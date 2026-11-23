import assert from "node:assert/strict";
import { test } from "node:test";

import { infoToResult, parseUciLine } from "../src/engine/uci.ts";

test("parses a full info line with cp score and pv", () => {
  const ev = parseUciLine(
    "info depth 12 seldepth 16 multipv 1 score cp 34 nodes 50000 nps 250000 hashfull 100 time 200 pv e2e4 e7e5 g1f3",
  );
  assert.deepEqual(ev, {
    type: "info",
    depth: 12,
    seldepth: 16,
    multipv: 1,
    scoreCp: 34,
    nodes: 50000,
    nps: 250000,
    hashfull: 100,
    timeMs: 200,
    pv: ["e2e4", "e7e5", "g1f3"],
  });
});

test("parses negative cp scores", () => {
  const ev = parseUciLine("info depth 8 score cp -45 pv e2e5");
  assert.ok(ev?.type === "info");
  assert.equal(ev.scoreCp, -45);
  assert.equal(ev.scoreMate, undefined);
});

test("parses mate scores", () => {
  const ev = parseUciLine("info depth 10 multipv 1 score mate 3 pv e1e8");
  assert.ok(ev?.type === "info");
  assert.equal(ev.scoreMate, 3);
  assert.equal(ev.scoreCp, undefined);
});

test("parses score bounds", () => {
  const ev = parseUciLine("info depth 5 score cp 40 lowerbound pv e2e4");
  assert.ok(ev?.type === "info");
  assert.equal(ev.scoreCp, 40);
  assert.equal(ev.scoreBound, "lowerbound");
});

test("parses multipv 2 lines (alternatives)", () => {
  const ev = parseUciLine("info depth 9 multipv 2 score cp 20 pv d2d4 d7d5");
  assert.ok(ev?.type === "info");
  assert.equal(ev.multipv, 2);
  assert.deepEqual(ev.pv, ["d2d4", "d7d5"]);
});

test("parses promotion and castling moves in the pv", () => {
  const ev = parseUciLine("info depth 7 score cp 10 pv e7e8q e8e7 e1g1");
  assert.ok(ev?.type === "info");
  assert.deepEqual(ev.pv, ["e7e8q", "e8e7", "e1g1"]);
});

test("parses info string lines", () => {
  const ev = parseUciLine("info string Network replica 1: Local memory.");
  assert.ok(ev?.type === "info");
  assert.equal(ev.string, "Network replica 1: Local memory.");
});

test("parses bestmove with ponder", () => {
  assert.deepEqual(parseUciLine("bestmove e2e4 ponder e7e5"), {
    type: "bestmove",
    bestMove: "e2e4",
    ponder: "e7e5",
  });
});

test("parses bestmove without ponder", () => {
  assert.deepEqual(parseUciLine("bestmove e1g1"), {
    type: "bestmove",
    bestMove: "e1g1",
  });
});

test("parses bestmove (none) for mate/stalemate positions", () => {
  assert.deepEqual(parseUciLine("bestmove (none)"), {
    type: "bestmove",
    bestMove: "(none)",
  });
});

test("parses uciok / readyok / id lines", () => {
  assert.deepEqual(parseUciLine("uciok"), { type: "uciok" });
  assert.deepEqual(parseUciLine("readyok"), { type: "readyok" });
  assert.deepEqual(parseUciLine("id name Stockfish 19 Lite WASM"), {
    type: "id",
    key: "name",
    value: "Stockfish 19 Lite WASM",
  });
  assert.deepEqual(parseUciLine("id author the Stockfish developers"), {
    type: "id",
    key: "author",
    value: "the Stockfish developers",
  });
});

test("returns null for banners, blanks and unknown lines", () => {
  assert.equal(parseUciLine(""), null);
  assert.equal(parseUciLine("   "), null);
  assert.equal(parseUciLine("Stockfish 19 Lite WASM by the Stockfish developers"), null);
  assert.equal(parseUciLine("option name Hash type spin default 16"), null);
  assert.equal(parseUciLine("whatever 1 2 3"), null);
});

// ------------------------------------------------------------- infoToResult

test("infoToResult maps an info line to a streaming EngineResult", () => {
  const ev = parseUciLine("info depth 14 multipv 1 score cp -62 pv e2e4 e7e5");
  assert.ok(ev?.type === "info");
  const result = infoToResult(ev, false);
  assert.deepEqual(result, {
    bestMove: "e2e4",
    scoreCp: -62,
    mate: null,
    pv: ["e2e4", "e7e5"],
    depth: 14,
    multipv: 1,
    final: false,
  });
});

test("infoToResult defaults multipv to 1", () => {
  const ev = parseUciLine("info depth 5 score cp 10 pv e2e4");
  assert.ok(ev?.type === "info");
  assert.equal(infoToResult(ev, false)?.multipv, 1);
});

test("infoToResult rejects lines without score or without pv", () => {
  const noScore = parseUciLine("info string some message");
  assert.ok(noScore?.type === "info");
  assert.equal(infoToResult(noScore, false), null);

  const noPv = parseUciLine("info depth 6 score cp 20");
  assert.ok(noPv?.type === "info");
  assert.equal(infoToResult(noPv, false), null);
});
