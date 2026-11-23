import assert from "node:assert/strict";
import { test } from "node:test";

import { isTerminal, planSearch, terminalAnalysis } from "../src/analyzer/skip.ts";
import { bookClassification } from "../src/classifier/classifier.ts";
import { loadPgn } from "../src/chess/game.ts";
import { mainPath, pathPositions, treeFromGame } from "../src/chess/variation.ts";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const AFTER_E4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";
const AFTER_E4_E5 = "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2";
// White mated (fool's mate final position).
const MATED = "rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3";
// Black stalemated.
const STALEMATE = "7k/5Q2/6K1/8/8/8/8/8 b - - 0 1";

test("terminalAnalysis matches the engine's depth-0 output", () => {
  const mated = terminalAnalysis(MATED);
  assert.deepEqual(mated.result, {
    bestMove: "(none)",
    scoreCp: null,
    mate: 0,
    pv: [],
    depth: 0,
    multipv: 1,
    final: true,
  });
  assert.deepEqual(mated.alternatives, []);

  const drawn = terminalAnalysis(STALEMATE);
  assert.equal(drawn.result.mate, null);
  assert.equal(drawn.result.scoreCp, 0);
  assert.equal(drawn.result.bestMove, "(none)");
});

test("isTerminal spots the three unsearchable kinds", () => {
  assert.equal(isTerminal(MATED), true);
  assert.equal(isTerminal(STALEMATE), true);
  assert.equal(isTerminal(START), false);
  assert.equal(isTerminal(AFTER_E4), false);
});

test("Opera: only the 26 post-book positions searched, mate synthesized", () => {
  const game = loadPgn(
    '[Event "Paris Opera"]\n[Result "1-0"]\n\n1.e4 e5 2.Nf3 d6 3.d4 Bg4 4.dxe5 Bxf3 5.Qxf3 dxe5 ' +
      "6.Bc4 Nf6 7.Qb3 Qe7 8.Nc3 c6 9.Bg5 b5 10.Nxb5 cxb5 11.Bxb5+ Nbd7 12.O-O-O Rd8 " +
      "13.Rxd7 Rxd7 14.Rd1 Qe6 15.Bxd7+ Nxd7 16.Qb8+ Nxb8 17.Rd8# 1-0",
  );
  const tree = treeFromGame(game);
  const path = mainPath(tree);
  const plan = planSearch(
    pathPositions(tree, path),
    path.map((node) => node.move.uci),
  );

  assert.equal(plan.searchable.length, 26, "34 positions − 7 book − 1 mate");
  assert.equal(plan.synthesized.length, 1);
  assert.equal(plan.synthesized[0]!.result.mate, 0, "final Rd8# synthesized as mate 0");
  assert.ok(!plan.searchable.includes(START), "the book-only start position is dropped");
});

test("an all-book line needs no search at all", () => {
  const game = loadPgn("1. d4 d5 2. c4 e6 3. Nc3 Nf6");
  const tree = treeFromGame(game);
  const path = mainPath(tree);
  const plan = planSearch(
    pathPositions(tree, path),
    path.map((node) => node.move.uci),
  );
  assert.deepEqual(plan.searchable, []);
  assert.deepEqual(plan.synthesized, []);
});

test("needed set keeps positions a non-book move touches, even in book", () => {
  // h2h3 after 1.e4 is NOT book; then a bare-kings filler position
  // (off-book) has e2e4 played from it (also non-book there), and the
  // line ends with book moves e2e4/e7e5 from real book positions.
  const FILLER = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKB1R w KQkq - 0 1";
  const positions = [AFTER_E4, FILLER, START, AFTER_E4, AFTER_E4_E5];
  const plan = planSearch(positions, ["h2h3", "e2e4", "e2e4", "e7e5"]);

  // Book moves 2–3 contribute nothing, but h2h3 needs {0,1} and the
  // non-book e2e4 from the filler needs {1,2}: even the book START
  // position stays needed (it is the "after" of that non-book move).
  assert.deepEqual(plan.searchable, [AFTER_E4, FILLER, START]);
  assert.deepEqual(plan.synthesized, []);
});

test("the same position needed twice is searched once", () => {
  // Two non-book moves (h2h3, then e2e4 from an off-book filler)
  // touching the same index collapse into one search.
  const plan = planSearch(
    [AFTER_E4, "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKB1R w KQkq - 0 1", AFTER_E4],
    ["h2h3", "e2e4", "e7e5"],
  );
  // move0 non-book → {0,1}; move1 (from unknown FEN) non-book → {1,2};
  // move2 book. Indices 0 and 2 hold the same FEN — deduplicated.
  assert.deepEqual(plan.searchable, [
    AFTER_E4,
    "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKB1R w KQkq - 0 1",
  ]);
});

test("a non-book mating move synthesizes its terminal 'after' position", () => {
  // Scholar's mate: 3...Nf6 and 4.Qxf7# are off-book → the final
  // checkmate position is synthesized, not searched.
  const game = loadPgn("1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 4. Qxf7#");
  const tree = treeFromGame(game);
  const path = mainPath(tree);
  const plan = planSearch(
    pathPositions(tree, path),
    path.map((node) => node.move.uci),
  );
  assert.equal(plan.synthesized.length, 1);
  assert.equal(plan.synthesized[0]!.result.mate, 0);
  assert.ok(plan.searchable.length > 0, "the non-book moves still get searched");
  assert.ok(!plan.searchable.includes(pathPositions(tree, path).at(-1)!));
});

test("bookClassification scores as a zero-loss move", () => {
  const book = bookClassification();
  assert.equal(book.label, "book");
  assert.equal(book.cpLoss, 0);
  assert.equal(book.winProbBefore, 0.5);
  assert.equal(book.winProbAfter, 0.5);
});
