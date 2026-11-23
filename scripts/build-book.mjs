/**
 * Opening book generator: distills the vendored lichess-org/chess-openings
 * TSV files in data/ (CC0) into src/config/openings.json.
 *
 *   npm run book        (or: node scripts/build-book.mjs)
 *
 * Full coverage: every position reachable from *any* known line (main
 * lines and all variations) is stored as:
 *
 *   key   "<placement> <turn>" — the first two FEN fields, so different
 *         move orders reaching the same position (transpositions) share
 *         one entry
 *   "m"   space-separated UCI continuations, union over every line that
 *         passes through the position
 *   "n"   index into "names" — the most specific name known for the
 *         position: a line ending exactly there wins over a line merely
 *         passing through it (closest-to-end breaks ties); the initial
 *         position is deliberately left unnamed
 *
 * Runs offline (data/ is checked in) and is part of `npm run build`.
 */

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { Chess } from "chess.js";

const SRC_DIR = "data";
const OUT = "src/config/openings.json";

/** Position key: placement + turn of a FEN. */
const keyOf = (fen) => fen.split(" ").slice(0, 2).join(" ");

/** PGN movetext → SAN tokens (drop move numbers, results, annotations). */
function sanTokens(pgn) {
  return pgn
    .split(/\s+/)
    .filter((t) => t && !/^\d+\.+$/.test(t) && !/^(\d+-\d+|\*)$/.test(t))
    .map((t) => t.replace(/[+#!?]+$/, ""));
}

const startKey = keyOf(new Chess().fen());

// key → { moves: Set<uci>, endRow?, throughRow? }
const movesByPos = new Map();
const endRow = new Map(); // key → row index (some line ends exactly here)
const throughRow = new Map(); // key → [remaining, row] (closest-to-end wins)
const rows = [];

let parsed = 0;
let skipped = 0;

const files = readdirSync(SRC_DIR).filter((f) => f.endsWith(".tsv")).sort();
for (const file of files) {
  const text = readFileSync(`${SRC_DIR}/${file}`, "utf8");
  for (const [i, line] of text.split("\n").entries()) {
    if (i === 0 || !line.trim()) continue; // header line
    const [eco, name, pgn] = line.split("\t");
    if (!eco || !name || !pgn) {
      skipped++;
      continue;
    }
    parsed++;

    // Replay the line first; commit only if every SAN is legal.
    const chess = new Chess();
    const steps = []; // [key, uci] per half-move
    let failed = false;
    for (const san of sanTokens(pgn)) {
      const key = keyOf(chess.fen());
      let mv;
      try {
        mv = chess.move(san);
      } catch {
        failed = san;
        break;
      }
      if (!mv) {
        failed = san;
        break;
      }
      steps.push([key, `${mv.from}${mv.to}${mv.promotion ?? ""}`]);
    }
    if (failed || steps.length === 0) {
      skipped++;
      console.warn(`SKIP (${file}, ${eco} ${name}): ${failed ? `failed at "${failed}"` : "no SAN tokens"} — "${pgn}"`);
      continue;
    }

    const row = rows.push({ eco, name }) - 1;
    const n = steps.length;
    for (let i = 0; i < n; i++) {
      const [key, uci] = steps[i];
      let set = movesByPos.get(key);
      if (!set) movesByPos.set(key, (set = new Set()));
      set.add(uci);

      // This line continues from `key`; remember the closest-to-end one
      // as the fallback name (skip the initial position — every line
      // passes through it and none of their names describe it).
      if (key !== startKey) {
        const remaining = n - i; // half-moves still to play from here
        const prev = throughRow.get(key);
        if (!prev || remaining < prev[0]) throughRow.set(key, [remaining, row]);
      }
    }
    const finalKey = keyOf(chess.fen());
    if (!endRow.has(finalKey)) endRow.set(finalKey, row);
  }
}

// ------------------------------------------------------------ emit

const nameIdx = new Map(); // "eco\0name" → index
const names = [];
function idxFor({ eco, name }) {
  const k = `${eco}\0${name}`;
  let i = nameIdx.get(k);
  if (i === undefined) {
    i = names.length;
    names.push({ eco, name });
    nameIdx.set(k, i);
  }
  return i;
}

const positions = {};
const allKeys = new Set([...movesByPos.keys(), ...endRow.keys(), ...throughRow.keys()]);
let named = 0;
let exactNames = 0;

for (const key of allKeys) {
  const entry = {};

  const moves = movesByPos.get(key);
  if (moves && moves.size > 0) entry.m = [...moves].join(" ");

  const end = endRow.get(key);
  if (end !== undefined) {
    entry.n = idxFor(rows[end]);
    exactNames++;
  } else {
    const through = throughRow.get(key);
    if (through) entry.n = idxFor(rows[through[1]]);
  }
  if (entry.n !== undefined) named++;

  if (entry.m !== undefined || entry.n !== undefined) positions[key] = entry;
}

const json = JSON.stringify({ names, positions });
writeFileSync(OUT, json);

const maxMoves = Math.max(
  ...[...Object.values(positions)].map((p) => (p.m ? p.m.split(" ").length : 0)),
);
console.log(
  `openings: ${parsed} lines from ${files.length} files` +
    (skipped ? `, ${skipped} skipped` : "") +
    `\npositions: ${Object.keys(positions).length}` +
    ` (${named} named, ${exactNames} with an exact end-of-line name)` +
    `\nmax continuations per position: ${maxMoves}` +
    `\nwrote ${OUT} (${(json.length / 1024).toFixed(0)} KB)`,
);
