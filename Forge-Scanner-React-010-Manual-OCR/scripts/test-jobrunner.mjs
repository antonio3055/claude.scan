/**
 * Job runner behaviour tests.
 *
 * These drive the real `src/scanner/services/jobRunner.js` used by the browser
 * build. The PDF and OCR stages are stand-ins that hang, throw or succeed on
 * demand, which is the only way to reproduce a hang deterministically — the
 * watchdog, cancellation, retry and isolation logic under test is production code.
 */

import assert from 'node:assert/strict';
import { createReporter } from './lib/report.mjs';
import {
  STOP_CODE,
  TIMEOUT_CODE,
  createCancellation,
  isStopError,
  isTimeoutError,
  runScanQueue,
  scanError,
  withWatchdog
} from '../src/scanner/services/jobRunner.js';
import { MAX_JOB_ATTEMPTS, SCAN_TIMEOUTS } from '../src/scanner/services/scannerConfig.js';

const reporter = createReporter('Job runner tests');
const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
const never = () => new Promise(() => {});

/**
 * Mirrors how `useScannerQueue` wires the runner: per-file status, attempt
 * counting, worker reset after every non-terminal failure, queue isolation.
 */
function createHarness(jobs, options = {}) {
  const state = new Map(jobs.map((job) => [job.id, { status: 'queued', attempts: 0, error: null }]));
  const events = [];
  let stopRequested = false;
  let paused = options.paused ?? false;
  const token = createCancellation();

  const harness = {
    token,
    events,
    state,
    get stopped() {
      return stopRequested;
    },
    setPaused(value) {
      paused = value;
    },
    async stop() {
      stopRequested = true;
      paused = false;
      await token.cancel();
    },
    statusOf: (id) => state.get(id).status,
    attemptsOf: (id) => state.get(id).attempts,
    errorOf: (id) => state.get(id).error,

    run() {
      return runScanQueue({
        maxAttempts: options.maxAttempts ?? MAX_JOB_ATTEMPTS,
        token,
        jobTimeoutMs: options.jobTimeoutMs ?? 5_000,
        jobLabel: (job) => job.id,
        shouldStop: () => stopRequested,
        beforeNext: async () => {
          while (paused && !stopRequested) await tick(5);
        },
        getNext: () => jobs.find((job) => state.get(job.id).status === 'queued') ?? null,

        processJob: async (job, attempt, jobToken) => {
          const record = state.get(job.id);
          record.attempts = attempt;
          record.status = 'running';
          events.push(`start:${job.id}:${attempt}`);
          // Stages run under the per-attempt token, exactly as the real hook does.
          await job.run({ attempt, token: jobToken });
          record.status = 'complete';
          events.push(`complete:${job.id}`);
        },

        resetWorkers: async () => {
          events.push('reset-workers');
          await options.resetWorkers?.();
        },

        onAttemptFailed: (job, error, attempt, willRetry) => {
          events.push(`attempt-failed:${job.id}:${attempt}:${willRetry ? 'retry' : 'final'}`);
          if (willRetry) state.get(job.id).status = 'queued';
        },

        onJobFailed: (job, error, attempt) => {
          const record = state.get(job.id);
          record.status = 'failed';
          record.attempts = attempt;
          record.error = error;
          events.push(`failed:${job.id}:${error.code}`);
        },

        onJobStopped: (job, error, attempt) => {
          const record = state.get(job.id);
          record.status = 'stopped';
          record.attempts = attempt;
          record.error = error;
          events.push(`stopped:${job.id}`);
        }
      });
    }
  };

  return harness;
}

/* ------------------------------------------------------------------ *
 * Watchdog primitives
 * ------------------------------------------------------------------ */

await reporter.check('watchdog returns the stage result when it finishes in time', async () => {
  const value = await withWatchdog('fast stage', 500, async () => 'done');
  assert.equal(value, 'done');
});

await reporter.check('watchdog aborts a hanging stage exactly once', async () => {
  let aborts = 0;
  await assert.rejects(
    withWatchdog('hanging stage', 40, never, { abort: () => { aborts += 1; } }),
    (error) => isTimeoutError(error) && error.code === TIMEOUT_CODE
  );
  await tick(60);
  assert.equal(aborts, 1, 'abort must run once and only once');
});

await reporter.check('cancelling a token rejects the stage it is watching', async () => {
  const token = createCancellation();
  let aborted = false;
  const pending = withWatchdog('cancellable stage', 5000, never, {
    token,
    abort: () => { aborted = true; }
  });
  await tick(10);
  await token.cancel();
  await assert.rejects(pending, (error) => isStopError(error));
  assert.equal(aborted, true, 'cancellation must tear the stage down');
});

/* ------------------------------------------------------------------ *
 * Hanging PDF / hanging OCR
 * ------------------------------------------------------------------ */

