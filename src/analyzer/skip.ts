/**
 * Search planning — deciding which positions actually need the engine.
 *
 * Two facts let a typical game skip roughly a third of its searches:
 *
 *   1. **Book moves need no evals.** A move the opening table knows is
 *      labeled "book" from the table alone (zero cp loss, perfect
 *      accuracy), so neither the position before it nor after it is
 *      needed *for that move*. The needed set is therefore the union,
 *      over every NON-book move, of {position before, position after} —
 *      a line that transposes back into book (or forks out of it) keeps
 *      exactly the positions its non-book moves touch.
 *   2. **Terminal positions have no search.** In a checkmate, stalemate
 *      or insufficient-material position the engine replies instantly
 *      with `info depth 0` — `mate 0` for the mated side, `cp 0` for
 *      the draws. Synthesizing that exact result costs nothing and
 *      keeps the classifier's mate arithmetic identical.
 *
 * Positions the plan drops get NO cache entry: the sidebar shows "–"
 * there (no eval for pure-theory positions).
 */

import { Chess } from "chess.js";
import { isBookMove } from "../book/book.ts";
import type { PositionAnalysis } from "./analyzer.ts";

/** The outcome of planning a line's positions for search. */
export interface SearchPlan {
  /** Positions that still need a real engine search (deduplicated). */
  searchable: string[];
  /** Engine-identical results for terminal positions (seed into the
   *  cache before the run). */
  synthesized: PositionAnalysis[];
}

/** True when the position is over in a way the engine cannot search:
 *  checkmate, stalemate, or dead (insufficient material). */
export function isTerminal(fen: string): boolean {
  const chess = new Chess(fen);
  return chess.isCheckmate() || chess.isStalemate() || chess.isInsufficientMaterial();
}

/**
 * The analysis a terminal position would get from the engine — bit for
 * bit: the engine answers `info depth 0 score mate 0` when the side to
 * move is mated and `score cp 0` for stalemate/dead draws, with no
 * best move and no PV.
 */
export function terminalAnalysis(fen: string): PositionAnalysis {
  const mated = new Chess(fen).isCheckmate();
  return {
    fen,
    result: {
      bestMove: "(none)",
      scoreCp: mated ? null : 0,
      mate: mated ? 0 : null,
      pv: [],
      depth: 0,
      multipv: 1,
      final: true,
    },
    alternatives: [],
  };
}

/**
 * Plan the searches for a line. `positions` are the line's N+1 FENs
 * (position i sits *before* move i); `ucis[i]` is the move played from
 * `positions[i]` — so `ucis.length === positions.length - 1`.
 */
export function planSearch(
  positions: readonly string[],
  ucis: readonly string[],
): SearchPlan {
  // Union of {i, i+1} over non-book moves — the positions whose evals
  // feed a real (engine-labeled) classification.
  const needed = new Set<number>();
  for (let index = 0; index < ucis.length; index++) {
    if (isBookMove(positions[index]!, ucis[index]!)) continue;
    needed.add(index); // eval before the move (its best alternative)
    needed.add(index + 1); // eval after the move (its result)
  }

  const searchable: string[] = [];
  const seen = new Set<string>();
  const synthesized: PositionAnalysis[] = [];
  for (const index of needed) {
    const fen = positions[index]!;
    if (isTerminal(fen)) {
      synthesized.push(terminalAnalysis(fen));
      continue;
    }
    // The same position can be needed twice (transposition inside the
    // line): one search serves both — the cache is FEN-keyed.
    if (seen.has(fen)) continue;
    seen.add(fen);
    searchable.push(fen);
  }
  return { searchable, synthesized };
}
