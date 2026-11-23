/**
 * Chess layer — PGN import and position reconstruction (wraps chess.js).
 *
 * The rest of the program never touches chess.js: it gets a `GameData`
 * with one `MoveRecord` per ply (SAN, UCI, FEN before/after).
 */

import { Chess } from "chess.js";

export const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

export interface MoveRecord {
  /** 1-based ply number (half-move counter). */
  ply: number;
  /** Move in SAN, e.g. "Nf3". */
  san: string;
  /** Move in UCI, e.g. "g1f3" (from + to + promotion). */
  uci: string;
  /** FEN of the position before the move. */
  fenBefore: string;
  /** FEN of the position after the move. */
  fenAfter: string;
}

export interface GameData {
  /** All PGN headers of the game (Event, Date, FEN, …). */
  tags: Record<string, string>;
  white: string;
  black: string;
  whiteElo: number | null;
  blackElo: number | null;
  /** Result token from the PGN headers, e.g. "1-0" ("*" if absent). */
  result: string;
  moves: MoveRecord[];
}

function parseElo(value: string | undefined): number | null {
  if (value === undefined) return null;
  const elo = Number.parseInt(value, 10);
  return Number.isFinite(elo) ? elo : null;
}

/** A reconstructed board position at a given point of the game. */
export interface PositionView {
  /** Full FEN of the position. */
  fen: string;
  /** From/to squares of the move that produced it; null at the start. */
  lastMove: [string, string] | null;
  /** Color whose king is in check; null when nobody is. */
  check: "w" | "b" | null;
}

/**
 * Board view of a raw FEN: the position itself, the move that produced
 * it (UCI, for the last-move highlight) and whether anybody is in check.
 * The replay core used by the board and the move list — pure data, no DOM.
 */
export function positionView(fen: string, lastMoveUci?: string | null): PositionView {
  const chess = new Chess(fen);
  const lastMove: [string, string] | null = lastMoveUci
    ? [lastMoveUci.slice(0, 2), lastMoveUci.slice(2, 4)]
    : null;
  const check = chess.isCheck() ? chess.turn() : null;
  return { fen, lastMove, check };
}

/**
 * The position after `ply` half-moves: ply 0 is the start position, ply k
 * is the position after `moves[k - 1]`. Throws RangeError outside 0..N.
 */
export function positionAt(game: GameData, ply: number): PositionView {
  if (!Number.isInteger(ply) || ply < 0 || ply > game.moves.length) {
    throw new RangeError(`ply ${ply} out of range 0..${game.moves.length}`);
  }
  const move = ply === 0 ? undefined : game.moves[ply - 1];
  const fen =
    move?.fenAfter ?? game.moves[0]?.fenBefore ?? game.tags.FEN ?? START_FEN;
  return positionView(fen, move?.uci ?? null);
}

/**
 * Convert a UCI move (from+to+promotion) to SAN in the context of `fen`.
 * Returns null when the move is illegal or the FEN unparseable.
 */
export function uciToSan(fen: string, uci: string): string | null {
  if (uci === "(none)" || uci.length < 4) return null;
  try {
    const chess = new Chess(fen);
    const move = chess.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      ...(uci.length > 4 ? { promotion: uci.slice(4, 5) } : {}),
    });
    return move.san;
  } catch {
    return null;
  }
}

/**
 * Convert a UCI principal variation to SAN, replayed from `fen`.
 * Stops at the first illegal move (stale PVs happen) and at `maxMoves`.
 */
export function pvToSan(fen: string, pv: readonly string[], maxMoves: number): string {
  let chess: Chess;
  try {
    chess = new Chess(fen);
  } catch {
    return "";
  }
  const sans: string[] = [];
  for (const uci of pv.slice(0, maxMoves)) {
    if (uci.length < 4) break;
    try {
      const move = chess.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        ...(uci.length > 4 ? { promotion: uci.slice(4, 5) } : {}),
      });
      sans.push(move.san);
    } catch {
      break; // stale PV: stop at the first illegal move
    }
  }
  return sans.join(" ");
}

/**
 * Parse a PGN (single game) into a `GameData`.
 *
 * Throws an `Error` with a descriptive message on empty or malformed PGN.
 * Comments, NAGs and variations are tolerated; only the main line is kept.
 */
export function loadPgn(pgn: string): GameData {
  if (pgn.trim() === "") {
    throw new Error("empty PGN");
  }

  const chess = new Chess();
  try {
    chess.loadPgn(pgn);
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`invalid PGN: ${detail}`, { cause });
  }

  const tags = chess.getHeaders();

  const moves: MoveRecord[] = chess.history({ verbose: true }).map((move, index) => ({
    ply: index + 1,
    san: move.san,
    uci: `${move.from}${move.to}${move.promotion ?? ""}`,
    fenBefore: move.before,
    fenAfter: move.after,
  }));

  return {
    tags,
    white: tags.White ?? "?",
    black: tags.Black ?? "?",
    whiteElo: parseElo(tags.WhiteElo),
    blackElo: parseElo(tags.BlackElo),
    result: tags.Result ?? "*",
    moves,
  };
}
