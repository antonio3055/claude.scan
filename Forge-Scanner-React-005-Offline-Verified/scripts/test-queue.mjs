/**
 * Queue isolation: one bad file must never stop the rest of the queue.
 * Runs the real `runScanQueue` from the browser build.
 */

import assert from 'node:assert/strict';
import { createReporter } from './lib/report.mjs';
import { runScanQueue, scanError } from '../src/scanner/services/jobRunner.js';

const reporter = createReporter('Queue isolation tests');

async function drain(jobs, options = {}) {
  const pending = [...jobs];
  const done = [];
  const failed = [];

  await runScanQueue({
    maxAttempts: 1,
    shouldStop: () => false,
    getNext: () => pending.shift() ?? null,
    processJob: async (job) => {
      await job.run();
      done.push(job.id);
    },
    onJobFailed: (job, error) => failed.push({ id: job.id, code: error.code, message: error.message }),
    ...options
  });

  return { done, failed };
}

await reporter.check('a failing first file does not stop the following files', async () => {
  const { done, failed } = await drain([
    { id: 1, run: async () => { throw scanError('first file failed', 'pdf_error'); } },
    { id: 2, run: async () => {} },
    { id: 3, run: async () => {} }
  ]);

  assert.deepEqual(failed, [{ id: 1, code: 'pdf_error', message: 'first file failed' }]);
  assert.deepEqual(done, [2, 3]);
});

await reporter.check('a failure in the middle of the queue is isolated', async () => {
  const { done, failed } = await drain([
    { id: 1, run: async () => {} },
    { id: 2, run: async () => { throw scanError('corrupt', 'corrupted_pdf'); } },
    { id: 3, run: async () => {} }
  ]);

  assert.deepEqual(done, [1, 3]);
  assert.deepEqual(failed.map((item) => item.id), [2]);
});

await reporter.check('every file can fail without ending the run early', async () => {
  const { done, failed } = await drain([
    { id: 1, run: async () => { throw scanError('a', 'pdf_error'); } },
    { id: 2, run: async () => { throw scanError('b', 'pdf_error'); } },
    { id: 3, run: async () => { throw scanError('c', 'pdf_error'); } }
  ]);

  assert.deepEqual(done, []);
  assert.deepEqual(failed.map((item) => item.id), [1, 2, 3]);
});

await reporter.check('an empty queue completes without work', async () => {
  const { done, failed } = await drain([]);
  assert.deepEqual(done, []);
  assert.deepEqual(failed, []);
});

reporter.done();
