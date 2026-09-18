/**
 * Authoritative scanner job runner.
 *
 * Responsibilities, in one place:
 *  - cancellation tokens that really abort an in-flight PDF/OCR job
 *  - a hard watchdog timeout around every awaited stage
 *  - one automatic retry per file
 *  - strict queue isolation: a failed file never stops the rest of the queue
 *
 * It owns no PDF, OCR, React or storage code. Everything it touches is
 * injected, which is why the browser build and the Node tests run the
 * same implementation.
 */

import { MAX_JOB_ATTEMPTS, isTerminalErrorCode } from './scannerConfig.js';

export const STOP_CODE = 'scan_stopped';
export const TIMEOUT_CODE = 'job_timeout';

export function scanError(message, code) {
  return Object.assign(new Error(message), { code });
}

export function isStopError(error) {
  return error?.code === STOP_CODE;
}

export function isTimeoutError(error) {
  return error?.code === TIMEOUT_CODE;
}

async function runQuietly(handler) {
  try {
    await handler();
  } catch {
    /* teardown must never mask the original failure */
  }
}

/**
 * Cancellation token. `cancel()` rejects everything currently waiting inside
 * `withWatchdog` and runs the abort handler registered by the active stage,
 * which is what actually tears down the PDF loading task or the OCR worker.
 */
export function createCancellation() {
  let cancelled = false;
  let aborts = new Set();
  let waiters = new Set();

  const token = {
    get cancelled() {
      return cancelled;
    },

    /** Register teardown for the stage that is running right now. */
    onCancel(handler) {
      if (cancelled) {
        void runQuietly(handler);
        return () => {};
      }
      aborts.add(handler);
      return () => aborts.delete(handler);
    },

    throwIfCancelled() {
      if (cancelled) throw scanError('Scan stopped by user.', STOP_CODE);
    },

    async cancel() {
      if (cancelled) return;
      cancelled = true;
      const error = scanError('Scan stopped by user.', STOP_CODE);
      const pending = [...waiters];
      waiters = new Set();
      for (const reject of pending) reject(error);
      const handlers = [...aborts];
      aborts = new Set();
      for (const handler of handlers) await runQuietly(handler);
    },

    /** Reuse the token for the next run after a stop. */
    reset() {
      cancelled = false;
      aborts = new Set();
      waiters = new Set();
    },

    /**
     * Internal: a promise that rejects the moment the token is cancelled,
     * plus the release function that drops it when the stage finishes.
     */
    _watch() {
      if (cancelled) {
        return { promise: Promise.reject(scanError('Scan stopped by user.', STOP_CODE)), release: () => {} };
      }
      let reject;
      const promise = new Promise((_resolve, rejectFn) => {
        reject = rejectFn;
        waiters.add(rejectFn);
      });
      return { promise, release: () => waiters.delete(reject) };
    }
  };

  return token;
}

const defaultTimer = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (id) => clearTimeout(id)
};

/**
 * Race a stage against a hard timeout and the cancellation token.
 *
 * `abort` is called exactly once when the stage times out or is cancelled, so
 * the underlying resource (PDF loading task, OCR worker) is destroyed instead
 * of being left running behind a promise nobody awaits any more.
 */
export async function withWatchdog(label, timeoutMs, run, options = {}) {
  const { token, abort, timer = defaultTimer } = options;
  token?.throwIfCancelled();

  let aborted = false;
  const abortOnce = async () => {
    if (aborted || !abort) return;
    aborted = true;
    await runQuietly(abort);
  };

  const unsubscribe = token ? token.onCancel(abortOnce) : () => {};
  const watch = token ? token._watch() : { promise: new Promise(() => {}), release: () => {} };
  // The stage promise may never settle after a timeout. Swallow its late
  // result so it can never surface as an unhandled rejection.
  watch.promise.catch(() => {});

  const work = (async () => run())();
  work.catch(() => {});

  let timeoutId = null;
  const timeout = new Promise((_resolve, reject) => {
    timeoutId = timer.set(() => reject(scanError(`${label} timed out after ${timeoutMs}ms.`, TIMEOUT_CODE)), timeoutMs);
  });
  timeout.catch(() => {});

  try {
    return await Promise.race([work, timeout, watch.promise]);
  } catch (error) {
    if (isTimeoutError(error) || isStopError(error)) await abortOnce();
    throw error;
  } finally {
    if (timeoutId !== null) timer.clear(timeoutId);
    watch.release();
    unsubscribe();
  }
}

/**
 * Run one job with a single automatic retry.
 *
 * Order of events on a failed attempt:
 *   1. workers are reset, so a poisoned PDF/OCR worker cannot infect the next file
 *   2. `onAttemptFailed` records the attempt
 *   3. the job is retried once, unless it was stopped or the failure is terminal
 */
export async function runJobWithRetry(job, handlers) {
  const {
    processJob,
    shouldStop = () => false,
    resetWorkers,
    onAttemptFailed,
    onJobFailed,
    onJobStopped,
    maxAttempts = MAX_JOB_ATTEMPTS
  } = handlers;

  let attempt = 0;

  while (attempt < maxAttempts) {
    attempt += 1;
    try {
      await processJob(job, attempt);
      return { outcome: 'complete', attempts: attempt };
    } catch (error) {
      if (resetWorkers) await runQuietly(() => resetWorkers(error));

      if (isStopError(error)) {
        if (onJobStopped) await onJobStopped(job, error, attempt);
        return { outcome: 'stopped', attempts: attempt };
      }

      const terminal = isTerminalErrorCode(error?.code);
      const stopping = shouldStop();
      const willRetry = !terminal && !stopping && attempt < maxAttempts;
      if (onAttemptFailed) await onAttemptFailed(job, error, attempt, willRetry);

      if (willRetry) continue;

      if (stopping && !terminal) {
        if (onJobStopped) await onJobStopped(job, error, attempt);
        return { outcome: 'stopped', attempts: attempt };
      }
      if (onJobFailed) await onJobFailed(job, error, attempt);
      return { outcome: 'failed', attempts: attempt };
    }
  }

  return { outcome: 'failed', attempts: attempt };
}

/**
 * Drain the queue one job at a time. A job that fails, times out or throws
 * unexpectedly is recorded against that job only; the loop always continues
 * to the next file.
 */
export async function runScanQueue(handlers) {
  const { getNext, shouldStop = () => false, beforeNext } = handlers;

  while (!shouldStop()) {
    if (beforeNext) await beforeNext();
    if (shouldStop()) break;

    const job = getNext();
    if (!job) break;

    await runJobWithRetry(job, handlers);
  }
}
