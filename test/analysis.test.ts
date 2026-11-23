import assert from "node:assert/strict";
import { test } from "node:test";

import { createAnalysisController } from "../src/ui/analysis.ts";
import { evalKeyPrefix, openEvalStore, type EvalStore } from "../src/ui/evalcache.ts";
import type { AnalyzeOptions, EngineAdapter, EngineResult } from "../src/engine/types.ts";
import type { PositionAnalysis } from "../src/analyzer/analyzer.ts";

// ---------------------------------------------------------------- fakes

function fin(depth: number, bestMove: string, scoreCp: number): EngineResult {
  return { bestMove, scoreCp, mate: null, pv: [bestMove], depth, multipv: 1, final: true };
}

/** Minimal instant engine: one final result per position, in call order. */
class FakeEngine implements EngineAdapter {
  readonly calls: string[] = [];
  stopCalls = 0;
  disposeCalls = 0;

  async *analyze(fen: string, _opts: AnalyzeOptions): AsyncIterable<EngineResult> {
    this.calls.push(fen);
    yield fin(6, "e2e4", 10);
  }

  stop(): void {
    this.stopCalls++;
  }

  dispose(): void {
    this.disposeCalls++;
  }
}

class WarmFakeEngine extends FakeEngine {
  warmCalls = 0;

  warmup(): Promise<void> {
    this.warmCalls++;
    return Promise.resolve();
  }
}

/** Factory that hands out a fresh engine per call, tracking them. */
function fakeFactory(): { made: FakeEngine[]; create: () => FakeEngine } {
  const made: FakeEngine[] = [];
  return { made, create: () => { const engine = new FakeEngine(); made.push(engine); return engine; } };
}

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const AFTER_E4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1";
// After 1.e4 c5 (White to move again): distinct placement + clocks.
const AFTER_C5 = "rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq c6 0 2";

// ----------------------------------------------------------- live queries

test("analyzeNow analyzes only missing positions and caches them", async () => {
  const engine = new FakeEngine();
  const controller = createAnalysisController(() => engine);

  await controller.analyzeNow([START, AFTER_E4]);
  assert.deepEqual(engine.calls, [START, AFTER_E4], "both positions searched once");

  await controller.analyzeNow([START, AFTER_E4]); // both cached now
  assert.deepEqual(engine.calls, [START, AFTER_E4], "cached positions are not re-searched");

  await controller.analyzeNow([START, AFTER_E4, START.replace(" w ", " b ")]);
  assert.equal(engine.calls.length, 3, "only the missing third position hit the engine");
});

test("cache key ignores move clocks (transpositions share results)", async () => {
  const engine = new FakeEngine();
  const controller = createAnalysisController(() => engine);

  await controller.analyzeNow([START]);
  assert.ok(controller.get(START));
  assert.ok(
    controller.get(START.replace("- 0 1", "- 42 77")),
    "halfmove/fullmove clocks do not change the key",
  );
  assert.equal(
    controller.get(START.replace(" w ", " b ")),
    null,
    "a different turn is a different position",
  );
  assert.equal(engine.calls.length, 1, "clock-variant never re-analyzed");
});

test("a run skips positions a live search already covered", async () => {
  const engine = new FakeEngine();
  const controller = createAnalysisController(() => engine);

  await controller.analyzeNow([START, AFTER_E4]);
  const progress: [number, number][] = [];

  const outcome = await controller.start(
    [AFTER_E4, AFTER_C5],
    (done, total) => progress.push([done, total]),
  );

  assert.equal(outcome.aborted, false);
  assert.equal(outcome.done, 2, "both requested positions have results");
  assert.equal(outcome.total, 2);
  assert.deepEqual(progress[0], [1, 2], "progress starts at the first missing position");
  assert.deepEqual(engine.calls, [START, AFTER_E4, AFTER_C5], "no position searched twice");
  assert.equal(controller.isRunning(), false);
});

// ---------------------------------------------------------------- runs

