/**
 * OCR after a regular scan — proved in a real browser.
 *
 * OCR is by far the slowest stage, so it no longer runs on its own: a
 * regular scan reads with its text layer first, same as always, and any
 * file left flagged `needsOcr` just waits there until "Run OCR" is clicked
 * by hand. A user who wants the old behaviour back can turn
 * "Auto-run OCR after scan" on in Options, which restores the single
 * automatic follow-up pass. Either way, an OCR pass itself never triggers
 * another one, so a file that fails OCR outright (still `needsOcr`, never
 * `usedOcr`) cannot loop forever. The manual control's own requeue/flag-
 * clearing mechanics are covered at the unit level in test-recovery.mjs and
 * structurally in audit.mjs; this suite is about the end-to-end behaviour
 * against the built app, offline.
 */

import assert from 'node:assert/strict';
import { createReporter } from './lib/report.mjs';
import { buildImageOnlyPdf, buildTextPdf } from './lib/fixtures.mjs';
import { launchScanner, SETTLED } from './lib/browser-harness.mjs';

const reporter = createReporter('OCR tests');

const READABLE = buildTextPdf([
  'Account Statement',
  'Beginning Balance $381.64',
  'Deposits and Additions 22 19,441.82',
  'Electronic Withdrawals 18 -18,477.08',
  'Ending Balance 57 $1,346.38'
]);
const SCANNED_A = buildImageOnlyPdf();
const SCANNED_B = buildImageOnlyPdf();

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
  throw new Error(`${filename} never reached a final post-OCR state within ${timeoutMs}ms (last: ${JSON.stringify(last)})`);
}

try {
  await scanner.open();

  await reporter.check('the scanner starts with OCR off and auto-continue off', async () => {
    const settings = await scanner.readSettings();
    assert.equal(settings?.mode ?? 'regular', 'regular');
    assert.equal(Boolean(settings?.autoContinueOcr), false);
  });

  // ---- Default (auto-continue off): a scanned file waits, unread, for a manual click ----

  await scanner.addFiles([
    { name: 'readable.pdf', bytes: READABLE },
    { name: 'scanned-a.pdf', bytes: SCANNED_A }
  ]);

  const readable = await scanner.waitForDocument('readable.pdf', 120_000);
  const flagged = await scanner.waitForDocument('scanned-a.pdf', 120_000);

  await reporter.check('a readable file is never flagged for OCR', async () => {
    assert.equal(Boolean(readable.needsOcr), false);
    assert.equal(Boolean(readable.usedOcr), false);
  });

  await reporter.check('the readable file was extracted normally', async () => {
    assert.equal(readable.statementSummary?.deposits, 19441.82);
    assert.equal(readable.reconciliation?.reconciles, true);
  });

  await reporter.check('by default, a scanned file is flagged but left unread -- no automatic OCR pass', async () => {
    assert.equal(Boolean(flagged.needsOcr), true, 'a scan of paper with no text layer should be flagged for OCR');
    assert.equal(Boolean(flagged.usedOcr), false, 'OCR must not have run on its own');
    assert.notEqual(flagged.processingStatus, 'failed');
  });

  await reporter.check('"Run OCR" is enabled with the flagged file counted', async () => {
    const button = scanner.page.getByRole('button', { name: /^run ocr\b/i });
    await assert.doesNotReject(button.waitFor({ state: 'visible' }));
    assert.equal(await button.isDisabled(), false);
    assert.equal((await button.textContent())?.includes('1'), true, `expected the flagged count to show 1, got: ${await button.textContent()}`);
  });

  await reporter.check('clicking "Run OCR" reads it by hand', async () => {
    await scanner.page.getByRole('button', { name: /^run ocr\b/i }).click();
    const settled = await waitForOcrSettled('scanned-a.pdf', 180_000);
    assert.equal(settled.usedOcr, true, 'the manual OCR pass should have read it');
    assert.equal(Boolean(settled.needsOcr), false, 'the needs-OCR flag should be cleared once OCR has run');
    assert.equal(settled.extractionMethod, 'ocr');
    assert.ok(
      (settled.stageLog ?? []).some((entry) => entry.stage === 'ocr_completed'),
      'the file never reached OCR'
    );
  });

  await reporter.check('the readable file was left alone by the manual OCR pass', async () => {
    const untouched = await scanner.findDocument('readable.pdf');
    assert.equal(Boolean(untouched.usedOcr), false, 'OCR must read only the file that needed it');
    assert.equal(untouched.statementSummary?.deposits, 19441.82);
  });

  await reporter.check('the manual "Run OCR" control is disabled once nothing needs it', async () => {
    const button = scanner.page.getByRole('button', { name: /^run ocr\b/i });
    await assert.doesNotReject(button.waitFor({ state: 'visible' }));
    assert.equal(await button.isDisabled(), true, 'nothing should be left needing OCR after the manual pass');
  });

  // ---- Opting back in: "Auto-run OCR after scan" on restores the old automatic follow-up ----

  await scanner.setAutoContinueOcr(true);
  await reporter.check('the auto-continue setting is really stored on', async () => {
    const settings = await scanner.readSettings();
    assert.equal(settings?.autoContinueOcr, true);
  });

  await scanner.addFiles([{ name: 'scanned-b.pdf', bytes: SCANNED_B }]);
  const autoRead = await waitForOcrSettled('scanned-b.pdf', 180_000);

  await reporter.check('with auto-continue on, a scanned file is read automatically, no click needed', async () => {
    assert.equal(autoRead.usedOcr, true);
    assert.equal(Boolean(autoRead.needsOcr), false);
    assert.equal(autoRead.extractionMethod, 'ocr');
  });

  await reporter.check('turning OCR mode itself off is still the stored default', async () => {
    const settings = await scanner.readSettings();
    assert.equal(settings?.mode ?? 'regular', 'regular', 'an automatic OCR pass must not change the scan mode');
  });

  await reporter.check('nothing reached the network and no page error was raised', async () => {
    assert.deepEqual(scanner.externalAttempts, []);
    assert.deepEqual(scanner.pageErrors, []);
  });
} finally {
  await scanner.close();
}

reporter.done();