await reporter.check('hanging PDF job times out, is destroyed, and is marked failed', async () => {
  let pdfTaskDestroyed = false;
  const harness = createHarness([
    {
      id: 'hanging.pdf',
      run: ({ token }) =>
        withWatchdog('PDF open', 40, never, {
          token,
          abort: () => { pdfTaskDestroyed = true; }
        })
    }
  ]);

  await harness.run();
  assert.equal(harness.statusOf('hanging.pdf'), 'failed');
  assert.equal(harness.errorOf('hanging.pdf').code, TIMEOUT_CODE);
  assert.equal(pdfTaskDestroyed, true, 'the PDF loading task must be destroyed');
});

await reporter.check('hanging OCR job times out and terminates the OCR worker', async () => {
  let workerTerminated = false;
  const harness = createHarness([
    {
      id: 'hanging-ocr.png',
      run: ({ token }) =>
        withWatchdog('OCR page 1', 40, never, {
          token,
          abort: () => { workerTerminated = true; }
        })
    }
  ]);

  await harness.run();
  assert.equal(harness.statusOf('hanging-ocr.png'), 'failed');
  assert.equal(harness.errorOf('hanging-ocr.png').code, TIMEOUT_CODE);
  assert.equal(workerTerminated, true, 'the OCR worker must be terminated');
});

/* ------------------------------------------------------------------ *
 * Corrupted PDF
 * ------------------------------------------------------------------ */

await reporter.check('corrupted PDF fails with its own code and does not hang', async () => {
  const harness = createHarness([
    { id: 'corrupt.pdf', run: async () => { throw scanError('Corrupted PDF: bad xref', 'corrupted_pdf'); } }
  ]);

  await harness.run();
  assert.equal(harness.statusOf('corrupt.pdf'), 'failed');
  assert.equal(harness.errorOf('corrupt.pdf').code, 'corrupted_pdf');
});

/* ------------------------------------------------------------------ *
 * Retry once
 * ------------------------------------------------------------------ */

await reporter.check('a failing job is retried exactly once and then succeeds', async () => {
  let calls = 0;
  const harness = createHarness([
    {
      id: 'flaky.pdf',
      run: async () => {
        calls += 1;
        if (calls === 1) throw scanError('worker died', 'pdf_error');
      }
    }
  ]);

  await harness.run();
  assert.equal(calls, 2, 'exactly one retry');
  assert.equal(harness.statusOf('flaky.pdf'), 'complete');
  assert.equal(harness.attemptsOf('flaky.pdf'), 2);
});

await reporter.check('a permanently failing job stops after one retry, never a third attempt', async () => {
  let calls = 0;
  const harness = createHarness([
    { id: 'broken.pdf', run: async () => { calls += 1; throw scanError('still broken', 'pdf_error'); } }
  ]);

  await harness.run();
  assert.equal(calls, MAX_JOB_ATTEMPTS);
  assert.equal(calls, 2);
  assert.equal(harness.statusOf('broken.pdf'), 'failed');
  assert.deepEqual(
    harness.events.filter((event) => event.startsWith('attempt-failed')),
    ['attempt-failed:broken.pdf:1:retry', 'attempt-failed:broken.pdf:2:final']
  );
});

await reporter.check('a hanging job is retried once, then fails without blocking the run', async () => {
  let calls = 0;
  const harness = createHarness([
    {
      id: 'always-hangs.pdf',
      run: ({ token }) => { calls += 1; return withWatchdog('PDF open', 30, never, { token }); }
    }
  ]);

  await harness.run();
  assert.equal(calls, 2);
  assert.equal(harness.statusOf('always-hangs.pdf'), 'failed');
  assert.equal(harness.errorOf('always-hangs.pdf').code, TIMEOUT_CODE);
});

await reporter.check('a validation failure is terminal and is not retried', async () => {
  let calls = 0;
  const harness = createHarness([
    { id: 'notes.txt', run: async () => { calls += 1; throw scanError('unsupported file type', 'unsupported_file_type'); } }
  ]);

  await harness.run();
  assert.equal(calls, 1, 'terminal failures must not consume a retry');
  assert.equal(harness.statusOf('notes.txt'), 'failed');
});

/* ------------------------------------------------------------------ *
 * Timeout recovery + queue isolation
 * ------------------------------------------------------------------ */

await reporter.check('workers are reset after every failed attempt', async () => {
  let resets = 0;
  const harness = createHarness(
    [{ id: 'broken.pdf', run: async () => { throw scanError('boom', 'pdf_error'); } }],
    { resetWorkers: () => { resets += 1; } }
  );

  await harness.run();
  assert.equal(resets, 2, 'one reset per failed attempt, so no poisoned worker survives');
});

