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

/* ---------------- several lanes reading one queue ---------------- */

const later = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

await reporter.check('every file is read exactly once across lanes', async () => {
  const jobs = Array.from({ length: 12 }, (_unused, index) => ({
    id: index,
    run: () => later(5)
  }));
  const { done, failed } = await drain(jobs, { concurrency: 4 });
  assert.deepEqual(failed, []);
  assert.deepEqual([...done].sort((a, b) => a - b), jobs.map((job) => job.id));
  assert.equal(new Set(done).size, jobs.length, 'a file was read twice');
});

await reporter.check('lanes really do overlap', async () => {
  let inFlight = 0;
  let peak = 0;
  const jobs = Array.from({ length: 8 }, (_unused, index) => ({
    id: index,
    run: async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await later(20);
      inFlight -= 1;
    }
  }));
  await drain(jobs, { concurrency: 4 });
  assert.ok(peak > 1, `files ran one at a time (peak ${peak})`);
  assert.ok(peak <= 4, `more files ran at once than there are lanes (peak ${peak})`);
});

await reporter.check('one lane is exactly the old sequential queue', async () => {
  let inFlight = 0;
  let peak = 0;
  const jobs = Array.from({ length: 5 }, (_unused, index) => ({
    id: index,
    run: async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await later(5);
      inFlight -= 1;
    }
  }));
  const { done } = await drain(jobs, { concurrency: 1 });
  assert.equal(peak, 1);
  assert.deepEqual(done, [0, 1, 2, 3, 4], 'one lane must keep the queue order');
});

await reporter.check('each lane carries its own lane number', async () => {
  const lanes = new Set();
  const jobs = Array.from({ length: 8 }, (_unused, index) => ({ id: index, run: () => later(10) }));
  await drain(jobs, {
    concurrency: 3,
    processJob: async (job, _attempt, _token, lane) => {
      lanes.add(lane);
      await job.run();
    }
  });
  assert.deepEqual([...lanes].sort(), [0, 1, 2]);
});

await reporter.check('a file that fails in one lane does not stop the others', async () => {
  const jobs = Array.from({ length: 9 }, (_unused, index) => ({
    id: index,
    run: async () => {
      await later(5);
      if (index % 3 === 0) throw scanError('bad file', 'pdf_error');
    }
  }));
  const { done, failed } = await drain(jobs, { concurrency: 3 });
  assert.deepEqual(failed.map((item) => item.id).sort((a, b) => a - b), [0, 3, 6]);
  assert.deepEqual(done.sort((a, b) => a - b), [1, 2, 4, 5, 7, 8]);
});

await reporter.check('a failing lane resets only its own worker', async () => {
  const reset = [];
  const jobs = [
    { id: 0, run: async () => { await later(5); throw scanError('bad', 'pdf_error'); } },
    { id: 1, run: () => later(5) },
    { id: 2, run: () => later(5) }
  ];
  await drain(jobs, {
    concurrency: 3,
    resetWorkers: async (_error, lane) => reset.push(lane)
  });
  assert.equal(reset.length, 1, 'only the failing file resets anything');
  assert.equal(typeof reset[0], 'number', 'the reset is told which lane failed');
});

await reporter.check('stop ends every lane, not just one', async () => {
  let stop = false;
  let started = 0;
  const jobs = Array.from({ length: 20 }, (_unused, index) => ({
    id: index,
    run: async () => {
      started += 1;
      if (started === 4) stop = true;
      await later(5);
    }
  }));
  const { done } = await drain(jobs, { concurrency: 4, shouldStop: () => stop });
  assert.ok(done.length < jobs.length, 'stop must end the run early');
  assert.ok(done.length >= 4, 'files already in flight still finish');
});

reporter.done();
