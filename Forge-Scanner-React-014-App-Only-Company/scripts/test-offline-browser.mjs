/**
 * Real offline browser test.
 *
 * Loads the built `dist/` scanner in headless Chromium with the browser context
 * set offline and every request served from local disk. Nothing reaches the
 * network; a request to any origin other than the local app origin aborts and
 * fails the run.
 *
 * It drives the real UI — the real file input, the real queue, the real
 * `offlineVendor.ts` loaders — to prove that:
 *   - PDF.js parses a genuine PDF from local assets only
 *   - Tesseract OCRs a genuine image from local worker + WASM + language data
 */

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createReporter } from './lib/report.mjs';
import { APP_ORIGIN, DIST, launchScanner } from './lib/browser-harness.mjs';
import { buildTextPdf } from './lib/fixtures.mjs';

const reporter = createReporter('Offline browser tests');

/** Rendered into a real PNG, then read back out of it by Tesseract. */
const OCR_LINES = [
  'Account Statement',
  'Account Number: 1234567890',
  'Beginning Balance 12,500.00',
  'Total Deposits 48,250.00',
  'Ending Balance 39,710.00'
];

const scanner = await launchScanner();

try {
  await reporter.check('the built scanner boots offline with no network access', async () => {
    await scanner.open();
    assert.deepEqual(scanner.pageErrors, [], `page errors: ${scanner.pageErrors.join(' | ')}`);
  });

  await reporter.check('the v10 extraction engine initialised in the built bundle', async () => {
    const ready = await scanner.page.evaluate(() => Boolean(globalThis.ScannerEngine?.pipeline?.processDocument));
    assert.equal(ready, true);
  });

  await reporter.check('a real PDF is parsed using only local PDF.js assets', async () => {
    const pdf = buildTextPdf([
      'FIRST NATIONAL BANK',
      'ACCOUNT HOLDER: NORTHWIND TRADING LLC',
      'Account Number: 1234567890',
      'Statement Period: 01/01/2026 - 01/31/2026',
      'Beginning Balance 12,500.00',
      'Total Deposits 125,430.00',
      'Total Withdrawals 98,220.00',
      'Ending Balance 39,710.00'
    ]);

    await scanner.addFiles([{ name: 'northwind-january.pdf', bytes: pdf }]);

    const doc = await scanner.waitForDocument('northwind-january.pdf', 90_000);
    assert.notEqual(doc.processingStatus, 'failed', `PDF failed offline: ${doc.processingErrorMessage}`);
    assert.equal(doc.pageCount, 1);
    assert.equal(doc.usedOcr, false);
    assert.equal(doc.attempts, 1, 'a healthy PDF must succeed on the first attempt');

    const pdfRequests = scanner.requested.filter((url) => url.includes('scanner-vendor/pdfjs/'));
    assert.ok(pdfRequests.some((url) => url.endsWith('pdf.min.js')), 'PDF.js must load from the local vendor folder');
    assert.ok(
      pdfRequests.some((url) => url.endsWith('pdf.worker.min.js')),
      'the PDF.js worker must load from the local vendor folder'
    );
  });

  await reporter.check('the parsed PDF text reached the v10 extraction engine', async () => {
    const doc = await scanner.findDocument('northwind-january.pdf');
    assert.equal(doc.bankAccount?.accountNumber, '1234567890');
    assert.ok(doc.docType, 'the document must be classified');
  });

  await reporter.check('a real image is OCRed using only local Tesseract worker, WASM and language data', async () => {
    await scanner.setScanMode('ocr');

    const pngBase64 = await scanner.page.evaluate((lines) => {
      const canvas = document.createElement('canvas');
      canvas.width = 1100;
      canvas.height = 120 + lines.length * 90;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#000000';
      ctx.font = 'bold 56px monospace';
      ctx.textBaseline = 'top';
      lines.forEach((line, index) => ctx.fillText(line, 50, 60 + index * 90));
      return canvas.toDataURL('image/png').split(',')[1];
    }, OCR_LINES);

    await scanner.addFiles([
      { name: 'deposit-slip.png', mimeType: 'image/png', bytes: Buffer.from(pngBase64, 'base64') }
    ]);

    const doc = await scanner.waitForDocument('deposit-slip.png', 240_000);
    assert.notEqual(doc.processingStatus, 'failed', `OCR failed offline: ${doc.processingErrorMessage}`);
    assert.equal(doc.usedOcr, true, 'the image must have gone through OCR');
    assert.equal(doc.attempts, 1, 'a healthy image must succeed on the first attempt');

    const tesseractRequests = scanner.requested.filter((url) => url.includes('scanner-vendor/tesseract/'));
    assert.ok(tesseractRequests.some((url) => url.endsWith('tesseract.min.js')), 'local Tesseract library');
    assert.ok(tesseractRequests.some((url) => url.endsWith('worker.min.js')), 'local Tesseract worker');
    assert.ok(tesseractRequests.some((url) => url.includes('/core/')), 'local Tesseract WASM core');
    assert.ok(tesseractRequests.some((url) => url.includes('eng.traineddata.gz')), 'local English language data');
  });

  await reporter.check('OCR read the image accurately enough for the v10 engine to extract fields', async () => {
    const doc = await scanner.findDocument('deposit-slip.png');
    assert.equal(doc.bankAccount?.accountNumber, '1234567890', 'OCR must recover the account number');
    assert.equal(doc.statementSummary?.beginning, 12500);
    assert.equal(doc.statementSummary?.deposits, 48250);
    assert.equal(doc.statementSummary?.ending, 39710);
  });

  await reporter.check('no request attempted any remote http:// or https:// origin', async () => {
    assert.deepEqual(
      scanner.externalAttempts,
      [],
      `blocked external requests: ${scanner.externalAttempts.join(', ')}`
    );
  });

  await reporter.check('every asset the runtime asked for exists in dist/', async () => {
    assert.deepEqual(scanner.missing, [], `missing local assets: ${scanner.missing.join(', ')}`);
  });

  await reporter.check('the offline assets are actually shipped inside dist/', async () => {
    const required = [
      'scanner-vendor/pdfjs/pdf.min.js',
      'scanner-vendor/pdfjs/pdf.worker.min.js',
      'scanner-vendor/tesseract/tesseract.min.js',
      'scanner-vendor/tesseract/worker.min.js',
      'scanner-vendor/tesseract/core/tesseract-core.wasm.js',
      'scanner-vendor/tesseract/core/tesseract-core-simd.wasm.js',
      'scanner-vendor/tesseract/core/tesseract-core-lstm.wasm.js',
      'scanner-vendor/tesseract/core/tesseract-core-simd-lstm.wasm.js',
      'scanner-vendor/tesseract/lang/eng.traineddata.gz'
    ];
    for (const relative of required) {
      const bytes = await readFile(path.join(DIST, relative)).catch(() => null);
      assert.ok(bytes && bytes.length > 0, `missing or empty in dist/: ${relative}`);
    }
  });

  await reporter.check('nothing in the built output points at a remote origin', async () => {
    const html = await readFile(path.join(DIST, 'index.html'), 'utf8');
    assert.ok(!/https?:\/\//i.test(html), 'index.html must not reference a remote URL');

    const remoteUrls = scanner.requested.filter((url) => !url.startsWith(`${APP_ORIGIN}/`));
    assert.deepEqual(remoteUrls, [], `remote URLs requested at runtime: ${remoteUrls.join(', ')}`);

    // React's production build embeds documentation links in its error text.
    // Those are never fetched, so the bundle scan targets asset delivery:
    // any CDN host, and any remote URL pointing at a loadable scanner asset.
    const cdnHosts = /cdnjs|jsdelivr|unpkg|cdn\.|tessdata|raw\.githubusercontent|googleapis/i;
    const remoteAsset = /https?:\/\/[^"'`\s]+\.(js|mjs|wasm|gz|traineddata)\b/i;
    const bundles = (await readdir(path.join(DIST, 'assets'))).filter((name) => name.endsWith('.js'));
    for (const name of bundles) {
      const code = await readFile(path.join(DIST, 'assets', name), 'utf8');
      assert.ok(!cdnHosts.test(code), `CDN host referenced in ${name}`);
      const assetHit = code.match(remoteAsset);
      assert.equal(assetHit, null, `remote asset URL in ${name}: ${assetHit?.[0]}`);
    }
  });

  await reporter.check('the browser reported no runtime errors during the offline run', async () => {
    const realErrors = scanner.consoleErrors.filter((text) => !/favicon/i.test(text));
    assert.deepEqual(scanner.pageErrors, [], `page errors: ${scanner.pageErrors.join(' | ')}`);
    assert.deepEqual(realErrors, [], `console errors: ${realErrors.join(' | ')}`);
  });
} finally {
  await scanner.close();

  console.log(`\nRuntime requests observed: ${scanner.requested.length}`);
  console.log(`Remote origins attempted:  ${scanner.externalAttempts.length}`);
  console.log(`Browser context offline:   yes`);
  console.log(`App origin:                ${APP_ORIGIN} (served from dist/ by the test, no server, no network)`);
}

reporter.done();
