export type ScanStatus = "queued" | "scanning" | "needs_review" | "complete" | "failed";
export type ConfidenceLevel = "high" | "medium" | "low";
export type EngineMode = "idle" | "running" | "paused" | "stopped";

export interface ScanSettings {
  regularPages: number;
  ocrPages: number;
}

export interface ScanResult {
  filename: string;
  status: ScanStatus;
  companyName: string | null;
  dba: string | null;
  statementName: string | null;
  address: string | null;
  bank: string | null;
  accountNumber: string | null;
  statementPeriod: string | null;
  openingBalance: number | null;
  endingBalance: number | null;
  deposits: number | null;
  withdrawals: number | null;
  reconciles: boolean | null;
  reconcileReason: string | null;
  revenue: number | null;
  confidenceLevel: ConfidenceLevel | null;
  pagesRead: number | null;
  usedOcr: boolean | null;
  extractionScore: number | null;
  timeTakenMs: number | null;
}

export type ScanFileFn = (file: File, settings: ScanSettings, signal: AbortSignal) => Promise<ScanResult>;

export interface QueueItem {
  id: string;
  filename: string;
  file?: File;
  sourceZip?: string;
  status: ScanStatus;
  result: ScanResult | null;
  fromCache: boolean;
  addedAt: number;
}

export interface Notice {
  id: string;
  kind: "zip" | "skip" | "info";
  message: string;
}

export const DEFAULT_SETTINGS: ScanSettings = {
  regularPages: 25,
  ocrPages: 10,
};

export const STATUS_LABEL: Record<ScanStatus, string> = {
  queued: "Queued",
  scanning: "Scanning",
  needs_review: "Needs review",
  complete: "Complete",
  failed: "Failed",
};
