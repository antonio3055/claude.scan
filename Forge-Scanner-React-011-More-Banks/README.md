# Forge Scanner React 011 — More Banks

Standalone React + Vite scanner module, prepared for direct use inside the CRM and later Electron packaging.

Five defects found by running a second, unseen batch of 60 real documents through the scanner. OCR is still off and still manual, as in 010.

`Forge-Scanner-React-010-Manual-OCR` is untouched and remains available for rollback, as are 004 to 009.

## What the second batch found

A 60-document batch from twelve companies, none of it seen before, read against
the banks' own printed arithmetic. Statements reconciling went from **27 of 48
to 39 of 48**, with no mismatches, and the first batch is unchanged at 47 of 48.

| defect, on real documents | effect |
|---|---|
| An account number in the first column of a Wells Fargo table was read as the opening balance | the table never balanced |
| A Comerica summary set beside a column of addresses read the branch telephone number, PO box and postcode as amounts | the block never balanced |
| A label and its figure separated by a row of that address column were never paired | the closing balance was never found |
| A figure printed *above* its own label was never paired | Access FCU's checking block was never read |
| A Chase PDF whose text layer holds only structural markers was not reported as needing OCR | it was read as an empty statement instead |

The fix for the first two is one rule: **banks punctuate money and leave
identifiers bare**, so a figure counts only when it carries a decimal point, a
thousands separator or a currency mark. Where the figures alone cannot say
which column is which — credits and debits equal and opposite — the header now
says: "Account number Beginning balance Total credits Total debits Ending
balance".



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
cat Forge-Scanner-React-011-More-Banks.zip.part* > Forge-Scanner-React-011-More-Banks.zip
unzip Forge-Scanner-React-011-More-Banks.zip
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
npm run test:balance       # statement balance equation
npm run test:manual-ocr    # OCR stays off until it is asked for (needs dist/)
npm run test:queue         # queue isolation and reading several files at once
npm run test:extraction    # document classification and business-name recovery
npm run test:transactions  # transaction row parsing
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

## How OCR works in 010

OCR is off. Nothing turns it on by itself.

1. A **regular scan** reads the text layer. A file with no usable text layer is
   a scan of paper, so the scan says so — it reports the file as needing OCR
   and moves on. It does not read it, and it does not fail it.
2. The menu then offers **Run OCR on flagged**, with the count beside it. That
   control reads exactly those files and nothing else.
3. Once a file has been read, its flag clears and it is not offered again.

The scan mode is untouched by all of this: it stays on Regular. Setting the
mode to OCR by hand still reads every file with OCR, as it always did.

An image file (PNG, JPG) has no text layer at all, so it is now reported as
needing OCR rather than failed. Previously it failed with
`ocr_required_for_image`; the file was never the problem, it just has to be
read a different way.

### What that does to the time, on the 61-document batch

| | 009 | 010 |
|---|---|---|
| Regular scan | 27.2 s (OCR ran inside it) | **15.1 s** |
| Run OCR on the 6 flagged files | — | 15.1 s |
| Both, when you choose to run OCR | 27.2 s | 30.3 s |
| OCR mode, every file | 91.1 s | 91.1 s |

The regular scan is **1.8x faster** because the OCR is no longer hidden inside
it. Running both costs a little more than 009 did, because the flagged files go
round the queue a second time — that is the price of not deciding for you.

### The figures are unchanged

The whole flow — regular scan, then Run OCR on flagged — was compared against
009's automatic run, document by document, on 22 fields each plus the full list
of confidence reasons:

  009 automatic OCR  vs  010 regular + Run OCR : 61 documents, **0 differences**
  009 OCR mode       vs  010 OCR mode          : 61 documents, **0 differences**

Exactly the same six files are flagged as the ones 009 read automatically.

---

## What was faster in 009

Measured on the supplied 61-document batch, on a four-core machine, against 008:

| | 008 | 009 |
|---|---|---|
| Regular scan | 62.6 s | **27.2 s** |
| OCR scan | 220.5 s | **91.1 s** |
| Extracted figures | — | **identical, 0 differences** |

### One PDF.js worker for the whole queue

PDF.js starts a worker per document by default, and starting one costs more
than reading a statement does. Over the batch that was **15.0 s of worker
startup against 2.3 s of actual work**. The worker is now owned by the scanner
and reused; the text it produces is byte-identical.

Stop still destroys it. A file that fails only marks it, and it is replaced at
the next moment no file is using it — other lanes may still be reading.

### Several files read at once

OCR is the whole cost of a scan — 195 s of a 206 s OCR run — and it is pure CPU
inside a worker, so lanes turn cores into speed. Measured on the same pages:

| lanes | 1 | 2 | 3 | 4 |
|---|---|---|---|---|
| OCR time | 24.3 s | 14.8 s | 10.0 s | 8.8 s |
| text | reference | identical | identical | identical |

`scanLaneCount` leaves one core for the interface and caps at four, because
each lane holds its own Tesseract worker with its own copy of the WASM core and
language data. At one lane it is exactly the sequential queue it always was —
the same loop, not a second implementation beside it.

