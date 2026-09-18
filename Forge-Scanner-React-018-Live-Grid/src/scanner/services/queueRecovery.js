/**
 * Queue recovery for Electron / browser restarts.
 *
 * IndexedDB keeps both the documents and their original files, so a scan that
 * was killed mid-flight has to be brought back to a state the user can act on
 * without losing the retry budget accounting or silently re-running work.
 */

const IN_FLIGHT = ['validating', 'extracting', 'ocr'];

export const RESUMABLE_STATUSES = ['queued', 'stopped'];

/**
 * Documents caught mid-scan by a restart become `stopped` and get a fresh
 * attempt budget: the interruption was the app closing, not a bad file.
 */
export function recoverDocuments(documents) {
  return documents.map((doc) => {
    if (!IN_FLIGHT.includes(doc.processingStatus)) return doc;
    return {
      ...doc,
      processingStatus: 'stopped',
      processingError: 'scan_interrupted',
      processingErrorMessage: 'Previous scan was interrupted by an app restart.',
      attempts: 0
    };
  });
}

/**
 * A filename-only guess, used purely to pick scan order before anything has
 * been read: the real document type is only known once the engine has
 * classified the extracted text.
 */
export function looksLikeApplicationFilename(filename) {
  const base = String(filename || '').split('/').pop() ?? '';
  return /application|use_this_app/i.test(base);
}

/** Same folder-grouping rule the engine uses for an application's own `folder` field. */
export function folderKeyOf(filename) {
  const parts = String(filename || '').split('/').filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 2] : '';
}

/**
 * Which of an application's sibling documents (same folder, not yet
 * started) the revenue-exclusion threshold rules out, and why. Returns no
 * documents when the check does not apply: no threshold set, the finished
 * document was not an application, it failed outright, or its revenue was
 * not below the threshold.
 */
export function revenueExclusionSkips(documents, appDoc, threshold) {
  const statedRevenue = Number(appDoc?.application?.statedRevenue);
  const applies =
    threshold > 0 &&
    appDoc?.docType === 'application' &&
    appDoc?.processingStatus !== 'failed' &&
    Number.isFinite(statedRevenue) &&
    statedRevenue < threshold;
  if (!applies) return { skipped: [], message: '' };

  const folder = folderKeyOf(appDoc.filename);
  if (!folder) return { skipped: [], message: '' };

  const skipped = documents.filter(
    (item) =>
      item.fileId !== appDoc.fileId &&
      folderKeyOf(item.filename) === folder &&
      (item.processingStatus === 'queued' || item.processingStatus === 'stopped')
  );
  const message = skipped.length
    ? `Skipped — application revenue $${Math.round(statedRevenue).toLocaleString('en-US')} is below the $${Math.round(threshold).toLocaleString('en-US')} exclusion threshold.`
    : '';
  return { skipped, message };
}

/**
 * Next document the runner should pick up. Documents are held newest-first,
 * so this keeps the v003 order: the batch the user just dropped in is scanned
 * in the order they selected it — except that a file that looks like an
 * application jumps the line, so the revenue-exclusion check (which needs
 * the application's stated revenue before its statements are worth reading)
 * has an answer as early as possible.
 *
 * `claimed` holds the ids lanes have already taken but whose status has not
 * been written back yet, so several lanes reading from this one queue never
 * take the same file.
 */
export function nextQueuedDocument(documents, claimed) {
  const available = documents.filter(
    (doc) => RESUMABLE_STATUSES.includes(doc.processingStatus) && !claimed?.has(doc.fileId)
  );
  if (!available.length) return null;
  return available.find((doc) => looksLikeApplicationFilename(doc.filename)) ?? available[0];
}

/** Documents that Restart should put back into the queue. */
export function restartableDocuments(documents) {
  return documents.filter((doc) => doc.processingStatus === 'stopped');
}

/** Documents that Retry Failed should put back into the queue. */
export function retryableDocuments(documents) {
  return documents.filter((doc) => doc.processingStatus === 'failed');
}

/**
 * Documents the regular scan reported as needing OCR. These are the files the
 * Run OCR control offers, and nothing sends them for OCR but that control.
 */
export function ocrCandidateDocuments(documents) {
  return documents.filter((doc) => doc.needsOcr === true && !doc.usedOcr);
}

/** Field reset applied when a document re-enters the queue. */
export function requeuePatch() {
  return {
    processingStatus: 'queued',
    processingError: undefined,
    processingErrorMessage: undefined,
    attempts: 0
  };
}
