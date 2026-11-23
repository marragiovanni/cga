/**
 * Analysis orchestration — owns a pool of engine workers and a FIFO queue
 * of search tasks over a shared, position-keyed result cache.
 *
 * Two task kinds share the pool (a search is one engine at a time, but
 * several engines may search different positions at once):
 *
 *   - **run**  — a full pass over a line's positions, with progress and
 *     cancellation (the Analyze button). Missing-only: any
 *     position already cached (from a previous run, a resume, or a live
 *     search) is skipped, so "resume" and "re-analyze" are the same
 *     operation. The missing positions sit in a shared queue that every
 *     free engine pulls from — dynamic dispatch balances uneven position
 *     costs, and wall-clock drops roughly with the pool size.
 *   - **live** — a short request for the positions a just-played move
 *     needs, queued behind whatever is running, silent (single engine).
 *
 * Because an engine evaluation of a position never goes stale, nothing
 * needs aborting when a live task arrives: tasks simply execute in
 * order, each reading the cache when its turn comes. The cache key is
 * the first four FEN fields (placement, turn, castling, en passant) so
 * transposed move orders share results while halfmove/fullmove clocks
 * don't leak into the key.
 *
 * Deliberately UI-agnostic: progress goes through a callback, the
 * caller applies classifications.
 */

import { analyzeGame, type PositionAnalysis } from "../analyzer/analyzer.ts";
import labels from "../config/labels.json" with { type: "json" };
import { createWebEngine } from "../engine/stockfish-wasm.ts";
import { evalKeyPrefix, type EvalStore } from "./evalcache.ts";
import type { EngineAdapter } from "../engine/types.ts";

export interface RunOutcome {
  /** True when the run was cancelled before analyzing everything. */
  aborted: boolean;
  /** Positions of this run with a result (kept ones included). */
  done: number;
  total: number;
}

export interface AnalysisController {
  /** Cached analysis for a position, or null (transposition-safe key). */
  get(fen: string): PositionAnalysis | null;
  /**
   * Put precomputed results into the cache without touching the
   * engines — synthesized terminal analyses (see `analyzer/skip.ts`)
   * and results restored from persistent storage.
   */
  seed(results: readonly PositionAnalysis[]): void;
  /**
   * Restore results for `positions` from the persistent store (a
   * no-op without one). Runs and live tasks wait for pending restores
   * before consulting the cache, so a hydrate racing a run is safe.
   */
  hydrate(positions: readonly string[]): Promise<void>;
  /**
   * Start (or resume) a run over `positions`. No-op while a run is
   * active: the in-flight run's promise is returned instead.
   */
  start(positions: readonly string[], onProgress?: (done: number, total: number) => void): Promise<RunOutcome>;
  /** Analyze `positions` now (queued behind current work); silent. */
  analyzeNow(positions: readonly string[]): Promise<void>;
  /** Cancel the active/queued run; results computed so far are kept. */
  cancel(): void;
  isRunning(): boolean;
  /**
   * Create the engine pool in the background (WASM compile + handshake)
   * so pressing Analyze pays no init cost. Safe to call repeatedly.
   */
  warmup(): void;
  /** Abort everything and release the workers. */
  dispose(): void;
}

/** Position identity: placement, turn, castling rights, en passant. */
function cacheKey(fen: string): string {
  return fen.split(" ").slice(0, 4).join(" ");
}

interface RunTask {
  kind: "run";
  positions: readonly string[];
  onProgress?: (done: number, total: number) => void;
  controller: AbortController;
  resolve: (outcome: RunOutcome) => void;
  reject: (error: unknown) => void;
}

interface LiveTask {
  kind: "live";
  positions: readonly string[];
  resolve: () => void;
  reject: (error: unknown) => void;
}

type Task = RunTask | LiveTask;

