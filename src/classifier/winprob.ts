/**
 * Win-probability model: centipawns → chance of scoring a win.
 *
 * Standard logistic curve: with k = 0.004,
 * +100cp ≈ 60%, +300cp ≈ 77%, +800cp ≈ 96%.
 */

export function winProbability(cp: number, k = 0.004): number {
  return 1 / (1 + Math.exp(-k * cp));
}

/**
 * Expected score between two players from their ELO difference
 * (whiteElo - blackElo). 0 = certain loss, 0.5 = equal, 1 = certain win.
 */
export function expectedScore(eloDiff: number): number {
  return 1 / (1 + Math.pow(10, -eloDiff / 400));
}
