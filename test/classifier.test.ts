import assert from "node:assert/strict";
import { test } from "node:test";

import {
  classifyGame,
  classifyMove,
  MATE_CP,
  resultToCp,
  toSidePerspective,
  toWhiteRelative,
  type ClassifyInput,
  type Label,
} from "../src/classifier/classifier.ts";
import { defaultConfig, thresholdScale } from "../src/classifier/config.ts";
import { loadPgn } from "../src/chess/game.ts";
import type { PositionAnalysis } from "../src/analyzer/analyzer.ts";
import type { EngineResult } from "../src/engine/types.ts";

// ------------------------------------------------------------- helpers

/** Build a classifyMove call whose cp loss is exactly `cpLoss`
 *  (mover = White, evals in White's perspective, no book, no ELO). */
function labelFor(cpLoss: number, extra: Partial<ClassifyInput> = {}): Label {
  return classifyMove({
    ply: 10,
    mover: "w",
    playedMove: "a2a3",
    bestMove: "h2h4",
    whiteRelativeBefore: 500,
    whiteRelativeAfter: 500 - cpLoss,
    elo: null,
    ...extra,
  }).label;
}

function analysis(fen: string, bestMove: string, scoreCp: number | null, mate: number | null = null): PositionAnalysis {
  const result: EngineResult = {
    bestMove, scoreCp, mate, pv: [bestMove], depth: 14, multipv: 1, final: true,
  };
  return { fen, result, alternatives: [] };
}

// -------------------------------------------- perspective normalization

test("toWhiteRelative flips scores when Black is to move", () => {
  const start = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
  assert.equal(toWhiteRelative(50, start), 50, "White to move: unchanged");
  // After 1.e4 it is Black to move: +50 for Black = -50 for White.
  const afterE4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";
  assert.equal(toWhiteRelative(50, afterE4), -50, "Black to move: negated");
});

test("toSidePerspective round-trips through White-relative", () => {
  assert.equal(toSidePerspective(120, "w"), 120);
  assert.equal(toSidePerspective(120, "b"), -120);
  assert.equal(toSidePerspective(toWhiteRelative(120, "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1"), "b"), 120);
});

test("same position, both viewpoints → identical win probs and cp loss", () => {
  const asWhite = classifyMove({
    ply: 8, mover: "w", playedMove: "x", bestMove: "y",
    whiteRelativeBefore: 200, whiteRelativeAfter: 100, elo: null,
  });
  const asBlack = classifyMove({
    ply: 8, mover: "b", playedMove: "x", bestMove: "y",
    whiteRelativeBefore: -200, whiteRelativeAfter: -100, elo: null,
  });
  assert.equal(asWhite.cpLoss, 100);
  assert.equal(asBlack.cpLoss, 100, "same loss seen from Black's side");
  assert.equal(asWhite.label, asBlack.label);
  assert.ok(Math.abs(asWhite.winProbBefore - asBlack.winProbBefore) < 1e-12);
  assert.ok(Math.abs(asWhite.winProbAfter - asBlack.winProbAfter) < 1e-12);
});

// -------------------------------------------------------- mate handling

test("resultToCp folds mate scores into the centipawn scale", () => {
  assert.equal(resultToCp({ scoreCp: 42, mate: null }), 42);
  assert.equal(resultToCp({ scoreCp: null, mate: 1 }), MATE_CP - 1);
  assert.equal(resultToCp({ scoreCp: null, mate: -1 }), -(MATE_CP - 1));
  assert.equal(resultToCp({ scoreCp: null, mate: 3 }), MATE_CP - 3);
  assert.equal(resultToCp({ scoreCp: null, mate: null }), 0, "degenerate result → 0");
});

