/**
 * Transport between the adapter and the engine process.
 *
 * The adapter speaks UCI strings; a transport only moves them around.
 * Production uses `WebWorkerTransport` (browser Worker); tests can supply
 * any implementation (e.g. the stockfish Node.js API) — the adapter and
 * the UCI parser never care.
 */

export interface EngineTransport {
  /** Send one UCI command to the engine. */
  send(command: string): void;
  /** Register the line handler. Exactly one handler; registered once at setup. */
  onLine(handler: (line: string) => void): void;
  /** Register the handler for unrecoverable transport failures. */
  onFatal(handler: (error: Error) => void): void;
  /** Kill the engine. The transport is unusable afterwards. */
  terminate(): void;
}

/**
 * Runs the engine in a Web Worker and exchanges plain UCI strings via
 * postMessage. Keeps the engine (and its CPU load) off the main thread.
 */
export class WebWorkerTransport implements EngineTransport {
  private readonly worker: Worker;
  private lineHandler: ((line: string) => void) | null = null;
  private fatalHandler: ((error: Error) => void) | null = null;

  constructor(workerUrl: string | URL) {
    this.worker = new Worker(workerUrl);
    this.worker.onmessage = (event: MessageEvent) => {
      // The engine posts strings; non-string messages (e.g. optional
      // download-progress objects) carry no UCI data and are ignored.
      if (typeof event.data === "string") {
        this.lineHandler?.(event.data);
      }
    };
    this.worker.onerror = (event: ErrorEvent) => {
      this.fatalHandler?.(new Error(event.message || "engine worker failed"));
    };
  }

  send(command: string): void {
    this.worker.postMessage(command);
  }

  onLine(handler: (line: string) => void): void {
    this.lineHandler = handler;
  }

  onFatal(handler: (error: Error) => void): void {
    this.fatalHandler = handler;
  }

  terminate(): void {
    this.worker.terminate();
  }
}
