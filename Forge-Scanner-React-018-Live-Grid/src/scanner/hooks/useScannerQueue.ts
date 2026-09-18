import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getScannerEngine } from '../engine';
import { scannerStore } from '../services/scannerStore';
import {
  extractPdfText,
  findDuplicate,
  hashFile,
  ocrImageFile,
  ocrPdfPages,
  releasePdfDocument,
  recoverFromJobFailure,
  resetScannerWorkers,
  validateFile,
  type ScanControls
} from '../services/offlineVendor';
import type { ScannerDocument, ScanSettings } from '../types/scanner';
import { createCancellation, isTimeoutError, runScanQueue, scanError } from '../services/jobRunner.js';
import {
  MAX_JOB_ATTEMPTS,
  USABLE_TEXT_MIN_CHARS,
  scanLaneCount,
  SCAN_TIMEOUTS,
  isTerminalErrorCode
} from '../services/scannerConfig.js';
import {
  nextQueuedDocument,
  ocrCandidateDocuments,
  recoverDocuments,
  requeuePatch,
  restartableDocuments,
  retryableDocuments,
  revenueExclusionSkips
} from '../services/queueRecovery.js';

export const DEFAULT_SCAN_SETTINGS: ScanSettings = {
  mode: 'regular',
  // Math.min(doc.numPages, pageLimit) in extractPdfText/ocrPdfPages caps this
  // to whatever the document actually has. OCR is far more expensive per page
  // than a native text read, so its default cap is much lower.
  regularPages: 15,
  ocrPages: 2,
  maxFiles: 500,
  maxFileBytes: 40 * 1024 * 1024,
  duplicateHandling: 'flag',
  revenueExclusionThreshold: 0
};

