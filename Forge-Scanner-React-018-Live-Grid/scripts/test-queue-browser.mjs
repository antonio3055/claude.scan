/**
 * Real queue-failure test, in headless Chromium, offline.
 *
 * A batch is uploaded through the real file input with bad files deliberately
 * placed between good ones. The test proves the good file before each bad one
 * completes, the bad ones fail on their own, and the good file after them still
 * completes — the queue is never stopped by a failure.
 */

import assert from 'node:assert/strict';
import { createReporter } from './lib/report.mjs';
import { launchScanner } from './lib/browser-harness.mjs';
import { buildCorruptedPdf, buildNonPdfBytes, buildTextPdf, buildTruncatedPdf } from './lib/fixtures.mjs';

const reporter = createReporter('Queue failure tests');

const goodPdf = (bank, account, deposits) =>
  buildTextPdf([
    bank,
    'Account Statement',
    `Account Number: ${account}`,
    'Statement Period: 01/01/2026 - 01/31/2026',
    'Beginning Balance 10,000.00',
    `Total Deposits ${deposits}`,
    'Ending Balance 25,000.00'
  ]);

// Order matters: good, bad, good, bad, good.
const BATCH = [
  { name: '1-good-before.pdf', bytes: goodPdf('FIRST NATIONAL BANK', '1111111111', '40,000.00') },
  { name: '2-corrupted.pdf', bytes: buildCorruptedPdf() },
  { name: '3-good-middle.pdf', bytes: goodPdf('SECOND NATIONAL BANK', '2222222222', '50,000.00') },
  { name: '4-truncated.pdf', bytes: buildTruncatedPdf() },
  { name: '5-not-a-pdf.pdf', bytes: buildNonPdfBytes() },
  { name: '6-good-after.pdf', bytes: goodPdf('THIRD NATIONAL BANK', '3333333333', '60,000.00') }
];

const scanner = await launchScanner();
const results = new Map();

try {
  await reporter.check('the scanner boots offline and accepts the whole batch', async () => {
    await scanner.open();
    await scanner.addFiles(BATCH);

    for (const file of BATCH) {
      results.set(file.name, await scanner.waitForDocument(file.name, 180_000));
    }
    assert.equal(results.size, BATCH.length, 'every file must reach a final state');
  });

  await reporter.check('the good file before the first bad file completed', async () => {
    const doc = results.get('1-good-before.pdf');
    assert.ok(['complete', 'needs_review'].includes(doc.processingStatus), `status was ${doc.processingStatus}`);
    assert.equal(doc.bankAccount?.accountNumber, '1111111111');
    assert.equal(doc.statementSummary?.deposits, 40000);
  });

  await reporter.check('the corrupted PDF failed on its own', async () => {
    const doc = results.get('2-corrupted.pdf');
    assert.equal(doc.processingStatus, 'failed', `status was ${doc.processingStatus}`);
    assert.ok(doc.processingErrorMessage, 'a failure must carry a reason');
  });

  await reporter.check('the corrupted PDF was retried once before being failed', async () => {
    const doc = results.get('2-corrupted.pdf');
    assert.equal(doc.attempts, 2, `attempts were ${doc.attempts}`);
  });

  await reporter.check('the good file between the bad files completed', async () => {
    const doc = results.get('3-good-middle.pdf');
    assert.ok(['complete', 'needs_review'].includes(doc.processingStatus), `status was ${doc.processingStatus}`);
    assert.equal(doc.bankAccount?.accountNumber, '2222222222');
    assert.equal(doc.statementSummary?.deposits, 50000);
  });

  await reporter.check('the truncated PDF failed and was recorded as structurally broken', async () => {
    const doc = results.get('4-truncated.pdf');
    assert.equal(doc.processingStatus, 'failed', `status was ${doc.processingStatus}`);
    assert.deepEqual(doc.pdfStructureWarnings, ['pdf_missing_eof', 'pdf_missing_startxref']);
  });

  await reporter.check('the file that is not a PDF was rejected without a wasted retry', async () => {
    const doc = results.get('5-not-a-pdf.pdf');
    assert.equal(doc.processingStatus, 'failed');
    assert.equal(doc.processingError, 'not_a_real_pdf_signature');
    assert.equal(doc.attempts, 1, 'a validation failure is terminal, so it must not consume a retry');
  });

  await reporter.check('the good file after every bad file still completed', async () => {
    const doc = results.get('6-good-after.pdf');
    assert.ok(['complete', 'needs_review'].includes(doc.processingStatus), `status was ${doc.processingStatus}`);
    assert.equal(doc.bankAccount?.accountNumber, '3333333333');
    assert.equal(doc.statementSummary?.deposits, 60000);
  });

  await reporter.check('exactly the three bad files failed, and no good file did', async () => {
    const failed = [...results.entries()]
      .filter(([, doc]) => doc.processingStatus === 'failed')
      .map(([name]) => name)
      .sort();
    assert.deepEqual(failed, ['2-corrupted.pdf', '4-truncated.pdf', '5-not-a-pdf.pdf']);
  });

  await reporter.check('the queue finished and the scanner returned to idle', async () => {
    await scanner.page.waitForFunction(
      () => !/Scanning|Paused/.test(document.querySelector('.scanner-panel-head span')?.textContent ?? ''),
      undefined,
      { timeout: 30_000 }
    );
    const stats = await scanner.waitForNoLiveWorker(10_000);
    assert.equal(stats.live, 0, 'no worker may be left running once the queue drains');
  });

  await reporter.check('the failures raised no page errors and touched no network', async () => {
    assert.deepEqual(scanner.pageErrors, [], `page errors: ${scanner.pageErrors.join(' | ')}`);
    assert.deepEqual(scanner.externalAttempts, [], `external requests: ${scanner.externalAttempts.join(', ')}`);
  });
} finally {
  await scanner.close();

  console.log('\nBatch outcome:');
  for (const file of BATCH) {
    const doc = results.get(file.name);
    const reason = doc?.processingError ? ` (${doc.processingError})` : '';
    console.log(`  ${file.name.padEnd(22)} ${doc?.processingStatus ?? 'never settled'}${reason}`);
  }
}

reporter.done();
