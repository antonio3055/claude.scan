import { create } from "zustand";
import { RESULT_COLUMNS, type ColumnId } from "@/lib/scan/columns";
import { runScanFile, isAbortError } from "@/lib/scan/run";
import {
  cachedPayloadBytes,
  clearCachedResults,
  loadCachedResults,
  upsertCachedResult,
} from "@/lib/scan/storage";
import {
  DEFAULT_SETTINGS,
  type EngineMode,
  type Notice,
  type QueueItem,
  type ScanSettings,
} from "@/lib/scan/types";
import { extractPdfsFromZip, isPdfFile, isZipFile } from "@/lib/scan/zip";

let abortController: AbortController | null = null;
let loopGeneration = 0;
let loopActive = false;

/** Wall-clock timer kept outside Zustand so completion snapshots can't zero it. */
let timerAnchor = 0;
let timerCarry = 0;

interface ScanState {
  items: QueueItem[];
  settings: ScanSettings;
  engineMode: EngineMode;
  inFlightId: string | null;
  notices: Notice[];
  timerRunning: boolean;
  timerStartedAt: number | null;
  timerAccumulatedMs: number;
  visibleColumns: ColumnId[];
  cacheEpoch: number;
  cacheBytes: number;
  hydrated: boolean;
}

interface ScanActions {
  hydrate: () => Promise<void>;
  setSettings: (patch: Partial<ScanSettings>) => void;
  addFiles: (files: File[]) => Promise<void>;
  dismissNotice: (id: string) => void;
  setColumnVisible: (id: ColumnId, visible: boolean) => void;
  resetColumns: () => void;
  start: () => void;
  pause: () => void;
  continueScan: () => void;
  stop: () => void;
  clearQueue: () => void;
  clearCache: () => Promise<void>;
}

export type ScanStore = ScanState & ScanActions;

const initialState: ScanState = {
  items: [],
  settings: { ...DEFAULT_SETTINGS },
  engineMode: "idle",
  inFlightId: null,
  notices: [],
  timerRunning: false,
  timerStartedAt: null,
  timerAccumulatedMs: 0,
  visibleColumns: RESULT_COLUMNS.map((c) => c.id),
  cacheEpoch: 0,
  cacheBytes: 0,
  hydrated: false,
};

function readElapsed(running: boolean): number {
  if (running && timerAnchor) return timerCarry + (Date.now() - timerAnchor);
  return timerCarry;
}

function freezeTimer(): number {
  if (timerAnchor) {
    timerCarry += Date.now() - timerAnchor;
    timerAnchor = 0;
  }
  return timerCarry;
}

function resetTimer(): void {
  timerCarry = 0;
  timerAnchor = 0;
}

function resumeTimer(): number {
  timerAnchor = Date.now();
  return timerCarry;
}

export const useScanStore = create<ScanStore>((set, get) => ({
  ...initialState,

  hydrate: async () => {
    if (get().hydrated) return;
    const cached = await loadCachedResults();
    const items: QueueItem[] = cached.map((rec) => ({
      id: rec.id,
      filename: rec.filename,
      status: rec.result.status,
      result: rec.result,
      fromCache: true,
      addedAt: rec.cachedAt,
    }));
    const bytes = await cachedPayloadBytes();
    set({
      items,
      hydrated: true,
      cacheBytes: bytes,
      cacheEpoch: 1,
    });
  },

  setSettings: (patch) => {
    set((s) => ({
      settings: {
        regularPages: clampPages(patch.regularPages ?? s.settings.regularPages),
        ocrPages: clampPages(patch.ocrPages ?? s.settings.ocrPages),
      },
    }));
  },

  addFiles: async (files) => {
    const incoming: QueueItem[] = [];
    const notices: Notice[] = [];

    for (const file of files) {
      if (isZipFile(file)) {
        try {
          const { pdfs, skipped } = await extractPdfsFromZip(file);
          notices.push(
            makeNotice(
              "zip",
              `${pdfs.length} file${pdfs.length === 1 ? "" : "s"} found in ${file.name}`,
            ),
          );
          if (skipped.length > 0) {
            const preview = skipped.slice(0, 3).join(", ");
            const extra = skipped.length > 3 ? ` +${skipped.length - 3} more` : "";
            notices.push(makeNotice("skip", `Skipped non-PDF in ${file.name}: ${preview}${extra}`));
          }
          for (const pdf of pdfs) {
            incoming.push(makeItem(pdf, file.name));
          }
        } catch {
          notices.push(makeNotice("skip", `Could not read ${file.name}`));
        }
      } else if (isPdfFile(file)) {
        incoming.push(makeItem(file));
      } else {
        notices.push(makeNotice("skip", `Skipped ${file.name} (not a PDF)`));
      }
    }

    if (incoming.length === 0 && notices.length === 0) return;

    set((s) => ({
      items: [...s.items, ...incoming],
      notices: [...notices, ...s.notices].slice(0, 8),
    }));
  },

  dismissNotice: (id) => {
    set((s) => ({ notices: s.notices.filter((n) => n.id !== id) }));
  },

  setColumnVisible: (id, visible) => {
    const col = RESULT_COLUMNS.find((c) => c.id === id);
    if (col?.locked) return;
    set((s) => {
      const has = s.visibleColumns.includes(id);
      if (visible && !has) return { visibleColumns: [...s.visibleColumns, id] };
      if (!visible && has) return { visibleColumns: s.visibleColumns.filter((c) => c !== id) };
      return s;
    });
  },

  resetColumns: () => {
    set({ visibleColumns: RESULT_COLUMNS.map((c) => c.id) });
  },

  start: () => {
    const { items, engineMode } = get();
    if (engineMode === "running") return;
    if (!items.some((i) => i.status === "queued" && i.file)) return;
    resetTimer();
    const started = Date.now();
    timerAnchor = started;
    set({
      engineMode: "running",
      timerRunning: true,
      timerStartedAt: started,
      timerAccumulatedMs: 0,
    });
    void runLoop();
  },

  pause: () => {
    if (get().engineMode !== "running") return;
    const elapsed = freezeTimer();
    set({
      engineMode: "paused",
      timerRunning: false,
      timerStartedAt: null,
      timerAccumulatedMs: elapsed,
    });
  },

  continueScan: () => {
    if (get().engineMode !== "paused") return;
    const carried = resumeTimer();
    set({
      engineMode: "running",
      timerRunning: true,
      timerStartedAt: timerAnchor,
      timerAccumulatedMs: carried,
    });
    void runLoop();
  },

  stop: () => {
    const { engineMode } = get();
    if (engineMode !== "running" && engineMode !== "paused") return;
    abortController?.abort();
    abortController = null;
    loopGeneration += 1;
    const elapsed = get().timerRunning ? freezeTimer() : timerCarry;
    set((s) => ({
      engineMode: "stopped",
      inFlightId: null,
      timerRunning: false,
      timerStartedAt: null,
      timerAccumulatedMs: elapsed,
      items: s.items.map((item) =>
        item.status === "scanning" ? { ...item, status: "queued" } : item,
      ),
    }));
  },

  clearQueue: () => {
    abortController?.abort();
    abortController = null;
    loopGeneration += 1;
    resetTimer();
    set({
      items: [],
      engineMode: "idle",
      inFlightId: null,
      timerRunning: false,
      timerStartedAt: null,
      timerAccumulatedMs: 0,
    });
  },

  clearCache: async () => {
    await clearCachedResults();
    set((s) => ({
      cacheBytes: 0,
      cacheEpoch: s.cacheEpoch + 1,
    }));
  },
}));

