import type { AnalyzeOptions, EngineAdapter, EngineResult } from "./types.ts";
import type { EngineTransport } from "./transport.ts";
import { WebWorkerTransport } from "./transport.ts";
import { infoToResult, parseUciLine } from "./uci.ts";

const HANDSHAKE_TIMEOUT_MS = 15_000;
const SEARCH_LINE_TIMEOUT_MS = 30_000;
const STOP_DRAIN_TIMEOUT_MS = 5_000;

interface Waiter {
  resolve: (line: string | null) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Stockfish WASM behind a clean API.
 *
 * All UCI knowledge lives here (and in `uci.ts`): the rest of the program
 * only calls `analyze()` / `stop()` / `dispose()` and receives typed
 * `EngineResult` objects — it never sees raw protocol text.
 *
 * Line handling is queue-based with a single persistent listener, because
 * the engine may answer synchronously inside `send()` (observed in Node);
 * swapping per-wait handlers loses lines.
 */
export class StockfishWasmEngine implements EngineAdapter {
  private readonly transport: EngineTransport;
  private buffer: string[] = [];
  private waiters: Waiter[] = [];
  private closed = false;
  private readyPromise: Promise<void> | null = null;
  private searching = false;

  constructor(transport: EngineTransport) {
    this.transport = transport;
    transport.onLine((line) => this.pushLine(line));
    transport.onFatal((error) => this.fail(error));
  }

  // ------------------------------------------------------------------ lines

  private pushLine(line: string): void {
    const waiter = this.waiters.shift();
    if (waiter) {
      clearTimeout(waiter.timer);
      waiter.resolve(line);
    } else {
      this.buffer.push(line);
    }
  }

  /** Resolve with the next engine line, or null if the engine is gone. */
  private nextLine(timeoutMs: number): Promise<string | null> {
    const buffered = this.buffer.shift();
    if (buffered !== undefined) return Promise.resolve(buffered);
    if (this.closed) return Promise.resolve(null);
    return new Promise<string | null>((resolve, reject) => {
      const waiter: Waiter = {
        resolve,
        reject,
        timer: setTimeout(() => {
          const index = this.waiters.indexOf(waiter);
          if (index !== -1) this.waiters.splice(index, 1);
          reject(new Error(`engine produced no output for ${timeoutMs}ms`));
        }, timeoutMs),
      };
      this.waiters.push(waiter);
    });
  }

  private fail(error: Error): void {
    if (this.closed) return;
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    this.buffer.length = 0;
  }

  // -------------------------------------------------------------- handshake

  private async handshake(): Promise<void> {
    this.transport.send("uci");
    await this.waitForEvent("uciok", HANDSHAKE_TIMEOUT_MS);
    // Fixed per-worker settings: one search thread (the pool parallelizes
    // across positions instead — lazy SMP gives nothing at shallow depth)
    // and a small hash so several workers don't squeeze memory. Both are
    // no-ops on the single-threaded build's Threads option, but explicit
    // beats implicit.
    this.transport.send("setoption name Threads value 1");
    this.transport.send("setoption name Hash value 16");
    this.transport.send("isready");
    await this.waitForEvent("readyok", HANDSHAKE_TIMEOUT_MS);
  }

  private async waitForEvent(event: "uciok" | "readyok", timeoutMs: number): Promise<void> {
    for (;;) {
      const line = await this.nextLine(timeoutMs);
      if (line === null) throw new Error("engine terminated during handshake");
      const parsed = parseUciLine(line);
      if (parsed?.type === event) return;
      // Ignore everything else (banner, id, option, blank lines).
    }
  }

  private ensureReady(): Promise<void> {
    if (this.readyPromise === null) {
      this.readyPromise = this.handshake().catch((error: unknown) => {
        this.readyPromise = null;
        throw error;
      });
    }
    return this.readyPromise;
  }

  // ----------------------------------------------------------------- search

