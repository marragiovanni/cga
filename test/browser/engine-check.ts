/**
 * Browser smoke check for the engine adapter — built to
 * dist-test/test/engine.html.
 * Verifies: worker starts, UCI handshake completes, info lines stream,
 * and the correct best move comes back for a mate-in-one FEN.
 */

import { createWebEngine } from "../../src/engine/stockfish-wasm.ts";
import type { EngineResult } from "../../src/engine/types.ts";

// White rook on e1: Re8# is mate in one.
const FEN = "6k1/5ppp/8/8/8/8/8/4R1K1 w - - 0 1";

const out = document.getElementById("out");
if (!out) throw new Error("missing #out element");
const log = (line: string): void => {
  out.textContent = `${out.textContent ?? ""}${line}\n`;
};

async function check(): Promise<void> {
  const engine = createWebEngine();
  log("worker created — analyzing…");
  let count = 0;
  let final: EngineResult | null = null;
  try {
    for await (const result of engine.analyze(FEN, { depth: 14, multipv: 2 })) {
      count++;
      const score = result.mate !== null ? `mate ${result.mate}` : `${result.scoreCp}cp`;
      log(
        `#${count} depth=${result.depth} multipv=${result.multipv} score=${score} ` +
          `pv=${result.pv.slice(0, 6).join(" ")}${result.final ? "  <<< FINAL" : ""}`,
      );
      if (result.final) final = result;
    }
    if (final && final.bestMove === "e1e8") {
      log(`\nPASS — bestmove ${final.bestMove} (expected e1e8), ${count} results`);
    } else {
      log(`\nFAIL — bestmove ${final?.bestMove ?? "none"} (expected e1e8)`);
    }
  } catch (error) {
    log(`ERROR — ${error}`);
  } finally {
    engine.dispose();
  }
}

void check();
