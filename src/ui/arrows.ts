/**
 * Best-move arrows — decide which engine lines deserve an arrow on the
 * board.
 *
 * The main line always gets one. The second line is shown only when it
 * is "almost as good" as the best move: a near-identical win probability
 * and a small centipawn gap. In a clearly better position the extra
 * arrow would be noise (and the cp gap is what stops two near-equal
 * win probabilities from both showing when the position is already won).
 */

import raw from "../config/labels.json" with { type: "json" };
import type { PositionAnalysis } from "../analyzer/analyzer.ts";
import { resultToCp } from "../classifier/classifier.ts";
import { winProbability } from "../classifier/winprob.ts";

const { maxWinProbGap, maxCpGap } = raw.arrows;

/** UCI moves to draw, best first (0, 1 or 2 arrows). */
export function pickArrows(analysis: PositionAnalysis): string[] {
  const main = analysis.result;
  if (main.bestMove === "(none)") return [];

  const arrows = [main.bestMove];
  const alt = analysis.alternatives[0];
  if (!alt || alt.bestMove === main.bestMove || alt.depth !== main.depth) return arrows;

  // Mates only compare with mates of the same sign: "mate in 3 for us"
  // and "mate in 3 for them" are not equally good moves.
  if (main.mate !== null || alt.mate !== null) {
    if (main.mate !== null && alt.mate !== null && Math.sign(main.mate) === Math.sign(alt.mate)) {
      arrows.push(alt.bestMove);
    }
    return arrows;
  }

  // Both scores are from the side to move's perspective, so a higher
  // number is always better and no inversion is needed.
  const a = resultToCp(main);
  const b = resultToCp(alt);
  const winProbGap = winProbability(a) - winProbability(b);
  if (winProbGap <= maxWinProbGap && a - b <= maxCpGap) arrows.push(alt.bestMove);

  return arrows;
}
