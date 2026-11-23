import assert from "node:assert/strict";
import { test } from "node:test";

import { gameAccuracy, moveAccuracy } from "../src/classifier/accuracy.ts";
import { defaultConfig } from "../src/classifier/config.ts";

test("a perfect move scores 100, over-estimates too", () => {
  assert.equal(moveAccuracy(0), 100);
  assert.equal(moveAccuracy(-120), 100, "negative loss clamps to 100");
});

test("accuracy strictly decreases with cp loss", () => {
  const losses = [0, 10, 25, 70, 150, 300, 600, 1200];
  for (let i = 1; i < losses.length; i++) {
    const prev = moveAccuracy(losses[i - 1]!);
    const curr = moveAccuracy(losses[i]!);
    assert.ok(curr < prev, `accuracy must drop from ${losses[i - 1]} to ${losses[i]} (${curr} !< ${prev})`);
  }
});

test("accuracy stays inside (0, 100]", () => {
  for (const loss of [0, 1, 100, 500, 5000]) {
    const acc = moveAccuracy(loss);
    assert.ok(acc > 0 && acc <= 100, `moveAccuracy(${loss}) = ${acc} outside (0, 100]`);
  }
});

test("matches the labels.json decay curve (k = 0.004)", () => {
  const k = defaultConfig.accuracy.k;
  assert.equal(k, 0.004, "labels.json k");
  assert.ok(Math.abs(moveAccuracy(100) - 100 * Math.exp(-0.4)) < 1e-9, "100cp ≈ 67.03");
  assert.ok(Math.abs(moveAccuracy(300) - 100 * Math.exp(-1.2)) < 1e-9, "300cp ≈ 30.12");
  // Sanity band: the label thresholds should map to sensible scores.
  assert.ok(moveAccuracy(25) > 85, "a 'good' move stays above 85");
  assert.ok(moveAccuracy(70) > 60 && moveAccuracy(70) < 85, "inaccuracy ≈ 76");
  assert.ok(moveAccuracy(150) > 40 && moveAccuracy(150) < 70, "mistake ≈ 55");
  assert.ok(moveAccuracy(300) < 40, "blunder < 40");
});

test("k is a parameter (steeper curves decay faster)", () => {
  assert.ok(Math.abs(moveAccuracy(100, 0.01) - 100 * Math.exp(-1)) < 1e-9);
  assert.ok(moveAccuracy(100, 0.01) < moveAccuracy(100, 0.004));
  assert.equal(moveAccuracy(0, 0.05), 100, "k does not move the anchor");
});

test("gameAccuracy averages the per-move accuracies", () => {
  const expected = (moveAccuracy(0) + moveAccuracy(300)) / 2;
  assert.ok(Math.abs(gameAccuracy([0, 300]) - expected) < 1e-9);
  assert.equal(gameAccuracy([150]), moveAccuracy(150), "single move → itself");
  assert.equal(gameAccuracy([]), 0, "no moves → 0 (caller decides)");
  // A side that plays only perfect moves is perfect.
  assert.equal(gameAccuracy([0, 0, 0, 0]), 100);
});