await reporter.check('the queue continues after a timeout and the later files still complete', async () => {
  const harness = createHarness([
    { id: 'a.pdf', run: async () => {} },
    { id: 'hangs.pdf', run: ({ token }) => withWatchdog('PDF open', 30, never, { token }) },
    { id: 'c.pdf', run: async () => {} },
    { id: 'd.pdf', run: async () => {} }
  ]);

  await harness.run();
  assert.equal(harness.statusOf('a.pdf'), 'complete');
  assert.equal(harness.statusOf('hangs.pdf'), 'failed');
  assert.equal(harness.statusOf('c.pdf'), 'complete');
  assert.equal(harness.statusOf('d.pdf'), 'complete');
});

await reporter.check('only the failing file is marked failed', async () => {
  const harness = createHarness([
    { id: 'a.pdf', run: async () => {} },
    { id: 'bad.pdf', run: async () => { throw scanError('nope', 'pdf_error'); } },
    { id: 'c.pdf', run: async () => {} }
  ]);

  await harness.run();
  const failed = [...harness.state.entries()].filter(([, record]) => record.status === 'failed').map(([id]) => id);
  assert.deepEqual(failed, ['bad.pdf']);
});

await reporter.check('a job that throws a non-Error value cannot break the queue', async () => {
  const harness = createHarness([
    { id: 'weird.pdf', run: async () => { throw 'string failure'; } },
    { id: 'next.pdf', run: async () => {} }
  ]);

  await harness.run();
  assert.equal(harness.statusOf('weird.pdf'), 'failed');
  assert.equal(harness.statusOf('next.pdf'), 'complete');
});

/* ------------------------------------------------------------------ *
 * Stop
 * ------------------------------------------------------------------ */

await reporter.check('stop cancels the in-flight job and skips the rest of the queue', async () => {
  let aborted = false;
  let thirdStarted = false;
  const harness = createHarness([
    {
      id: 'running.pdf',
      run: ({ token }) => withWatchdog('PDF open', 5000, never, { token, abort: () => { aborted = true; } })
    },
    { id: 'queued-1.pdf', run: async () => { thirdStarted = true; } },
    { id: 'queued-2.pdf', run: async () => { thirdStarted = true; } }
  ]);

  const run = harness.run();
  await tick(20);
  await harness.stop();
  await run;

  assert.equal(aborted, true, 'stop must abort the active PDF/OCR stage');
  assert.equal(harness.statusOf('running.pdf'), 'stopped');
  assert.equal(harness.errorOf('running.pdf').code, STOP_CODE);
  assert.equal(thirdStarted, false, 'no further files may start after stop');
  assert.equal(harness.statusOf('queued-1.pdf'), 'queued');
});

await reporter.check('a stopped job is not retried', async () => {
  let calls = 0;
  const harness = createHarness([
    {
      id: 'running.pdf',
      run: ({ token }) => { calls += 1; return withWatchdog('PDF open', 5000, never, { token }); }
    }
  ]);

  const run = harness.run();
  await tick(20);
  await harness.stop();
  await run;

  assert.equal(calls, 1, 'stop is a user action, not a failure to retry');
  assert.equal(harness.statusOf('running.pdf'), 'stopped');
});

await reporter.check('stop still resets the workers', async () => {
  let resets = 0;
  const harness = createHarness(
    [{ id: 'running.pdf', run: ({ token }) => withWatchdog('PDF open', 5000, never, { token }) }],
    { resetWorkers: () => { resets += 1; } }
  );

  const run = harness.run();
  await tick(20);
  await harness.stop();
  await run;
  assert.equal(resets, 1);
});

/* ------------------------------------------------------------------ *
 * Pause / resume
 * ------------------------------------------------------------------ */

await reporter.check('pause holds the queue and resume drains it', async () => {
  const harness = createHarness(
    [
      { id: 'a.pdf', run: async () => {} },
      { id: 'b.pdf', run: async () => {} }
    ],
    { paused: true }
  );

  const run = harness.run();
  await tick(40);
  assert.equal(harness.events.length, 0, 'nothing may start while paused');

  harness.setPaused(false);
  await run;
  assert.equal(harness.statusOf('a.pdf'), 'complete');
  assert.equal(harness.statusOf('b.pdf'), 'complete');
});

await reporter.check('pause between files does not lose queued work', async () => {
  const harness = createHarness([
    { id: 'a.pdf', run: async () => { harness.setPaused(true); } },
    { id: 'b.pdf', run: async () => {} }
  ]);

  const run = harness.run();
  await tick(40);
  assert.equal(harness.statusOf('a.pdf'), 'complete');
  assert.equal(harness.statusOf('b.pdf'), 'queued', 'the second file waits for resume');

  harness.setPaused(false);
  await run;
  assert.equal(harness.statusOf('b.pdf'), 'complete');
});