export function createAnalysisController(
  createEngine: () => EngineAdapter = createWebEngine,
  engineCount = 1,
  persistent?: EvalStore,
): AnalysisController {
  /** Lazy pool: engine *i* is created the first time it is needed. */
  const engines: (EngineAdapter | undefined)[] = [];
  const cache = new Map<string, PositionAnalysis>();
  let queue: Task[] = [];
  let pumping = false;
  /** The queued-or-running run (button state + single-flight start). */
  let currentRun: { task: RunTask; promise: Promise<RunOutcome> } | null = null;

  /** Key of a position in the persistent store (settings-partitioned). */
  const storeKey = (fen: string): string => evalKeyPrefix() + cacheKey(fen);

  /**
   * Pending persistent-cache restores. Tasks await this chain before
   * reading the cache, so a hydrate issued at game load always lands
   * before a run decides what to search — no wasted searches.
   */
  let hydrating: Promise<void> = Promise.resolve();

  const hydrate = (positions: readonly string[]): Promise<void> => {
    if (!persistent) return Promise.resolve();
    const task = hydrating.then(async () => {
      for (const fen of positions) {
        // The in-memory cache wins: engine results already in hand are
        // as good as anything on disk, and re-seeding would be waste.
        if (get(fen) !== null) continue;
        const restored = await persistent.get(storeKey(fen));
        if (restored) cache.set(cacheKey(restored.fen), restored);
      }
    });
    hydrating = task.catch(() => {}); // a failed restore never blocks the queue
    return task;
  };

  /** Engine *i* of the pool, created on first use. */
  const getEngine = (index: number): EngineAdapter => (engines[index] ??= createEngine());

  const get = (fen: string): PositionAnalysis | null => cache.get(cacheKey(fen)) ?? null;

  const commit = (results: readonly (PositionAnalysis | null)[]): void => {
    for (const result of results) {
      if (result) {
        cache.set(cacheKey(result.fen), result);
        persist(result);
      }
    }
  };

  /** Write-through to the persistent store; never blocks, never throws. */
  const persist = (result: PositionAnalysis): void => {
    void persistent?.put(storeKey(result.fen), result).catch(() => {
      // degraded mode: persistence is best-effort
    });
  };

  const doneIn = (positions: readonly string[]): number =>
    positions.reduce((n, fen) => n + (get(fen) !== null ? 1 : 0), 0);

  const enqueue = (task: Task): void => {
    queue.push(task);
    void pump();
  };

  async function execute(task: Task): Promise<void> {
    if (task.kind === "run" && task.controller.signal.aborted) {
      // Cancelled before its turn came: never touch the engine.
      finishRun(task, true);
      return;
    }
    try {
      // Let pending persistent-store restores land first: a run issued
      // right after a game load must not re-search what disk has.
      await hydrating;
      const existing = task.positions.map((fen) => get(fen));
      if (task.kind === "live" && existing.every((r) => r !== null)) {
        task.resolve();
        return;
      }
      if (task.kind === "run") {
        await executeParallel(task);
      } else {
        // Live searches are tiny (1-2 positions); a single engine keeps
        // their latency at its bare minimum.
        const out = await analyzeGame(getEngine(0), task.positions, {
          depth: labels.engine.depth,
          multipv: labels.engine.multipv,
          existing,
        });
        commit(out.results);
        task.resolve();
      }
      if (task.kind === "run") {
        if (existing.every((r) => r !== null)) {
          await new Promise((r) => setTimeout(r, 80));
        }
        finishRun(task, task.controller.signal.aborted);
      }
    } catch (error) {
      if (task.kind === "run") {
        if (currentRun?.task === task) currentRun = null;
      }
      task.reject(error);
    }
  }

  /**
   * Run a full pass across the engine pool: the missing positions sit in
   * a shared queue and every free engine pulls the next one, so uneven
   * position costs balance out dynamically instead of by pre-assigned
   * slices. Progress aggregates over all engines; cancellation stops
   * each engine at its next position boundary (the in-flight search is
   * stopped by the signal listener inside `analyzeGame` and discarded).
   */
  async function executeParallel(
    task: RunTask,
  ): Promise<void> {
    const missing = task.positions.filter((fen) => get(fen) === null);
    const total = task.positions.length;
    const base = total - missing.length;
    task.onProgress?.(base, total);
    if (missing.length === 0) return;

    const count = Math.max(1, Math.min(engineCount, missing.length));
    const pending = [...missing];
    let done = 0;
    const tick = (): void => task.onProgress?.(base + done, total);

    const worker = async (engine: EngineAdapter): Promise<void> => {
      for (;;) {
        if (task.controller.signal.aborted) return;
        const fen = pending.shift();
        if (fen === undefined) return;
        const out = await analyzeGame(engine, [fen], {
          depth: labels.engine.depth,
          multipv: labels.engine.multipv,
          signal: task.controller.signal,
        });
        const result = out.results[0];
        if (result) {
          cache.set(cacheKey(result.fen), result);
          persist(result);
          done++;
          tick();
        }
      }
    };

    await Promise.all(
      Array.from({ length: count }, (_, index) => worker(getEngine(index))),
    );
  }

  function finishRun(task: RunTask, aborted: boolean): void {
    if (currentRun?.task === task) currentRun = null;
    task.resolve({
      aborted,
      done: doneIn(task.positions),
      total: task.positions.length,
    });
  }

  async function pump(): Promise<void> {
    if (pumping) return;
    pumping = true;
    try {
      while (queue.length > 0) {
        const task = queue.shift()!;
        await execute(task);
      }
    } finally {
      pumping = false;
    }
  }

  return {
    get,

    seed(results): void {
      commit(results);
    },

    hydrate(positions): Promise<void> {
      return hydrate(positions);
    },

    start(positions, onProgress): Promise<RunOutcome> {
      if (currentRun) return currentRun.promise;

      let resolve!: (outcome: RunOutcome) => void;
      let reject!: (error: unknown) => void;
      const promise = new Promise<RunOutcome>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      const task: RunTask = {
        kind: "run",
        positions,
        onProgress,
        controller: new AbortController(),
        resolve,
        reject,
      };
      currentRun = { task, promise };
      enqueue(task);
      return promise;
    },

    analyzeNow(positions): Promise<void> {
      const missing = positions.filter((fen) => get(fen) === null);
      if (missing.length === 0) return Promise.resolve();

      return new Promise<void>((resolve, reject) => {
        enqueue({ kind: "live", positions: missing, resolve, reject });
      });
    },

    cancel(): void {
      currentRun?.task.controller.abort();
    },

    isRunning(): boolean {
      return currentRun !== null;
    },

    warmup(): void {
      // Fire and forget: each engine pays its startup (worker script,
      // WASM compile, NNUE load, handshake) while the page idles, so
      // pressing Analyze starts searching immediately.
      for (let index = 0; index < Math.max(1, engineCount); index++) {
        void getEngine(index).warmup?.().catch(() => {
          // A failed warm-up just means the engine initializes lazily
          // on first use, like before.
        });
      }
    },

    dispose(): void {
      currentRun?.task.controller.abort();
      currentRun = null;
      for (const task of queue) {
        if (task.kind === "run") {
          task.resolve({ aborted: true, done: doneIn(task.positions), total: task.positions.length });
        } else {
          task.resolve();
        }
      }
      queue = [];
      for (const engine of engines.splice(0)) {
        engine?.dispose();
      }
    },
  };
}
