import assert from "node:assert/strict";
import { test } from "node:test";

import { evalBarFraction, formatScore } from "../src/ui/score.ts";
import { MATE_CP } from "../src/classifier/classifier.ts";

const WHITE_TO_MOVE = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const BLACK_TO_MOVE = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1";

// ------------------------------------------------------------ formatScore

test("formatScore renders centipawns from White's perspective", () => {
  // Engine scores are side-to-move: White to move +35 = White up 0.35.
  assert.equal(formatScore({ scoreCp: 35, mate: null }, WHITE_TO_MOVE), "+0.35");
  // Black to move +35 means Black is up 0.35 → White is down.
  assert.equal(formatScore({ scoreCp: 35, mate: null }, BLACK_TO_MOVE), "-0.35");
  assert.equal(formatScore({ scoreCp: -120, mate: null }, WHITE_TO_MOVE), "-1.20");
  assert.equal(formatScore({ scoreCp: 0, mate: null }, WHITE_TO_MOVE), "+0.00");
});

test("formatScore renders mates as ±M<n> always White-relative", () => {
  // White to move, mates in 3 plies → White is winning: +M3.
  assert.equal(formatScore({ scoreCp: null, mate: 3 }, WHITE_TO_MOVE), "+M3");
  // Black to move, mates in 2 plies → Black mates White: -M2.
  assert.equal(formatScore({ scoreCp: null, mate: 2 }, BLACK_TO_MOVE), "-M2");
  // White to move but getting mated in 4 → -M4.
  assert.equal(formatScore({ scoreCp: null, mate: -4 }, WHITE_TO_MOVE), "-M4");
  // Black to move, getting mated in 1 → White mates: +M1.
  assert.equal(formatScore({ scoreCp: null, mate: -1 }, BLACK_TO_MOVE), "+M1");
});

test("formatScore tolerates a null score with no mate", () => {
  assert.equal(formatScore({ scoreCp: null, mate: null }, WHITE_TO_MOVE), "+0.00");
});

// --------------------------------------------------------- evalBarFraction

test("evalBarFraction is neutral without an evaluation", () => {
  assert.equal(evalBarFraction(null), 0.5);
});

test("evalBarFraction follows White's expected score", () => {
  const equal = evalBarFraction(0);
  assert.ok(Math.abs(equal - 0.5) < 1e-9, `expected ~0.5, got ${equal}`);

  const whiteBetter = evalBarFraction(200);
  assert.ok(whiteBetter > 0.5, `White advantage should fill more than half, got ${whiteBetter}`);
  assert.ok(whiteBetter < 1);

  const blackBetter = evalBarFraction(-200);
  assert.ok(blackBetter < 0.5, `Black advantage should fill less than half, got ${blackBetter}`);
  assert.ok(blackBetter > 0);

  assert.ok(evalBarFraction(5000) > evalBarFraction(200), "monotonic in cp");
});

test("evalBarFraction maps a forced mate to a near-total bar", () => {
  assert.ok(evalBarFraction(MATE_CP) > 0.99);
  assert.ok(evalBarFraction(-MATE_CP) < 0.01);
});
