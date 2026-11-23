/**
 * Accuracy scoring: per-move cp loss → 0..100 accuracy, then averaged
 * over a set of moves (one side's moves, or the whole game).
 *
 * Model: exponential decay `accuracy = 100 · e^(−k · cpLoss)` with k
 * from labels.json (0.004 → a 0-cp move is 100, a "good" 25cp move ≈
 * 90, an inaccuracy (70) ≈ 76, a mistake (150) ≈ 55, a blunder (300)
 * ≈ 30). Monotonic, bounded in (0, 100], and — like the thresholds —
 * tunable in data, not code.
 */

import { defaultConfig } from "./config.ts";

/**
 * Accuracy of a single move from its cp loss. Non-positive loss
 * (perfect or "better than engine" move) scores a flat 100.
 */
export function moveAccuracy(
  cpLoss: number,
  k: number = defaultConfig.accuracy.k,
): number {
  if (cpLoss <= 0) return 100;
  return 100 * Math.exp(-k * cpLoss);
}

/**
 * Mean accuracy over a list of cp losses (one per classified move).
 * An empty list (side never moved / nothing classified) scores 0 —
 * the caller decides whether that is meaningful to display.
 */
export function gameAccuracy(
  cpLosses: readonly number[],
  k: number = defaultConfig.accuracy.k,
): number {
  if (cpLosses.length === 0) return 0;
  let total = 0;
  for (const cpLoss of cpLosses) {
    total += moveAccuracy(cpLoss, k);
  }
  return total / cpLosses.length;
}