  /**
   * Analyze a position. Yields one typed result per improving `info`
   * line (streaming), always ending with a `final: true` result carrying
   * the definitive best move.
   */
  async *analyze(fen: string, opts: AnalyzeOptions): AsyncIterable<EngineResult> {
    const multipv = Math.max(1, opts.multipv);
    const go =
      opts.movetimeMs !== undefined
        ? `go movetime ${Math.max(1, Math.round(opts.movetimeMs))}`
        : opts.depth !== undefined
          ? `go depth ${Math.max(1, opts.depth)}`
          : null;
    if (go === null) throw new Error("analyze() requires a depth or movetimeMs");

    await this.ensureReady();
    if (this.closed) throw new Error("engine has been disposed");
    if (this.searching) throw new Error("a search is already in progress");
    this.searching = true;

    let sawBestMove = false;
    let lastMainLine: EngineResult | null = null;

    try {
      this.transport.send(`setoption name MultiPV value ${multipv}`);
      this.transport.send(`position fen ${fen}`);
      this.transport.send(go);

      for (;;) {
        const line = await this.nextLine(SEARCH_LINE_TIMEOUT_MS);
        if (line === null) throw new Error("engine terminated during search");
        const parsed = parseUciLine(line);
        if (parsed === null) continue;

        if (parsed.type === "info") {
          const result = infoToResult(parsed, false);
          if (result === null) continue;
          if (result.multipv === 1) lastMainLine = result;
          yield result;
        } else if (parsed.type === "bestmove") {
          sawBestMove = true;
          const base: EngineResult = lastMainLine ?? {
            bestMove: parsed.bestMove,
            scoreCp: null,
            mate: null,
            pv: [],
            depth: 0,
            multipv: 1,
            final: false,
          };
          yield { ...base, bestMove: parsed.bestMove, final: true };
          return;
        }
      }
    } finally {
      this.searching = false;
      if (!sawBestMove && !this.closed) {
        // Consumer stopped early (break/dispose): ask the engine to wind
        // down and swallow the trailing output so the next search starts
        // from a clean stream. An idle `stop` produces no output, so this
        // is safe even if the search already finished.
        this.transport.send("stop");
        await this.drainUntilBestMove();
      }
    }
  }

  private async drainUntilBestMove(): Promise<void> {
    try {
      for (;;) {
        const line = await this.nextLine(STOP_DRAIN_TIMEOUT_MS);
        if (line === null) return;
        const parsed = parseUciLine(line);
        if (parsed?.type === "bestmove") return;
      }
    } catch {
      // Engine wedged or timed out while stopping — give up quietly; the
      // next search will surface any real problem.
    }
  }

  /** Abort the search in progress. The stream then ends with the engine's
   *  final `bestmove` for that search. Safe to call when idle. */
  stop(): void {
    if (this.searching) this.transport.send("stop");
  }

  /** Pay the startup cost (worker script, WASM compile, NNUE load,
   *  `uci`/`isready` handshake) without searching. */
  warmup(): Promise<void> {
    return this.ensureReady();
  }

  /** Release the engine. Pending streams end; the adapter is unusable. */
  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.resolve(null);
    }
    this.buffer.length = 0;
    this.transport.terminate();
  }
}

// ------------------------------------------------------------------ factory

// The engine lives in public/stockfish/ and is copied next to the build
// output by scripts/copy-engine.mjs. During development it is served from
// the site root; in a production bundle this module is emitted into
// <base>/assets/, one level below it. Resolving from import.meta.url thus
// works both at a domain root and under a sub-path.
const WORKER_PATH = "stockfish/engine.js";

/** URL of the bundled engine worker (base-path aware). */
export function defaultWorkerUrl(): URL {
  const isDev = Boolean(import.meta.env && import.meta.env.DEV);
  if (typeof globalThis.location?.origin === "string") {
    return isDev
      ? new URL(WORKER_PATH, globalThis.location.origin)
      // Built assets live in <base>/assets/, so the engine is one level up.
      // Concatenation (not a template literal) keeps Vite from treating this
      // as a static asset reference and rewriting it.
      : new URL("../" + WORKER_PATH, import.meta.url);
  }
  // Node (unit tests): resolve next to this module — never fetched.
  return new URL(WORKER_PATH, import.meta.url);
}

/** Convenience: engine running in a Web Worker (browser). */
export function createWebEngine(workerUrl: string | URL = defaultWorkerUrl()): StockfishWasmEngine {
  return new StockfishWasmEngine(new WebWorkerTransport(workerUrl));
}
