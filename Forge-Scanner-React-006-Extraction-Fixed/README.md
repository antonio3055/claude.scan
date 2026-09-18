# Forge Scanner React 005 — Offline Verified

Standalone React + Vite scanner module, prepared for direct use inside the CRM and later Electron packaging.

This build fixes the defects found in the audit of 004. The UI, the v10 extraction engine, the React structure, the queue behaviour and every approved feature are unchanged.

`Forge-Scanner-React-004-Offline-Hardened` is untouched and remains available for rollback.

---

## What is actually inside this package

This list matches the ZIP. Nothing here is aspirational.

| Path | Size | What it is |
|---|---|---|
| `src/` | 340 KB | Full React + TypeScript source, including the v10 extraction engine |
| `scripts/` | 130 KB | Every test, the audit, the batch runner and the vendor copier |
| `public/scanner-vendor/` | 29 MB | The local PDF.js and Tesseract assets, ready to use |
| `dist/` | 29 MB | The production build, including the same vendor assets |
| `npm-cache/` | 58 MB | A populated npm cache, so `npm ci` runs with no internet |
| `package.json`, `package-lock.json` | — | Exact pinned dependency set |
| `README.md`, `VERIFICATION.txt` | — | This file, and the exact test and build results |

Because the whole package is about 88 MB zipped, it is delivered as **four split parts**. Rejoin them first:

```bash
cat Forge-Scanner-React-005-Offline-Verified.zip.part* > Forge-Scanner-React-005-Offline-Verified.zip
unzip Forge-Scanner-React-005-Offline-Verified.zip
```

### Local PDF.js and Tesseract assets included

Both `public/scanner-vendor/` and `dist/scanner-vendor/` contain all nine files:

```
pdfjs/pdf.min.js                              320 KB
pdfjs/pdf.worker.min.js                       1.1 MB
tesseract/tesseract.min.js                     67 KB
tesseract/worker.min.js                       124 KB
tesseract/core/tesseract-core.wasm.js         4.7 MB
tesseract/core/tesseract-core-simd.wasm.js    4.7 MB
tesseract/core/tesseract-core-lstm.wasm.js    3.9 MB
tesseract/core/tesseract-core-simd-lstm.wasm.js 3.9 MB
tesseract/lang/eng.traineddata.gz            10.9 MB
```

Pinned to exact versions: `pdfjs-dist` 3.11.174, `tesseract.js` 5.1.1, `tesseract.js-core` 5.1.1, `@tesseract.js-data/eng` 1.0.0.

---

## Install / build / test

```bash
npm install          # also copies the vendor assets into public/scanner-vendor/
npm run build        # tsc --noEmit && vite build  ->  dist/
npm test             # production build, then every suite, one process per suite
npm run dev          # local dev server on :3000
```

### Fully offline install

```bash
npm ci --cache ./npm-cache --offline
```

Verified: 147 packages, no network.

### Individual suites

```bash
npm run audit              # structural / clean-code audit
npm run test:engine        # v10 extraction engine
npm run test:validation    # validation, corrupted PDFs, duplicates
npm run test:recovery      # queue recovery after an app restart
npm run test:queue         # queue isolation
npm run test:jobrunner     # timeouts, whole-file ceiling, cancel, retry
npm run test:vendorloader  # dead PDF.js / Tesseract load recovery
npm run test:offline       # real offline Chromium run (needs dist/)
npm run test:stop          # real Stop mid-scan in Chromium (needs dist/)
npm run test:queue-browser # real good/bad/good queue run in Chromium (needs dist/)
npm run test:suites        # all suites against the existing dist/, no rebuild
```

The three browser suites need a Chromium binary. `npx playwright install chromium` supplies one; if Chromium lives elsewhere, point `SCANNER_CHROMIUM_PATH` at the executable.

### Running your own batch

```bash
npm run batch -- /path/to/folder --json report.json
npm run batch -- /path/to/folder --mode ocr --json report-ocr.json
```

Walks the folder recursively, feeds every PDF/PNG/JPG through the real UI offline, and reports accepted / scanned / completed / failed / needs review / average extraction score / timeouts / OCR count / runtime, plus every failed file and its reason. Nothing is corrected or filled in.

---

## What was fixed in 005

### 1. The whole-file timeout is now real

`SCAN_TIMEOUTS.jobMs` was declared in 004 and **used nowhere** — there was no whole-file ceiling at all.

Now `runJobWithRetry` wraps each attempt in the watchdog at `jobMs` (420 s). Each attempt gets its own cancellation token, created as a child of the run-level Stop token. When the ceiling fires it cancels that token, which tears down whichever PDF or OCR stage is running inside the attempt. The file is then failed, retried once, and the queue continues — including when the stage ignores cancellation entirely.

### 2. A dead loader is never reused

In 004, `pdfPromise.catch(...)` cleared the cached loader only when the promise **rejected**. A `<script>` that fires neither `load` nor `error` leaves the promise pending forever, so the retry — and every later file — awaited a corpse.

