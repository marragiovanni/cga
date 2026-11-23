import { createRequire } from "node:module";

import type { EngineTransport } from "../../src/engine/transport.ts";

/**
 * EngineTransport backed by the real stockfish package's Node.js API.
 * This is how the integration test runs the actual engine without a
 * browser: same UCI strings, same adapter, different pipe.
 */

interface NodeStockfishEngine {
  processCommand(command: string): void;
  terminate(): void;
}

type InitEngine = (flavor: string, onMessage: (line: string) => void) => NodeStockfishEngine;

const require = createRequire(import.meta.url);
const stockfishModule = require("stockfish") as InitEngine & {
  findEngine(flavor: string): string;
};
const enginePath = stockfishModule.findEngine("lite-single");

export function nodeEngineTransport(): EngineTransport {
  // The stockfish Node module keeps state at module scope: a second
  // instantiation from the same require cache comes back broken (no
  // processCommand, wasm path resolved to the generic stockfish.wasm).
  // Loading a fresh module per transport mirrors the browser, where every
  // engine gets its own Worker.
  delete require.cache[enginePath];
  const initEngine = require("stockfish") as InitEngine;

  let lineHandler: ((line: string) => void) | null = null;
  let fatalHandler: ((error: Error) => void) | null = null;

  const engine = initEngine("lite-single", (line) => {
    lineHandler?.(line);
  });

  return {
    send(command: string): void {
      try {
        engine.processCommand(command);
      } catch (error) {
        fatalHandler?.(error instanceof Error ? error : new Error(String(error)));
      }
    },
    onLine(handler): void {
      lineHandler = handler;
    },
    onFatal(handler): void {
      fatalHandler = handler;
    },
    terminate(): void {
      engine.terminate();
    },
  };
}
