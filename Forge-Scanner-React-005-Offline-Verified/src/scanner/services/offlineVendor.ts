/**
 * Offline PDF.js + Tesseract access layer.
 *
 * Every asset is loaded from `public/scanner-vendor/`, which `npm install` and
 * `npm run build` populate from the pinned npm packages. There is no CDN URL
 * and no runtime network access anywhere in this module.
 *
 * Every awaited stage runs under the job runner's watchdog, and every stage
 * registers a real abort: PDF loading tasks are destroyed and the OCR worker
 * is terminated, so Stop and timeouts cancel work instead of orphaning it.
 */

import { SCAN_TIMEOUTS } from './scannerConfig.js';
import { createLoaderSlot } from './vendorLoader.js';
import { scanError, withWatchdog } from './jobRunner.js';
import {
  findDuplicate as findDuplicateImpl,
  hashFile as hashFileImpl,
  inspectPdfStructure as inspectPdfStructureImpl,
  validateFile as validateFileImpl
} from './fileValidation.js';
import type { ScanSettings, ScannerDocument } from '../types/scanner';

type CancellationToken = {
  readonly cancelled: boolean;
  onCancel(handler: () => unknown): () => void;
  throwIfCancelled(): void;
};

export interface ScanControls {
  token: CancellationToken;
  waitIfPaused?: () => Promise<void>;
  onProgress?: (message: unknown) => void;
}

interface PdfDocumentProxy {
  numPages: number;
  getPage(pageNumber: number): Promise<any>;
  destroy?: () => Promise<void> | void;
}

interface PdfLoadingTask {
  promise: Promise<PdfDocumentProxy>;
  destroy: () => Promise<void>;
}

export interface PdfExtractResult {
  fullText: string;
  pageTexts: string[];
  pageCount: number;
  scannedPageCount: number;
  doc: PdfDocumentProxy;
}

const localUrl = (relativePath: string) => new URL(relativePath, document.baseURI).href;

/**
 * One vendor loader slot per library.
 *
 * A load that times out leaves its promise pending forever. Keeping that
 * promise would make every later retry await a corpse, so a failed or
 * cancelled load clears the slot and removes its script tag, and the next
 * attempt starts a completely fresh load.
 */
const loaders = {
  pdf: createLoaderSlot(),
  tesseract: createLoaderSlot()
};

let ocrWorker: any = null;
let ocrWorkerPromise: Promise<any> | null = null;

/** Live PDF resources, so a reset can tear down anything still open. */
const activeLoadingTasks = new Set<PdfLoadingTask>();
const activeDocuments = new Set<PdfDocumentProxy>();

function loadLocalScript(src: string, globalName: string) {
  const existing = (globalThis as any)[globalName];
  if (existing) return { promise: Promise.resolve(existing), cleanup: () => {} };

  let script: HTMLScriptElement | null = null;
  const promise = new Promise<any>((resolve, reject) => {
    script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => {
      const value = (globalThis as any)[globalName];
      if (value) resolve(value);
      else reject(scanError(`${globalName} did not initialize from ${src}`, 'vendor_asset_invalid'));
    };
    script.onerror = () => reject(scanError(`Failed to load local scanner asset: ${src}`, 'vendor_asset_missing'));
    document.head.appendChild(script);
  });

  return { promise, cleanup: () => script?.remove() };
}

/** Load a vendor library once, under the watchdog, and never reuse a dead load. */
function ensureVendor(
  key: 'pdf' | 'tesseract',
  label: string,
  start: () => { promise: Promise<any>; cleanup: () => void },
  token?: CancellationToken
) {
  return loaders[key].get(start, (pending: Promise<any>) =>
    withWatchdog(label, SCAN_TIMEOUTS.assetLoadMs, () => pending, { token })
  );
}

/** Drop both loader slots so the next attempt loads fresh instances. */
export function resetVendorLoaders() {
  loaders.pdf.reset();
  loaders.tesseract.reset();
}

export async function ensurePdfJs(token?: CancellationToken) {
  return ensureVendor(
    'pdf',
    'PDF.js load',
    () => {
      const started = loadLocalScript(localUrl('scanner-vendor/pdfjs/pdf.min.js'), 'pdfjsLib');
      return {
        cleanup: started.cleanup,
        promise: started.promise.then((lib) => {
          lib.GlobalWorkerOptions.workerSrc = localUrl('scanner-vendor/pdfjs/pdf.worker.min.js');
          return lib;
        })
      };
    },
    token
  );
}

export async function ensureTesseract(token?: CancellationToken) {
  return ensureVendor(
    'tesseract',
    'Tesseract load',
    () => loadLocalScript(localUrl('scanner-vendor/tesseract/tesseract.min.js'), 'Tesseract'),
    token
  );
}

