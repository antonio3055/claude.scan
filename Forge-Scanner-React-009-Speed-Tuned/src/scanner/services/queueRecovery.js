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
 * Next document the runner should pick up. Documents are held newest-first,
 * so this keeps the v003 order: the batch the user just dropped in is scanned
 * in the order they selected it.
 *
 * `claimed` holds the ids lanes have already taken but whose status has not
 * been written back yet, so several lanes reading from this one queue never
 * take the same file.
 */
export function nextQueuedDocument(documents, claimed) {
  return (
    documents.find(
      (doc) => RESUMABLE_STATUSES.includes(doc.processingStatus) && !claimed?.has(doc.fileId)
    ) ?? null
  );
}

/** Documents that Restart should put back into the queue. */
export function restartableDocuments(documents) {
  return documents.filter((doc) => doc.processingStatus === 'stopped');
}

/** Documents that Retry Failed should put back into the queue. */
export function retryableDocuments(documents) {
  return documents.filter((doc) => doc.processingStatus === 'failed');
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
