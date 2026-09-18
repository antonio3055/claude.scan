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

/** One automatic retry: first attempt + one retry = 2. */
export const MAX_JOB_ATTEMPTS = 2;

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