const nowIso = () => new Date().toISOString();
const newId = () => `doc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

export function useScannerQueue() {
  const [documents, setDocuments] = useState<ScannerDocument[]>([]);
  const [settings, setSettingsState] = useState<ScanSettings>(DEFAULT_SCAN_SETTINGS);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const docsRef = useRef<ScannerDocument[]>([]);
  const settingsRef = useRef<ScanSettings>(DEFAULT_SCAN_SETTINGS);
  const runningRef = useRef(false);
  const pausedRef = useRef(false);
  const stopRequestedRef = useRef(false);
  const cancellationRef = useRef(createCancellation());
  /** Files a lane has taken but not yet finished, so no two lanes share one. */
  const claimedRef = useRef<Set<string>>(new Set());
  /** How many files this machine reads at once. Derived once, never guessed. */
  const laneCount = useMemo(
    () => scanLaneCount(typeof navigator === 'undefined' ? undefined : navigator.hardwareConcurrency),
    []
  );

  const commitDocs = useCallback(
    (updater: ScannerDocument[] | ((prev: ScannerDocument[]) => ScannerDocument[])) => {
      const previous = docsRef.current;
      const next = typeof updater === 'function' ? updater(previous) : updater;
      docsRef.current = next;
      setDocuments(next);
    },
    []
  );

  useEffect(() => {
    (async () => {
      const [savedDocs, savedSettings] = await Promise.all([
        scannerStore.listDocuments().catch(() => [] as ScannerDocument[]),
        scannerStore.getSettings(DEFAULT_SCAN_SETTINGS).catch(() => DEFAULT_SCAN_SETTINGS)
      ]);

      // Anything caught mid-scan by an app restart comes back as `stopped`
      // with a fresh attempt budget, and is persisted in that state so a
      // second restart cannot see a document stuck as `extracting`.
      const recovered = recoverDocuments(savedDocs) as ScannerDocument[];
      const changed = recovered.filter((doc, index) => doc !== savedDocs[index]);
      await Promise.all(changed.map((doc) => scannerStore.saveDocument(doc).catch(() => undefined)));

      docsRef.current = recovered;
      setDocuments(recovered);
      settingsRef.current = savedSettings;
      setSettingsState(savedSettings);
      setSelectedDocId(recovered[0]?.fileId ?? null);
      setLoaded(true);
    })();
  }, []);

  const updateDoc = useCallback(
    async (fileId: string, patch: Partial<ScannerDocument>) => {
      let updated: ScannerDocument | null = null;
      commitDocs((prev) =>
        prev.map((doc) => {
          if (doc.fileId !== fileId) return doc;
          updated = { ...doc, ...patch };
          return updated;
        })
      );
      if (updated) await scannerStore.saveDocument(updated).catch(() => undefined);
    },
    [commitDocs]
  );

  const waitIfPaused = useCallback(async () => {
    while (pausedRef.current && !stopRequestedRef.current) {
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
  }, []);

  /**
   * Scan one file. Failures are thrown, not swallowed: the job runner owns
   * the retry, the worker reset and the final status.
   */
  const processFile = useCallback(
    async (doc: ScannerDocument, file: File, attempt: number, jobToken: ScanControls['token'], lane: number) => {
      const settingsNow = settingsRef.current;
      const current = docsRef.current.find((item) => item.fileId === doc.fileId) ?? doc;
      const stageLog = [...(current.stageLog ?? [])];
      const stamp = (stage: string) => stageLog.push({ stage, at: nowIso() });
      // The runner hands each attempt its own token: the whole-file watchdog
      // cancels it, and Stop cancels it through its parent.
      const controls: ScanControls = { token: jobToken, waitIfPaused, lane };
      let openDoc: { destroy?: () => Promise<void> | void } | null = null;


      stamp(attempt === 1 ? 'file_received' : 'retry_started');
      await updateDoc(doc.fileId, { processingStatus: 'validating', attempts: attempt, stageLog });

      const validation = await validateFile(file, settingsNow);
      if (!validation.valid) {
        stamp('file_validation_failed');
        await updateDoc(doc.fileId, { stageLog });
        const reason = validation.reason ?? 'processing_error';
        throw scanError(reason.replaceAll('_', ' '), reason);
      }

      stamp('file_validated');
      if (validation.warnings?.length) stamp(`pdf_structure_warning:${validation.warnings.join('+')}`);

      const fileHash = await hashFile(file);
      const duplicate = findDuplicate(docsRef.current, { fileId: doc.fileId, fileHash, fileSize: file.size });
      if (duplicate && settingsNow.duplicateHandling === 'skip') {
        stamp('duplicate_skipped');
        await scannerStore.deleteDocument(doc.fileId).catch(() => undefined);
        commitDocs((prev) => prev.filter((item) => item.fileId !== doc.fileId));
        return;
      }

      await updateDoc(doc.fileId, {
        fileHash,
        duplicateOfFileId: duplicate?.fileId ?? null,
        pdfStructureWarnings: validation.warnings ?? [],
        stageLog
      });
      controls.token.throwIfCancelled();

      let rawText = '';
      let usedOcr = false;
      let needsOcr = false;
      let pageCount = 1;
      let scannedPageCount = 1;

      // OCR never starts on its own. It runs when the scan mode is OCR, or
      // when this one file was sent for OCR by hand after a regular scan
      // reported that it needs it.
      const runOcr = settingsNow.mode === 'ocr' || current.forceOcr === true;

      try {
        if (validation.kind === 'pdf') {
          await updateDoc(doc.fileId, { processingStatus: 'extracting', stageLog });
          stamp('document_identified');
          // An OCR pass replaces the text layer with the OCR result, so it is
          // not read at all; a regular scan needs it, including to notice a
          // scanned page that has no text layer and report that.
          const native = await extractPdfText(file, settingsNow.regularPages, controls, {
            readTextLayer: !runOcr
          });
          openDoc = native.doc;
          pageCount = native.pageCount;
          scannedPageCount = native.scannedPageCount;
          stamp('text_extracted');

          if (runOcr) {
            await updateDoc(doc.fileId, { processingStatus: 'ocr', stageLog });
            stamp('ocr_started');
            const ocr = await ocrPdfPages(native.doc, settingsNow.ocrPages, controls);
            rawText = ocr.text;
            scannedPageCount = ocr.scannedPageCount;
            usedOcr = true;
            stamp('ocr_completed');
          } else {
            rawText = native.fullText;
            // A PDF with no usable text layer is a scan of paper. So is one
            // whose text layer carries no printed amount: some banks emit a
            // layer of nothing but structural markers, which is a page count
            // rather than a statement. Either way OCR is the only way to read
            // it — reported here, and run only when asked for.
            const engine = getScannerEngine();
            needsOcr =
              rawText.replace(/\s+/g, '').length < USABLE_TEXT_MIN_CHARS ||
              !engine.balanceEquation.hasPrintedAmounts(rawText);
            if (needsOcr) stamp('needs_ocr_no_text_layer');
          }
        } else if (runOcr) {
          await updateDoc(doc.fileId, { processingStatus: 'ocr', stageLog });
          stamp('ocr_started');
          rawText = await ocrImageFile(file, controls);
          usedOcr = true;
          stamp('ocr_completed');
        } else {
          // An image has no text layer at all, so it is reported as needing
          // OCR rather than failed: the file is fine, it just has to be read.
          needsOcr = true;
          stamp('needs_ocr_image_file');
        }
      } finally {
        await releasePdfDocument(openDoc);
      }

      await waitIfPaused();
      controls.token.throwIfCancelled();

      stamp('transactions_extracted');
      const result = getScannerEngine().pipeline.processDocument({
        fileId: doc.fileId,
        filename: file.name,
        rawText,
        usedOcr,
        needsOcr,
        pageCount,
        scannedPageCount
      }) as ScannerDocument;
      stamp('results_validated');

      const finalDoc: ScannerDocument = {
        ...doc,
        ...result,
        fileId: doc.fileId,
        filename: file.name,
        fileSize: file.size,
        uploadedAt: doc.uploadedAt,
        fileHash,
        duplicateOfFileId: duplicate?.fileId ?? null,
        pdfStructureWarnings: validation.warnings ?? [],
        processingStatus: (result.status as ScannerDocument['processingStatus']) || 'complete',
        processingError: undefined,
        processingErrorMessage: undefined,
        attempts: attempt,
        stageLog,
        pageCount,
        scannedPageCount,
        usedOcr,
        needsOcr,
        // Cleared once the file has been through OCR, so it is not sent again.
        forceOcr: false,
        completedAt: nowIso()
      };
      commitDocs((prev) => prev.map((item) => (item.fileId === doc.fileId ? finalDoc : item)));
      await scannerStore.saveDocument(finalDoc);

      const { skipped: siblings, message } = revenueExclusionSkips(
        docsRef.current,
        finalDoc,
        settingsNow.revenueExclusionThreshold
      );
      if (siblings.length) {
        const skippedIds = new Set(siblings.map((item: ScannerDocument) => item.fileId));
        commitDocs((prev) =>
          prev.map((item) =>
            skippedIds.has(item.fileId) ? { ...item, processingStatus: 'skipped', processingErrorMessage: message } : item
          )
        );
        await Promise.all(
          siblings.map((item: ScannerDocument) =>
            scannerStore
              .saveDocument({ ...item, processingStatus: 'skipped', processingErrorMessage: message })
              .catch(() => undefined)
          )
        );
      }
    },
    [commitDocs, updateDoc, waitIfPaused]
  );

  const failureMessage = (error: any) => {
    if (isTimeoutError(error)) {
      return `${error.message} The file was cancelled so the queue could continue.`;
    }
    return error?.message || String(error);
  };

  const runQueue = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setRunning(true);
    stopRequestedRef.current = false;
    cancellationRef.current.reset();
    claimedRef.current.clear();

    try {
      await runScanQueue({
        // Claimed synchronously, so two lanes never take the same file.
        getNext: () => {
          const next = nextQueuedDocument(docsRef.current, claimedRef.current);
          if (next) claimedRef.current.add(next.fileId);
          return next;
        },
        concurrency: laneCount,
        shouldStop: () => stopRequestedRef.current,
        beforeNext: waitIfPaused,
        maxAttempts: MAX_JOB_ATTEMPTS,
        token: cancellationRef.current,
        jobTimeoutMs: SCAN_TIMEOUTS.jobMs,
        jobLabel: (next: ScannerDocument) => next.filename,

        processJob: async (
          next: ScannerDocument,
          attempt: number,
          jobToken: ScanControls['token'],
          lane: number
        ) => {
          try {
            const file = await scannerStore.getFile(next.fileId).catch(() => null);
            if (!file) throw scanError('Original file is not available for reprocessing.', 'source_file_missing');
            await processFile(next, file, attempt, jobToken, lane);
          } finally {
            claimedRef.current.delete(next.fileId);
          }
        },

        // A failed or cancelled job leaves PDF.js and Tesseract in an unknown
        // state. This lane's OCR worker is torn down before the retry, and the
        // shared PDF worker is replaced as soon as no file is using it — the
        // other lanes are reading their own files and must not be cut off.
        resetWorkers: async (error: any, lane: number) => {
          if (isTerminalErrorCode(error?.code)) return;
          await recoverFromJobFailure(lane);
        },

        onAttemptFailed: async (next: ScannerDocument, error: any, attempt: number, willRetry: boolean) => {
          if (!willRetry) return;
          await updateDoc(next.fileId, {
            processingStatus: 'queued',
            attempts: attempt,
            processingError: error?.code || 'processing_error',
            processingErrorMessage: `Attempt ${attempt} failed: ${failureMessage(error)} Retrying once.`
          });
        },

        onJobFailed: async (next: ScannerDocument, error: any, attempt: number) => {
          await updateDoc(next.fileId, {
            processingStatus: 'failed',
            attempts: attempt,
            processingError: error?.code || 'processing_error',
            processingErrorMessage: failureMessage(error)
          });
        },

        onJobStopped: async (next: ScannerDocument, _error: unknown, attempt: number) => {
          await updateDoc(next.fileId, {
            processingStatus: 'stopped',
            attempts: attempt,
            processingError: 'scan_stopped',
            processingErrorMessage: 'Scan stopped by user.'
          });
        }
      });
    } finally {
      runningRef.current = false;
      setRunning(false);
      pausedRef.current = false;
      setPaused(false);
      claimedRef.current.clear();
      // The engines are kept warm for the length of a run, which is where the
      // saving is; holding a PDF worker and a Tesseract worker per lane — each
      // with its own copy of the WASM core and language data — while the
      // scanner sits idle would cost memory for nothing.
      await resetScannerWorkers();
    }
  }, [processFile, updateDoc, waitIfPaused]);

  const addFiles = useCallback(
    async (files: File[]) => {
      if (!files.length) return;
      const remaining = Math.max(0, settingsRef.current.maxFiles - docsRef.current.length);
      const accepted = files.slice(0, remaining);
      if (!accepted.length) return;

      const created: ScannerDocument[] = accepted.map((file) => ({
        fileId: newId(),
        filename: file.name,
        fileSize: file.size,
        uploadedAt: nowIso(),
        processingStatus: 'queued',
        attempts: 0,
        stageLog: []
      }));

      await Promise.all(
        created.map((doc, index) =>
          Promise.all([scannerStore.saveDocument(doc), scannerStore.saveFile(doc.fileId, accepted[index])])
        )
      );
      commitDocs((prev) => [...created, ...prev]);
      setSelectedDocId((current) => created[0]?.fileId ?? current);
      queueMicrotask(() => void runQueue());
    },
    [commitDocs, runQueue]
  );

  const pause = useCallback(() => {
    if (!runningRef.current || stopRequestedRef.current) return;
    pausedRef.current = true;
    setPaused(true);
  }, []);

  /**
   * Resume only lifts a pause. After Stop the correct control is Restart, so
   * Resume can never silently relaunch a scan the user ended.
   */
  const resume = useCallback(() => {
    if (stopRequestedRef.current) return;
    pausedRef.current = false;
    setPaused(false);
    if (!runningRef.current) void runQueue();
  }, [runQueue]);

  const stop = useCallback(async () => {
    stopRequestedRef.current = true;
    pausedRef.current = false;
    setPaused(false);
    // Cancels the in-flight stage, then tears both engines down.
    await cancellationRef.current.cancel();
    claimedRef.current.clear();
    await resetScannerWorkers();
  }, []);

  const requeue = useCallback(
    async (targets: ScannerDocument[]) => {
      await Promise.all(targets.map((doc) => updateDoc(doc.fileId, requeuePatch() as Partial<ScannerDocument>)));
    },
    [updateDoc]
  );

  const restart = useCallback(async () => {
    stopRequestedRef.current = false;
    cancellationRef.current.reset();
    claimedRef.current.clear();
    await requeue(restartableDocuments(docsRef.current) as ScannerDocument[]);
    void runQueue();
  }, [requeue, runQueue]);

  /**
   * Read the flagged files with OCR, this once. The scan mode is untouched:
   * OCR stays off, and only the files the regular scan reported are read.
   */
  const runOcrOnFlagged = useCallback(async () => {
    const targets = ocrCandidateDocuments(docsRef.current) as ScannerDocument[];
    if (!targets.length) return;
    stopRequestedRef.current = false;
    cancellationRef.current.reset();
    claimedRef.current.clear();
    await Promise.all(
      targets.map((doc) =>
        updateDoc(doc.fileId, { ...(requeuePatch() as Partial<ScannerDocument>), forceOcr: true })
      )
    );
    void runQueue();
  }, [runQueue, updateDoc]);

  const retryFailed = useCallback(async () => {
    stopRequestedRef.current = false;
    cancellationRef.current.reset();
    claimedRef.current.clear();
    await requeue(retryableDocuments(docsRef.current) as ScannerDocument[]);
    void runQueue();
  }, [requeue, runQueue]);

  const removeDoc = useCallback(
    async (fileId: string) => {
      await scannerStore.deleteDocument(fileId);
      commitDocs((prev) => prev.filter((doc) => doc.fileId !== fileId));
      setSelectedDocId((current) => (current === fileId ? (docsRef.current[0]?.fileId ?? null) : current));
    },
    [commitDocs]
  );

  const clearCompleted = useCallback(async () => {
    const ids = docsRef.current.filter((doc) => doc.processingStatus === 'complete').map((doc) => doc.fileId);
    await scannerStore.clearCompleted(ids);
    commitDocs((prev) => prev.filter((doc) => !ids.includes(doc.fileId)));
  }, [commitDocs]);

  /** A real "free up space" action: wipes every cached document and file. */
  const clearStorage = useCallback(async () => {
    await scannerStore.clearAll();
    commitDocs(() => []);
  }, [commitDocs]);

  const setSettings = useCallback(async (next: ScanSettings) => {
    settingsRef.current = next;
    setSettingsState(next);
    await scannerStore.saveSettings(next).catch(() => undefined);
  }, []);

  const selectedDocument = useMemo(
    () => documents.find((doc) => doc.fileId === selectedDocId) ?? null,
    [documents, selectedDocId]
  );

  return {
    loaded,
    documents,
    selectedDocument,
    selectedDocId,
    setSelectedDocId,
    settings,
    setSettings,
    running,
    paused,
    addFiles,
    pause,
    resume,
    stop,
    restart,
    retryFailed,
    runOcrOnFlagged,
    removeDoc,
    clearStorage,
    clearCompleted,
    runQueue
  };
}
