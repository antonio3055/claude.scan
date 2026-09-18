/**
 * Queue recovery after an Electron / browser restart.
 *
 * `recoverDocuments` is what `useScannerQueue` runs against whatever IndexedDB
 * held when the app was killed, so these cases are the restart contract.
 */

import assert from 'node:assert/strict';
import { createReporter } from './lib/report.mjs';
import {
  RESUMABLE_STATUSES,
  nextQueuedDocument,
  recoverDocuments,
  requeuePatch,
  restartableDocuments,
  retryableDocuments
} from '../src/scanner/services/queueRecovery.js';

const reporter = createReporter('Queue recovery tests');

const doc = (fileId, processingStatus, extra = {}) => ({
  fileId,
  filename: `${fileId}.pdf`,
  processingStatus,
  stageLog: [],
  ...extra
});

await reporter.check('a scan killed mid-extraction comes back as stopped, not stuck', async () => {
  const [recovered] = recoverDocuments([doc('a', 'extracting', { attempts: 1 })]);
  assert.equal(recovered.processingStatus, 'stopped');
  assert.equal(recovered.processingError, 'scan_interrupted');
});

await reporter.check('every in-flight status is recovered', async () => {
  const recovered = recoverDocuments([
    doc('a', 'validating'),
    doc('b', 'extracting'),
    doc('c', 'ocr')
  ]);
  assert.deepEqual(recovered.map((item) => item.processingStatus), ['stopped', 'stopped', 'stopped']);
});

await reporter.check('an interrupted file gets a fresh attempt budget', async () => {
  const [recovered] = recoverDocuments([doc('a', 'ocr', { attempts: 2 })]);
  assert.equal(recovered.attempts, 0, 'an app restart is not a failed attempt');
});

await reporter.check('settled documents are returned untouched', async () => {
  const input = [
    doc('a', 'complete', { attempts: 1 }),
    doc('b', 'failed', { attempts: 2, processingError: 'corrupted_pdf' }),
    doc('c', 'queued'),
    doc('d', 'needs_review'),
    doc('e', 'stopped')
  ];
  const recovered = recoverDocuments(input);
  assert.deepEqual(recovered, input);
  input.forEach((item, index) => assert.equal(recovered[index], item, 'unchanged documents keep identity'));
});

await reporter.check('recovery does not mutate the stored documents', async () => {
  const input = [doc('a', 'extracting', { attempts: 1 })];
  recoverDocuments(input);
  assert.equal(input[0].processingStatus, 'extracting');
});

await reporter.check('queued and stopped documents are both resumable', async () => {
  assert.deepEqual(RESUMABLE_STATUSES, ['queued', 'stopped']);
});

await reporter.check('the next job is the first resumable document in queue order', async () => {
  const docs = [doc('newest', 'complete'), doc('a', 'queued'), doc('b', 'queued')];
  assert.equal(nextQueuedDocument(docs).fileId, 'a');
});

await reporter.check('a recovered stopped document is picked up again', async () => {
  const docs = recoverDocuments([doc('a', 'complete'), doc('b', 'ocr')]);
  assert.equal(nextQueuedDocument(docs).fileId, 'b');
});

await reporter.check('nothing resumable returns null instead of looping', async () => {
  assert.equal(nextQueuedDocument([doc('a', 'complete'), doc('b', 'failed')]), null);
  assert.equal(nextQueuedDocument([]), null);
});

await reporter.check('restart targets stopped files and retry targets failed files', async () => {
  const docs = [doc('a', 'stopped'), doc('b', 'failed'), doc('c', 'complete')];
  assert.deepEqual(restartableDocuments(docs).map((item) => item.fileId), ['a']);
  assert.deepEqual(retryableDocuments(docs).map((item) => item.fileId), ['b']);
});

await reporter.check('re-queueing clears the previous error and attempt count', async () => {
  const patch = requeuePatch();
  assert.equal(patch.processingStatus, 'queued');
  assert.equal(patch.attempts, 0);
  assert.equal(patch.processingError, undefined);
  assert.equal(patch.processingErrorMessage, undefined);
});

reporter.done();
