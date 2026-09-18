/**
 * Real Stop test, in headless Chromium, offline.
 *
 * A long PDF is scanned in OCR mode so the scan is genuinely still running when
 * Stop is clicked. Stop is clicked through the real menu button, not by calling
 * the hook. The test then proves the active job was cancelled, that no Web
 * Worker is left running, that the cancelled file does not keep progressing,
 * and that the scanner still works afterwards.
 */

import assert from 'node:assert/strict';
import { createReporter } from './lib/report.mjs';
import { launchScanner } from './lib/browser-harness.mjs';
import { buildLongPdf, buildTextPdf } from './lib/fixtures.mjs';

const reporter = createReporter('Stop cancellation tests');

const LONG_PDF = buildLongPdf(8, [
  'Account Statement',
  'Account Number: 1234567890',
  'Beginning Balance 12,500.00',
  'Total Deposits 48,250.00'
]);

const SHORT_PDF = buildTextPdf([
  'SECOND NATIONAL BANK',
  'ACCOUNT HOLDER: AFTERSTOP HOLDINGS LLC',
  'Account Number: 9988776655',
  'Beginning Balance 4,000.00',
  'Total Deposits 61,000.00',
  'Ending Balance 21,000.00'
]);

const scanner = await launchScanner();
let stoppedDoc = null;
let statsAtStop = null;

try {
  await reporter.check('the scanner boots offline and OCR mode is really selected', async () => {
    await scanner.open();
    // OCR over several pages keeps the job running long enough to interrupt.
    await scanner.setScanMode('ocr');
    await scanner.setOcrPages(8);

    const settings = await scanner.readSettings();
    assert.equal(settings?.mode, 'ocr', 'the scan must actually run in OCR mode');
    assert.equal(settings?.ocrPages, 8, 'the scan must actually cover 8 OCR pages');
    assert.deepEqual(scanner.pageErrors, []);
  });

  await reporter.check('Stop is clicked while a PDF/OCR worker is genuinely running', async () => {
    await scanner.addFiles([{ name: 'long-statement.pdf', bytes: LONG_PDF }]);

    // Not "queued" and not finished: actually in extracting or OCR, with a
    // real worker alive. Nothing is asserted before Stop is clicked, so a
    // failed expectation can never be the reason Stop did not happen.
    const active = await scanner.waitForActive('long-statement.pdf', 90_000);
    statsAtStop = await scanner.waitForLiveWorker(90_000);
    await scanner.clickStop();

    assert.ok(['extracting', 'ocr'].includes(active.processingStatus), `active status was ${active.processingStatus}`);
    assert.ok(statsAtStop.created > 0, 'a PDF/OCR worker must have been running');
  });

  await reporter.check('the active job is cancelled and recorded as stopped, not failed', async () => {
    stoppedDoc = await scanner.waitForDocument('long-statement.pdf', 30_000);
    assert.equal(stoppedDoc.processingStatus, 'stopped', `status was ${stoppedDoc.processingStatus}`);
    assert.equal(stoppedDoc.processingError, 'scan_stopped');
  });

  await reporter.check('Stop cancels quickly instead of waiting for the file to finish', async () => {
    const stages = stoppedDoc.stageLog.map((entry) => entry.stage);
    assert.ok(!stages.includes('results_validated'), 'a cancelled file must not reach extraction');
    assert.ok(!stages.includes('ocr_completed'), 'OCR must not have run to completion');
  });

  await reporter.check('every PDF/OCR worker is terminated after Stop, within 5 seconds', async () => {
    // Stop tears the engines down asynchronously, so the claim under test is
    // that teardown completes promptly — not that it is instantaneous.
    const stats = await scanner.waitForNoLiveWorker(5_000);
    assert.equal(stats.live, 0);
    assert.ok(stats.terminated > 0, 'a worker must actually have been terminated, not merely never started');
  });

  await reporter.check('the cancelled file makes no further progress once stopped', async () => {
    const before = JSON.stringify(await scanner.findDocument('long-statement.pdf'));
    await scanner.page.waitForTimeout(4_000);
    const after = JSON.stringify(await scanner.findDocument('long-statement.pdf'));
    assert.equal(after, before, 'a stale worker would keep mutating the stopped document');
  });

  await reporter.check('the scanner accepts and completes another job after Stop', async () => {
    await scanner.setScanMode('regular');
    await scanner.addFiles([{ name: 'after-stop.pdf', bytes: SHORT_PDF }]);

    const doc = await scanner.waitForDocument('after-stop.pdf', 90_000);
    assert.notEqual(doc.processingStatus, 'failed', `after-stop scan failed: ${doc.processingErrorMessage}`);
    assert.notEqual(doc.processingStatus, 'stopped', 'the new job must not inherit the stop');
    assert.equal(doc.attempts, 1, 'the fresh job must succeed on its first attempt');
  });

  await reporter.check('the job after Stop extracted real data, so the engines recovered fully', async () => {
    const doc = await scanner.findDocument('after-stop.pdf');
    assert.equal(doc.bankAccount?.accountNumber, '9988776655');
    assert.equal(doc.statementSummary?.deposits, 61000);
  });

  await reporter.check('Restart puts the stopped file back and completes it', async () => {
    await scanner.clickRestart();
    const doc = await scanner.waitForDocument('long-statement.pdf', 180_000);
    assert.notEqual(doc.processingStatus, 'stopped', 'Restart must re-queue the stopped file');
    assert.notEqual(doc.processingStatus, 'failed', `restarted scan failed: ${doc.processingErrorMessage}`);
    assert.equal(doc.pageCount, 8);
  });

  await reporter.check('nothing reached the network during the whole stop run', async () => {
    assert.deepEqual(scanner.externalAttempts, [], `external requests: ${scanner.externalAttempts.join(', ')}`);
    assert.deepEqual(scanner.missing, [], `missing local assets: ${scanner.missing.join(', ')}`);
  });

  await reporter.check('no page errors were raised by cancelling mid-scan', async () => {
    assert.deepEqual(scanner.pageErrors, [], `page errors: ${scanner.pageErrors.join(' | ')}`);
  });
} finally {
  const stats = await scanner.workerStats().catch(() => null);
  await scanner.close();

  console.log(`\nWorkers created:    ${stats?.created ?? 'n/a'}`);
  console.log(`Workers terminated: ${stats?.terminated ?? 'n/a'}`);
  console.log(`Workers still live: ${stats?.live ?? 'n/a'}`);
  console.log(`Remote origins attempted: ${scanner.externalAttempts.length}`);
}

reporter.done();