test("cancel keeps partial results; the next run resumes at the first missing", async () => {
  const engine = new FakeEngine();
  const controller = createAnalysisController(() => engine);
  const positions = [START, AFTER_E4, AFTER_C5, START.replace(" w ", " b ")];

  const cancelled = await controller.start(positions, (done) => {
    if (done >= 1) controller.cancel(); // abort as soon as one is cached
  });
  assert.equal(cancelled.aborted, true);
  assert.equal(cancelled.done, 1, "the completed position is kept");
  assert.ok(controller.get(positions[0]!), "partial result cached");
  assert.equal(controller.get(positions[1]!), null, "unreached position stays uncached");

  const progress: number[] = [];
  const resumed = await controller.start(positions, (done) => progress.push(done));
  assert.equal(resumed.aborted, false);
  assert.equal(resumed.done, 4, "everything cached after resume");
  assert.equal(progress[0], 1, "resume starts counting at the first missing position");
  assert.deepEqual(
    engine.calls,
    positions,
    "each position hit the engine exactly once across both runs",
  );
});

test("FIFO: a live task queued behind a run executes after it", async () => {
  const engine = new FakeEngine();
  const controller = createAnalysisController(() => engine);

  const run = controller.start([START, AFTER_E4]);
  const live = controller.analyzeNow([AFTER_C5]);

  const liveOutcome = await live;
  const runOutcome = await run;
  assert.equal(liveOutcome, undefined, "live task resolves with nothing to report");
  assert.equal(runOutcome.aborted, false);
  assert.deepEqual(engine.calls, [START, AFTER_E4, AFTER_C5], "run first, live second");
});

test("start is single-flight while a run is queued or active", async () => {
  const engine = new FakeEngine();
  const controller = createAnalysisController(() => engine);

  const first = controller.start([START]);
  const second = controller.start([AFTER_E4]); // returns the in-flight promise
  assert.equal(first, second, "same promise for the same run");
  assert.equal(controller.isRunning(), true);

  const outcome = await first;
  assert.equal(outcome.done, 1, "the second start's positions were not analyzed");
  assert.deepEqual(engine.calls, [START]);
  assert.equal(controller.isRunning(), false);
});

test("cancel before the run reaches the engine never touches it", async () => {
  const engine = new FakeEngine();
  const controller = createAnalysisController(() => engine);

  // Queue the run behind a live task, then cancel while it waits.
  const live = controller.analyzeNow([START]);
  const run = controller.start([AFTER_E4, AFTER_C5]);
  controller.cancel();
  await live;

  const outcome = await run;
  assert.equal(outcome.aborted, true);
  assert.equal(outcome.done, 0, "nothing of the cancelled run was kept");
  assert.deepEqual(engine.calls, [START], "queued run skipped the engine entirely");
  assert.equal(engine.stopCalls, 0, "engine never stopped for a task that never ran");
});

test("dispose aborts the active run and resolves it as cancelled", async () => {
  const engine = new FakeEngine();
  const controller = createAnalysisController(() => engine);

  const run = controller.start([START, AFTER_E4]);
  controller.dispose();

  const outcome = await run;
  assert.equal(outcome.aborted, true);
  assert.equal(controller.isRunning(), false);
});

// ------------------------------------------------------------------ pool

const POSITIONS = [
  START,
  AFTER_E4,
  AFTER_C5,
  START.replace(" w ", " b "), // black to move at the start
  "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2",
  "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKB1R b KQkq - 1 2",
];

test("a run spreads its positions across the pool without duplication", async () => {
  const { made, create } = fakeFactory();
  const controller = createAnalysisController(create, 3);
  const progress: [number, number][] = [];

  const outcome = await controller.start(POSITIONS, (done, total) => progress.push([done, total]));

  assert.equal(outcome.aborted, false);
  assert.equal(outcome.done, POSITIONS.length);
  assert.equal(outcome.total, POSITIONS.length);
  assert.equal(made.length, 3, "all three pool engines were created");
  const all = made.flatMap((engine) => engine.calls);
  assert.equal(all.length, POSITIONS.length, "each position searched exactly once");
  assert.equal(new Set(all).size, POSITIONS.length, "no position searched twice");
  for (const fen of POSITIONS) {
    assert.ok(controller.get(fen), `result cached for ${fen}`);
  }
  assert.deepEqual(progress.at(-1), [POSITIONS.length, POSITIONS.length], "progress reaches total");
});

test("a live search runs on a single engine even with a pool", async () => {
  const { made, create } = fakeFactory();
  const controller = createAnalysisController(create, 4);

  await controller.analyzeNow([START, AFTER_E4]);

  assert.equal(made.length, 1, "live tasks do not spin up extra engines");
  assert.deepEqual(made[0]!.calls, [START, AFTER_E4], "one engine, positions in order");
});