await reporter.check('stop while paused ends the run instead of resuming it', async () => {
  const harness = createHarness(
    [{ id: 'a.pdf', run: async () => {} }],
    { paused: true }
  );

  const run = harness.run();
  await tick(20);
  await harness.stop();
  await run;
  assert.equal(harness.statusOf('a.pdf'), 'queued');
  assert.equal(harness.stopped, true);
});

/* ------------------------------------------------------------------ *
 * Whole-file watchdog (jobMs)
 * ------------------------------------------------------------------ */

await reporter.check('the whole-file ceiling is the configured jobMs by default', async () => {
  assert.equal(typeof SCAN_TIMEOUTS.jobMs, 'number');
  assert.equal(SCAN_TIMEOUTS.jobMs, 420_000);
});

await reporter.check('a file whose stages each pass but together overrun is killed at the ceiling', async () => {
  // Every stage finishes inside its own limit; the file still exceeds its total.
  const harness = createHarness(
    [
      {
        id: 'slow-but-legal.pdf',
        run: async ({ token }) => {
          for (let page = 0; page < 20; page += 1) {
            await withWatchdog(`page ${page}`, 1_000, () => tick(25), { token });
          }
        }
      }
    ],
    { jobTimeoutMs: 120, maxAttempts: 1 }
  );

  await harness.run();
  assert.equal(harness.statusOf('slow-but-legal.pdf'), 'failed');
  assert.equal(harness.errorOf('slow-but-legal.pdf').code, TIMEOUT_CODE);
});

await reporter.check('the whole-file ceiling cancels the stage that is running inside it', async () => {
  let aborted = false;
  const harness = createHarness(
    [
      {
        id: 'stuck-stage.pdf',
        run: ({ token }) =>
          // The stage's own limit is far higher than the file ceiling.
          withWatchdog('endless page', 60_000, never, { token, abort: () => { aborted = true; } })
      }
    ],
    { jobTimeoutMs: 80, maxAttempts: 1 }
  );

  await harness.run();
  assert.equal(aborted, true, 'the file ceiling must tear down the active stage');
  assert.equal(harness.errorOf('stuck-stage.pdf').code, TIMEOUT_CODE);
});

await reporter.check('a file killed by the ceiling is retried once, then failed', async () => {
  let calls = 0;
  const harness = createHarness(
    [{ id: 'always-slow.pdf', run: ({ token }) => { calls += 1; return withWatchdog('endless', 60_000, never, { token }); } }],
    { jobTimeoutMs: 80 }
  );

  await harness.run();
  assert.equal(calls, 2, 'first attempt plus one retry');
  assert.equal(harness.statusOf('always-slow.pdf'), 'failed');
  assert.equal(harness.errorOf('always-slow.pdf').code, TIMEOUT_CODE);
});

await reporter.check('the queue continues after a whole-file timeout', async () => {
  const harness = createHarness(
    [
      { id: 'good-before.pdf', run: async () => {} },
      { id: 'hangs-forever.pdf', run: ({ token }) => withWatchdog('endless', 60_000, never, { token }) },
      { id: 'good-after.pdf', run: async () => {} }
    ],
    { jobTimeoutMs: 80, maxAttempts: 1 }
  );

  await harness.run();
  assert.equal(harness.statusOf('good-before.pdf'), 'complete');
  assert.equal(harness.statusOf('hangs-forever.pdf'), 'failed');
  assert.equal(harness.statusOf('good-after.pdf'), 'complete');
});

await reporter.check('a file that ignores its cancellation still cannot hold the queue', async () => {
  // Worst case: the stage never observes the token at all.
  const harness = createHarness(
    [
      { id: 'uncooperative.pdf', run: () => never() },
      { id: 'next.pdf', run: async () => {} }
    ],
    { jobTimeoutMs: 80, maxAttempts: 1 }
  );

  await harness.run();
  assert.equal(harness.statusOf('uncooperative.pdf'), 'failed');
  assert.equal(harness.statusOf('next.pdf'), 'complete');
});

await reporter.check('a file finishing inside the ceiling is untouched by it', async () => {
  const harness = createHarness([{ id: 'quick.pdf', run: () => tick(20) }], { jobTimeoutMs: 5_000 });
  await harness.run();
  assert.equal(harness.statusOf('quick.pdf'), 'complete');
  assert.equal(harness.attemptsOf('quick.pdf'), 1);
});

await reporter.check('stop still reaches the stage through the per-attempt token', async () => {
  let aborted = false;
  const harness = createHarness(
    [{ id: 'running.pdf', run: ({ token }) => withWatchdog('endless', 60_000, never, { token, abort: () => { aborted = true; } }) }],
    { jobTimeoutMs: 60_000 }
  );

  const run = harness.run();
  await tick(20);
  await harness.stop();
  await run;

  assert.equal(aborted, true, 'stop must cancel through the child token');
  assert.equal(harness.statusOf('running.pdf'), 'stopped');
});

reporter.done();