test("missing a mate (or winning one) produces extreme cp losses → blunder/best", () => {
  const hadMate = classifyMove({
    ply: 40, mover: "w", playedMove: "q7h7", bestMove: "q7h7",
    whiteRelativeBefore: MATE_CP - 1, whiteRelativeAfter: 50, elo: null,
  });
  assert.equal(hadMate.label, "best", "the mating move itself is 'best'");
  assert.ok(hadMate.cpLoss > 9000);

  const threwIt = classifyMove({
    ply: 40, mover: "w", playedMove: "q7a1", bestMove: "q7h7",
    whiteRelativeBefore: MATE_CP - 1, whiteRelativeAfter: 50, elo: null,
  });
  assert.equal(threwIt.label, "blunder", "giving up a forced mate is a blunder");
  assert.ok(threwIt.winProbBefore > 0.999, "certain win before");
  assert.ok(threwIt.winProbAfter < 0.6, "advantage gone after");
});

// ------------------------------------------------------------- labels

test("cp-loss ladder boundaries (unscaled thresholds)", () => {
  // labels.json: good 25, inaccuracy 70, mistake 150, blunder 300.
  const cases: [number, Label][] = [
    [0, "acceptable"],
    [24, "acceptable"],
    [25, "good"],
    [69, "good"],
    [70, "inaccuracy"],
    [149, "inaccuracy"],
    [150, "mistake"],
    [299, "mistake"],
    [300, "blunder"],
    [1000, "blunder"],
  ];
  for (const [cpLoss, expected] of cases) {
    assert.equal(labelFor(cpLoss), expected, `cpLoss ${cpLoss} → ${expected}`);
  }
});

test("'best' beats the ladder even if evals disagree", () => {
  const c = classifyMove({
    ply: 12, mover: "w", playedMove: "e2e4", bestMove: "e2e4",
    whiteRelativeBefore: 500, whiteRelativeAfter: 400, elo: null,
  });
  assert.equal(c.label, "best");
  assert.equal(c.cpLoss, 100, "cp loss still reported honestly");
});

test("'book' beats both 'best' and the ladder, but only within maxPly", () => {
  const inBook = { inBook: true as const };
  assert.equal(labelFor(350, { ply: 3, ...inBook }), "book", "book beats blunder");
  assert.equal(labelFor(0, { ply: 8, playedMove: "e2e4", bestMove: "e2e4", ...inBook }), "book", "book beats best");
  assert.equal(
    labelFor(0, { ply: defaultConfig.book.maxPly + 1, ...inBook }),
    "acceptable",
    "past book.maxPly the flag is ignored",
  );
});

// ------------------------------------------------------- ELO scaling

test("thresholdScale: reference, slope, clamps, unknown ELO", () => {
  const cfg = defaultConfig.eloScaling;
  assert.equal(thresholdScale(null, cfg), 1, "unknown ELO → unscaled");
  assert.equal(thresholdScale(Number.NaN, cfg), 1, "NaN → unscaled");
  assert.equal(thresholdScale(1500, cfg), 1, "reference ELO → exactly 1");
  assert.ok(Math.abs(thresholdScale(1000, cfg) - 1.2) < 1e-12, "1000 → 1.2 (more forgiving)");
  assert.equal(thresholdScale(2500, cfg), 0.6, "2500 → clamped at minScale 0.6");
  assert.equal(thresholdScale(4000, cfg), 0.6, "raw 0.4 clamped up to 0.6");
  assert.equal(thresholdScale(0, cfg), 1.6, "raw 1.6 = maxScale");
});

test("same cp loss, different labels for different ELOs", () => {
  // 100cp: at 1500 it is an inaccuracy; a 2500 is held to stricter
  // thresholds (scale 0.6 → mistake at 90) so it becomes a mistake.
  assert.equal(labelFor(100, { elo: 1500 }), "inaccuracy");
  assert.equal(labelFor(100, { elo: 2500 }), "mistake");
  // 80cp: a 1000 gets slack (scale 1.2 → inaccuracy starts at 84) so
  // it drops to "good", while a 1500 still gets an inaccuracy.
  assert.equal(labelFor(80, { elo: 1500 }), "inaccuracy");
  assert.equal(labelFor(80, { elo: 1000 }), "good");
});

test("clamping keeps the ladder sane at extreme ELOs", () => {
  assert.equal(labelFor(180, { elo: 4000 }), "blunder", "floor: 300 × 0.6 = 180");
  assert.equal(labelFor(179, { elo: 4000 }), "mistake", "just under the floor");
  assert.equal(labelFor(300, { elo: 0 }), "mistake", "ceiling: 300 × 1.6 = 480 > 300");
});