/**
 * Typed facade over the plain-JavaScript validation module, which is shared
 * verbatim with the Node test suite.
 */
export interface FileValidationResult {
  valid: boolean;
  reason?: string;
  kind?: 'pdf' | 'image';
  warnings?: string[];
  corrupted?: boolean;
}

export function validateFile(file: File, settings: ScanSettings): Promise<FileValidationResult> {
  return validateFileImpl(file, settings) as Promise<FileValidationResult>;
}

export function inspectPdfStructure(file: File): Promise<{ warnings: string[]; corrupted: boolean }> {
  return inspectPdfStructureImpl(file) as Promise<{ warnings: string[]; corrupted: boolean }>;
}

export function hashFile(file: File): Promise<string> {
  return hashFileImpl(file) as Promise<string>;
}

export function findDuplicate(
  documents: ScannerDocument[],
  candidate: { fileId: string; fileHash: string; fileSize: number }
): ScannerDocument | null {
  return findDuplicateImpl(documents, candidate) as ScannerDocument | null;
}

/**
 * Extract the PDF text layer. The loading task is destroyed if the stage is
 * cancelled or times out, which aborts the PDF.js worker for this document.
 */
export async function extractPdfText(
  file: File,
  pageLimit: number,
  controls: ScanControls
): Promise<PdfExtractResult> {
  const pdfjsLib = await ensurePdfJs(controls.token);
  const data = await file.arrayBuffer();

  const loadingTask: PdfLoadingTask = pdfjsLib.getDocument({ data, isEvalSupported: false });
  activeLoadingTasks.add(loadingTask);

  const abortLoad = async () => {
    activeLoadingTasks.delete(loadingTask);
    try {
      await loadingTask.destroy();
    } catch {
      /* already torn down */
    }
  };

  let doc: PdfDocumentProxy;
  try {
    doc = await withWatchdog('PDF open', SCAN_TIMEOUTS.pdfOpenMs, () => loadingTask.promise, {
      token: controls.token,
      abort: abortLoad
    });
  } catch (error) {
    await abortLoad();
    throw asPdfError(error);
  }
  activeDocuments.add(doc);

  const abortDocument = async () => {
    activeDocuments.delete(doc);
    activeLoadingTasks.delete(loadingTask);
    try {
      await loadingTask.destroy();
    } catch {
      /* already torn down */
    }
  };

  try {
    const scanCount = Math.max(1, Math.min(doc.numPages, pageLimit));
    const pageTexts: string[] = [];
    let fullText = '';

    for (let pageNumber = 1; pageNumber <= scanCount; pageNumber += 1) {
      await controls.waitIfPaused?.();
      controls.token.throwIfCancelled();

      const pageText = await withWatchdog(
        `PDF page ${pageNumber}`,
        SCAN_TIMEOUTS.pdfPageMs,
        async () => {
          const page = await doc.getPage(pageNumber);
          const content = await page.getTextContent();
          return rebuildRows(content.items as Array<any>);
        },
        { token: controls.token, abort: abortDocument }
      );

      pageTexts.push(pageText);
      fullText += pageText;
    }

    return { fullText, pageTexts, pageCount: doc.numPages, scannedPageCount: scanCount, doc };
  } catch (error) {
    await abortDocument();
    throw asPdfError(error);
  }
}

/** v10 row reconstruction: group text items by baseline, then order by x. */
function rebuildRows(items: Array<any>) {
  const rows = new Map<number, Array<{ x: number; text: string }>>();
  for (const item of items) {
    const x = Number(item.transform?.[4] ?? 0);
    const rawY = Number(item.transform?.[5] ?? 0);
    const y = Math.round(rawY / 2) * 2;
    const row = rows.get(y) ?? [];
    row.push({ x, text: String(item.str ?? '') });
    rows.set(y, row);
  }
  return (
    [...rows.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([, row]) =>
        row
          .sort((a, b) => a.x - b.x)
          .map((entry) => entry.text)
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim()
      )
      .filter(Boolean)
      .join('\n') + '\n'
  );
}

/** Give PDF.js structural failures a stable, reportable code. */
function asPdfError(error: any) {
  if (error?.code) return error;
  const name = String(error?.name ?? '');
  const message = String(error?.message ?? error);
  if (name === 'PasswordException') return scanError('PDF is password protected.', 'password_protected_pdf');
  if (name === 'InvalidPDFException' || /invalid pdf|corrupt/i.test(message)) {
    return scanError(`Corrupted PDF: ${message}`, 'corrupted_pdf');
  }
  if (name === 'MissingPDFException') return scanError('PDF data is missing or truncated.', 'corrupted_pdf');
  return scanError(message, 'pdf_error');
}

