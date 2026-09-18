/**
 * OCR auto-continues after a regular scan — proved in a real browser.
 *
 * A regular scan reads with its text layer first, same as always. If that
 * pass leaves anything flagged `needsOcr`, the scanner now follows up with
 * exactly one automatic OCR pass on those files -- the user no longer has
 * to find and click "Run OCR on flagged" for the common case. That control
 * still exists (for anything flagged after this run, e.g. a later batch),
 * and its own requeue/flag-clearing mechanics are covered at the unit level
 * in test-recovery.mjs and structurally in audit.mjs; this suite is about
 * the end-to-end auto-continue behaviour against the built app, offline.
 */

import assert from 'node:assert/strict';
import { createReporter } from './lib/report.mjs';
import { buildImageOnlyPdf, buildTextPdf } from './lib/fixtures.mjs';
import { launchScanner, SETTLED } from './lib/browser-harness.mjs';

const reporter = createReporter('OCR auto-continue tests');

const READABLE = buildTextPdf([
  'Account Statement',
  'Beginning Balance $381.64',
  'Deposits and Additions 22 19,441.82',
  'Electronic Withdrawals 18 -18,477.08',
  'Ending Balance 57 $1,346.38'
]);
const SCANNED = buildImageOnlyPdf();

const scanner = await launchScanner();

/** Wait past the transient "flagged but not yet auto-OCR'd" state to the real final one. */
async function waitForOcrSettled(filename, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = (await scanner.findDocument(filename)) ?? last;
    if (last && SETTLED.includes(last.processingStatus) && !(last.needsOcr && !last.usedOcr)) return last;
    await scanner.page.waitForTimeout(200);
  }
  throw new Error(`${filename} never reached a final post-auto-OCR state within ${timeoutMs}ms (last: ${JSON.stringify(last)})`);
}

try {
  await scanner.open();

  await reporter.check('the scanner starts with OCR off', async () => {
    const settings = await scanner.readSettings();
    assert.equal(settings?.mode ?? 'regular', 'regular');
  });

  await scanner.addFiles([
    { name: 'readable.pdf', bytes: READABLE },
    { name: 'scanned.pdf', bytes: SCANNED }
  ]);

  const readable = await scanner.waitForDocument('readable.pdf', 120_000);
  const scanned = await waitForOcrSettled('scanned.pdf', 180_000);

  await reporter.check('a readable file is never flagged for OCR', async () => {
    assert.equal(Boolean(readable.needsOcr), false);
    assert.equal(Boolean(readable.usedOcr), false);
  });

  await reporter.check('the readable file was still extracted normally', async () => {
    assert.equal(readable.statementSummary?.deposits, 19441.82);
    assert.equal(readable.reconciliation?.reconciles, true);
  });

  await reporter.check('the scanned file was flagged, then read automatically', async () => {
    // needsOcr is cleared once OCR actually runs -- usedOcr is the lasting
    // record that this file needed and got the OCR pass.
    assert.equal(scanned.usedOcr, true, 'the automatic follow-up pass should have read it with OCR');
    assert.equal(Boolean(scanned.needsOcr), false, 'the needs-OCR flag should be cleared once OCR has run');
    assert.equal(scanned.extractionMethod, 'ocr');
  });

  await reporter.check('the scanned file is not failed for having no text', async () => {
    assert.notEqual(scanned.processingStatus, 'failed');
  });

  await reporter.check('OCR really did run, rather than being skipped', async () => {
    assert.ok(
      (scanned.stageLog ?? []).some((entry) => entry.stage === 'ocr_completed'),
      'the file never reached OCR'
    );
    const stats = await scanner.workerStats();
    assert.ok(stats.created >= 2, `expected a PDF worker and an OCR worker, only ${stats.created} were created`);
  });

  await reporter.check('the readable file was left alone by the automatic OCR pass', async () => {
    const untouched = await scanner.findDocument('readable.pdf');
    assert.equal(Boolean(untouched.usedOcr), false, 'OCR must read only the files that needed it');
    assert.equal(untouched.statementSummary?.deposits, 19441.82);
  });

  await reporter.check('turning OCR off is still the stored default', async () => {
    const settings = await scanner.readSettings();
    assert.equal(settings?.mode ?? 'regular', 'regular', 'an automatic OCR pass must not change the scan mode');
  });

  await reporter.check('the manual "Run OCR on flagged" control is disabled once nothing needs it', async () => {
    await scanner.page.evaluate(() => document.querySelector('details.more-menu')?.setAttribute('open', 'open'));
    const button = scanner.page.getByRole('button', { name: /run ocr on flagged/i });
    await assert.doesNotReject(button.waitFor({ state: 'visible' }));
    assert.equal(await button.isDisabled(), true, 'nothing should be left needing OCR after the automatic pass');
  });

  await reporter.check('nothing reached the network and no page error was raised', async () => {
    assert.deepEqual(scanner.externalAttempts, []);
    assert.deepEqual(scanner.pageErrors, []);
  });
} finally {
  await scanner.close();
}

reporter.done();
