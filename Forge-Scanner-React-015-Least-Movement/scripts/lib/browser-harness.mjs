/**
 * Shared headless-Chromium harness for the browser suites.
 *
 * The browser context is set offline and every request is served from the
 * built `dist/` by Playwright, so no server runs and nothing reaches the
 * network. Any request to an origin other than the local app origin is
 * recorded and aborted.
 *
 * One implementation, used by the offline, stop and queue-failure suites.
 */

import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const DIST = path.join(root, 'dist');
export const APP_ORIGIN = 'http://scanner.localhost';
export const DB_NAME = 'forge_scanner_react_v2';

export const SETTLED = ['complete', 'needs_review', 'failed', 'stopped'];

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

export function requireDist() {
  if (existsSync(path.join(DIST, 'index.html'))) return;
  console.error('FAIL dist/index.html is missing. Run `npm run build` first.');
  process.exit(1);
}

function resolveChromium() {
  const candidates = [process.env.SCANNER_CHROMIUM_PATH, '/opt/pw-browsers/chromium'].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

export async function launchScanner() {
  requireDist();

  const requested = [];
  const externalAttempts = [];
  const missing = [];
  const consoleErrors = [];
  const pageErrors = [];

  const executablePath = resolveChromium();
  const browser = await chromium.launch({
    args: ['--no-sandbox'],
    ...(executablePath ? { executablePath } : {})
  });

  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  // Hard offline for the whole run.
  await context.setOffline(true);

  // Count every Web Worker the page creates and terminates. PDF.js and
  // Tesseract both go through `new Worker(...)`, so this is real evidence about
  // whether a worker is left running after Stop.
  await context.addInitScript(() => {
    const stats = { created: 0, terminated: 0 };
    window.__workerStats = stats;
    const NativeWorker = window.Worker;
    window.Worker = class TrackedWorker extends NativeWorker {
      constructor(...args) {
        super(...args);
        stats.created += 1;
      }
      terminate() {
        stats.terminated += 1;
        return super.terminate();
      }
    };
  });

  await context.route('**/*', async (route) => {
    const url = route.request().url();
    requested.push(url);

    if (!url.startsWith(`${APP_ORIGIN}/`)) {
      externalAttempts.push(url);
      await route.abort('blockedbyclient');
      return;
    }

    const relative = decodeURIComponent(new URL(url).pathname).replace(/^\/+/, '') || 'index.html';
    const filePath = path.join(DIST, relative);
    if (!filePath.startsWith(DIST) || !existsSync(filePath) || !(await stat(filePath)).isFile()) {
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

  /** Read the scanner's own IndexedDB records: the persisted truth. */
  const readDocuments = () =>
    page.evaluate(
      (dbName) =>
        new Promise((resolve, reject) => {
          const open = indexedDB.open(dbName);
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const db = open.result;
            const store = db.transaction('documents', 'readonly').objectStore('documents');
            const request = store.getAll();
            request.onsuccess = () => {
              db.close();
              resolve(request.result);
            };
            request.onerror = () => reject(request.error);
          };
        }),
      DB_NAME
    );

  const findDocument = async (filename) => (await readDocuments()).find((doc) => doc.filename === filename) ?? null;

  const waitForDocument = async (filename, timeoutMs) => {
    const deadline = Date.now() + timeoutMs;
    let last = null;
    while (Date.now() < deadline) {
      last = (await findDocument(filename)) ?? last;
      if (last && SETTLED.includes(last.processingStatus)) return last;
      await page.waitForTimeout(200);
    }
    throw new Error(`${filename} did not settle within ${timeoutMs}ms (last status: ${last?.processingStatus ?? 'none'})`);
  };

  /** Wait until a document reaches a stage that means real work is happening. */
  const waitForActive = async (filename, timeoutMs) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const doc = await findDocument(filename);
      if (doc && ['extracting', 'ocr'].includes(doc.processingStatus)) return doc;
      if (doc && SETTLED.includes(doc.processingStatus)) {
        throw new Error(`${filename} finished (${doc.processingStatus}) before it could be interrupted`);
      }
      await page.waitForTimeout(50);
    }
    throw new Error(`${filename} never started processing within ${timeoutMs}ms`);
  };

  /** The settings the scanner actually persisted, not what the DOM shows. */
  const readSettings = () =>
    page.evaluate(
      (dbName) =>
        new Promise((resolve, reject) => {
          const open = indexedDB.open(dbName);
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const db = open.result;
            const request = db.transaction('settings', 'readonly').objectStore('settings').get('scanner');
            request.onsuccess = () => {
              db.close();
              resolve(request.result?.value ?? null);
            };
            request.onerror = () => reject(request.error);
          };
        }),
      DB_NAME
    );

  return {
    browser,
    context,
    page,
    readSettings,
    requested,
    externalAttempts,
    missing,
    consoleErrors,
    pageErrors,
    readDocuments,
    findDocument,
    waitForDocument,
    waitForActive,

    async open() {
      await page.goto(`${APP_ORIGIN}/index.html`, { waitUntil: 'load' });
      await page.waitForSelector('.forge-scanner', { timeout: 20_000 });
      await page.waitForSelector('input[type=file]', { state: 'attached' });
    },

    /** Drive the approved UI's own scan-mode control. */
    async setScanMode(mode) {
      await page.evaluate(() => document.querySelector('details.more-menu')?.setAttribute('open', 'open'));
      await page.selectOption('.scan-settings select', mode);
      await page.waitForFunction(
        (expected) => document.querySelector('.scan-settings select')?.value === expected,
        mode
      );
    },

    async setRegularPages(count) {
      await page.evaluate(() => document.querySelector('details.more-menu')?.setAttribute('open', 'open'));
      const input = page.locator('.scan-settings input[type=number]').nth(0);
      await input.fill(String(count));
      await input.dispatchEvent('change');
    },

    async setOcrPages(count) {
      await page.evaluate(() => document.querySelector('details.more-menu')?.setAttribute('open', 'open'));
      const input = page.locator('.scan-settings input[type=number]').nth(1);
      await input.fill(String(count));
      await input.dispatchEvent('change');
    },

    /** Upload through the real hidden file input the upload zone uses. */
    async addFiles(files) {
      await page.setInputFiles(
        'input[type=file]',
        files.map((file) => ({
          name: file.name,
          mimeType: file.mimeType ?? 'application/pdf',
          buffer: Buffer.from(file.bytes)
        }))
      );
    },

    /** Click Stop in the real menu, exactly as a user would. */
    async clickStop() {
      await page.evaluate(() => document.querySelector('details.more-menu')?.setAttribute('open', 'open'));
      await page.getByRole('button', { name: /stop scan/i }).click();
    },

    /** Click "Run OCR on flagged" in the real menu, exactly as a user would. */
    async clickRunOcr() {
      await page.evaluate(() => document.querySelector('details.more-menu')?.setAttribute('open', 'open'));
      await page.getByRole('button', { name: /run ocr on flagged/i }).click();
    },

    async clickRestart() {
      await page.evaluate(() => document.querySelector('details.more-menu')?.setAttribute('open', 'open'));
      await page.getByRole('button', { name: /restart stopped/i }).click();
    },

    /** Workers created vs terminated. `live` > 0 means a worker is still running. */
    async workerStats() {
      const stats = await page.evaluate(() => ({ ...window.__workerStats }));
      return { ...stats, live: stats.created - stats.terminated };
    },

    /** Block until every PDF/OCR worker has been terminated. */
    async waitForNoLiveWorker(timeoutMs) {
      const deadline = Date.now() + timeoutMs;
      let stats = null;
      while (Date.now() < deadline) {
        stats = await page.evaluate(() => ({ ...window.__workerStats }));
        if (stats.created - stats.terminated === 0) return { ...stats, live: 0 };
        await page.waitForTimeout(100);
      }
      throw new Error(
        `a worker was still running after ${timeoutMs}ms ` +
          `(created ${stats?.created}, terminated ${stats?.terminated})`
      );
    },

    /** Block until the page has actually spun up a PDF/OCR worker. */
    async waitForLiveWorker(timeoutMs) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const stats = await page.evaluate(() => ({ ...window.__workerStats }));
        if (stats.created - stats.terminated > 0) return stats;
        await page.waitForTimeout(50);
      }
      throw new Error(`no worker was running within ${timeoutMs}ms`);
    },

    async close() {
      await context.close();
      await browser.close();
    }
  };
}