test("warmup creates the whole pool and pays each engine's startup", async () => {
  const made: WarmFakeEngine[] = [];
  const controller = createAnalysisController(() => {
    const engine = new WarmFakeEngine();
    made.push(engine);
    return engine;
  }, 2);

  controller.warmup();

  assert.equal(made.length, 2, "every pool engine was created eagerly");
  assert.equal(made.filter((engine) => engine.warmCalls === 1).length, 2, "each engine warmed once");
});

test("dispose releases every pool engine that was created", async () => {
  const { made, create } = fakeFactory();
  const controller = createAnalysisController(create, 3);

  await controller.analyzeNow([START]); // live: only engine 0 is needed
  controller.dispose();

  assert.equal(made.length, 1, "only the needed engine was ever created");
  assert.equal(made[0]!.disposeCalls, 1, "and dispose released it");
});

test("seed plants results the run then skips", async () => {
  const engine = new FakeEngine();
  const controller = createAnalysisController(() => engine, 1);
  const seeded = {
    fen: START,
    result: { bestMove: "(none)", scoreCp: 0, mate: null, pv: [], depth: 0, multipv: 1, final: true },
    alternatives: [],
  };

  controller.seed([seeded]);
  assert.equal(controller.get(START), seeded, "seeded result is cached as-is");

  const outcome = await controller.start([START, AFTER_E4]);
  assert.equal(outcome.aborted, false);
  assert.equal(outcome.done, 2);
  assert.deepEqual(engine.calls, [AFTER_E4], "the run searched only the unseeded position");
  assert.equal(controller.get(START), seeded, "the seed survived the run");
});

// ------------------------------------------------------- persistent store

/** In-memory stand-in for the IndexedDB store (same async interface). */
class FakeStore implements EvalStore {
  readonly map = new Map<string, PositionAnalysis>();

  async get(key: string): Promise<PositionAnalysis | null> {
    return this.map.get(key) ?? null;
  }

  async put(key: string, analysis: PositionAnalysis): Promise<void> {
    this.map.set(key, analysis);
  }
}

test("results are written through to the persistent store", async () => {
  const store = new FakeStore();
  const controller = createAnalysisController(() => new FakeEngine(), 1, store);

  await controller.start([START, AFTER_E4]);

  assert.equal(store.map.size, 2, "both positions persisted");
  for (const key of store.map.keys()) {
    assert.ok(key.startsWith(evalKeyPrefix()), `key is settings-partitioned (${key})`);
  }
  assert.equal(
    store.map.size,
    new Set(store.map.keys()).size,
    "transposition-safe distinct keys",
  );
});

test("a second controller hydrates from the store and skips the engine", async () => {
  const store = new FakeStore();
  const first = createAnalysisController(() => new FakeEngine(), 1, store);
  await first.start([START, AFTER_E4]);

  const secondEngine = new FakeEngine();
  const second = createAnalysisController(() => secondEngine, 1, store);
  await second.hydrate([START, AFTER_E4]);
  assert.ok(second.get(START), "hydrate restored the start position");
  assert.ok(second.get(AFTER_E4), "hydrate restored the other position");

  const outcome = await second.start([START, AFTER_E4]);
  assert.equal(outcome.aborted, false);
  assert.equal(outcome.done, 2);
  assert.deepEqual(secondEngine.calls, [], "no engine search — everything came from disk");
});

test("hydrate overwrites nothing already in memory", async () => {
  const store = new FakeStore();
  await createAnalysisController(() => new FakeEngine(), 1, store).start([START]);

  const engine = new FakeEngine();
  const controller = createAnalysisController(() => engine, 1, store);
  // Start a live search BEFORE hydrating: the in-memory result must win.
  const live = controller.analyzeNow([START]);
  await controller.hydrate([START]);
  const duringHydrate = controller.get(START);
  await live;

  assert.ok(duringHydrate !== null, "the live search already had the position cached");
  assert.equal(engine.calls.length, 1, "one engine call total (live), none extra from hydrate");
});

test("openEvalStore is null where IndexedDB is unavailable", () => {
  // Node has no indexedDB global — the store must degrade to null.
  assert.equal(openEvalStore(), null);
});
