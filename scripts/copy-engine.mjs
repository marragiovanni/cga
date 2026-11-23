/**
 * Copies the Stockfish worker into public/stockfish/ so both the Vite dev
 * server (serves public/) and `vite build` (copies public/ into dist/) ship
 * it. Runs before `vite` and `vite build` (see package.json scripts).
 */

import { copyFile, mkdir, readdir } from "node:fs/promises";

// Keep in sync with src/config/labels.json (engine.flavor).
const ENGINE_FLAVOR = "lite-single";
const STOCKFISH_BIN = "node_modules/stockfish/bin";
const ENGINE_OUT = "public/stockfish";

await mkdir(ENGINE_OUT, { recursive: true });
const files = await readdir(STOCKFISH_BIN);
const js = files.find((f) => f.endsWith(`-${ENGINE_FLAVOR}.js`));
const wasm = files.find((f) => f.endsWith(`-${ENGINE_FLAVOR}.wasm`));
if (!js || !wasm) {
  throw new Error(`stockfish "${ENGINE_FLAVOR}" build not found in ${STOCKFISH_BIN}`);
}
// The worker derives its WASM URL from its own name (.js -> .wasm), so
// both files are renamed to stable names the adapter can rely on.
await copyFile(`${STOCKFISH_BIN}/${js}`, `${ENGINE_OUT}/engine.js`);
await copyFile(`${STOCKFISH_BIN}/${wasm}`, `${ENGINE_OUT}/engine.wasm`);
console.log(`copied engine to ${ENGINE_OUT}/engine.{js,wasm}`);
