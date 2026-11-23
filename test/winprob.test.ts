import assert from "node:assert/strict";
import { test } from "node:test";

import { expectedScore, winProbability } from "../src/classifier/winprob.ts";

test("equal eval is an equal chance (0.5)", () => {
  assert.equal(winProbability(0), 0.5);
});

test("win probability is strictly increasing in cp", () => {
  const points = [-800, -300, -100, 0, 100, 300, 800];
  for (let i = 1; i < points.length; i++) {
    assert.ok(
      winProbability(points[i]!) > winProbability(points[i - 1]!),
      `winProbability must increase from ${points[i - 1]} to ${points[i]}`,
    );
  }
});

test("+100cp ≈ 60%, +300cp ≈ 77%", () => {
  assert.ok(Math.abs(winProbability(100) - 0.5987) < 0.001);
  assert.ok(Math.abs(winProbability(300) - 0.7685) < 0.001);
});

test("expected score at equal ELO is 0.5", () => {
  assert.equal(expectedScore(0), 0.5);
});

test("expected score for +400 ELO ≈ 0.909", () => {
  assert.ok(Math.abs(expectedScore(400) - 10 / 11) < 1e-9);
});

test("expected score is symmetric around zero", () => {
  assert.ok(Math.abs(expectedScore(250) + expectedScore(-250) - 1) < 1e-12);
});
