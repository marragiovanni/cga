import assert from "node:assert/strict";
import { test } from "node:test";

import type { PositionAnalysis } from "../src/analyzer/analyzer.ts";
import { winProbability } from "../src/classifier/winprob.ts";
import type { EngineResult } from "../src/engine/types.ts";
import { pickArrows } from "../src/ui/arrows.ts";

const WHITE_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const BLACK_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1";

function result(overrides: Partial<EngineResult> = {}): EngineResult {
  return {
    bestMove: "e2e4",
    scoreCp: 0,
    mate: null,
    pv: ["e2e4"],
    depth: 14,
    multipv: 1,
    final: true,
    ...overrides,
  };
}

function analysis(
  main: Partial<EngineResult>,
  alt?: Partial<EngineResult> | null,
  fen = WHITE_FEN,
): PositionAnalysis {
  return {
    fen,
    result: result(main),
    alternatives: alt ? [result({ multipv: 2, ...alt })] : [],
  };
}

// --------------------------------------------------------------- main line

test("a single line yields only the best-move arrow", () => {
  assert.deepEqual(pickArrows(analysis({ bestMove: "g1f3" })), ["g1f3"]);
});

test("no legal move yields no arrows", () => {
  assert.deepEqual(pickArrows(analysis({ bestMove: "(none)", scoreCp: null })), []);
});

test("an alternative with the same move is not drawn twice", () => {
  const a = analysis({ bestMove: "e2e4" }, { bestMove: "e2e4", scoreCp: 20 });
  assert.deepEqual(pickArrows(a), ["e2e4"]);
});

test("an alternative at a different depth is discarded", () => {
  const a = analysis({ bestMove: "e2e4" }, { bestMove: "d2d4", depth: 13 });
  assert.deepEqual(pickArrows(a), ["e2e4"]);
});

// -------------------------------------------------------- thresholds (cp)

test("a close second line gets an arrow", () => {
  const a = analysis({ bestMove: "e2e4", scoreCp: 100 }, { bestMove: "d2d4", scoreCp: 80 });
  assert.deepEqual(pickArrows(a), ["e2e4", "d2d4"]);
});

test("a clearly worse second line does not", () => {
  const a = analysis({ bestMove: "e2e4", scoreCp: 100 }, { bestMove: "d2d4", scoreCp: 0 });
  assert.deepEqual(pickArrows(a), ["e2e4"]);
});

test("a winning position keeps the second arrow only within the cp gap", () => {
  // +900cp vs +840cp: win probabilities are nearly identical (a won
  // position), but 60cp apart — the cp guard suppresses the arrow.
  const a = analysis({ bestMove: "e2e4", scoreCp: 900 }, { bestMove: "d2d4", scoreCp: 840 });
  assert.ok(winProbability(900) - winProbability(840) < 0.03, "win-prob gap is under the threshold");
  assert.deepEqual(pickArrows(a), ["e2e4"]);

  // 20cp apart is inside both limits: both arrows show.
  const b = analysis({ bestMove: "e2e4", scoreCp: 900 }, { bestMove: "d2d4", scoreCp: 880 });
  assert.deepEqual(pickArrows(b), ["e2e4", "d2d4"]);
});

// ------------------------------------------------------------------ mates

test("a mate line never shares an arrow with a centipawn line", () => {
  const mateMain = analysis({ bestMove: "e2e4", scoreCp: null, mate: 3 }, { bestMove: "d2d4", scoreCp: 900 });
  assert.deepEqual(pickArrows(mateMain), ["e2e4"]);

  const mateAlt = analysis({ bestMove: "e2e4", scoreCp: 900 }, { bestMove: "d2d4", scoreCp: null, mate: 3 });
  assert.deepEqual(pickArrows(mateAlt), ["e2e4"]);
});

test("two mates for the same side get both arrows", () => {
  const a = analysis(
    { bestMove: "e2e4", scoreCp: null, mate: 3 },
    { bestMove: "d2d4", scoreCp: null, mate: 5 },
  );
  assert.deepEqual(pickArrows(a), ["e2e4", "d2d4"]);
});

test("mates with opposite signs do not get a second arrow", () => {
  const a = analysis(
    { bestMove: "e2e4", scoreCp: null, mate: 3 },
    { bestMove: "d2d4", scoreCp: null, mate: -3 },
  );
  assert.deepEqual(pickArrows(a), ["e2e4"]);
});

// -------------------------------------------------------------- Black to move

test("Black-to-move scores stay in the side-to-move's perspective", () => {
  // Both evals are for Black. −100 vs −140 is a 40cp gap (above the
  // 0.03 win-prob threshold) → no second arrow. Inverting the signs
  // would wrongly make the gap look close.
  const a = analysis({ bestMove: "e7e5", scoreCp: -100 }, { bestMove: "c7c5", scoreCp: -140 }, BLACK_FEN);
  assert.ok(winProbability(-100) - winProbability(-140) > 0.03, "win-prob gap is over the threshold");
  assert.deepEqual(pickArrows(a), ["e7e5"]);

  // 20cp apart → both arrows, still without any inversion.
  const b = analysis({ bestMove: "e7e5", scoreCp: -100 }, { bestMove: "c7c5", scoreCp: -120 }, BLACK_FEN);
  assert.deepEqual(pickArrows(b), ["e7e5", "c7c5"]);
});
