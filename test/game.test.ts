import assert from "node:assert/strict";
import { test } from "node:test";

import { loadPgn, pvToSan, START_FEN, uciToSan } from "../src/chess/game.ts";

const SIMPLE_PGN = `[Event "Test Match"]
[Site "?"]
[Date "2026.11.11"]
[White "Alice"]
[Black "Bob"]
[WhiteElo "1520"]
[BlackElo "1480"]
[Result "1-0"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 1-0`;

test("parses headers of a simple game", () => {
  const game = loadPgn(SIMPLE_PGN);
  assert.equal(game.white, "Alice");
  assert.equal(game.black, "Bob");
  assert.equal(game.whiteElo, 1520);
  assert.equal(game.blackElo, 1480);
  assert.equal(game.result, "1-0");
  assert.equal(game.tags.Event, "Test Match");
  assert.equal(game.tags.Date, "2026.11.11");
});

test("produces one MoveRecord per ply with SAN, UCI and FENs", () => {
  const game = loadPgn(SIMPLE_PGN);
  assert.equal(game.moves.length, 10);

  const first = game.moves[0];
  assert.ok(first);
  assert.equal(first.ply, 1);
  assert.equal(first.san, "e4");
  assert.equal(first.uci, "e2e4");
  assert.equal(first.fenBefore, START_FEN);
  assert.ok(first.fenAfter.includes("4P3/8"), "pawn should be on e4 after 1. e4");
  assert.ok(first.fenAfter.endsWith(" b KQkq - 0 1"), "black to move after 1. e4");

  const last = game.moves[9];
  assert.ok(last);
  assert.equal(last.ply, 10);
  assert.equal(last.san, "Be7");
  assert.equal(last.uci, "f8e7");
});

test("encodes castling as a king-move UCI string", () => {
  const game = loadPgn(SIMPLE_PGN);
  const castle = game.moves.find((m) => m.san === "O-O");
  assert.ok(castle, "expected a kingside castle");
  assert.equal(castle.uci, "e1g1");
});

test("FENs form an unbroken chain across the whole game", () => {
  const game = loadPgn(SIMPLE_PGN);
  for (let i = 1; i < game.moves.length; i++) {
    assert.equal(
      game.moves[i]?.fenBefore,
      game.moves[i - 1]?.fenAfter,
      `gap between ply ${i} and ${i + 1}`,
    );
  }
});

test("encodes en passant captures", () => {
  const pgn = `[Event "ep"]

1. e4 d5 2. e5 f5 3. exf6 *`;
  const game = loadPgn(pgn);
  const ep = game.moves.find((m) => m.san === "exf6");
  assert.ok(ep, "expected an en passant capture");
  assert.equal(ep.uci, "e5f6");
});

test("respects a FEN tag and encodes promotions", () => {
  const pgn = `[Event "promotion"]
[FEN "8/P6k/8/8/8/8/8/K7 w - - 0 1"]

1. a8=Q Kg7 2. Qa3 *`;
  const game = loadPgn(pgn);
  assert.equal(game.moves.length, 3);

  const first = game.moves[0];
  assert.ok(first);
  assert.equal(first.fenBefore, "8/P6k/8/8/8/8/8/K7 w - - 0 1");
  assert.equal(first.san, "a8=Q");
  assert.equal(first.uci, "a7a8q");
  assert.ok(first.fenAfter.startsWith("Q7/"), "pawn should be a queen on a8");

  const kingMove = game.moves[1];
  assert.ok(kingMove);
  assert.equal(kingMove.san, "Kg7");
  assert.equal(kingMove.uci, "h7g7");
});

test("tolerates comments, NAGs and variations (main line only)", () => {
  const pgn = `[Event "annotated"]

1. e4 {a comment} e5 $1 2. Nf3 (2. d4 d5 3. Nc3) Nc6 *`;
  const game = loadPgn(pgn);
  assert.deepEqual(
    game.moves.map((m) => m.san),
    ["e4", "e5", "Nf3", "Nc6"],
  );
});

test("defaults missing headers", () => {
  const game = loadPgn("1. d4 d5 *");
  assert.equal(game.white, "?");
  assert.equal(game.black, "?");
  assert.equal(game.whiteElo, null);
  assert.equal(game.blackElo, null);
  assert.equal(game.result, "*");
});

test("accepts a headers-only PGN with zero moves", () => {
  const game = loadPgn(`[Event "unplayed"]
[White "Alice"]

*`);
  assert.equal(game.moves.length, 0);
  assert.equal(game.white, "Alice");
});

test("rejects an empty PGN", () => {
  assert.throws(() => loadPgn(""), /empty PGN/);
  assert.throws(() => loadPgn("   \n  "), /empty PGN/);
});

test("rejects a garbage PGN", () => {
  assert.throws(() => loadPgn("this is not a chess game at all"), /invalid PGN/);
});

test("rejects an illegal move in the movetext", () => {
  assert.throws(() => loadPgn("1. e4 e5 2. Nf3 Qxd99"), /invalid PGN/);
});

// --------------------------------------------------- uciToSan / pvToSan

test("uciToSan converts a UCI move to SAN in context", () => {
  const game = loadPgn(SIMPLE_PGN);
  const first = game.moves[0]!;
  assert.equal(uciToSan(first.fenBefore, first.uci), first.san);

  // Disambiguation needs the position: both knights can reach f3.
  const fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
  assert.equal(uciToSan(fen, "g1f3"), "Nf3");
  assert.equal(uciToSan(fen, "b1c3"), "Nc3");
});

test("uciToSan rejects illegal moves, bad FENs and the mate sentinel", () => {
  const fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
  assert.equal(uciToSan(fen, "e2e5"), null, "pawn cannot jump two extra squares");
  assert.equal(uciToSan(fen, "a1a1"), null, "no-op is not a move");
  assert.equal(uciToSan(fen, "(none)"), null, "engine's mate sentinel");
  assert.equal(uciToSan(fen, "e2"), null, "truncated UCI");
  assert.equal(uciToSan("not a fen", "e2e4"), null);
});

test("uciToSan encodes promotions", () => {
  // White pawn on a7, black king on h8: promoting on the 8th rank gives
  // check along the rank, which SAN appends.
  const fen = "7k/P7/8/8/8/8/8/K7 w - - 0 1";
  assert.equal(uciToSan(fen, "a7a8q"), "a8=Q+");
  assert.equal(uciToSan(fen, "a7a8n"), "a8=N");
  assert.equal(uciToSan(fen, "a7a8b"), "a8=B", "underpromotion to a bishop");
});

test("pvToSan replays a principal variation from a position", () => {
  const game = loadPgn(SIMPLE_PGN);
  const start = game.moves[0]!.fenBefore;
  const pv = game.moves.slice(0, 4).map((m) => m.uci);
  assert.equal(pvToSan(start, pv, 10), "e4 e5 Nf3 Nc6");
  assert.equal(pvToSan(start, pv, 2), "e4 e5", "maxMoves truncates");
});

test("pvToSan stops at the first illegal move of a stale PV", () => {
  const fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
  assert.equal(pvToSan(fen, ["e2e4", "e2e5", "g1f3"], 10), "e4", "second move is illegal here");
  assert.equal(pvToSan(fen, [], 10), "");
  assert.equal(pvToSan("not a fen", ["e2e4"], 10), "");
});
