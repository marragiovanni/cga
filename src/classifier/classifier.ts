/**
 * Move classifier — turns engine numbers into natural-language labels.
 *
 * Pipeline (pure functions, unit-tested from end to end):
 *
 *   1. engine scores arrive in UCI's side-to-move perspective →
 *      normalize to White-relative (`toWhiteRelative`)
 *   2. convert the evals before/after the move to the *mover's*
 *      perspective; cpLoss = before − after, clamped at 0
 *   3. pick a label, in priority order:
 *        book  >  best  >  blunder > mistake > inaccuracy > good > acceptable
 *      the cp-loss ladder is scaled per player by `thresholdScale(elo)`
 *      (stronger players are held to stricter thresholds)
 *
 * Win probabilities are reported alongside the label so the UI (and
 * the accuracy model) can reason in "chance of scoring" terms.
 */

import type { GameData, MoveRecord } from "../chess/game.ts";
import type { PositionAnalysis } from "../analyzer/analyzer.ts";
import type { EngineResult } from "../engine/types.ts";
import { gameAccuracy } from "./accuracy.ts";
import { defaultConfig, thresholdScale, type ClassifierConfig } from "./config.ts";
import { winProbability } from "./winprob.ts";

export type Label =
  | "book"
  | "best"
  | "blunder"
  | "mistake"
  | "inaccuracy"
  | "good"
  | "acceptable";

/**
 * Classification for a book move: the opening table says the move is
 * theory, so no engine evals are needed — it scores as a zero-loss
 * move (and feeds the accuracy as perfect, like a "best" move would).
 */
export function bookClassification(): MoveClassification {
  return {
    label: "book",
    cpLoss: 0,
    winProbBefore: 0.5,
    winProbAfter: 0.5,
  };
}

export interface MoveClassification {
  label: Label;
  /** Evaluation loss of the played move in centipawns (>= 0, mover's
   *  perspective: how much *this player* gave away). */
  cpLoss: number;
  /** Expected score (win = 1, draw = 0.5) for the mover before the move. */
  winProbBefore: number;
  /** Expected score for the mover after having played the move. */
  winProbAfter: number;
}

/** Mate scores are mapped onto ±(MATE_CP − |mate|) centipawns so they
 *  can take part in the same arithmetic as normal evaluations. */
export const MATE_CP = 10_000;

/** Engine result → centipawns, side-to-move perspective (mates folded
 *  into the cp scale). scoreCp and mate are both null → 0. */
export function resultToCp(result: Pick<EngineResult, "scoreCp" | "mate">): number {
  if (result.mate !== null) {
    return result.mate > 0 ? MATE_CP - result.mate : -(MATE_CP + result.mate);
  }
  return result.scoreCp ?? 0;
}

/** Side-to-move-perspective score → White-relative (UCI scores say
 *  "good for the side to move"; flip them when Black is to move). */
export function toWhiteRelative(scoreCp: number, fen: string): number {
  return fen.split(" ")[1] === "b" ? -scoreCp : scoreCp;
}

/** White-relative score → the given side's perspective. */
export function toSidePerspective(whiteRelative: number, side: "w" | "b"): number {
  return side === "w" ? whiteRelative : -whiteRelative;
}

export interface ClassifyInput {
  /** 1-based half-move number (gates the book via `book.maxPly`). */
  ply: number;
  /** The side that played the move. */
  mover: "w" | "b";
  /** The move actually played, UCI (from+to+promotion). */
  playedMove: string;
  /** The engine's best move for this position, UCI. */
  bestMove: string;
  /** Evaluation before the move, White-relative centipawns. */
  whiteRelativeBefore: number;
  /** Evaluation after the move, White-relative centipawns. */
  whiteRelativeAfter: number;
  /** Rating of the player who moved (null → thresholds unscaled). */
  elo: number | null;
  /** True when the move is in the opening book. */
  inBook?: boolean;
  /** Config override — tests pass custom thresholds; omit for labels.json. */
  config?: ClassifierConfig;
}

function pickLabel(input: ClassifyInput, cfg: ClassifierConfig, cpLoss: number): Label {
  if (input.inBook && input.ply <= cfg.book.maxPly) return "book";
  if (input.playedMove === input.bestMove) return "best";

  const scale = thresholdScale(input.elo, cfg.eloScaling);
  const t = cfg.labels;
  if (cpLoss >= t.blunderCpLoss * scale) return "blunder";
  if (cpLoss >= t.mistakeCpLoss * scale) return "mistake";
  if (cpLoss >= t.inaccuracyCpLoss * scale) return "inaccuracy";
  if (cpLoss >= t.goodCpLoss * scale) return "good";
  return "acceptable";
}

