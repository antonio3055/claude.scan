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
import { rebuildRows } from './pdfRows.js';
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
  /** Which queue lane this file is running in; picks its OCR worker. */
  lane?: number;
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

let fontsRequested = false;
/**
 * Registers the self-hosted Inter Variable font (see copy-scanner-vendor.mjs
 * and app.css) the same way every other vendor asset is loaded here: a
 * document.baseURI-relative URL, so it resolves correctly under the dev
 * server and under a production build deployed at any subpath. Without this,
 * the `Inter` in app.css's font stack never matches an installed font and
 * the UI silently renders in the OS default instead.
 */
export function ensureLocalFonts() {
  if (fontsRequested || typeof document === 'undefined' || !('fonts' in document)) return;
  fontsRequested = true;
  const faces = [
    { file: 'inter-latin-wght-normal.woff2', range: 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD' },
    { file: 'inter-latin-ext-wght-normal.woff2', range: 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF' }
  ];
  for (const { file, range } of faces) {
    const face = new (window as any).FontFace(
      'Inter',
      `url(${localUrl(`scanner-vendor/fonts/${file}`)}) format('woff2-variations')`,
      { style: 'normal', weight: '100 900', unicodeRange: range }
    );
    face
      .load()
      .then((loaded: unknown) => (document as any).fonts.add(loaded))
      .catch(() => undefined);
  }
}

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

/**
 * One OCR worker per queue lane.
 *
 * Starting a Tesseract worker loads the WASM core and the language data, so it
 * is kept alive between files. Keying it by lane is what makes reading several
 * files at once safe: a file that fails or times out terminates the worker in
 * its own lane and leaves the other lanes running.
 */
type OcrSlot = { worker: any; promise: Promise<any> | null };
const ocrLanes = new Map<number, OcrSlot>();

function ocrSlot(lane: number): OcrSlot {
  let slot = ocrLanes.get(lane);
  if (!slot) {
    slot = { worker: null, promise: null };
    ocrLanes.set(lane, slot);
  }
  return slot;
}

/**
 * One PDF.js worker for the whole queue.
 *
 * Left to itself PDF.js spawns a worker per document, and starting one costs
 * more than reading a statement does: across the 61-document batch that was
 * 15.0 s of worker startup against 2.3 s of actual work. The worker is owned
 * here rather than by each loading task, so destroying a document leaves it
 * running for the next file. Stop destroys it through `resetPdfEngine`; a
 * failed file only marks it, because other lanes may still be reading.
 */
let pdfWorker: any = null;
let pdfWorkerSuspect = false;

function getPdfWorker(pdfjsLib: any) {
  // A file that failed may have left the worker wedged, but other lanes may
  // still be reading through it, so it is replaced at the next moment nothing
  // is using it rather than pulled out from under them.
  if (pdfWorkerSuspect && !activeLoadingTasks.size && !activeDocuments.size) {
    pdfWorkerSuspect = false;
    try {
      pdfWorker?.destroy();
    } catch {
      /* already torn down */
    }
    pdfWorker = null;
  }
  if (pdfWorker && !pdfWorker.destroyed) return pdfWorker;
  pdfWorkerSuspect = false;
  pdfWorker = new pdfjsLib.PDFWorker({ name: 'forge-scanner-pdf' });
  return pdfWorker;
}

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
  controls: ScanControls,
  options: { readTextLayer?: boolean } = {}
): Promise<PdfExtractResult> {
  const pdfjsLib = await ensurePdfJs(controls.token);
  const data = await file.arrayBuffer();

  const loadingTask: PdfLoadingTask = pdfjsLib.getDocument({
    data,
    isEvalSupported: false,
    worker: getPdfWorker(pdfjsLib)
  });
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

    // An OCR scan reads the pages as images, so reading the text layer first
    // only to discard it is work for nothing. The document itself is still
    // opened and returned, because OCR renders its pages.
    const pagesToRead = options.readTextLayer === false ? 0 : scanCount;

    for (let pageNumber = 1; pageNumber <= pagesToRead; pageNumber += 1) {
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
  const worker = pdfWorker;
  activeLoadingTasks.clear();
  activeDocuments.clear();
  pdfWorker = null;

  // The shared worker goes with them: a file that failed may have left it in a
  // bad state, and Stop must leave nothing running.
  try {
    worker?.destroy();
  } catch {
    /* already torn down */
  }

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
  const lane = controls.lane ?? 0;
  const slot = ocrSlot(lane);
  if (slot.worker) return slot.worker;

  if (!slot.promise) {
    slot.promise = (async () => {
      const Tesseract = await ensureTesseract(controls.token);
      return Tesseract.createWorker('eng', 1, {
        workerPath: localUrl('scanner-vendor/tesseract/worker.min.js'),
        corePath: localUrl('scanner-vendor/tesseract/core'),
        langPath: localUrl('scanner-vendor/tesseract/lang'),
        logger: (message: unknown) => controls.onProgress?.(message)
      });
    })();
    slot.promise.catch(() => {
      slot.promise = null;
    });
  }

  const pending = slot.promise;
  try {
    slot.worker = await withWatchdog('OCR worker start', SCAN_TIMEOUTS.ocrInitMs, () => pending, {
      token: controls.token,
      abort: () => resetOcrWorker(lane)
    });
  } catch (error) {
    // A worker that never finished starting must not be awaited again.
    if (slot.promise === pending) await resetOcrWorker(lane);
    throw error;
  }
  return slot.worker;
}

async function recognize(source: unknown, label: string, controls: ScanControls) {
  const worker = await getOcrWorker(controls);
  const result = await withWatchdog(label, SCAN_TIMEOUTS.ocrPageMs, () => worker.recognize(source), {
    token: controls.token,
    // Terminating the worker is the only true cancellation Tesseract offers,
    // and it doubles as the clean worker reset the next file needs. Only this
    // lane's worker goes: the other lanes are reading their own files.
    abort: () => resetOcrWorker(controls.lane ?? 0)
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

/**
 * Terminate an OCR worker so the next job starts from a clean one.
 * With a lane, only that lane's worker goes; with none, every lane's does.
 */
export async function resetOcrWorker(lane?: number) {
  const lanes = lane === undefined ? [...ocrLanes.keys()] : [lane];
  await Promise.all(lanes.map((index) => terminateOcrLane(index)));
}

async function terminateOcrLane(lane: number) {
  const slot = ocrLanes.get(lane);
  if (!slot) return;
  const worker = slot.worker;
  const pending = slot.promise;
  ocrLanes.delete(lane);

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
  pdfWorkerSuspect = false;
  await Promise.all([resetPdfEngine(), resetOcrWorker()]);
}

/**
 * Recovery after one file failed, when other files may still be reading.
 *
 * The library loaders are dropped either way — a load that hung has stalled
 * every lane, so clearing it is what lets any of them retry. The OCR worker
 * torn down is only this lane's. The shared PDF worker is marked instead of
 * destroyed, and replaced at the next moment no file is using it.
 */
export async function recoverFromJobFailure(lane: number) {
  resetVendorLoaders();
  pdfWorkerSuspect = true;
  await resetOcrWorker(lane);
}
