/**
 * Engine abstraction — the encapsulation point of the whole app.
 *
 * Everything outside `src/engine/` depends only on this interface.
 * Swapping the lite single-threaded WASM engine for the multi-threaded
 * flavor (or a native backend) means providing another implementation
 * of `EngineAdapter` — no other module changes.
 */

export interface EngineResult {
  /** Best move in UCI notation (e.g. "e2e4"); "(none)" if no legal move. */
  bestMove: string;
  /** Evaluation in centipawns from the side to move's perspective (UCI
   *  convention — normalize with `toWhiteRelative`), null if mate. */
  scoreCp: number | null;
  /** Distance to mate in plies (from the side to move), null if not mating. */
  mate: number | null;
  /** Principal variation as a list of UCI moves. */
  pv: string[];
  /** Depth reached for this result. */
  depth: number;
  /** Which candidate line this is (1 = main line). */
  multipv: number;
  /**
   * false = intermediate streaming result (score of the line so far),
   * true  = definitive result after the engine's `bestmove`.
   */
  final: boolean;
}

export interface AnalyzeOptions {
  /** Search depth (required unless movetimeMs is given). */
  depth?: number;
  /** Fixed thinking time per position in ms (alternative to depth). */
  movetimeMs?: number;
  /** Number of candidate lines to report (1 = only best, 2 = best + alternative). */
  multipv: number;
}

export interface EngineAdapter {
  /**
   * Analyze a position. Yields the latest result each time the engine
   * improves its search (streaming), ending with the final result.
   */
  analyze(fen: string, opts: AnalyzeOptions): AsyncIterable<EngineResult>;
  /** Abort any search in progress. Safe to call when idle. */
  stop(): void;
  /** Release the engine's worker/process. The adapter is unusable afterwards. */
  dispose(): void;
  /**
   * Complete the engine's startup (WASM compile, NNUE load, handshake)
   * without searching — used to warm up a pool while the page idles so
   * pressing Analyze pays no init cost. Optional: fakes may omit it.
   */
  warmup?(): Promise<void>;
}