/** Classify a single move from normalized (White-relative) evals. */
export function classifyMove(input: ClassifyInput): MoveClassification {
  const cfg = input.config ?? defaultConfig;
  const before = toSidePerspective(input.whiteRelativeBefore, input.mover);
  const after = toSidePerspective(input.whiteRelativeAfter, input.mover);
  // Engine horizon effects can make the "after" eval look better than
  // "before"; a move can never score a negative loss.
  const cpLoss = Math.max(0, before - after);

  return {
    label: pickLabel(input, cfg, cpLoss),
    cpLoss,
    winProbBefore: winProbability(before, cfg.winProb.k),
    winProbAfter: winProbability(after, cfg.winProb.k),
  };
}

export interface ClassifyGameOptions {
  /** Overrides the PGN's WhiteElo tag (undefined = use the tag). */
  whiteElo?: number | null;
  /** Overrides the PGN's BlackElo tag (undefined = use the tag). */
  blackElo?: number | null;
  /** Opening-book lookup; defaults to "nothing is in book".
   *  Receives the position the move was played from so the book can be
   *  queried — the classifier applies the `book.maxPly` gate itself. */
  inBook?: (move: { san: string; uci: string; ply: number; fenBefore: string }) => boolean;
  /** Config override (tests). */
  config?: ClassifierConfig;
}

export interface GameClassification {
  /** Index-aligned with `game.moves`; null when either surrounding
   *  position is missing from `results` (aborted analysis). */
  moves: (MoveClassification | null)[];
  /** Mean accuracy over White's classified moves (0..100). */
  whiteAccuracy: number;
  /** Mean accuracy over Black's classified moves (0..100). */
  blackAccuracy: number;
}

/**
 * Classify one move from its two surrounding position analyses (the
 * "before" holds the engine's best alternative, the "after" the score
 * the move actually produced). Shared by `classifyGame` and the
 * per-node classification of interactive/variation moves.
 */
export function classifyMoveRecord(
  move: MoveRecord,
  before: PositionAnalysis,
  after: PositionAnalysis,
  options: ClassifyGameOptions & { whiteElo: number | null; blackElo: number | null },
): MoveClassification {
  const cfg = options.config ?? defaultConfig;
  // fenBefore's turn field tells us who moved (a FEN-started game may
  // have Black on move at ply 1 — do not assume odd = White).
  const mover = move.fenBefore.split(" ")[1] === "b" ? "b" : "w";
  return classifyMove({
    ply: move.ply,
    mover,
    playedMove: move.uci,
    bestMove: before.result.bestMove,
    whiteRelativeBefore: toWhiteRelative(resultToCp(before.result), before.fen),
    whiteRelativeAfter: toWhiteRelative(resultToCp(after.result), after.fen),
    elo: mover === "w" ? options.whiteElo : options.blackElo,
    inBook:
      options.inBook?.({ san: move.san, uci: move.uci, ply: move.ply, fenBefore: move.fenBefore }) ??
      false,
    config: cfg,
  });
}

/**
 * Classify a whole game. `results` is the output of `analyzeGame` fed
 * with `gamePositions(game)` — N+1 entries: entry i holds the eval
 * *before* move i, entry i+1 the eval *after* it.
 *
 * Throws when the analysis does not line up with the game (wrong
 * length); missing (null) entries yield a null classification for the
 * affected move only, and are skipped by the accuracy averages.
 */
export function classifyGame(
  game: GameData,
  results: readonly (PositionAnalysis | null)[],
  options: ClassifyGameOptions = {},
): GameClassification {
  const expected = game.moves.length + 1;
  if (results.length !== expected) {
    throw new Error(`expected ${expected} position analyses, got ${results.length}`);
  }

  const cfg = options.config ?? defaultConfig;
  const whiteElo = options.whiteElo !== undefined ? options.whiteElo : game.whiteElo;
  const blackElo = options.blackElo !== undefined ? options.blackElo : game.blackElo;

  const moves: (MoveClassification | null)[] = [];
  const cpLosses: { w: number[]; b: number[] } = { w: [], b: [] };

  for (const [index, move] of game.moves.entries()) {
    const before = results[index];
    const after = results[index + 1];
    if (!before || !after) {
      moves.push(null);
      continue;
    }

    const classification = classifyMoveRecord(move, before, after, {
      ...options,
      whiteElo,
      blackElo,
      config: cfg,
    });

    moves.push(classification);
    const mover = move.fenBefore.split(" ")[1] === "b" ? "b" : "w";
    cpLosses[mover].push(classification.cpLoss);
  }

  return {
    moves,
    whiteAccuracy: gameAccuracy(cpLosses.w, cfg.accuracy.k),
    blackAccuracy: gameAccuracy(cpLosses.b, cfg.accuracy.k),
  };
}