// ------------------------------------------------------- win probability

test("win probs are the mover's, before and after the move", () => {
  const c = classifyMove({
    ply: 20, mover: "w", playedMove: "a2a3", bestMove: "h2h4",
    whiteRelativeBefore: 100, whiteRelativeAfter: 0, elo: null,
  });
  assert.ok(Math.abs(c.winProbBefore - 0.5987) < 0.001, "+100cp ≈ 60%");
  assert.equal(c.winProbAfter, 0.5, "back to even");
  assert.equal(c.cpLoss, 100);
  assert.equal(c.label, "inaccuracy");

  const black = classifyMove({
    ply: 20, mover: "b", playedMove: "a2a3", bestMove: "h2h4",
    whiteRelativeBefore: 100, whiteRelativeAfter: 100, elo: null,
  });
  // White +100 means Black is at -100 from Black's point of view.
  assert.ok(Math.abs(black.winProbBefore - 0.4013) < 0.001);
  assert.equal(black.winProbAfter, black.winProbBefore, "no eval change → no prob change");
});

test("a move that never loses evaluation clamps to cpLoss 0", () => {
  const c = classifyMove({
    ply: 5, mover: "w", playedMove: "a2a3", bestMove: "h2h4",
    whiteRelativeBefore: -300, whiteRelativeAfter: -200, elo: null,
  });
  assert.equal(c.cpLoss, 0, "horizon-effect gains are not negative losses");
  assert.equal(c.label, "acceptable");
});

// ------------------------------------------------------------ classifyGame

const PGN = `[Event "Classifier Fixture"]
[White "Alice"]
[WhiteElo "2400"]
[Black "Bob"]
[BlackElo "1200"]
[Result "*"]

1. e4 e5 2. Nf3 Nc6 *`;

const game = loadPgn(PGN);

/** Engine script (side-to-move perspective), one entry per position:
 *  [bestMove, scoreCp]. Position turn order: w, b, w, b, w. */
const SCRIPT: [string, number][] = [
  ["e2e4", 50],    // 0. White slightly better, best is e4
  ["d7d5", -50],   // 1. still +50 White; Black's best is d5 (not played)
  ["g1f3", 200],   // 2. White now much better
  ["g8f6", -180],  // 3. +180 White; Black's best is Nf6 (not played)
  ["f1c4", 150],   // 4. final position
];

function scriptedResults(): PositionAnalysis[] {
  return game.moves.map((_, i) => {
    const entry = SCRIPT[i];
    if (!entry) throw new Error(`missing script entry ${i}`);
    return analysis(i === 0 ? game.moves[0]!.fenBefore : game.moves[i - 1]!.fenAfter, entry[0], entry[1]);
  }).concat([
    analysis(game.moves.at(-1)!.fenAfter, SCRIPT[4]![0], SCRIPT[4]![1]),
  ]);
}

test("classifyGame: labels, cp losses and per-side accuracy", () => {
  const out = classifyGame(game, scriptedResults());

  // move 1: White plays the engine's best (e4) → best, cpLoss 0.
  // move 2: Black's e5 is not best (d5 was); White's share grows
  //         50 → 200, i.e. Black loses 150cp.
  // move 3: White plays the best move → best, even though the two
  //         evals differ by 20cp (fixture inconsistency, priority rule).
  // move 4: Black's Nc6 is not best, but the eval *improves* for
  //         Black (180 → 150 White) → clamped to 0 → acceptable.
  assert.deepEqual(
    out.moves.map((m) => m?.label ?? null),
    ["best", "inaccuracy", "best", "acceptable"],
  );

  const move2 = out.moves[1];
  assert.ok(move2);
  assert.equal(move2.cpLoss, 150, "Black's cp loss, Black's perspective");
  // Black is rated 1200 → thresholds × 1.12: 150 < 168 (mistake)
  // but ≥ 78.4 (inaccuracy) — ELO scaling visible in a full game.
  assert.equal(move2.label, "inaccuracy");

  // Accuracy: White [0, 20], Black [150, 0] with k = 0.004.
  const expectedWhite = (100 + 100 * Math.exp(-0.004 * 20)) / 2;
  const expectedBlack = (100 * Math.exp(-0.004 * 150) + 100) / 2;
  assert.ok(Math.abs(out.whiteAccuracy - expectedWhite) < 1e-9, "white accuracy");
  assert.ok(Math.abs(out.blackAccuracy - expectedBlack) < 1e-9, "black accuracy");
  assert.ok(out.blackAccuracy < out.whiteAccuracy, "the sloppy side scores lower");
});