Each lane owns its OCR worker, so a file that fails or times out terminates the
worker in **its own lane** and leaves the others running. Files are claimed
synchronously as a lane takes them, so no two lanes ever read the same file.

### An OCR scan no longer reads a text layer it throws away

In OCR mode the page images replace the text layer, so reading it first was
work for nothing. The document is still opened, because OCR renders its pages.

### The engines are released when the queue goes idle

They are kept warm for the length of a run, which is where the saving is.
Holding a PDF worker and a Tesseract worker per lane while the scanner sits
idle would cost memory for nothing.

### What was measured and rejected

Not every idea survived contact with the documents. These were tried, measured
and thrown away rather than shipped:

- **Rendering OCR pages smaller.** At scale 1.5 the run is 19% faster and the
  figures go wrong — one statement's deposits read as 0 and three stopped
  reconciling. At 1.25 the business names turn to noise. The shipped scale of 2
  is the lowest that keeps the numbers right.
- **Tesseract page-segmentation and invert settings.** No measurable change
  (24.1–24.6 s across every variant), and single-column mode broke three of the
  six documents. Left alone.

---

## What was fixed in 008

### The statement's own arithmetic is now read, and proved

Every bank statement prints the same equation in its summary:

```
beginning balance + credits - debits = ending balance
```

The engine used to guess which printed figures were credits and which were
debits from a list of category names, and never checked the result. On the
61-document batch that produced a summary that did not add up on **23 of the
24** documents where all four figures were found — silently, because nothing
tested it.

`src/scanner/engine/balanceEquation.js` replaces that guesswork. It reads the
signs the bank itself printed — on the number (`-3,405.57`), before it
(`- 469,487.69`), after it (`$22,888.95 +`), or in its own narrow column — and
where a sign is missing it solves for the one assignment that reproduces the
printed ending balance. **The arithmetic is the proof**: a reading is reported
as verified only when it closes to the cent.

Covered, each taken from a real statement in the batch and each under test:

- signs printed on, before or after the figure, or on a row of their own;
- an opening or closing balance that is overdrawn, signed on the row above;
- statistics printed inside the block (average balance, dividends to date);
- a posting date, a transaction count or an account name in front of the label;
- labels in one column and figures in another, split onto separate rows;
- column tables, with or without operators in the header;
- a statement covering several accounts — the busiest is the operating account;
- balances named after the statements (`LAST STATEMENT` / `THIS STATEMENT`).

Measured on the 61-document batch: **47 of the 48 bank statements** now
reconcile against their own printed summary, and every month-to-month chain in
the batch is continuous — each statement's closing balance is the next one's
opening balance, exactly.

The ten per-bank summary-block adapters this replaces are gone. What remains
beside it is genuinely different: online-banking activity printouts, which
print no balance equation to prove, OCR-specific recovery, and summing dated
deposit rows as a last resort.

### Reconciliation no longer depends on reading every page

The summary sits on page one. Reading three pages of a twelve-page statement
was reported as `reconciliation_not_possible`, which said nothing about the
document. The statement's own equation and the parsed transaction rows are now
two separate checks: the equation stands whatever was read, and the transaction
check is withheld — not failed — when the statement was only part-read.

Reported per document as `reconciliation.source`:
`statement_balance_equation` or `transactions`.

### A part-read statement reports the bank's total, not a share of the month

Revenue was taken from the parsed transaction rows whenever they produced a
figure, even when those rows covered three pages of a twelve-page month. It now
falls back to the bank's own deposit total in that case, and
`deposits.trueRevenueSource` says which was used.

### An application is no longer judged by bank-statement wording

`assessTextQuality` looked for phrases such as "beginning balance" in every
document. A funding application has none, so all 13 in the batch were marked
`no_statement_signal` and sent to review. Each document is now judged against
the wording of its own kind.

### A statement that adds up is trusted whatever wording it uses

Some banks set the summary in two columns, so "beginning" and "balance" never
land next to each other and the phrase gate failed. A proven balance equation
is now itself the evidence that the text was read correctly.

### Smaller fixes

- `deposits.totalDeposits` read a key that did not exist and was `undefined`
  whenever the bank printed no summary; it now falls back to the parsed gross.
- A money figure written `$2,000.00` was discarded as a year. Only an
  unpunctuated four-digit number is read as one.
- `coreUtils.labeledMoney` had no callers left and was removed.

---

## Reliability model

One place owns each rule.

**`src/scanner/engine/balanceEquation.js`** — the single reader of a statement's summary block or table, and the only place that decides whether its arithmetic holds.

**`src/scanner/engine/reconciliation.js`** — the single verdict on whether a statement reconciles, from the equation where one is proved and from the parsed rows otherwise.

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
- Regular scan is default; OCR is OFF by default and never starts on its own.
- A regular scan reports files with no text layer as needing OCR. They are read
  only when Run OCR on flagged is clicked, and only those files.
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
