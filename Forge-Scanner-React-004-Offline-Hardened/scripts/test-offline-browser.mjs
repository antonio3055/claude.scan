/**
 * Real offline browser test.
 *
 * Loads the built `dist/` scanner in headless Chromium with the browser
 * context set offline and every single request served from local disk by
 * Playwright. Nothing reaches the network. A request to any origin other
 * than the local app origin aborts and fails the run.
 *
 * It then drives the real UI — the real file input, the real queue, the real
 * `offlineVendor.ts` loaders — to prove that:
 *   - PDF.js parses a genuine PDF from local assets only
 *   - Tesseract OCRs a genuine image from local worker + WASM + language data
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createReporter } from './lib/report.mjs';
import { buildTextPdf } from './lib/fixtures.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const APP_ORIGIN = 'http://scanner.localhost';
/** Rendered into a real PNG, then read back out of it by Tesseract. */
const OCR_LINES = [
  'Account Statement',
  'Account Number: 1234567890',
  'Beginning Balance 12,500.00',
  'Total Deposits 48,250.00',
  'Ending Balance 39,710.00'
];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.gz': 'application/gzip',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.traineddata': 'application/octet-stream'
};

const reporter = createReporter('Offline browser tests');

if (!existsSync(path.join(dist, 'index.html'))) {
  console.error('FAIL dist/index.html is missing. Run `npm run build` first.');
  process.exit(1);
}

/** Every URL the page asked for, and every one that tried to leave the machine. */
const requested = [];
const externalAttempts = [];
const missing = [];
const consoleErrors = [];
const pageErrors = [];

function resolveChromium() {
  const candidates = [process.env.SCANNER_CHROMIUM_PATH, '/opt/pw-browsers/chromium'].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

const executablePath = resolveChromium();
const browser = await chromium.launch({
  args: ['--no-sandbox'],
  ...(executablePath ? { executablePath } : {})
});

const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
// Hard offline: the network stack is unavailable for the whole run.
await context.setOffline(true);

await context.route('**/*', async (route) => {
  const url = route.request().url();
  requested.push(url);

  if (!url.startsWith(`${APP_ORIGIN}/`)) {
    externalAttempts.push(url);
    await route.abort('blockedbyclient');
    return;
  }

  const relative = decodeURIComponent(new URL(url).pathname).replace(/^\/+/, '') || 'index.html';
  const filePath = path.join(dist, relative);
  if (!filePath.startsWith(dist) || !existsSync(filePath) || !(await stat(filePath)).isFile()) {
    missing.push(relative);
    await route.fulfill({ status: 404, body: 'not found' });
    return;
  }

  await route.fulfill({
    status: 200,
    contentType: MIME[path.extname(filePath)] ?? 'application/octet-stream',
    body: await readFile(filePath)
  });
});

const page = await context.newPage();
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text());
});
page.on('pageerror', (error) => pageErrors.push(error.message));

/** Read the scanner's own IndexedDB records: the persisted result, not a DOM guess. */
const readDocuments = () =>
  page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('forge_scanner_react_v2');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const request = db.transaction('documents', 'readonly').objectStore('documents').getAll();
          request.onsuccess = () => {
            db.close();
            resolve(request.result);
          };
          request.onerror = () => reject(request.error);
        };
      })
  );

async function waitForDocument(filename, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    const docs = await readDocuments();
    last = docs.find((doc) => doc.filename === filename) ?? last;
    if (last && ['complete', 'needs_review', 'failed', 'stopped'].includes(last.processingStatus)) return last;
    await page.waitForTimeout(250);
  }
  throw new Error(`${filename} did not settle within ${timeoutMs}ms (last status: ${last?.processingStatus ?? 'none'})`);
}

