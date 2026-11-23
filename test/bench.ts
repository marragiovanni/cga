/**
 * Depth tuning benchmark — run manually, not part of `npm test`:
 *
 *   node test/bench.ts
 *
 * Measures ms/position for the single-threaded Stockfish WASM at a few
 * depths on real game positions, and projects the time for a full game.
 * The result informs `engine.depth` in src/config/labels.json.
 */

import { loadPgn } from "../src/chess/game.ts";
import { gamePositions } from "../src/analyzer/analyzer.ts";
import { StockfishWasmEngine } from "../src/engine/stockfish-wasm.ts";
import { nodeEngineTransport } from "./helpers/node-transport.ts";

const OPERA_PGN = `[Event "Paris Opera"]
[White "Paul Morphy"]
[Black "Duke Karl / Count Isouard"]
[Result "1-0"]

1.e4 e5 2.Nf3 d6 3.d4 Bg4 4.dxe5 Bxf3 5.Qxf3 dxe5 6.Bc4 Nf6 7.Qb3 Qe7 8.Nc3 c6 9.Bg5 b5 10.Nxb5 cxb5 11.Bxb5+ Nbd7 12.O-O-O Rd8 13.Rxd7 Rxd7 14.Rd1 Qe6 15.Bxd7+ Nxd7 16.Qb8+ Nxb8 17.Rd8# 1-0`;

const DEPTHS = [12, 14, 16];
const POSITIONS_PER_DEPTH = 10;

async function main(): Promise<void> {
  const game = loadPgn(OPERA_PGN);
  const positions = gamePositions(game).slice(0, POSITIONS_PER_DEPTH);
  const fullGame = gamePositions(game).length;
  console.log(
    `Opera Game: ${game.moves.length} moves → ${fullGame} positions; benchmarking ${positions.length} per depth\n`,
  );

  const engine = new StockfishWasmEngine(nodeEngineTransport());
  try {
    console.log("depth | ms/position | total for game");
    console.log("------+-------------+---------------");
    for (const depth of DEPTHS) {
      const start = performance.now();
      for (const fen of positions) {
        // Drain the stream fully so timing includes the whole search.
        // multipv 2 matches the analyzer's real configuration.
        for await (const _ of engine.analyze(fen, { depth, multipv: 2 })) {
          // consume
        }
      }
      const perPosition = (performance.now() - start) / positions.length;
      const projected = (perPosition * fullGame) / 1000;
      console.log(
        `${String(depth).padStart(5)} | ${perPosition.toFixed(0).padStart(11)} | ${projected.toFixed(1)}s`,
      );
    }
  } finally {
    engine.dispose();
  }
}

void main();
