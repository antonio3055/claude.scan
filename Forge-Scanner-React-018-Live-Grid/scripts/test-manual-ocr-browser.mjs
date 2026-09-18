/**
 * OCR is off, and stays off until it is asked for — proved in a real browser.
 *
 * A regular scan must never start OCR by itself. What it must do is say which
 * files need it, and the Run OCR control must then read exactly those files
 * and nothing else. Both halves are checked here against the built `dist/`,
 * offline, driving the real controls.
 */

import assert from 'node:assert/strict';
import { createReporter } from './lib/report.mjs';
import { buildImageOnlyPdf, buildTextPdf } from './lib/fixtures.mjs';
import { launchScanner } from './lib/browser-harness.mjs';

const reporter = createReporter('Manual OCR tests');

const READABLE = buildTextPdf([
  'Account Statement',
  'Beginning Balance $381.64',
  'Deposits and Additions 22 19,441.82',
  'Electronic Withdrawals 18 -18,477.08',
  'Ending Balance 57 $1,346.38'
]);
const SCANNED = buildImageOnlyPdf();

const scanner = await launchScanner();

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
  const scanned = await scanner.waitForDocument('scanned.pdf', 120_000);
  const afterScan = await scanner.workerStats();

  await reporter.check('a regular scan starts no OCR worker at all', async () => {
    // PDF.js uses one worker; Tesseract would be a second. Only one may exist.
    assert.ok(afterScan.created <= 1, `OCR ran on its own (${afterScan.created} workers created)`);
  });

  await reporter.check('the scanned file is reported as needing OCR, not read by it', async () => {
    assert.equal(scanned.needsOcr, true);
    assert.equal(Boolean(scanned.usedOcr), false);
    assert.equal(scanned.processingStatus, 'needs_review');
  });

  await reporter.check('the scanned file is not failed for having no text', async () => {
    assert.notEqual(scanned.processingStatus, 'failed');
    assert.equal(scanned.processingError ?? null, null);
  });

  await reporter.check('a readable file is never flagged for OCR', async () => {
    assert.equal(Boolean(readable.needsOcr), false);
    assert.equal(Boolean(readable.usedOcr), false);
  });

  await reporter.check('the readable file was still extracted normally', async () => {
    assert.equal(readable.statementSummary?.deposits, 19441.82);
    assert.equal(readable.reconciliation?.reconciles, true);
  });

  await scanner.clickRunOcr();

  const readAgain = await scanner.waitForDocument('scanned.pdf', 300_000);

  await reporter.check('the Run OCR control reads the flagged file', async () => {
    assert.equal(readAgain.usedOcr, true);
    assert.equal(readAgain.extractionMethod, 'ocr');
  });

  await reporter.check('the flag is cleared once the file has been read', async () => {
    assert.equal(Boolean(readAgain.needsOcr), false);
    assert.equal(Boolean(readAgain.forceOcr), false);
  });

  await reporter.check('OCR really did start, rather than being skipped', async () => {
    const stats = await scanner.workerStats();
    assert.ok(stats.created > afterScan.created, 'no new worker was started for OCR');
    assert.ok(
      (readAgain.stageLog ?? []).some((entry) => entry.stage === 'ocr_completed'),
      'the file never reached OCR'
    );
  });

  await reporter.check('the readable file was left alone by the OCR run', async () => {
    const untouched = await scanner.findDocument('readable.pdf');
    assert.equal(Boolean(untouched.usedOcr), false, 'OCR must read only the files it was asked to');
    assert.equal(untouched.statementSummary?.deposits, 19441.82);
  });

  await reporter.check('turning OCR off is still the stored default', async () => {
    const settings = await scanner.readSettings();
    assert.equal(settings?.mode ?? 'regular', 'regular', 'a manual OCR run must not change the scan mode');
  });

  await reporter.check('nothing reached the network and no page error was raised', async () => {
    assert.deepEqual(scanner.externalAttempts, []);
    assert.deepEqual(scanner.pageErrors, []);
  });
} finally {
  await scanner.close();
}

reporter.done();