try {
  await reporter.check('the built scanner boots offline with no network access', async () => {
    await page.goto(`${APP_ORIGIN}/index.html`, { waitUntil: 'load' });
    await page.waitForSelector('.forge-scanner', { timeout: 20_000 });
    await page.waitForSelector('input[type=file]', { state: 'attached' });
    assert.equal(pageErrors.length, 0, `page errors: ${pageErrors.join(' | ')}`);
  });

  await reporter.check('the v10 extraction engine initialised in the built bundle', async () => {
    const ready = await page.evaluate(() => Boolean(globalThis.ScannerEngine?.pipeline?.processDocument));
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

    await page.setInputFiles('input[type=file]', {
      name: 'northwind-january.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from(pdf)
    });

    const doc = await waitForDocument('northwind-january.pdf', 90_000);
    assert.notEqual(doc.processingStatus, 'failed', `PDF failed offline: ${doc.processingErrorMessage}`);
    assert.equal(doc.pageCount, 1);
    assert.equal(doc.usedOcr, false);
    assert.equal(doc.attempts, 1, 'a healthy PDF must succeed on the first attempt');

    const pdfWorkerRequests = requested.filter((url) => url.includes('scanner-vendor/pdfjs/'));
    assert.ok(
      pdfWorkerRequests.some((url) => url.endsWith('pdf.min.js')),
      'PDF.js must load from the local vendor folder'
    );
    assert.ok(
      pdfWorkerRequests.some((url) => url.endsWith('pdf.worker.min.js')),
      'the PDF.js worker must load from the local vendor folder'
    );
  });

  await reporter.check('the parsed PDF text reached the v10 extraction engine', async () => {
    const doc = await waitForDocument('northwind-january.pdf', 5_000);
    assert.equal(doc.bankAccount?.accountNumber, '1234567890');
    assert.ok(doc.docType, 'the document must be classified');
  });

  await reporter.check('a real image is OCRed using only local Tesseract worker, WASM and language data', async () => {
    // Switch the approved UI into OCR mode through its own controls.
    await page.evaluate(() => {
      document.querySelector('details.more-menu')?.setAttribute('open', 'open');
    });
    await page.selectOption('.scan-settings select', 'ocr');
    await page.waitForFunction(
      () => document.querySelector('.scan-settings select')?.value === 'ocr'
    );

    const pngBase64 = await page.evaluate((lines) => {
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

    await page.setInputFiles('input[type=file]', {
      name: 'deposit-slip.png',
      mimeType: 'image/png',
      buffer: Buffer.from(pngBase64, 'base64')
    });

    const doc = await waitForDocument('deposit-slip.png', 240_000);
    assert.notEqual(doc.processingStatus, 'failed', `OCR failed offline: ${doc.processingErrorMessage}`);
    assert.equal(doc.usedOcr, true, 'the image must have gone through OCR');
    assert.equal(doc.attempts, 1, 'a healthy image must succeed on the first attempt');

    const tesseractRequests = requested.filter((url) => url.includes('scanner-vendor/tesseract/'));
    assert.ok(tesseractRequests.some((url) => url.endsWith('tesseract.min.js')), 'local Tesseract library');
    assert.ok(tesseractRequests.some((url) => url.endsWith('worker.min.js')), 'local Tesseract worker');
    assert.ok(tesseractRequests.some((url) => url.includes('/core/')), 'local Tesseract WASM core');
    assert.ok(tesseractRequests.some((url) => url.includes('eng.traineddata.gz')), 'local English language data');
  });

  await reporter.check('OCR read the image accurately enough for the v10 engine to extract fields', async () => {
    const doc = await waitForDocument('deposit-slip.png', 5_000);
    assert.equal(doc.bankAccount?.accountNumber, '1234567890', 'OCR must recover the account number');
    assert.equal(doc.statementSummary?.beginning, 12500);
    assert.equal(doc.statementSummary?.deposits, 48250);
    assert.equal(doc.statementSummary?.ending, 39710);
  });

  await reporter.check('no request attempted any remote http:// or https:// origin', async () => {
    assert.deepEqual(externalAttempts, [], `blocked external requests: ${externalAttempts.join(', ')}`);
  });

  await reporter.check('every asset the runtime asked for exists in dist/', async () => {
    assert.deepEqual(missing, [], `missing local assets: ${missing.join(', ')}`);
  });

  await reporter.check('nothing in the built output points at a remote origin', async () => {
    const html = await readFile(path.join(dist, 'index.html'), 'utf8');
    assert.ok(!/https?:\/\//i.test(html), 'index.html must not reference a remote URL');

    const remoteUrls = requested.filter((url) => !url.startsWith(`${APP_ORIGIN}/`));
    assert.deepEqual(remoteUrls, [], `remote URLs requested at runtime: ${remoteUrls.join(', ')}`);

    // React's production build embeds documentation links in its error text.
    // Those are never fetched, so the bundle scan targets asset delivery:
    // any CDN host, and any remote URL pointing at a loadable scanner asset.
    const cdnHosts = /cdnjs|jsdelivr|unpkg|cdn\.|tessdata|raw\.githubusercontent|googleapis/i;
    const remoteAsset = /https?:\/\/[^"'`\s]+\.(js|mjs|wasm|gz|traineddata)\b/i;
    const bundles = (await readdir(path.join(dist, 'assets'))).filter((name) => name.endsWith('.js'));
    for (const name of bundles) {
      const code = await readFile(path.join(dist, 'assets', name), 'utf8');
      assert.ok(!cdnHosts.test(code), `CDN host referenced in ${name}`);
      const assetHit = code.match(remoteAsset);
      assert.equal(assetHit, null, `remote asset URL in ${name}: ${assetHit?.[0]}`);
    }
  });

  await reporter.check('the browser reported no runtime errors during the offline run', async () => {
    const realErrors = consoleErrors.filter((text) => !/favicon/i.test(text));
    assert.deepEqual(pageErrors, [], `page errors: ${pageErrors.join(' | ')}`);
    assert.deepEqual(realErrors, [], `console errors: ${realErrors.join(' | ')}`);
  });
} finally {
  await context.close();
  await browser.close();

  console.log(`\nRuntime requests observed: ${requested.length}`);
  console.log(`Remote origins attempted:  ${externalAttempts.length}`);
  console.log(`Browser context offline:   yes`);
  console.log(`App origin:                ${APP_ORIGIN} (served from dist/ by the test, no server, no network)`);
}

reporter.done();
