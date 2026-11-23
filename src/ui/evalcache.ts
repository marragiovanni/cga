/**
 * Persistent eval cache — IndexedDB-backed storage of engine results.
 *
 * The in-memory cache dies with the page; this store survives reloads,
 * so re-pasting the same game (or the same opening shared across
 * games) is instant: every position's search happened once, ever.
 *
 * Keys must disambiguate the engine settings that produced the evals —
 * swapping the engine flavor, depth or MultiPV changes what a score
 * means, and stale results must not mix in. The position part is the
 * same 4-field FEN key the in-memory cache uses.
 *
 * The open is lazy and queued: `openEvalStore()` returns immediately
 * with a wrapper whose first get/put triggers the (async) DB open.
 * Anything the browser refuses (private mode, quota) degrades to a
 * no-op — persistence is an optimization, never a requirement.
 */

import type { PositionAnalysis } from "../analyzer/analyzer.ts";
import labels from "../config/labels.json" with { type: "json" };

export interface EvalStore {
  get(key: string): Promise<PositionAnalysis | null>;
  put(key: string, analysis: PositionAnalysis): Promise<void>;
}

/** Cache-partition prefix: engine flavor + the settings that shape the evals. */
export function evalKeyPrefix(): string {
  return `${labels.engine.flavor}|d${labels.engine.depth}|m${labels.engine.multipv}|`;
}

const DB_NAME = "cma-evals";
const STORE_NAME = "evals";

/**
 * Persistent store for this browser, or null where IndexedDB is
 * unavailable (node tests, SSR). Call once; the wrapper is stateless
 * beyond its lazy open.
 */export function openEvalStore(): EvalStore | null {
  if (typeof indexedDB === "undefined") return null;

  let dbPromise: Promise<IDBDatabase> | null = null;
  const open = (): Promise<IDBDatabase> => {
    dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) {
          request.result.createObjectStore(STORE_NAME);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("indexedDB open failed"));
    });
    return dbPromise;
  };

  return {
    async get(key) {
      try {
        const db = await open();
        return await new Promise<PositionAnalysis | null>((resolve, reject) => {
          const tx = db.transaction(STORE_NAME, "readonly");
          const request = tx.objectStore(STORE_NAME).get(key);
          request.onsuccess = () => resolve((request.result ?? null) as PositionAnalysis | null);
          request.onerror = () => reject(request.error ?? new Error("indexedDB get failed"));
        });
      } catch {
        return null; // degraded: treat as a cache miss
      }
    },

    async put(key, analysis) {
      try {
        const db = await open();
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(STORE_NAME, "readwrite");
          tx.objectStore(STORE_NAME).put(analysis, key);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error ?? new Error("indexedDB put failed"));
        });
      } catch {
        // degraded: drop the write silently
      }
    },
  };
}