test("classifyGame: ELO options override the PGN tags", () => {
  const out = classifyGame(game, scriptedResults(), { blackElo: 1500 });
  assert.equal(out.moves[1]?.label, "mistake", "1500 → scale 1 → 150cp is a mistake");

  const forced = classifyGame(game, scriptedResults(), { blackElo: null });
  assert.equal(forced.moves[1]?.label, "mistake", "explicit null → unknown → unscaled");

  const unscaled = classifyGame(game, scriptedResults(), { whiteElo: null, blackElo: null });
  assert.equal(unscaled.moves[1]?.label, "mistake");
});

test("classifyGame: accuracy is ELO-independent (labels aren't)", () => {
  const tagged = classifyGame(game, scriptedResults());
  const forced = classifyGame(game, scriptedResults(), { blackElo: 1500 });
  assert.equal(tagged.blackAccuracy, forced.blackAccuracy, "same cp losses → same accuracy");
  assert.notEqual(tagged.moves[1]?.label, forced.moves[1]?.label, "but different labels");
});

test("classifyGame: book lookup is consulted per move", () => {
  const out = classifyGame(game, scriptedResults(), {
    inBook: ({ ply }) => ply <= 2,
  });
  assert.deepEqual(
    out.moves.map((m) => m?.label ?? null),
    ["book", "book", "best", "acceptable"],
  );
});

test("classifyGame: null analyses null only the affected moves, skip in accuracy", () => {
  const results: (PositionAnalysis | null)[] = scriptedResults();
  results[2] = null;
  const out = classifyGame(game, results);

  assert.deepEqual(
    out.moves.map((m) => m?.label ?? null),
    ["best", null, null, "acceptable"],
    "one missing position kills its move and the next",
  );
  assert.equal(out.whiteAccuracy, 100, "White's only surviving move had cpLoss 0");
  assert.equal(out.blackAccuracy, 100, "Black's only surviving move had cpLoss 0");
});

test("classifyGame: wrong analysis length throws", () => {
  assert.throws(
    () => classifyGame(game, scriptedResults().slice(0, 4)),
    /expected 5 position analyses, got 4/,
  );
});

test("classifyGame: mover comes from the FEN, not the ply parity", () => {
  // Black to move from the start (FEN-tagged game): the first move is
  // Black's, so Black's perspective must drive the cp loss.
  const frcGame = loadPgn(`[Event "Black starts"]
[White "W"]
[Black "B"]
[Result "*"]
[FEN "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1"]

1... e5 2. Nf3 *`);

  const results: (PositionAnalysis | null)[] = [
    analysis(frcGame.moves[0]!.fenBefore, "d7d5", -60), // Black to move: +60 for Black
    analysis(frcGame.moves[0]!.fenAfter, "g1f3", 400),  // White to move: White +400
    analysis(frcGame.moves[1]!.fenAfter, "f1c4", 400),
  ];

  const out = classifyGame(frcGame, results, { whiteElo: null, blackElo: null });
  // Black's perspective: before −60, after −400 → cpLoss 340 → blunder.
  // (If the mover were wrongly assumed White: 60 − 400 < 0 → 0 → acceptable.)
  assert.equal(out.moves[0]?.label, "blunder", "classified as Black's blunder");
  assert.equal(out.moves[0]?.cpLoss, 340);
  assert.equal(out.moves[1]?.label, "best", "White then plays the best move");
});
