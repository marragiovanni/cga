import assert from "node:assert/strict";
import { test } from "node:test";

import {
  analyzeGame,
  gamePositions,
  type PositionAnalysis,
} from "../src/analyzer/analyzer.ts";
import { loadPgn } from "../src/chess/game.ts";
import type { AnalyzeOptions, EngineAdapter, EngineResult } from "../src/engine/types.ts";
import { StockfishWasmEngine } from "../src/engine/stockfish-wasm.ts";
import { nodeEngineTransport } from "./helpers/node-transport.ts";

// ---------------------------------------------------------------- fakes

function inter(depth: number, multipv: number, bestMove: string, scoreCp: number): EngineResult {
  return { bestMove, scoreCp, mate: null, pv: [bestMove], depth, multipv, final: false };
}

function fin(depth: number, bestMove: string, scoreCp: number): EngineResult {
  return { ...inter(depth, 1, bestMove, scoreCp), final: true };
}

class FakeEngine implements EngineAdapter {
  readonly calls: { fen: string; opts: AnalyzeOptions }[] = [];
  stopCalls = 0;
  onYield: ((result: EngineResult) => void) | null = null;
  private readonly script: (fen: string, call: number) => EngineResult[];

  constructor(script: (fen: string, call: number) => EngineResult[]) {
    this.script = script;
  }

  async *analyze(fen: string, opts: AnalyzeOptions): AsyncIterable<EngineResult> {
    const call = this.calls.length;
    this.calls.push({ fen, opts });
    for (const result of this.script(fen, call)) {
      this.onYield?.(result);
      yield result;
    }
  }

  stop(): void {
    this.stopCalls++;
  }

  dispose(): void {
    // fake engine: nothing to release
  }
}

const FENS = ["fen-0", "fen-1", "fen-2", "fen-3"];

// ------------------------------------------------------------ unit tests

test("analyzes every position sequentially and collects final + alternatives", async () => {
  const engine = new FakeEngine((_fen, call) => [
    inter(5, 1, "e2e4", 20 + call),
    inter(5, 2, "d2d4", 10 + call),
    inter(8, 1, "e2e4", 30 + call),
    inter(8, 2, "d2d4", 15 + call),
    fin(8, "e2e4", 30 + call),
  ]);
  const progress: [number, number][] = [];

  const out = await analyzeGame(engine, FENS, {
    depth: 10,
    onProgress: (done, total) => progress.push([done, total]),
  });

  assert.equal(out.aborted, false);
  assert.equal(engine.calls.length, 4, "one engine call per position");
  assert.deepEqual(
    engine.calls.map((c) => c.fen),
    FENS,
    "positions analyzed in order",
  );
  assert.equal(engine.calls[0]?.opts.depth, 10, "depth passed through");
  assert.equal(engine.calls[0]?.opts.multipv, 2, "multipv passed through");

  const first = out.results[0];
  assert.ok(first);
  assert.equal(first.result.final, true);
  assert.equal(first.result.bestMove, "e2e4");
  assert.equal(first.result.scoreCp, 30);
  assert.equal(first.alternatives.length, 1);
  assert.equal(first.alternatives[0]?.multipv, 2);
  assert.equal(first.alternatives[0]?.depth, 8, "alternative keeps deepest snapshot");

  const second = out.results[1];
  assert.ok(second);
  assert.equal(second.result.scoreCp, 31, "per-position results are independent");

  assert.deepEqual(progress, [
    [0, 4],
    [1, 4],
    [2, 4],
    [3, 4],
    [4, 4],
  ]);
});

test("resume: skips positions already computed and keeps their results", async () => {
  const engine = new FakeEngine(() => [fin(6, "a2a3", 5)]);
  const existing: (PositionAnalysis | null)[] = [
    { fen: FENS[0]!, result: fin(6, "a2a3", 5), alternatives: [] },
    null,
    { fen: FENS[2]!, result: fin(6, "a2a3", 5), alternatives: [] },
    null,
  ];
  const progress: [number, number][] = [];

  const out = await analyzeGame(engine, FENS, {
    depth: 6,
    existing,
    onProgress: (done, total) => progress.push([done, total]),
  });

  assert.equal(out.aborted, false);
  assert.deepEqual(
    engine.calls.map((c) => c.fen),
    [FENS[1], FENS[3]],
    "only missing positions hit the engine",
  );
  assert.equal(out.results[0], existing[0], "existing result kept as-is");
  assert.equal(out.results[2], existing[2], "existing result kept as-is");
  assert.ok(out.results[1], "missing position computed");
  assert.ok(out.results[3], "missing position computed");
  assert.deepEqual(progress, [
    [2, 4],
    [3, 4],
    [4, 4],
  ]);
});

test("abort before start: nothing runs, everything stays null", async () => {
  const engine = new FakeEngine(() => [fin(6, "a2a3", 5)]);
  const controller = new AbortController();
  controller.abort();

  const out = await analyzeGame(engine, FENS, { depth: 6, signal: controller.signal });

  assert.equal(out.aborted, true);
  assert.equal(engine.calls.length, 0, "engine never called");
  assert.ok(out.results.every((r) => r === null));
});

