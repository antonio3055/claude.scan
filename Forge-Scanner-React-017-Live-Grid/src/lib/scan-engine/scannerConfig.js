// @ts-nocheck -- ported verbatim from Forge-Scanner-React-016-Full-Document, verified there by its own Node test suite (checkJs:false there too).
/**
 * Single authoritative timeout / retry policy for the scanner.
 * Plain JavaScript so the browser bundle, the Node test suite and the
 * queue runner all read the exact same values.
 */

export const SCAN_TIMEOUTS = {
  /** Loading a local vendor script (pdf.js / tesseract.js) from the app bundle. */
  assetLoadMs: 30_000,
  /** Opening a PDF document (parse + first structure read). */
  pdfOpenMs: 45_000,
  /** Reading the text layer of a single PDF page. */
  pdfPageMs: 25_000,
  /** Rendering one PDF page to canvas before OCR. */
  pdfRenderMs: 45_000,
  /** Creating the Tesseract worker (loads WASM core + language data). */
  ocrInitMs: 120_000,
  /** OCR of a single page or image. */
  ocrPageMs: 120_000,
  /** Hard ceiling for one whole file, whatever stage it is in. */
  jobMs: 420_000
};

/**
 * A PDF whose text layer yields fewer meaningful characters than this is a
 * scan of paper rather than a document. OCR is the only way to read it, so the
 * regular scan reports that the file needs OCR. It never starts OCR by itself:
 * OCR is off unless the scan mode says otherwise or the file is sent for OCR
 * by hand.
 */
export const USABLE_TEXT_MIN_CHARS = 50;

/** One automatic retry: first attempt + one retry = 2. */
export const MAX_JOB_ATTEMPTS = 2;

/**
 * How many files the queue reads at once.
 *
 * OCR is the whole cost of a scan — 195 s of a 206 s OCR run on the reference
 * batch — and it is pure CPU inside a worker, so lanes turn cores into speed:
 * measured on that batch, one lane took 24.3 s, two 14.8 s, three 10.0 s and
 * four 8.8 s, with byte-identical text at every count.
 *
 * One core is left for the interface and the PDF worker, and the cap is four
 * because each lane holds its own OCR worker with its own copy of the WASM
 * core and language data. A machine that does not report its core count gets
 * two lanes, which is safe anywhere.
 */
export const MAX_SCAN_LANES = 4;

export function scanLaneCount(hardwareConcurrency) {
  const cores = Number(hardwareConcurrency);
  if (!Number.isFinite(cores) || cores < 1) return 2;
  return Math.max(1, Math.min(MAX_SCAN_LANES, Math.floor(cores) - 1));
}

/**
 * Failures that are decided before any PDF/OCR work starts.
 * Retrying these can only produce the same answer, so they fail immediately.
 */
export const TERMINAL_ERROR_CODES = Object.freeze([
  'empty_file',
  'file_too_large',
  'unsupported_file_type',
  'not_a_real_pdf_signature',
  'source_file_missing',
  'ocr_required_for_image'
]);

export function isTerminalErrorCode(code) {
  return TERMINAL_ERROR_CODES.includes(code);
}
