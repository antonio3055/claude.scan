# Forge Scanner React 018 — Live Grid

Standalone React + Vite scanner module, prepared for direct use inside the CRM and later Electron packaging.

`Forge-Scanner-React-017-Live-Grid` (a different attempt at this same feature set, on a much heavier TanStack Start/SSR/auth/database stack) and `Forge-Scanner-React-016-Full-Document` are untouched and remain available for rollback, as are 004 to 015.

## Build 018 — the live grid, on the same proven engine, not a new framework

017 built the same feature set — a live results grid, drag/drop + zip upload,
xlsx export, a storage panel — on a scaffolded TanStack Start app with a full
auth system, an embedded database and server-side rendering, none of which
this scanner uses. That stack caused three separate real Windows failures
across as many rounds of fixes (`spawn vite ENOENT`, a production
tree-shaking bug that silently deleted the entire engine, then Start doing
nothing at all) — each one specific to machinery the scanner never needed.

018 builds the exact same feature set directly onto 016 — the same plain
Vite + React app, same engine, same `useScannerQueue` hook, zero new
framework. Every one of 017's failure classes is structurally impossible
here: there is no server, no SSR, no auth, no database, no bundler
tree-shaking surprise (016's own `npm run build` has been verified clean
throughout this project's history).

### What's new

- **Live results grid** — click "All files" to open a full-screen table,
  one row per document (not one per company/lead), that fills in the
  instant each file's scan finishes: company, DBA, statement name, address,
  bank, account, period, opening/ending balance, deposits, withdrawals,
  reconciles, revenue, confidence, pages, OCR used, score. It renders
  directly off `useScannerQueue`'s own `documents` state — no separate data
  path, so it can never drift from what the rest of the app already shows.
- **Zip upload** — drop or pick a `.zip` and every PDF inside (including
  nested folders) is extracted client-side and queued, exactly like
  dropping the PDFs directly. Non-PDF entries are skipped with a small
  dismissible notice, not a hard failure.
- **Export to .xlsx** — from the live grid, at any point during or after a
  scan, exporting exactly what's currently shown.
- **Timer and progress bar** — elapsed time since Start (pauses with the
  scan, keeps counting through OCR, resets on a fresh Start), and a slim
  progress bar showing settled/total.
  Verified for real against a genuinely slow operation (a real OCR run),
  not just a fast one — see Verified below for why that distinction
  mattered.
- **Storage panel** — real, disk-backed space used by the scanner's cache
  (`navigator.storage.estimate()`, refreshing every few seconds while the
  panel is open), and a "Clear cache" button that wipes every cached
  document and original file, not just completed ones. This is a new,
  more thorough action than the existing "Clear completed" — see
  `scannerStore.clearAll()`.

### Verified

Not assumed from reading the code:

- **Zero regression**: the full existing suite — 519 tests across 15
  suites, including every real-browser test — passes twice in a row on the
  finished build, with an identical `dist/` SHA-256 both times
  (`b6f7d1e1af836d8baa6e3362b8267afca7a5002474e16eebb09441c9c824fb68`).
  None of this build's changes touched anything those suites depend on.
- **Real batch, byte-for-byte against the known baseline**: batch1 (61 real
  files) through the existing `scripts/run-batch.mjs` harness came back
  identical to 016's own recorded numbers — 47/48 reconciled, 0 mismatches,
  50 completed, 61/61 text trusted, 94.3% average extraction score.
- **Every new feature exercised with real documents and real Playwright
  runs**, not just built and assumed: the live grid filling in from a real
  scan (exact match to a known-good document's real numbers); a real
  multi-file `.zip` (11 real files across two companies) unzipped, queued,
  scanned, and — for the files that needed it — completed correctly only
  after "Run OCR on flagged," exactly matching how this scanner has always
  required OCR to be requested rather than assumed; a real `.xlsx` download
  opened and checked for correct data; the storage panel's number checked
  against IndexedDB's own raw contents directly (not just the displayed
  number) after Clear cache, confirming it actually empties both the
  documents and files object stores.
- **One thing that looked like a bug and wasn't, caught by checking rather
  than assuming**: an early timer/progress test on two small, fast (no-OCR)
  files showed the timer frozen at 0:00 and the progress bar already at
  100% within a second — a real OCR run on the same batch (0:00 → 0:04 →
  0:10 → 0:20 across ten seconds) proved this was the scan finishing before
  the timer's first tick, not a broken timer. Documented here rather than
  either quietly "fixing" a non-bug or shipping an unverified claim.

### Not done in this build

- No Windows one-click launcher (bundled Node, hidden console, desktop
  shortcut) — this build is run the same way every other build here always
  has been: `npm install && npm run dev` (or `npm run build && npm run
  preview` for a faster, production-mode run). Given 017's launcher work
  was built against the framework this build deliberately does not use, it
  was not carried over; it would need to be redone against this build's
  actual `npm run dev`/`preview` commands if still wanted.
- Pause/Continue and the existing menu actions (Restart stopped, Retry
  failed) are all pre-existing 016 behavior, unchanged here — not
  re-verified with fresh tests in this pass beyond the existing suite
  already covering them.

## Build 016 — both scan modes now read the whole document, and three real bugs that hid behind the old page cap

The regular (text-layer) scan and the OCR scan each had a page limit —
`regularPages: 3, ocrPages: 1` by default — so a statement's summary block or
transaction section past that many pages was simply never read. Raised to
effectively unlimited on both: `regularPages: 9999, ocrPages: 9999`.
`Math.min(doc.numPages, pageLimit)` in `extractPdfText`/`ocrPdfPages` still
caps this to whatever the document actually has, so it means "read it all",
not a literal 9999-page document. The page-count inputs in the scanner's
settings panel now accept up to 9999 as well.

Reading more pages of the real `leads` batch surfaced a document that used to
score 0 mismatches simply because its debit section was never reached: a
12-page scanned statement, `goodcents pest controlnk -compressed-protected.pdf`.
With the full document read, it came back as a **false reconciliation
mismatch** — `difference: 66755.85` — that had never appeared before. Chasing
it down found three separate, real bugs, each compounding the next:

1. **`balanceEquation.js` zeroed every component it could not sign-prove.**
   When no exact combination of signs balanced a statement's printed
   beginning/ending, every unresolved deposit or withdrawal fell back to `0`
   instead of its closest reading. The document's real debit total —
   $75,266.74 — was reported as $0. Fixed with a new `closestSigns()` that
   keeps every sign already fixed by print or keyword, and for the rest picks
   the combination that comes closest to the printed ending, without ever
   marking the reading verified.

2. **`transactionParser.js` did not recognise "Electronic Credits" /
   "Electronic Debits" as section headings** — only "Electronic Deposits" and
   "Electronic Withdrawals/Payments". All 60 transaction rows in this
   document sat under an "Electronic Debits" heading and were misread as
   credits with $0 in debits. Fixed by widening both section regexes.

3. **`reconciliation.js` preferred incomplete row-level parsing over an
   existing, unverified statement-summary equation.** Even with fixes 1 and 2
   in place, a real but unverified equation reading (`difference: 23.68`) was
   still being discarded in favour of comparing this scanner's own
   transaction-row totals against the printed opening/ending — and across 211
   heavily OCR'd debit line items spanning several pages, that row-level total
   was far worse (`difference: 66755.85`). A statement's own printed summary,
   even when the engine cannot itself prove every sign to the cent, is
   stronger evidence than hundreds of OCR'd rows reconstructed from scratch.
   Added a new outcome, `reconciles: null, reason: 'equation_not_provable'`,
   which reports the unproven reading honestly instead of either forcing a
   false pass or calling it a contradiction the evidence doesn't support.

Verified against the real document, before and after all three fixes:

| | before | after |
|---|---|---|
| deposits | $0 | $76,403.68 |
| withdrawals | $0 | $75,266.74 |
| reconciliation | `false`, mismatch, difference $66,755.85 | `null`, unproven, difference $23.68 |

Six new tests were added for this (3 in `test-balance.mjs`, 3 in
`test-transactions.mjs`); the full suite ran clean twice in a row —
**519 passed, 0 failed, across 15 suites** — and all three real batches were
re-run in full:

| batch | before (015 baseline) | after (016) |
|---|---|---|
| batch 1 — 61 files | 47/48 reconciled, 0 mismatches | 47/48 reconciled, 0 mismatches |
| batch 2 — 60 files | 39/48 reconciled, 0 mismatches | **40/48 reconciled, 0 mismatches** |
| batch 3 — 95 files | 73/77 reconciled, 0 mismatches | 73/77 reconciled, 0 mismatches |

Batch 2's reconciled count rose by exactly the one document this section
describes. No other batch changed. See `VERIFICATION.txt` for the full,
current test and batch run.

---

## Earlier history: build 015 — Third batch

Four defects found by running a third batch of 95 real documents — 18 companies, none seen before. Statements reconciling on that batch went from **61 of 77 to 71 of 77, and its two mismatches to none**. The first two batches are unchanged: 60 documents each, 0 differences.

## What the third batch found

| defect, on real documents | effect |
|---|---|
| A summary carries two equal statistics — "Average Ledger 7,622.90" beside "Average Collected 7,622.90" — which can be added to both sides without disturbing the balance | several readings balanced, so the solver refused all of them and the statement was reported as a **mismatch** |
| An amount under a dollar printed without its leading zero: "Current Balance .43" | the closing balance was never found |
| An overdrawn balance in a column table: "…-$126,808.58 -$279.44" | the table read the closing balance as positive and never balanced |
| A transaction row dated "Apr 14, 2026" | its description was read as the company name |

The first is the one that mattered most: a mismatch says the bank's own
arithmetic is wrong, which is a far stronger claim than "could not prove". Where
several readings balance, the one that **moves the least money** is now taken —
treating an equal pair of statistics as movements would invent deposits the bank
never counted. A genuine tie is still reported as unsolved.

### Where the third batch stands

  95 documents, 18 companies, 0 failed, 0 timeouts, 0 retries, fully offline
  71 of 77 statements reconciled, 0 mismatches
  Business name on 90 of 95, account number on 77, statement address on 71

The six that do not reconcile are not wrong numbers:

- **2** put their Account Summary past page three, behind pages of legal text.
  Reading every page proves both. This is the 3-page scan default, unchanged.
- **2** are online transaction exports with no summary block at all — nothing to
  prove, with every page read.
- **2** are scans where OCR read page one of nineteen and of four, and the
  summary is not on it.

---

## What the statements say the company is (added in 012)

A business is often banked under a name that is not the one on its
incorporation, and the bank often holds an address the application has moved on
from. Neither overwrites the other: both are read, both are kept, and where the
statements say something different it is marked.

Each statement now carries `statementIdentity` — the holder name as printed, any
DBA, and the address split into street, town, state and postcode. The lead
carries `companyInfo`, which holds the application's name, DBA and address, the
distinct values from the statements, and three flags saying which of the three
differ. The extraction panel shows them side by side under **On the statements**.

Measured on the supplied 60-document batch: **a statement name for 12 of 12
companies and an address for 11 of 12**, and the differences it surfaces are
real:

| the application says | the statements say |
|---|---|
| G&s Metal Products INC | **G & S METAL PRODUCTS CO., INC.** |
| G Boil Wholesale CORP | **GB OIL WHOLESALE CORP** |
| East Staff LLC | **ESTAFF LLC** |
| Greers Ferry Heat And Air | **GREERS FERRY HEAT AND AIR LLC** |
| Hammerhead Holdings | **EVERLAST ENTERPRISES INC**, **MAR LAM INDUSTRIES INC** |

The last one is not a spelling difference: that folder's statements are in two
other companies' names. It was invisible before and is now on the record.

### Reading the address past the bank's own

The address sits under the holder's name, but rarely on its own — banks set
their own address and telephone numbers in a column beside it, and rebuilding
the rows interleaves the two:

```
DATALAB INFOTECH INC
Bank of America, N.A.          <- the bank's column
1201 RICHARDSON DR STE 180
P.O. Box 25118                 <- the bank's column
RICHARDSON, TX 75080-4610
Tampa, FL 33622-5118           <- the bank's column
```

Rows are not counted. The first street after the name is taken, then the first
town after that street, which steps over the bank's column without knowing
anything about the bank. Marketing copy printed after the street is cut at the
street type, so "2998 SCOTT BLVD reserve your seat by calling..." reads as
"2998 SCOTT BLVD".

### Same place, different words

An application says "1201 Richardson Drive, Richardson, TX 75080" and the bank
writes to "1201 RICHARDSON DR STE 180, RICHARDSON, TX 75080-4610". That is one
address written twice, and reporting it as a difference would bury the ones
that really differ — so addresses are compared on the house number with the
postcode, not on the words.

Names are compared the other way, as printed: "Datalab Infotech Corporation"
and "DATALAB INFOTECH INC" are one company for grouping and exactly the
difference worth showing.

### Two more names cleaned up

- An account number fused onto the name in the routing block —
  "ESTAFFLLC4812 ESTAFF LLC" — is dropped, but only when the code restates the
  name, so "23HUNDRED VENTURES INC" and "366 Metro Mart INC" keep theirs.
- A row opening with a posting date is a transaction, not the account holder,
  so "04-13-2026 ZEL FROM AL MAWA LLC" is no longer read as a company.

---

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
cat Forge-Scanner-React-015-Least-Movement.zip.part* > Forge-Scanner-React-015-Least-Movement.zip
unzip Forge-Scanner-React-015-Least-Movement.zip
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
npm run test:company-info  # statement name, DBA and address (needs dist/)
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
