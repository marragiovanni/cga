/**
 * Classifier configuration — the data-driven knobs live in
 * src/config/labels.json so tuning thresholds never requires code
 * changes (this module only provides the types and the ELO scaling).
 */

import raw from "../config/labels.json" with { type: "json" };

export interface EloScalingConfig {
  /** ELO at which thresholds apply exactly as written (scale 1). */
  referenceElo: number;
  /** Scale change per ELO point above `referenceElo`; negative = stronger
   *  players are held to stricter (lower) cp-loss thresholds. */
  slope: number;
  /** Scale floor: strong players' thresholds never drop below this
   *  fraction of the base values. */
  minScale: number;
  /** Scale ceiling: weak players' thresholds never exceed this multiple
   *  of the base values. */
  maxScale: number;
}

export interface ClassifierConfig {
  /** Opening book limits (maxPly gates the lookup). */
  book: { maxPly: number };
  /** Logistic win-probability curve. */
  winProb: { k: number };
  /** ELO → threshold multiplier. */
  eloScaling: EloScalingConfig;
  /** Cp-loss ladder boundaries (mover perspective, before scaling). */
  labels: {
    blunderCpLoss: number;
    mistakeCpLoss: number;
    inaccuracyCpLoss: number;
    goodCpLoss: number;
  };
  /** Exponential decay constant for accuracy = 100·e^(−k·cpLoss). */
  accuracy: { k: number };
}

/** The live configuration (labels.json). */
export const defaultConfig: ClassifierConfig = raw;

/**
 * Multiplier applied to the cp-loss thresholds for a player of `elo`.
 *
 * Stronger players are judged more strictly (a 2500 dropping half a
 * pawn is more surprising than a 1000 doing it), weaker players get
 * more slack. Unknown ELO (null/NaN) → 1: thresholds exactly as
 * written in labels.json.
 */
export function thresholdScale(elo: number | null, cfg: EloScalingConfig): number {
  if (elo === null || !Number.isFinite(elo)) return 1;
  const rawScale = 1 + cfg.slope * (elo - cfg.referenceElo);
  return Math.min(cfg.maxScale, Math.max(cfg.minScale, rawScale));
}
