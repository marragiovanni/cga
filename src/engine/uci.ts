/**
 * UCI protocol parser — converts raw engine output lines into typed events.
 *
 * Pure functions: no engine, no worker, no I/O. The rest of the app never
 * sees raw UCI text; it only sees `UciEvent` / `EngineResult` objects.
 */

import type { EngineResult } from "./types.ts";

export interface UciInfoEvent {
  type: "info";
  depth?: number;
  seldepth?: number;
  timeMs?: number;
  nodes?: number;
  nps?: number;
  hashfull?: number;
  tbhits?: number;
  multipv?: number;
  currmove?: string;
  /** Score in centipawns from the side to move's perspective (UCI
   *  convention; undefined if mate score). */
  scoreCp?: number;
  /** Mate score in plies from the side to move (undefined if cp score). */
  scoreMate?: number;
  scoreBound?: "lowerbound" | "upperbound";
  pv?: string[];
  /** Free-form engine message (e.g. "info string …"). */
  string?: string;
}

export interface UciIdEvent {
  type: "id";
  key: "name" | "author";
  value: string;
}

export interface UciReadyEvent {
  type: "uciok" | "readyok";
}

export interface UciBestMoveEvent {
  type: "bestmove";
  bestMove: string;
  ponder?: string;
}

export type UciEvent = UciInfoEvent | UciIdEvent | UciReadyEvent | UciBestMoveEvent;

/** UCI move: e2e4, e1g1, e7e8q. */
const MOVE_RE = /^(?:[a-h][1-8]){2}[qrbn]?$/;

function num(token: string | undefined): number | undefined {
  if (token === undefined) return undefined;
  const n = Number(token);
  return Number.isFinite(n) ? n : undefined;
}

function parseInfo(tokens: string[]): UciInfoEvent {
  const info: UciInfoEvent = { type: "info" };
  let i = 1;
  while (i < tokens.length) {
    const key = tokens[i++];
    switch (key) {
      case "depth":
        info.depth = num(tokens[i++]);
        break;
      case "seldepth":
        info.seldepth = num(tokens[i++]);
        break;
      case "time":
        info.timeMs = num(tokens[i++]);
        break;
      case "nodes":
        info.nodes = num(tokens[i++]);
        break;
      case "nps":
        info.nps = num(tokens[i++]);
        break;
      case "hashfull":
        info.hashfull = num(tokens[i++]);
        break;
      case "tbhits":
        info.tbhits = num(tokens[i++]);
        break;
      case "multipv":
        info.multipv = num(tokens[i++]);
        break;
      case "currmove":
        info.currmove = tokens[i++];
        break;
      case "score": {
        const kind = tokens[i++];
        const value = num(tokens[i++]);
        if (kind === "cp" && value !== undefined) info.scoreCp = value;
        else if (kind === "mate" && value !== undefined) info.scoreMate = value;
        const bound = tokens[i];
        if (bound === "lowerbound" || bound === "upperbound") {
          info.scoreBound = bound;
          i++;
        }
        break;
      }
      case "pv": {
        const pv: string[] = [];
        while (i < tokens.length) {
          const token = tokens[i];
          if (token === undefined || !MOVE_RE.test(token)) break;
          pv.push(token);
          i++;
        }
        info.pv = pv;
        break;
      }
      case "string":
        info.string = tokens.slice(i).join(" ");
        i = tokens.length;
        break;
      default:
        // Unknown token — skip it (forward compatibility with new fields).
        break;
    }
  }
  return info;
}

/**
 * Parse one line of engine output. Returns null for lines that carry no
 * UCI event (banners, blank lines, unknown commands) — callers may ignore
 * those.
 */
export function parseUciLine(raw: string): UciEvent | null {
  const line = raw.trim();
  if (line === "") return null;
  const tokens = line.split(/\s+/);
  switch (tokens[0]) {
    case "uciok":
      return { type: "uciok" };
    case "readyok":
      return { type: "readyok" };
    case "id": {
      const key = tokens[1];
      if (key !== "name" && key !== "author") return null;
      return { type: "id", key, value: tokens.slice(2).join(" ") };
    }
    case "bestmove": {
      const bestMove = tokens[1] ?? "(none)";
      const ponderIndex = tokens.indexOf("ponder");
      const ponder = ponderIndex !== -1 ? tokens[ponderIndex + 1] : undefined;
      return ponder !== undefined
        ? { type: "bestmove", bestMove, ponder }
        : { type: "bestmove", bestMove };
    }
    case "info":
      return parseInfo(tokens);
    default:
      return null;
  }
}

/**
 * Convert an `info` event into an `EngineResult`, or null if the line has
 * no search score / no principal variation (e.g. "info string …").
 *
 * For intermediate results (`final = false`), `bestMove` is the first move
 * of the reported line — the caller treats `multipv` to tell the main line
 * from alternatives.
 */
export function infoToResult(info: UciInfoEvent, final: boolean): EngineResult | null {
  const pv = info.pv;
  if (pv === undefined || pv.length === 0) return null;
  const bestMove = pv[0];
  if (bestMove === undefined) return null;
  if (info.scoreCp === undefined && info.scoreMate === undefined) return null;
  return {
    bestMove,
    scoreCp: info.scoreCp ?? null,
    mate: info.scoreMate ?? null,
    pv,
    depth: info.depth ?? 0,
    multipv: info.multipv ?? 1,
    final,
  };
}
