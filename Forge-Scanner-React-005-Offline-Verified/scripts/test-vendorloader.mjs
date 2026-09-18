/**
 * Vendor loader recovery.
 *
 * The failure this guards against: a PDF.js or Tesseract `<script>` that never
 * fires `load` or `error`. Its promise stays pending forever. If the slot keeps
 * it, the retry — and every later file — awaits a corpse and times out too.
 *
 * These run the production `vendorLoader.js` with the real `withWatchdog` from
 * `jobRunner.js`; only the load itself is a stand-in, because a hang cannot be
 * produced on demand any other way.
 */

import assert from 'node:assert/strict';
import { createReporter } from './lib/report.mjs';
import { createLoaderSlot } from '../src/scanner/services/vendorLoader.js';
import { createCancellation, isStopError, isTimeoutError, withWatchdog } from '../src/scanner/services/jobRunner.js';

const reporter = createReporter('Vendor loader tests');
const never = () => new Promise(() => {});
const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

/** The same guard the scanner uses: the watchdog around the pending load. */
const guardWith = (timeoutMs, token) => (pending) =>
  withWatchdog('vendor load', timeoutMs, () => pending, { token });

await reporter.check('a successful load is cached and started only once', async () => {
  const slot = createLoaderSlot();
  let starts = 0;
  const start = () => {
    starts += 1;
    return { promise: Promise.resolve('pdfjsLib'), cleanup: () => {} };
  };

  assert.equal(await slot.get(start, guardWith(1_000)), 'pdfjsLib');
  assert.equal(await slot.get(start, guardWith(1_000)), 'pdfjsLib');
  assert.equal(starts, 1, 'a good load is reused, not repeated');
  assert.equal(slot.loaded, true);
});

await reporter.check('a hanging load times out and is dropped, not cached', async () => {
  const slot = createLoaderSlot();
  const start = () => ({ promise: never(), cleanup: () => {} });

  await assert.rejects(slot.get(start, guardWith(40)), (error) => isTimeoutError(error));
  assert.equal(slot.loaded, false, 'the dead promise must not survive the timeout');
});

await reporter.check('the retry after a hang starts a completely fresh load', async () => {
  const slot = createLoaderSlot();
  let attempt = 0;
  const start = () => {
    attempt += 1;
    // First attempt hangs forever; the second resolves.
    return attempt === 1
      ? { promise: never(), cleanup: () => {} }
      : { promise: Promise.resolve('fresh-instance'), cleanup: () => {} };
  };

  await assert.rejects(slot.get(start, guardWith(40)), (error) => isTimeoutError(error));
  assert.equal(await slot.get(start, guardWith(1_000)), 'fresh-instance');
  assert.equal(attempt, 2, 'the second call must start a new load');
});

await reporter.check('a hanging load runs its cleanup so no partial script tag is left', async () => {
  const slot = createLoaderSlot();
  let cleaned = 0;
  const start = () => ({ promise: never(), cleanup: () => { cleaned += 1; } });

  await assert.rejects(slot.get(start, guardWith(40)), (error) => isTimeoutError(error));
  assert.equal(cleaned, 1, 'the partial load must be torn down exactly once');
});

await reporter.check('a rejected load is dropped and retried fresh', async () => {
  const slot = createLoaderSlot();
  let attempt = 0;
  const start = () => {
    attempt += 1;
    return attempt === 1
      ? { promise: Promise.reject(new Error('asset missing')), cleanup: () => {} }
      : { promise: Promise.resolve('recovered'), cleanup: () => {} };
  };

  await assert.rejects(slot.get(start, guardWith(1_000)), /asset missing/);
  assert.equal(slot.loaded, false);
  assert.equal(await slot.get(start, guardWith(1_000)), 'recovered');
});

await reporter.check('a rejection with nobody waiting still clears the slot', async () => {
  const slot = createLoaderSlot();
  const start = () => ({ promise: Promise.reject(new Error('boom')), cleanup: () => {} });

  await assert.rejects(slot.get(start, guardWith(1_000)), /boom/);
  await tick(5);
  assert.equal(slot.loaded, false);
});

await reporter.check('a cancelled load is dropped so a later scan can load it', async () => {
  const slot = createLoaderSlot();
  const token = createCancellation();
  let attempt = 0;
  const start = () => {
    attempt += 1;
    return attempt === 1
      ? { promise: never(), cleanup: () => {} }
      : { promise: Promise.resolve('after-stop'), cleanup: () => {} };
  };

  const pending = slot.get(start, guardWith(60_000, token));
  await tick(10);
  await token.cancel();
  await assert.rejects(pending, (error) => isStopError(error));
  assert.equal(slot.loaded, false, 'stop must not poison the loader for the next scan');

  assert.equal(await slot.get(start, guardWith(1_000)), 'after-stop');
});

await reporter.check('an explicit reset drops a healthy load and its cleanup runs', async () => {
  const slot = createLoaderSlot();
  let cleaned = 0;
  const start = () => ({ promise: Promise.resolve('lib'), cleanup: () => { cleaned += 1; } });

  await slot.get(start, guardWith(1_000));
  assert.equal(slot.loaded, true);
  slot.reset();
  assert.equal(slot.loaded, false);
  assert.equal(cleaned, 1);
});

await reporter.check('resetting an empty slot is safe and does nothing', async () => {
  const slot = createLoaderSlot();
  slot.reset();
  slot.reset();
  assert.equal(slot.loaded, false);
});

await reporter.check('a throwing cleanup cannot break recovery', async () => {
  const slot = createLoaderSlot();
  let attempt = 0;
  const start = () => {
    attempt += 1;
    return attempt === 1
      ? { promise: never(), cleanup: () => { throw new Error('tag already gone'); } }
      : { promise: Promise.resolve('ok'), cleanup: () => {} };
  };

  await assert.rejects(slot.get(start, guardWith(40)), (error) => isTimeoutError(error));
  assert.equal(slot.loaded, false);
  assert.equal(await slot.get(start, guardWith(1_000)), 'ok');
});

await reporter.check('two callers waiting on one load share it, and both recover from a hang', async () => {
  const slot = createLoaderSlot();
  let starts = 0;
  const start = () => {
    starts += 1;
    return { promise: never(), cleanup: () => {} };
  };

  const first = slot.get(start, guardWith(40));
  const second = slot.get(start, guardWith(40));
  await assert.rejects(first, (error) => isTimeoutError(error));
  await assert.rejects(second, (error) => isTimeoutError(error));
  assert.equal(starts, 1, 'concurrent callers share one load');
  assert.equal(slot.loaded, false, 'and the dead load is still dropped');
});

reporter.done();
