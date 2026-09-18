import { getScannerEngine } from "../scan-engine";
import { createCancellation } from "../scan-engine/jobRunner.js";
import {
  extractPdfText,
  ocrPdfPages,
  releasePdfDocument,
  validateFile,
  type ScanControls,
} from "../scan-engine/offlineVendor";
import { USABLE_TEXT_MIN_CHARS } from "../scan-engine/scannerConfig.js";
import type { ScanFileFn, ScanResult } from "./types";

const MAX_FILE_BYTES = 40 * 1024 * 1024;

/**
 * Real extraction, ported verbatim from Forge-Scanner-React-016-Full-Document
 * (src/lib/scan-engine/ -- see that directory's own files for what each
 * stage does and why). This file is only the adapter: it drives PDF.js text
 * extraction, falls back to Tesseract OCR when the text layer is missing or
 * unusable, runs the ported production engine (pipeline.processDocument) for
 * every field below, and reshapes that engine's rich per-document result
 * into this app's flatter ScanResult. No field here is invented -- every one
 * maps directly to a real engine output; see the comments below for exactly
 * which one.
 */
export const realScanFile: ScanFileFn = async (file, settings, signal) => {
  const started = performance.now();
  const token = createCancellation();
  const onAbort = () => {
    void token.cancel();
  };
  if (signal.aborted) onAbort();
  else signal.addEventListener("abort", onAbort, { once: true });

  const controls: ScanControls = { token };
  let openDoc: unknown = null;

  try {
    const validation = await validateFile(file, { maxFileBytes: MAX_FILE_BYTES });
    if (!validation.valid) {
      return failedResult(file.name, describeValidationFailure(validation.reason), elapsed(started));
    }
    if (validation.kind !== "pdf") {
      return failedResult(
        file.name,
        "Only PDF statements are read in this build.",
        elapsed(started),
      );
    }

    const native = await extractPdfText(file, settings.regularPages, controls, {
      readTextLayer: true,
    });
    openDoc = native.doc;

    let rawText = native.fullText;
    let usedOcr = false;
    let scannedPageCount = native.scannedPageCount;

    const engine = getScannerEngine();
    // Same heuristic 016 uses: a text layer that is too short, or carries no
    // printed dollar amount, is a scan of paper rather than a real text
    // layer -- OCR is the only way to actually read it.
    const needsOcr =
      rawText.replace(/\s+/g, "").length < USABLE_TEXT_MIN_CHARS ||
      !engine.balanceEquation.hasPrintedAmounts(rawText);

    if (needsOcr && settings.ocrPages > 0) {
      const ocr = await ocrPdfPages(native.doc, settings.ocrPages, controls);
      rawText = ocr.text;
      scannedPageCount = ocr.scannedPageCount;
      usedOcr = true;
    }

    const result = engine.pipeline.processDocument({
      fileId: file.name,
      filename: file.name,
      rawText,
      usedOcr,
      needsOcr: needsOcr && !usedOcr,
      pageCount: native.pageCount,
      scannedPageCount,
    }) as EngineDocument;

    return toScanResult(file.name, result, scannedPageCount, usedOcr, elapsed(started));
  } finally {
    signal.removeEventListener("abort", onAbort);
    if (openDoc) await releasePdfDocument(openDoc as Parameters<typeof releasePdfDocument>[0]);
  }
};

function elapsed(started: number): number {
  return Math.round(performance.now() - started);
}

/** Only the fields this adapter actually reads off the engine's real result. */
interface EngineDocument {
  status?: string;
  companyNameGuess?: string | null;
  dbaNameGuess?: string | null;
  statementIdentity?: { name?: string | null; address?: string | null };
  bankAccount?: { bank?: string | null; accountNumber?: string | null; accountNumberMasked?: string | null };
  statementPeriod?: { start?: string | null; end?: string | null } | null;
  balances?: { opening?: number | null; ending?: number | null; withdrawals?: number | null };
  deposits?: { totalDeposits?: number | null; trueRevenue?: number | null };
  expenses?: { totalDebits?: number | null };
  reconciliation?: { reconciles?: boolean | null; reason?: string | null };
  confidence?: { level?: string; points?: number; maxPoints?: number };
}

function toScanResult(
  filename: string,
  result: EngineDocument,
  pagesRead: number,
  usedOcr: boolean,
  timeTakenMs: number,
): ScanResult {
  const points = result.confidence?.points;
  const maxPoints = result.confidence?.maxPoints;
  // No numeric score exists in the ported engine -- this is a direct,
  // deterministic function of its own real signal count (bank recognized /
  // text trusted / no OCR needed / reconciles), not an invented number.
  const extractionScore =
    typeof points === "number" && typeof maxPoints === "number" && maxPoints > 0
      ? Math.round((points / maxPoints) * 100) / 100
      : null;

  const status: ScanResult["status"] =
    result.status === "complete" || result.status === "needs_review" || result.status === "failed"
      ? result.status
      : "needs_review";

  return {
    filename,
    status,
    companyName: result.companyNameGuess ?? null,
    dba: result.dbaNameGuess ?? null,
    statementName: result.statementIdentity?.name ?? null,
    address: result.statementIdentity?.address ?? null,
    bank: result.bankAccount?.bank ?? null,
    accountNumber: result.bankAccount?.accountNumberMasked ?? result.bankAccount?.accountNumber ?? null,
    statementPeriod: formatPeriod(result.statementPeriod),
    openingBalance: result.balances?.opening ?? null,
    endingBalance: result.balances?.ending ?? null,
    deposits: result.deposits?.totalDeposits ?? null,
    withdrawals: result.balances?.withdrawals ?? result.expenses?.totalDebits ?? null,
    reconciles: result.reconciliation?.reconciles ?? null,
    reconcileReason: result.reconciliation?.reason ?? null,
    revenue: result.deposits?.trueRevenue ?? null,
    confidenceLevel:
      result.confidence?.level === "high" || result.confidence?.level === "medium" || result.confidence?.level === "low"
        ? result.confidence.level
        : null,
    pagesRead,
    usedOcr,
    extractionScore,
    timeTakenMs,
  };
}

function formatDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  return `${m[2]}/${m[3]}/${m[1]}`;
}

function formatPeriod(period: { start?: string | null; end?: string | null } | null | undefined): string | null {
  if (!period) return null;
  const start = formatDate(period.start);
  const end = formatDate(period.end);
  if (start && end) return `${start} - ${end}`;
  return end ?? start ?? null;
}

function failedResult(filename: string, reason: string, timeTakenMs: number): ScanResult {
  return {
    filename,
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
    reconcileReason: reason,
    revenue: null,
    confidenceLevel: null,
    pagesRead: 0,
    usedOcr: false,
    extractionScore: null,
    timeTakenMs,
  };
}

function describeValidationFailure(reason: string | undefined): string {
  switch (reason) {
    case "empty_file":
      return "Empty file";
    case "file_too_large":
      return "File is larger than 40 MB";
    case "unsupported_file_type":
      return "Not a PDF or image file";
    case "not_a_real_pdf_signature":
      return "Not a real PDF (bad file signature)";
    default:
      return reason ?? "File failed validation";
  }
}