function clampPages(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.min(99999, Math.floor(value));
}

function makeItem(file: File, sourceZip?: string): QueueItem {
  return {
    id: crypto.randomUUID(),
    filename: file.name,
    file,
    sourceZip,
    status: "queued",
    result: null,
    fromCache: false,
    addedAt: Date.now(),
  };
}

function makeNotice(kind: Notice["kind"], message: string): Notice {
  return { id: crypto.randomUUID(), kind, message };
}

function finishBatchIfIdle(): void {
  const snapshot = useScanStore.getState();
  const elapsed = snapshot.timerRunning ? freezeTimer() : timerCarry;
  useScanStore.setState({
    engineMode: snapshot.engineMode === "stopped" ? "stopped" : "idle",
    inFlightId: null,
    timerRunning: false,
    timerStartedAt: null,
    timerAccumulatedMs: elapsed,
  });
}

async function runLoop() {
  if (loopActive) return;
  loopActive = true;
  const gen = loopGeneration;
  try {
    while (true) {
      if (gen !== loopGeneration) return;
      const snapshot = useScanStore.getState();
      const next = snapshot.items.find((item) => item.status === "queued" && item.file);
      if (!next || !next.file) {
        finishBatchIfIdle();
        return;
      }
      if (snapshot.engineMode !== "running") return;

      const settings = { ...snapshot.settings };
      const file = next.file;
      const controller = new AbortController();
      abortController = controller;

      useScanStore.setState((s) => ({
        inFlightId: next.id,
        timerAccumulatedMs: readElapsed(s.timerRunning),
        items: s.items.map((item) =>
          item.id === next.id ? { ...item, status: "scanning" as const } : item,
        ),
      }));

      try {
        const result = await runScanFile(file, settings, controller.signal);
        if (gen !== loopGeneration) return;
        useScanStore.setState((s) => ({
          inFlightId: null,
          timerAccumulatedMs: readElapsed(s.timerRunning),
          items: s.items.map((item) =>
            item.id === next.id
              ? {
                  ...item,
                  file: undefined,
                  status: result.status,
                  result,
                  fromCache: false,
                }
              : item,
          ),
        }));
        await upsertCachedResult({
          id: next.id,
          filename: next.filename,
          result,
          cachedAt: Date.now(),
        });
        const bytes = await cachedPayloadBytes();
        useScanStore.setState((s) => ({
          cacheBytes: bytes,
          cacheEpoch: s.cacheEpoch + 1,
        }));
      } catch (err) {
        if (isAbortError(err) || gen !== loopGeneration) return;
        console.error(`Scan failed for ${next.filename}:`, err);
        useScanStore.setState((s) => ({
          inFlightId: null,
          items: s.items.map((item) =>
            item.id === next.id
              ? {
                  ...item,
                  file: undefined,
                  status: "failed" as const,
                  result: {
                    filename: item.filename,
                    status: "failed",
                    companyName: null,
                    dba: null,
                    statementName: null,
                    address: null,
                    bank: null,
                    accountNumber: null,
                    statementPeriod: null,
                    openingBalance: null,
                    endingBalance: null,
                    deposits: null,
                    withdrawals: null,
                    reconciles: null,
                    reconcileReason: err instanceof Error ? err.message : "Scan failed",
                    revenue: null,
                    confidenceLevel: null,
                    pagesRead: null,
                    usedOcr: null,
                    extractionScore: null,
                    timeTakenMs: null,
                  },
                }
              : item,
          ),
        }));
      }
    }
  } finally {
    loopActive = false;
  }
}

export function completedCount(items: QueueItem[]): number {
  return items.filter((i) => i.status !== "queued" && i.status !== "scanning").length;
}

export function queuedCount(items: QueueItem[]): number {
  return items.filter((i) => i.status === "queued" && i.file).length;
}
