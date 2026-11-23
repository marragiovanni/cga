import assert from "node:assert/strict";
import { test } from "node:test";

import { bookMoves, isBookMove, openingAt, positionKey } from "../src/book/book.ts";
import { classifyGame } from "../src/classifier/classifier.ts";
import { gamePositions, type PositionAnalysis } from "../src/analyzer/analyzer.ts";
import { loadPgn, positionAt, START_FEN, type GameData } from "../src/chess/game.ts";
import type { EngineResult } from "../src/engine/types.ts";

// ------------------------------------------------------------- helpers

function analysis(fen: string, bestMove: string, scoreCp: number): PositionAnalysis {
  const result: EngineResult = {
    bestMove, scoreCp, mate: null, pv: [bestMove], depth: 14, multipv: 1, final: true,
  };
  return { fen, result, alternatives: [] };
}

/** Every position analyzed with score 0 and the engine "playing" the
 *  game's own moves: cp loss 0 everywhere, so any non-`best` label can
 *  only come from the book (or its absence). */
function flatResults(game: GameData): PositionAnalysis[] {
  const fens = gamePositions(game);
  return fens.map((fen, i) => analysis(fen, game.moves[i]?.uci ?? "(none)", 0));
}

function gameOf(moves: string): GameData {
  return loadPgn(`[Event "Book Fixture"]
[White "W"]
[Black "B"]
[Result "*"]

${moves} *`);
}

const RUY: GameData = gameOf("1. e4 e5 2. Nf3 Nc6 3. Bb5 a6");

// ---------------------------------------------------------- membership

test("start position: every first move is book, but it has no name yet", () => {
  const moves = bookMoves(START_FEN);
  assert.equal(moves.length, 20, "all 20 legal first moves are known");
  assert.ok(moves.includes("e2e4") && moves.includes("d2d4") && moves.includes("g1f3"));
  assert.equal(openingAt(START_FEN), null, "the initial position is not an opening");
});

test("every move of a known line is a book move at its position", () => {
  for (const [i, move] of RUY.moves.entries()) {
    const fen = positionAt(RUY, i).fen; // position the move was played from
    assert.ok(
      isBookMove(fen, move.uci),
      `ply ${move.ply} (${move.san}) should be book from ${fen.split(" ").slice(0, 2).join(" ")}`,
    );
  }
});

test("the main branches at the Ruy Lopez base are all book", () => {
  const fen = positionAt(RUY, 4).fen; // after 1. e4 e5 2. Nf3 Nc6
  for (const branch of ["f1b5", "f1c4", "d2d4", "b1c3"]) {
    assert.ok(isBookMove(fen, branch), `${branch} (Ruy/Italian/Scotch/Vienna) should be book`);
  }
  assert.ok(!isBookMove(fen, "d2d5"), "an illegal pawn push is not a book move");
});

// ------------------------------------------------------- transpositions

test("transpositions share one entry regardless of move order", () => {
  const qgd = gameOf("1. d4 d5 2. c4 e6");
  const other = gameOf("1. c4 e6 2. d4 d5"); // same position, other order

  const fenA = positionAt(qgd, qgd.moves.length).fen;
  const fenB = positionAt(other, other.moves.length).fen;
  assert.equal(positionKey(fenA), positionKey(fenB), "keys collapse");

  assert.deepEqual(openingAt(fenA), openingAt(fenB), "same name either way");
  assert.equal(openingAt(fenA)?.name, "Queen's Gambit Declined");

  assert.ok(isBookMove(fenA, "g1f3") && isBookMove(fenB, "g1f3"));
  assert.deepEqual(bookMoves(fenA).sort(), bookMoves(fenB).sort());
});

// ------------------------------------------------------- opening names

test("opening names come from the line ending at the position", () => {
  const e4 = gameOf("1. e4");
  assert.deepEqual(openingAt(positionAt(e4, 1).fen), { name: "King's Pawn Game", eco: "B00" });

  const a3 = gameOf("1. a3");
  assert.deepEqual(openingAt(positionAt(a3, 1).fen), { name: "Anderssen's Opening", eco: "A00" });

  const ruy = gameOf("1. e4 e5 2. Nf3 Nc6 3. Bb5 a6");
  assert.equal(openingAt(positionAt(ruy, 6).fen)?.name, "Ruy Lopez: Morphy Defense");
});

// ---------------------------------------------------------- off-book

test("positions no line reaches are not in the book", () => {
  // 1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7?? — a known blunder, never a line.
  const blunder = gameOf("1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7");
  const fen = positionAt(blunder, blunder.moves.length).fen;
  assert.equal(bookMoves(fen).length, 0, "no continuations known");
  assert.equal(isBookMove(fen, "d8e7"), false);
  assert.equal(openingAt(fen), null);

  // 1. a3 h6 2. a4 h5 3. a5 h4 — starts in book, leaves it immediately.
  const wander = gameOf("1. a3 h6 2. a4 h5 3. a5 h4");
  assert.ok(bookMoves(positionAt(wander, 1).fen).length > 0, "after 1.a3 still book");
  assert.equal(
    bookMoves(positionAt(wander, wander.moves.length).fen).length,
    0,
    "the wandering line leaves the book",
  );
});

// ------------------------------------------- classifyGame integration

test("classifyGame labels every opening move 'book' via the real book", () => {
  const out = classifyGame(RUY, flatResults(RUY), {
    inBook: ({ fenBefore, uci }) => isBookMove(fenBefore, uci),
  });
  assert.deepEqual(
    out.moves.map((m) => m?.label),
    ["book", "book", "book", "book", "book", "book"],
  );
  assert.equal(out.whiteAccuracy, 100, "cp loss 0 everywhere");
  assert.equal(out.blackAccuracy, 100);
});

test("book.maxPly gates the label even for known moves", () => {
  // 20-ply main line, all verified book: the classifier must stop
  // saying "book" after labels.json's book.maxPly (12).
  const long = gameOf(
    "1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 d6 " +
      "8. c3 O-O 9. h3 Nb8 10. d4 Nbd7",
  );
  assert.equal(long.moves.length, 20);

  const out = classifyGame(long, flatResults(long), {
    inBook: ({ fenBefore, uci }) => isBookMove(fenBefore, uci),
  });

  assert.equal(out.moves[11]?.label, "book", "ply 12 still book");
  assert.equal(out.moves[12]?.label, "best", "ply 13 falls through to best (engine agrees)");
  assert.ok(
    out.moves.slice(12).every((m) => m?.label === "best"),
    "all moves past maxPly lose the book label",
  );
});
