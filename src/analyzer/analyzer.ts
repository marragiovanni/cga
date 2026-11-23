/**
 * Game analyzer — the analysis "main loop".
 *
 * Takes the positions of a game, feeds them to the engine one at a time
 * (a single engine can only search one position at a time), and collects
 * the raw evaluations — streaming progress via callback, cancellable via
 * AbortSignal, resumable from previous results. No classification here;
 * this is raw engine data only.
 */

import { START_FEN, type GameData } from "../chess/game.ts";
import type { EngineAdapter, EngineResult } from "../engine/types.ts";

/** Analysis of a single position. */
export interface PositionAnalysis {
  fen: string;
  /** Final engine result: best move, score, main PV. */
  result: EngineResult;
  /** Best alternative lines (multipv > 1), deepest snapshot of each. */
  alternatives: EngineResult[];
}

export interface AnalyzeGameOptions {
  /** Search depth per position (omit to use movetimeMs). */
  depth?: number;
  /** Fixed thinking time per position in ms (alternative to depth). */
  movetimeMs?: number;
  /** Candidate lines: 1 = best only, 2+ = include alternatives. Default 2. */
  multipv?: number;
  /** Called after every completed position with (done, total) — like a C
   *  function pointer for the progress bar; called once up front too. */
  onProgress?: (done: number, total: number) => void;
  /** Cancellation flag: checked before every position and every streamed
   *  line; aborting also stops the engine immediately. */
  signal?: AbortSignal;
  /** Previously computed results to keep (resume): non-null entries are
   *  not recomputed. Index-aligned with `positions`. */
  existing?: readonly (PositionAnalysis | null)[];
}

export interface GameAnalysis {
  /** One entry per position; null when not analyzed (aborted before it). */
  results: (PositionAnalysis | null)[];
  /** True if the signal cancelled the run before all positions were done. */
  aborted: boolean;
}

/**
 * The N+1 positions of a game: the position before every one of the N
 * moves, plus the final position after the last move. Analyzing all of
 * them yields the eval before each move (best alternative) and after it
 * (the resulting score) — everything the classifier needs later.
 */
export function gamePositions(game: GameData): string[] {
  const positions = game.moves.map((move) => move.fenBefore);
  const last = game.moves.at(-1);
  positions.push(last?.fenAfter ?? game.tags.FEN ?? START_FEN);
  return positions;
}

/**
 * Analyze every position sequentially, reporting progress and honoring
 * cancellation. Returns as soon as the signal aborts; positions not
 * reached stay null so a later call with `existing` resumes exactly at
 * the first missing one.
 */
export async function analyzeGame(
  engine: EngineAdapter,
  positions: readonly string[],
  options: AnalyzeGameOptions = {},
): Promise<GameAnalysis> {
  const total = positions.length;
  const multipv = options.multipv ?? 2;
  const signal = options.signal;
  const results: (PositionAnalysis | null)[] = positions.map(
    (_, index) => options.existing?.[index] ?? null,
  );

  let done = results.reduce((count, r) => count + (r !== null ? 1 : 0), 0);
  options.onProgress?.(done, total);

  // Abort mid-search: stop the engine right away so the stream below
  // winds down promptly (the adapter sends `stop` and drains cleanly).
  const onAbort = (): void => engine.stop();
  signal?.addEventListener("abort", onAbort, { once: true });

  try {
    for (const [index, fen] of positions.entries()) {
      if (signal?.aborted) break;
      if (results[index] !== null) continue; // already computed (resume)

      const alternatives = new Map<number, EngineResult>();
      let final: EngineResult | null = null;

      for await (const result of engine.analyze(fen, { depth: options.depth, movetimeMs: options.movetimeMs, multipv })) {
        if (signal?.aborted) break; // consumer break: adapter stops + drains
        if (result.final) {
          final = result;
        } else if (result.multipv > 1) {
          alternatives.set(result.multipv, result);
        }
      }

      if (signal?.aborted) break; // result cut short by stop — discard it
      if (final === null) {
        throw new Error("engine stream ended without a final result");
      }

      results[index] = {
        fen,
        result: final,
        alternatives: [...alternatives.values()].sort((a, b) => a.multipv - b.multipv),
      };
      done++;
      options.onProgress?.(done, total);
    }
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }

  return { results, aborted: signal?.aborted ?? false };
}
