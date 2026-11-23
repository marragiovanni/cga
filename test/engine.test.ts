import assert from "node:assert/strict";
import { test } from "node:test";

import { StockfishWasmEngine } from "../src/engine/stockfish-wasm.ts";
import type { EngineResult } from "../src/engine/types.ts";
import { nodeEngineTransport } from "./helpers/node-transport.ts";

// White rook on e1: Re8# is mate in one.
const MATE_IN_ONE = "6k1/5ppp/8/8/8/8/8/4R1K1 w - - 0 1";
const STARTPOS = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

test(
  "engine streams info results and finds the mate in one",
  { timeout: 60_000 },
  async () => {
    const engine = new StockfishWasmEngine(nodeEngineTransport());
    try {
      const results: EngineResult[] = [];
      for await (const result of engine.analyze(MATE_IN_ONE, { depth: 14, multipv: 2 })) {
        results.push(result);
      }

      // The stream must end with a final result carrying the best move.
      const final = results.at(-1);
      assert.ok(final, "expected at least one result");
      assert.equal(final.final, true);
      assert.equal(final.bestMove, "e1e8", "expected Re8# (mate in one)");

      // Streaming: several intermediate results before the final one.
      const streamed = results.filter((r) => !r.final);
      assert.ok(streamed.length >= 2, `expected streaming info, got ${streamed.length}`);
      assert.ok(
        streamed.some((r) => r.pv.length > 0),
        "expected at least one principal variation",
      );
      assert.ok(
        streamed.some((r) => r.multipv === 2),
        "expected an alternative line (MultiPV = 2)",
      );
      assert.ok(
        streamed.some((r) => r.mate !== null),
        "expected a mate score in the stream",
      );
      assert.ok(
        new Set(streamed.map((r) => r.depth)).size >= 2,
        "expected results at increasing depths",
      );
    } finally {
      engine.dispose();
    }
  },
);

test(
  "engine reuses the handshake for a second search",
  { timeout: 60_000 },
  async () => {
    const engine = new StockfishWasmEngine(nodeEngineTransport());
    try {
      let last: EngineResult | null = null;
      for await (const result of engine.analyze(STARTPOS, { depth: 8, multipv: 1 })) {
        last = result;
      }
      assert.ok(last?.final, "expected a final result");
      assert.match(last.bestMove, /^(?:[a-h][1-8]){2}[qrbn]?$/, "expected a legal UCI move");
      assert.ok(last.pv.length > 0, "expected a PV on the final result");
    } finally {
      engine.dispose();
    }
  },
);

test("stop() and dispose() are safe when idle", () => {
  const engine = new StockfishWasmEngine(nodeEngineTransport());
  engine.stop();
  engine.stop();
  engine.dispose();
  engine.dispose(); // double dispose must not throw
});

test(
  "supports a time limit per position instead of a depth",
  { timeout: 30_000 },
  async () => {
    const engine = new StockfishWasmEngine(nodeEngineTransport());
    try {
      let last: EngineResult | null = null;
      for await (const result of engine.analyze(STARTPOS, { movetimeMs: 300, multipv: 1 })) {
        last = result;
      }
      assert.ok(last?.final, "expected a final result");
      assert.match(last.bestMove, /^(?:[a-h][1-8]){2}[qrbn]?$/);
    } finally {
      engine.dispose();
    }
  },
);