export async function releasePdfDocument(doc: Pick<PdfDocumentProxy, 'destroy'> | null | undefined) {
  if (!doc) return;
  activeDocuments.delete(doc as PdfDocumentProxy);
  try {
    await doc.destroy?.();
  } catch {
    /* PDF cleanup only */
  }
}

/** Destroy every live PDF resource. Used on stop and after any failure. */
export async function resetPdfEngine() {
  const tasks = [...activeLoadingTasks];
  const docs = [...activeDocuments];
  activeLoadingTasks.clear();
  activeDocuments.clear();

  await Promise.all([
    ...tasks.map(async (task) => {
      try {
        await task.destroy();
      } catch {
        /* already torn down */
      }
    }),
    ...docs.map(async (doc) => {
      try {
        await doc.destroy?.();
      } catch {
        /* already torn down */
      }
    })
  ]);
}

async function getOcrWorker(controls: ScanControls) {
  if (ocrWorker) return ocrWorker;
  if (!ocrWorkerPromise) {
    ocrWorkerPromise = (async () => {
      const Tesseract = await ensureTesseract(controls.token);
      return Tesseract.createWorker('eng', 1, {
        workerPath: localUrl('scanner-vendor/tesseract/worker.min.js'),
        corePath: localUrl('scanner-vendor/tesseract/core'),
        langPath: localUrl('scanner-vendor/tesseract/lang'),
        logger: (message: unknown) => controls.onProgress?.(message)
      });
    })();
    ocrWorkerPromise.catch(() => {
      ocrWorkerPromise = null;
    });
  }

  const pending = ocrWorkerPromise;
  try {
    ocrWorker = await withWatchdog('OCR worker start', SCAN_TIMEOUTS.ocrInitMs, () => pending, {
      token: controls.token,
      abort: resetOcrWorker
    });
  } catch (error) {
    // A worker that never finished starting must not be awaited again.
    if (ocrWorkerPromise === pending) await resetOcrWorker();
    throw error;
  }
  return ocrWorker;
}

async function recognize(source: unknown, label: string, controls: ScanControls) {
  const worker = await getOcrWorker(controls);
  const result = await withWatchdog(label, SCAN_TIMEOUTS.ocrPageMs, () => worker.recognize(source), {
    token: controls.token,
    // Terminating the worker is the only true cancellation Tesseract offers,
    // and it doubles as the clean worker reset the next file needs.
    abort: resetOcrWorker
  });
  return String(result?.data?.text ?? '');
}

async function renderPageToCanvas(doc: PdfDocumentProxy, pageNumber: number, controls: ScanControls, scale = 2) {
  return withWatchdog(
    `PDF render page ${pageNumber}`,
    SCAN_TIMEOUTS.pdfRenderMs,
    async () => {
      const page = await doc.getPage(pageNumber);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext('2d');
      if (!context) throw scanError('Canvas 2D context is unavailable.', 'canvas_unavailable');
      await page.render({ canvasContext: context, viewport }).promise;
      return canvas;
    },
    { token: controls.token, abort: () => releasePdfDocument(doc) }
  );
}

export async function ocrPdfPages(doc: PdfDocumentProxy, pageLimit: number, controls: ScanControls) {
  const count = Math.max(1, Math.min(doc.numPages, pageLimit));
  let text = '';

  for (let pageNumber = 1; pageNumber <= count; pageNumber += 1) {
    await controls.waitIfPaused?.();
    controls.token.throwIfCancelled();
    const canvas = await renderPageToCanvas(doc, pageNumber, controls);
    text += `${await recognize(canvas, `OCR page ${pageNumber}`, controls)}\n`;
  }

  return { text, scannedPageCount: count };
}

export async function ocrImageFile(file: File, controls: ScanControls) {
  await controls.waitIfPaused?.();
  controls.token.throwIfCancelled();
  return recognize(file, `OCR ${file.name}`, controls);
}

/** Terminate the OCR worker so the next job starts from a clean one. */
export async function resetOcrWorker() {
  const worker = ocrWorker;
  const pending = ocrWorkerPromise;
  ocrWorker = null;
  ocrWorkerPromise = null;

  if (worker) {
    try {
      await worker.terminate();
    } catch {
      /* worker already gone */
    }
    return;
  }

  if (pending) {
    try {
      const late = await pending;
      await late?.terminate?.();
    } catch {
      /* never started */
    }
  }
}

/**
 * Full PDF + OCR teardown. Called on stop and after every failed attempt.
 * Dropping the library loaders is free when the library already loaded — the
 * global is reused — and is what rescues the queue when a load itself hung.
 */
export async function resetScannerWorkers() {
  resetVendorLoaders();
  await Promise.all([resetPdfEngine(), resetOcrWorker()]);
}
