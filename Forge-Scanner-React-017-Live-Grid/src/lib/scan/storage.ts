import type { ScanResult } from "./types";

/**
 * Cached results only -- the small extracted JSON per file. The original
 * uploaded bytes are never written here; scan-store.ts drops its `File`
 * reference the moment a scan finishes, so nothing large ever reaches disk.
 */

const DB_NAME = "northline-scan-cache";
const DB_VERSION = 1;
const STORE = "results";

export interface CachedRecord {
  id: string;
  filename: string;
  result: ScanResult;
  cachedAt: number;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: "id" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    });
  }
  return dbPromise;
}

export async function loadCachedResults(): Promise<CachedRecord[]> {
  const db = await openDb();
  if (!db) return [];
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve((req.result as unknown[]).filter(isCachedRecord));
    req.onerror = () => resolve([]);
  });
}

export async function upsertCachedResult(record: CachedRecord): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

export async function clearCachedResults(): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

/**
 * Real disk-backed usage from the browser's own Storage API where available
 * -- this is the whole origin's usage, which is accurate here since this
 * IndexedDB store is the only thing this app ever writes. Falls back to a
 * computed size of the cached JSON if the API isn't available (older
 * Safari/Firefox), which is a real number, just not disk-verified.
 */
export async function cachedPayloadBytes(): Promise<number> {
  if (typeof navigator !== "undefined" && navigator.storage?.estimate) {
    try {
      const estimate = await navigator.storage.estimate();
      if (typeof estimate.usage === "number") return estimate.usage;
    } catch {
      // fall through to the computed estimate below
    }
  }
  const records = await loadCachedResults();
  return new Blob([JSON.stringify(records)]).size;
}

function isCachedRecord(value: unknown): value is CachedRecord {
  if (!value || typeof value !== "object") return false;
  const rec = value as CachedRecord;
  return (
    typeof rec.id === "string" &&
    typeof rec.filename === "string" &&
    typeof rec.cachedAt === "number" &&
    !!rec.result &&
    typeof rec.result === "object"
  );
}
