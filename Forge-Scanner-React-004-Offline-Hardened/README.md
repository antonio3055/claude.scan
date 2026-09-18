# Forge Scanner React 004 — Offline Hardened

Standalone React + Vite scanner module, prepared for direct use inside the CRM and later Electron packaging.

This build keeps the approved v003 scanner UI and the full **v10 extraction engine** unchanged, and hardens the runtime: every PDF and OCR stage is now offline-only, time-limited, cancellable and retried once, and one bad file can no longer stall or poison the queue.

Previous build `Forge-Scanner-React-003-20260914-V10Engine` is untouched and remains available for rollback.

---

## What changed from 003

| Area | 003 | 004 |
|---|---|---|
| Production build | **Broken** — 2 TypeScript errors, `dist/` was never produced | Green `tsc --noEmit` + `vite build` |
| Engine module loading | Dead CommonJS branch resolved `true` in the bundle and threw `require is not defined` at runtime | CommonJS branch removed; one global registry |
| Timeouts | none | Hard watchdog on every PDF and OCR stage |
| Stop | checked only between pages; in-flight work kept running | Cancels the active stage: PDF loading task destroyed, OCR worker terminated |
| Retry | manual only | One automatic retry per file, then a clean failure |
| Worker reset | OCR worker terminated on Stop only | PDF + OCR torn down after every failed attempt |
| Resume after Stop | silently restarted the scan | Only Restart resumes a stopped scan |
| Restart recovery | in-flight docs marked stopped in memory | Recovered **and persisted**, with a fresh attempt budget |
| Corrupted PDFs | 5-byte header check | Header + trailer/`%%EOF` structure check, and stable PDF.js error codes |
| Duplicates | matched on hash | Matched on hash **and** size |
| Tests | 48 (engine + isolation) | **174**, including a real offline headless-Chromium run |

The scanner UI, layout, fonts, colours, spacing, sorting, extraction score, audit section, routing instructions, stats strip and `APP` / `JAN` / `FEB` / `MTD` / `DOC` labels are unchanged.

---

## Install / build / test

```bash
npm install          # also copies PDF.js + Tesseract assets into public/scanner-vendor/
npm run build        # tsc --noEmit && vite build  ->  dist/
npm test             # production build, then every suite, strict, one process per suite
npm run dev          # local dev server on :3000
```

### Fully offline install

A populated npm cache ships in `npm-cache/` (58 MB). With it, installation needs no internet:

```bash
npm ci --cache ./npm-cache --offline
```

### Individual suites

```bash
npm run audit             # structural / clean-code audit
npm run test:engine       # v10 extraction engine
npm run test:validation   # validation, corrupted PDFs, duplicates
npm run test:recovery     # queue recovery after an app restart
npm run test:queue        # queue isolation
npm run test:jobrunner    # timeout, cancellation, retry, worker reset
npm run test:offline      # real headless-Chromium offline run (needs dist/)
npm run test:suites       # all suites against the existing dist/, without rebuilding
```

`npm run test:offline` needs a Chromium binary. On a normal machine `npx playwright install chromium` supplies it; if Chromium lives elsewhere, point `SCANNER_CHROMIUM_PATH` at the executable.

---

## Offline runtime

There is **no CDN and no runtime network access**. `npm install` and `npm run build` copy these from the pinned npm packages into `public/scanner-vendor/`, which Vite ships inside `dist/`:

- PDF.js library + worker
- Tesseract.js library + worker
- all four Tesseract v5 WASM cores (`tesseract-core`, `-simd`, `-lstm`, `-simd-lstm`)
- English `eng.traineddata.gz`

Pinned to exact versions: `pdfjs-dist` 3.11.174, `tesseract.js` 5.1.1, `tesseract.js-core` 5.1.1, `@tesseract.js-data/eng` 1.0.0.

`npm run test:offline` proves this end to end: the built `dist/` is loaded in headless Chromium with the browser context set **offline**, every request is served from local disk, a real PDF is parsed and a real image is OCRed, and any request to a non-local origin aborts and fails the run.

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
| Whole-file ceiling | 420 s |

`MAX_JOB_ATTEMPTS = 2` — the first attempt plus one automatic retry.

**`src/scanner/services/jobRunner.js`** — the authoritative runner:

- `withWatchdog` races every awaited stage against its timeout and the cancellation token, and calls that stage's `abort` exactly once when either fires.
- `createCancellation` gives Stop a real teardown hook rather than a flag checked between pages.
- `runJobWithRetry` resets the workers, then retries once — except for a user Stop and except for validation failures, which can only produce the same answer twice.
- `runScanQueue` drains the queue one file at a time and always continues to the next file.

**`src/scanner/services/offlineVendor.ts`** — the only module that touches PDF.js or Tesseract. Every stage registers a real abort: PDF loading tasks are destroyed, and the OCR worker is terminated (Tesseract's only true cancellation, which doubles as the clean reset the next file needs).

**`src/scanner/services/fileValidation.js`** — size, type, PDF signature, PDF structure, content hashing, duplicate matching. No DOM or PDF.js, so the Node suite runs the production implementation unmodified.

**`src/scanner/services/queueRecovery.js`** — restart safety. A document caught mid-scan by an Electron or browser restart comes back as `stopped` with a fresh attempt budget, and that state is written back to IndexedDB so a second restart cannot find a document stuck at `extracting`.

### Behaviour on failure

1. The file times out or fails; its stage is aborted.
2. PDF.js and Tesseract are torn down.
3. The file is retried once.
4. If it fails again, **only that file** is marked `failed`, with the cause and attempt count.
5. The queue continues to the next file automatically.

### Controls

- **Pause** — holds between stages and between files; queued work is kept.
- **Resume** — lifts a pause only. After Stop it does nothing, so a scan the user ended can never restart by itself.
- **Stop** — cancels the in-flight PDF/OCR stage, tears down both engines, and ends the run. The active file is marked `stopped`, not `failed`.
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

The renderer module is Electron-safe: its PDF and OCR dependencies are local build assets, loaded relative to `document.baseURI`, and `vite.config.ts` uses `base: './'` for relative asset paths. Serve the packaged `dist/` through a local file or custom app protocol. Keep Node integration disabled in the renderer; all file processing is browser-side.

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
- Routing supports odd/even split, round robin, revenue threshold and send-all. Unknown natural-language instructions are **not faked**; they require the optional CRM `routingInterpreter` callback.
- Sending leads is **not faked**. Nothing is sent unless the host CRM supplies `onSendLeads`.

---

## Honest limits

- Bank summary extraction uses the v10 bank/layout adapters. Transaction-level parsing is still generic and can be tuned further against real statements.
- Stop, Pause and Resume are verified against the production job runner in Node, and the offline PDF and OCR paths are verified in a real browser. Clicking Stop mid-scan in the real UI is not covered by an automated browser test, because the fixtures complete too fast to interrupt deterministically.
- Real CRM sending requires the host CRM callback/API.
- Freeform routing beyond the built-in deterministic patterns requires the optional host CRM interpreter callback.
- The offline browser test serves `dist/` over a local app origin (`http://scanner.localhost`), which stands in for Electron's local app protocol. Chromium blocks Web Workers on `file://`, so a `file://` origin cannot be used for this test. No server is started and no network request is made: every response is served from disk by the test harness with the browser context offline.
