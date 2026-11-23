/**
 * Score formatting — pure display helpers for engine evaluations, kept
 * out of the components so they stay unit-testable (test/sidebar.test.ts).
 */

import type { EngineResult } from "../engine/types.ts";
import { toWhiteRelative } from "../classifier/classifier.ts";
import { winProbability } from "../classifier/winprob.ts";

/**
 * Display string for an evaluation from White's perspective.
 * Centipawns → pawns with sign ("+0.35", "-1.20"); mates → "+M3"/"-M2"
 * (always White-relative: who mates, in how many plies).
 */
export function formatScore(
  result: Pick<EngineResult, "scoreCp" | "mate">,
  fen: string,
): string {
  if (result.mate !== null) {
    const whiteMate = fen.split(" ")[1] === "w" ? result.mate : -result.mate;
    return `${whiteMate >= 0 ? "+" : "-"}M${Math.abs(whiteMate)}`;
  }
  const whiteRelative = toWhiteRelative(result.scoreCp ?? 0, fen);
  return `${whiteRelative >= 0 ? "+" : "-"}${(Math.abs(whiteRelative) / 100).toFixed(2)}`;
}

/** White-relative evaluation → the eval bar fill (White's chance). */
export function evalBarFraction(whiteRelativeCp: number | null): number {
  return whiteRelativeCp === null ? 0.5 : winProbability(whiteRelativeCp);
}