`vendorLoader.js` now owns one loader slot per library. A load that rejects, times out or is cancelled clears the slot and runs its cleanup (removing the partial `<script>` tag), so the next attempt starts a completely fresh load. The same rule covers the Tesseract worker: a worker that never finished starting is terminated and never awaited again. `resetScannerWorkers()` drops both library slots as well — free when the library already loaded, and the thing that rescues the queue when a load itself hung.

### 3. The offline dependencies are in the package

004's ZIP was source only: the README described an npm cache and vendor assets that were not in it. This package ships the cache, the vendor assets and the built `dist/`, and the table at the top of this file is the actual manifest.

---

## Reliability model

One place owns each rule.

**`src/scanner/services/scannerConfig.js`** — the single timeout and retry policy.

| Stage | Limit |
|---|---|
| Local vendor script load | 30 s |
| PDF open | 45 s |
| PDF page text | 25 s |
| PDF page render (OCR) | 45 s |
| OCR worker start | 120 s |
| OCR page / image | 120 s |
| **Whole file, any stage** | **420 s — enforced** |

`MAX_JOB_ATTEMPTS = 2` — the first attempt plus one automatic retry.

**`src/scanner/services/jobRunner.js`** — the authoritative runner: per-stage watchdog, per-attempt cancellation tokens, the whole-file ceiling, one retry, and strict queue isolation.

**`src/scanner/services/vendorLoader.js`** — load-once slots with dead-load recovery.

**`src/scanner/services/offlineVendor.ts`** — the only module that touches PDF.js or Tesseract. Every stage registers a real abort: PDF loading tasks are destroyed, the OCR worker is terminated.

**`src/scanner/services/fileValidation.js`** — size, type, PDF signature, PDF structure, hashing, duplicate matching. No DOM, so the Node suite runs the production code unmodified.

**`src/scanner/services/queueRecovery.js`** — restart safety for Electron and the browser.

### Behaviour on failure

1. The file times out or fails; its stage is aborted.
2. PDF.js and Tesseract are torn down, and their loader slots dropped.
3. The file is retried once.
4. If it fails again, **only that file** is marked `failed`, with the cause and attempt count.
5. The queue continues to the next file automatically.

### Controls

- **Pause** — holds between stages and between files; queued work is kept.
- **Resume** — lifts a pause only. After Stop it does nothing.
- **Stop** — cancels the in-flight stage, terminates every worker, ends the run. The active file is marked `stopped`, not `failed`.
- **Restart** — re-queues `stopped` files.
- **Retry failed** — re-queues `failed` files. Separate from Restart.

---

## Integration

```tsx
import { ScannerPage } from './scanner';

<ScannerPage
  reps={realCrmReps}
  onSendLeads={async (assignments, leads) => {
    // Connect this to the real CRM backend/API.
  }}
/>
```

Copy `src/scanner/` into the target React/Vite CRM. The scanner does not include the old CRM sidebar, lead panels, communications UI, branding or navigation shell.

## Electron

The renderer module is Electron-safe: PDF and OCR dependencies are local build assets loaded relative to `document.baseURI`, and `vite.config.ts` uses `base: './'`. Serve the packaged `dist/` through a local file or custom app protocol. Keep Node integration disabled in the renderer.

Playwright is a **devDependency** and is not part of the Electron production package.

---

## Current scanner rules

- Fixed wide mobile viewport: 1200px, `user-scalable=yes`.
- Regular scan is default; OCR is OFF by default.
- Regular scan default: 3 pages. OCR default: 1 page.
- A failed file is isolated and never stops the rest of the queue.
- First lead column is row number only; no selection checkbox column.
- Leads auto-sort by highest extracted revenue.
- Extraction score is displayed to the left of the row-number divider.
- File names are not displayed in lead rows. Documents show `APP`, a three-letter month, `MTD`, or `DOC`.
- Audit area is closed by default.
- Secondary scanner/routing controls are hidden in menus or closed sections.
- All three CRM panels are resizeable and widths are remembered locally.
- Routing supports odd/even split, round robin, revenue threshold and send-all. Unknown natural-language instructions are **not faked**.
- Sending leads is **not faked**. Nothing is sent unless the host CRM supplies `onSendLeads`.

---

## Honest limits

See `VERIFICATION.txt` for the exact test, build and batch numbers, including what the real document batch revealed about extraction quality.

- Transaction-level parsing is still generic and can be tuned further against real statements.
- Real CRM lead sending requires the host `onSendLeads` callback; freeform routing requires `routingInterpreter`. Neither is simulated.
- Electron packaging itself was not built or run here.
- The browser suites serve `dist/` over a local app origin (`http://scanner.localhost`), standing in for Electron's local app protocol. Chromium blocks Web Workers on `file://`, so a `file://` origin cannot be used. No server is started and no network request is made: every response is served from disk with the browser context offline.
