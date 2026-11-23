import { test } from "node:test";
import assert from "node:assert/strict";

import { loadPgn, positionAt, START_FEN } from "../src/chess/game.ts";

const OPERA_PGN = `[Event "Paris Opera"]
[Site "Paris FRA"]
[Date "1858.??.??"]
[White "Morphy, Paul"]
[Black "Duke Karl / Count Isouard"]
[Result "1-0"]

1.e4 e5 2.Nf3 d6 3.d4 Bg4 4.dxe5 Bxf3 5.Qxf3 dxe5 6.Bc4 Nf6 7.Qb3 Qe7
8.Nc3 c6 9.Bg5 b5 10.Nxb5 cxb5 11.Bxb5+ Nbd7 12.O-O-O Rd8 13.Rxd7 Rxd7
14.Rd1 Qe6 15.Bxd7+ Nxd7 16.Qb8+ Nxb8 17.Rd8# 1-0`;

const game = loadPgn(OPERA_PGN);

test("ply 0 is the start position with no last move", () => {
  const pos = positionAt(game, 0);
  assert.equal(pos.fen, START_FEN);
  assert.equal(pos.lastMove, null);
  assert.equal(pos.check, null);
});

test("ply 1 is the position after the first move", () => {
  const pos = positionAt(game, 1);
  assert.deepEqual(pos.lastMove, ["e2", "e4"]);
  assert.ok(pos.fen.startsWith("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b"));
  assert.equal(pos.check, null);
});

test("middle plies reproduce the recorded fenAfter and last move", () => {
  for (const ply of [2, 5, 17, 30]) {
    const move = game.moves[ply - 1];
    assert.ok(move);
    const pos = positionAt(game, ply);
    assert.equal(pos.fen, move.fenAfter, `fen at ply ${ply}`);
    assert.deepEqual(pos.lastMove, [move.uci.slice(0, 2), move.uci.slice(2, 4)]);
  }
});

test("last ply is the final position, king in check (checkmate)", () => {
  const last = game.moves.length;
  const pos = positionAt(game, last);
  assert.equal(pos.fen, game.moves[last - 1]?.fenAfter);
  // Black is mated: it is Black's turn and the Black king is attacked.
  assert.equal(pos.check, "b");
});

test("detects a check position mid-game (11.Bxb5+)", () => {
  const checkPly = game.moves.findIndex((m) => m.san.includes("+")) + 1;
  assert.ok(checkPly > 0, "game contains a check");
  const pos = positionAt(game, checkPly);
  assert.equal(pos.check, "b", "Black king is checked by Bxb5+");
});

test("throws RangeError outside 0..N", () => {
  const last = game.moves.length;
  assert.throws(() => positionAt(game, -1), RangeError);
  assert.throws(() => positionAt(game, last + 1), RangeError);
  assert.throws(() => positionAt(game, 1.5), RangeError);
});

test("ply 0 of a headers-only game yields the tag FEN when present", () => {
  const custom = loadPgn(`[FEN "rnbqkbnr/pp1ppppp/8/2p5/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2"]
[Result "*"]

*`);
  const pos = positionAt(custom, 0);
  assert.ok(pos.fen.startsWith("rnbqkbnr/pp1ppppp/8/2p5/4P3/5N2/PPPP1PPP/RNBQKB1R b"));
  assert.equal(custom.moves.length, 0);
});