test("abort mid-position: current result discarded, engine stopped, resume-safe", async () => {
  const controller = new AbortController();
  const engine = new FakeEngine(() => [
    inter(3, 1, "e2e4", 10),
    inter(5, 1, "e2e4", 20),
    inter(5, 2, "d2d4", 10),
    fin(8, "e2e4", 30),
  ]);
  engine.onYield = (result) => {
    if (result.depth === 5) controller.abort();
  };

  const out = await analyzeGame(engine, FENS, { depth: 8, signal: controller.signal });

  assert.equal(out.aborted, true);
  assert.ok(engine.stopCalls >= 1, "abort stops the engine immediately");
  assert.equal(out.results[0], null, "cut-short result is discarded, not saved");
  assert.ok(out.results.slice(1).every((r) => r === null));
});

test("passes movetime through instead of depth", async () => {
  const engine = new FakeEngine(() => [fin(1, "a2a3", 5)]);
  await analyzeGame(engine, [FENS[0]!], { movetimeMs: 500 });
  assert.equal(engine.calls[0]?.opts.movetimeMs, 500);
  assert.equal(engine.calls[0]?.opts.depth, undefined);
});

test("empty position list reports (0, 0) and finishes", async () => {
  const engine = new FakeEngine(() => []);
  const progress: [number, number][] = [];
  const out = await analyzeGame(engine, [], {
    onProgress: (done, total) => progress.push([done, total]),
  });
  assert.equal(out.aborted, false);
  assert.deepEqual(out.results, []);
  assert.deepEqual(progress, [[0, 0]]);
  assert.equal(engine.calls.length, 0);
});

// -------------------------------------------------- real engine, real game

const OPERA_PGN = `[Event "Paris Opera"]
[White "Paul Morphy"]
[Black "Duke Karl / Count Isouard"]
[Result "1-0"]

1.e4 e5 2.Nf3 d6 3.d4 Bg4 4.dxe5 Bxf3 5.Qxf3 dxe5 6.Bc4 Nf6 7.Qb3 Qe7 8.Nc3 c6 9.Bg5 b5 10.Nxb5 cxb5 11.Bxb5+ Nbd7 12.O-O-O Rd8 13.Rxd7 Rxd7 14.Rd1 Qe6 15.Bxd7+ Nxd7 16.Qb8+ Nxb8 17.Rd8# 1-0`;

test("gamePositions yields N+1 positions for N moves", () => {
  const game = loadPgn(OPERA_PGN);
  const positions = gamePositions(game);
  assert.equal(positions.length, game.moves.length + 1);
  assert.equal(positions[0], game.moves[0]?.fenBefore);
  assert.equal(positions.at(-1), game.moves.at(-1)?.fenAfter);
});

test(
  "analyzes a real game: every position, progress, alternatives",
  { timeout: 120_000 },
  async () => {
    const game = loadPgn(OPERA_PGN);
    const subset = gamePositions(game).slice(0, 10);
    const engine = new StockfishWasmEngine(nodeEngineTransport());
    try {
      const progress: [number, number][] = [];
      const out = await analyzeGame(engine, subset, {
        depth: 8,
        multipv: 2,
        onProgress: (done, total) => progress.push([done, total]),
      });

      assert.equal(out.aborted, false);
      const analyses = out.results.filter((r): r is PositionAnalysis => r !== null);
      assert.equal(analyses.length, subset.length, "every position analyzed");

      for (const analysis of analyses) {
        assert.ok(analysis.result.final);
        assert.match(
          analysis.result.bestMove,
          /^(?:[a-h][1-8]){2}[qrbn]?$/,
          "final best move must be a legal UCI move",
        );
        assert.ok(analysis.alternatives.length >= 1, "expected a MultiPV=2 alternative");
      }

      assert.equal(progress.at(-1)?.[0], subset.length, "progress reaches the total");
      for (let i = 1; i < progress.length; i++) {
        assert.ok((progress[i]?.[0] ?? 0) >= (progress[i - 1]?.[0] ?? 0), "progress is monotonic");
      }
    } finally {
      engine.dispose();
    }
  },
);

test(
  "engine scores are from the side to move's perspective (UCI convention)",
  { timeout: 60_000 },
  async () => {
    // Black is a full queen ahead with black to move: a positive score
    // must mean "good for the side to move" (black), not "good for White".
    const FEN = "q5k1/5ppp/8/8/8/8/5PPP/6K1 b - - 0 1";
    const engine = new StockfishWasmEngine(nodeEngineTransport());
    try {
      let final: EngineResult | null = null;
      for await (const result of engine.analyze(FEN, { depth: 10, multipv: 1 })) {
        if (result.final) final = result;
      }
      assert.ok(final, "expected a final result");
      const value =
        final.scoreCp ?? (final.mate !== null && final.mate > 0 ? 10_000 : -10_000);
      assert.ok(
        value > 300,
        `expected a positive side-to-move score, got cp=${final.scoreCp} mate=${final.mate}`,
      );
    } finally {
      engine.dispose();
    }
  },
);
