# Session log

Append-only. Newest entry at the bottom. Each entry: what happened, why,
and anything a future session needs to know to not redo or undo it.

---

## 2026-09-14 → 2026-09-18 — Full 34-item scope, redesign rounds, repo split

Work originally happened on `antonio3055/crm`, branch
`claude/tender-bell-lxu05z`, inside `Forge-Scanner-React-018-Live-Grid/`.
That repo/branch is not this repo's history — this log summarizes what
was actually built, since the commits themselves live over there.

**Full 34-item scope implemented** (engine + UI), each verified with the
engine test suites, `tsc --noEmit`, a production build, and — for UI
changes — real Playwright checks against injected or real data, not just
code review:
- Engine/data: fixed Chase/BofA bank misdetection (position-scored
  letterhead match instead of first-match-by-array-order); full email
  list shown, not just the first; statement-vs-application "differs" flag
  now requires real application data to compare against; App date
  extraction near the AUTHORIZATIONS block; default page limits corrected
  to 15 regular / 2 OCR; revenue-exclusion threshold (app always scanned
  first, its statements skipped if revenue is under a configurable
  floor); duplicate statement files excluded from revenue and score math
  while staying visible in the audit trail; self-hosted Inter Variable
  font (was silently falling back to the OS font).
- UI: replaced the original 3-panel layout with a single company-level
  Results sheet (CSS-grid rows, not a `<table>` — this matters, see
  below) plus a collapsed-by-default Scan Audit table; Options/OCR-files/
  Send moved into popup modals; drag-to-resize AND drag-to-reorder columns
  on both sheets; a draggable bottom-edge handle to resize the Results
  panel's height; a real drag-and-drop upload dropzone.

**Column resize/reorder implementation note**: the sheets are real CSS
grid rows (`.sheet-row` / `.sheet-cell`, `gridTemplateColumns` built from
a per-column width map), not an HTML `<table>`. This was a deliberate
fix — a `<table>` implementation had a bug where dragging one column's
resize handle visually affected neighbors. If touching
`LeadsSheet.tsx`/`AuditTable.tsx`, keep this pattern; don't revert to a
table layout. Column resize uses `hooks/useResizableColumns.ts` (pointer
capture on the handle, keyed by column), reorder uses
`hooks/useColumnOrder.ts` (native HTML5 drag, deliberately a separate
gesture from resize so they can't fight each other).

**Real bugs found from the user's own live testing against real data**
(not hypothetical — confirmed against `scan15test.zip`, 61 real PDFs,
13 companies):
- **Lead score was badly inflated.** Two bugs, both fixed in
  `lib/format.ts` / `lib/leads.ts`: (1) an application document had no
  bank-recognition/reconciliation signal to score against, so it fell
  back to a flat 85 regardless of whether any field was actually found —
  replaced with a real 8-field completeness count. (2) the lead-level
  score averaged every document flat, so a lead with a fully-complete
  application but **zero matched bank statements** still scored ~100%
  complete. Fixed by weighting statements over the application (70/30)
  and capping a zero-statement lead at 30% of the application's own
  completeness. Verified against the user's real exported data
  (Abbaspour INC, 366 Metro Mart INC).
- **"366 Metro Mart INC" / "2 EVERFRESH MARKET INC" is not a bug** —
  confirmed by extracting the real PDFs directly (pdfjs-dist in Node):
  they're the same real business (identical address, 2 Hendrickson Ave,
  Lynbrook NY), but the bank statements are printed under a different
  company name than the application. The engine correctly keeps them as
  two separate leads since there's no name overlap to group on. Not
  fixed — a possible future feature (flag "an app-only lead and a
  statement-only lead share an address, might be the same business") was
  proposed but not built; needs the user's go-ahead first.
- The "audit shows no OCR used" report could not be reproduced: directly
  ran real Tesseract OCR against the user's actual scanned Abbaspour
  statement PDF (confirmed via the PDF's own object structure — zero
  `/Font` entries, pure image) and confirmed both `usedOcr: true` gets
  set correctly and the Audit table renders "OCR: Yes" correctly.
  Whatever the user saw was most likely a stale deployment, not a code
  defect — see the Vercel section below for why that's very plausible.

**XLSX export filename**: changed to
`{INITIALS}{month}.{day}.{leadCount}L{HHMM}.xlsx` (e.g.
`MM9.17.13L1342.xlsx`) — short, always unique (minute-level time),
includes lead count. Initials come from a new "Your initials" field in
Options (`exporterInitials` in `ScanSettings`), optional.

**Deployment chaos, and why this repo exists**: the scanner was
originally a subfolder of `antonio3055/crm`. That repo's Vercel project
had its Root Directory set to `frontend` — a path that has never existed
in either repo — so every deployment from that branch silently failed or
served a stale build. This caused real confusion during testing (the
user reasonably suspected fabricated results / stale cache when scores
looked wrong) before the actual root cause was found. `crm` also had
~8 scanner-related Vercel projects accumulated from repeated failed
attempts (wrong root directory, orphaned/never-connected, duplicates).

Fix: split the scanner out into this repo (`antonio3055/claude.scan`),
copied over from the crm branch (PR #1, merged 2026-09-18). Set up a
single Vercel project, `forge-scanner`
(https://forge-scanner-one.vercel.app), Root Directory correctly set to
`Forge-Scanner-React-018-Live-Grid`, auto-deploying from `main`. All the
old crm-side scanner Vercel projects and this repo's own duplicate
auto-detected ones were identified for deletion (see CLAUDE.md — don't
recreate them). This is now the one true home for the scanner.

Added this file and `CLAUDE.md` at the end of this session specifically
so a fresh chat can pick up this context without needing to be pasted a
manual recap every time.

---

## 2026-09-18 — Live-deploy verification against real data (Scanner 03)

Tested the actual `forge-scanner-one.vercel.app` deployment end-to-end with
Playwright against the user's real `scan15test.zip` batch (61 PDFs, 13
companies) — not code reading, not unit tests, the deployed site itself.
Test artifacts (extracted PDFs, screenshots, XLSX export, the uploaded zip)
were deleted after the session; none of it is checked in or left on disk.

**Score-weighting fix from the previous session is confirmed working in
production**: zero-statement leads correctly cap at 30% of the
application's completeness, fully-matched leads score up to 100, nothing
is clustered artificially the way it was before that fix.

**Root cause of the old "audit shows no OCR used" report, finally
explained**: OCR is intentionally manual, not automatic (see the comment
in `useScannerQueue.ts` — "OCR never starts on its own"). A user has to
click **Run OCR on flagged N** in the "..." menu after the first pass.
Before that click, a scanned document sits flagged `needsOcr` but unread —
its lead looks like a zero-statement, app-only lead (low score, app
revenue only), which is exactly what the user saw and what the prior
session couldn't reproduce (it wasn't stale deployment, it's a
workflow/discoverability gap, not a code defect — not changed this
session, flagging here in case it's worth a UI nudge later).

**One real, separate bug found and fixed**: `Results` and the XLSX export
both intentionally hide any lead whose `companyName` is `'Unassociated'`
(a document the engine couldn't read or match to a company) — by design,
"exports exactly what the Results sheet shows" — but there was no
indication to the user that this had happened. A document could fail (e.g.
a one-off Tesseract worker load failure during OCR) and its revenue would
just silently vanish from both the screen and the spreadsheet. Fixed by
wiring up `auditSummary()` in `lib/leads.ts` (already existed, was never
called anywhere) into a warning banner in `LeadsSheet.tsx`: "N document(s)
could not be matched to a company — excluded from Results and the export
... Check Scan Audit." Verified against a synthetic blank PDF in a local
`vite preview` build (real browser, not just `tsc`/unit tests) — confirmed
it renders correctly. Full regression suite + build still clean.

**Investigated and ruled out as not-a-bug**: initially suspected the
"Run OCR on flagged" path skips the queue's automatic retry-once logic
(one Abbaspour statement failed on `tesseract-core-simd-lstm.wasm.js`
during live testing and didn't visibly retry). Read `jobRunner.js` and
confirmed `runOcrOnFlagged` reuses the exact same `runScanQueue` /
`runJobWithRetry` path as every other scan trigger — retry is generic, not
special-cased per entry point. Also confirmed the wasm asset itself is
present and served correctly (200, correct size) both locally and on the
live deployment. Most likely a one-off network hiccup in the sandboxed
test environment's TLS-intercepting proxy, not a reproducible production
defect. No code change made here — don't re-"fix" this without new
evidence it's real.

**Vercel cleanup (6 leftover projects)**: done by the user directly in the
Vercel dashboard (this session still has no delete tool for it — confirmed
again this session, only pause/unpause are exposed).

---

## 2026-09-18 (continued) — OCR auto-continue, same-address flag, PR #2 merged

PR #2 (the unmatched-document warning banner, above) merged to `main`
(squash, matching this repo's existing linear history). Branch reset to
latest `main` and two more requested changes built fresh on top of it,
each verified live in a browser against a local `vite preview` build (real
Playwright runs, synthetic PDFs built with `scripts/lib/fixtures.mjs`'s
`buildTextPdf`/`buildImageOnlyPdf` — not just `tsc`/unit tests), plus the
full existing regression suite + build.

**OCR now auto-continues after a regular scan**, instead of requiring the
user to click "Run OCR on flagged" by hand. `useScannerQueue.ts`'s
`runQueue` takes an `isOcrPass` flag (default false); when a *regular*
pass finishes and `ocrCandidateDocuments()` finds anything flagged
`needsOcr`, it now automatically calls `runOcrOnFlagged()` once.
`runOcrOnFlagged` itself calls `runQueue(true)`, so an OCR pass can never
trigger *another* auto-continue — this is the guard against a file that
fails OCR outright (stays `needsOcr: true, usedOcr: false` forever) auto-
retrying in an infinite loop. The manual "Run OCR on flagged" button is
kept (still useful after adding more files later, or retrying by hand).
Verified live: uploaded an image-only PDF, clicked "Start" exactly once,
confirmed via the Scan Audit table that it went through OCR
(`Text: OCR`, `OCR: Yes`) with no second click.

**Same-address cross-reference flag, built** (the Metro Mart/Everfresh
idea from the first session, previously deferred pending a second real
occurrence — the user asked for it now regardless). `lib/leads.ts` now
runs `flagSameAddressAcrossNames()` after grouping: any lead with an
application and zero matched statements, and any lead with matched
statements and no application, at the same address (via the existing
`engine.holderAddress.sameAddress`), get a new `possibleSameBusinessAs`
field pointing at each other's company name. Nothing is merged or
rescored — it is purely a flag. Rendered as a badge next to the company
name in `LeadsSheet.tsx`: "⚠ possibly \<other company\>". Verified live
with two synthetic documents (an application and a statement, different
company names, same address) — both leads showed the badge pointing at
each other.

No unit-test harness exists for `lib/leads.ts` (it's TypeScript; the
existing `scripts/test-*.mjs` suite only imports the plain-JS engine under
`src/scanner/engine/`, which Node can run directly) — verification for
both of these changes is `tsc` + `vite build` + the full existing suite
(regression) + a real-browser Playwright check specific to each new
behavior (feature correctness). If `lib/leads.ts` grows more logic like
this, it may be worth wiring up a TS-aware test runner for it.

---

## 2026-09-18 (continued) — Same-business flag: broadened + restyled, on PR #3

Two rounds of user feedback on the same-address flag above, both applied
directly to `claude/magical-gates-w0kw08` / PR #3 before it merged:

**Broadened the match.** The user pointed out an app-only lead and a
statement-only lead can be the same real business even when neither the
name nor the address line up (an old address on file, a typo, a business
that moved) — the address-match requirement was too narrow. `lib/leads.ts`
now drops the `sameAddress` check entirely: `flagPossibleSameBusiness`
(renamed from `flagSameAddressAcrossNames`) flags every application-only
lead against every statement-only lead in the batch, unconditionally.
`possibleSameBusinessAs` changed from `string | null` to `string[]` to
carry more than one candidate when there's more than one orphan on each
side (uncommon, but the type has to allow it now that there's no filter
narrowing the pairs).

**Restyled the flag.** The inline "⚠ possibly \<company\>" badge widened
the Company column and was unreadable without manually resizing it — not
something the person doing the review should have to do to see a warning.
Replaced with: a small solid amber dot pinned to the top-left corner of
the company name (`.flag-dot`, absolutely positioned inside a
`position: relative` wrapper, so it overlays the first letter without
shifting anything or affecting row height/column width), and the company
name text itself recolored a darker amber (`.flag-strong-text`, new
`--warn-strong: #7a4c05` variable next to the existing `--warn`/
`--warn-soft`). The full "possibly the same as X" detail moved to the
dot's hover tooltip instead of being shown inline. Scoped to only this
badge — the existing name/DBA/address-differs badges and the duplicate
badge were left as they were; nobody asked for those to change.

Verified live in a local `vite preview` build with two synthetic
documents that share neither a name nor an address (`Northgate Traders
LLC` / `90 Main Street, Austin, TX` vs `SOUTHVIEW WHOLESALE CORP` / `210
Oak Ridge Dr, Reno, NV`) — both leads got the dot, pointing at each other,
with no address or name overlap at all. Full regression suite (309 tests)
and build still clean.

---

## 2026-09-18 (continued) — Fixed all 5 failing `npm run test:suites` suites (Scanner 04)

`npm run test:suites` on `main` was 357 passed / 16 failed across 15
suites (Clean-code audit, Offline browser, Stop cancellation, Manual OCR,
Company info). Reproduced byte-identical in this session's own sandbox
before touching anything, confirming these were real and deterministic,
not environmental flakiness from any one sandbox. Every fix below is to a
test/audit script, not product code — `git diff` for this work touches
only `scripts/`, nothing under `src/`.

**Root cause, all five suites**: none of this was a live product
regression. Two earlier, already-documented redesigns left stale test
code behind that nobody had run since:

1. The three-panel layout (`LeadRows.tsx` / `ExtractionPanel` / a fixed
   `RoutingPanel` column, plus a `.scan-settings` inline settings row) was
   replaced by the single Results-sheet design (`LeadsSheet.tsx` +
   `AuditTable.tsx`, settings moved into the `OptionsModal` popup) back
   when build 017/018 shipped. `scripts/audit.mjs` and
   `scripts/lib/browser-harness.mjs` (the shared real-browser test
   harness) were never updated to match, so `audit.mjs` crashed outright
   (`ENOENT` opening the long-gone `LeadRows.tsx`) and every browser suite
   that opens the scan-mode dropdown via `setScanMode()` timed out looking
   for `.scan-settings select`.
2. This session's own PR #3 (OCR auto-continue) changed real, intended
   behavior — a regular scan now finishes a flagged file's OCR pass
   automatically — and `test-manual-ocr-browser.mjs` still encoded the old
   "OCR only runs by hand" contract, so it failed correctly, against code
   working as newly designed.

**Fixes**:
- `scripts/audit.mjs`: pointed its file reads at the real current
  components (`LeadsSheet.tsx`, `AuditTable.tsx`), rewrote the "Approved
  scanner UI" assertions to check the *current* approved design instead of
  the superseded one (single-sheet layout instead of three panels, one
  resize handle instead of two, the audit table's `useState(false)` toggle
  instead of a `<details>` element, default page caps of 15/2 instead of
  the old 9999/9999), and scoped the "no bulk-select checkbox" check to
  just the row-rendering code so it doesn't false-positive on the
  legitimate column-visibility checkbox that exists today. Also relaxed
  one structural regex ("the engines are released when the queue goes
  idle") that was over-fitted to exact brace placement PR #3's new
  auto-continue code shifted — confirmed the actual invariant (workers
  reset as the last statement of `runQueue`'s own `finally` block) still
  holds before touching it. 140/140 now.
- `scripts/lib/browser-harness.mjs`: `setScanMode`/`setRegularPages`/
  `setOcrPages` now open the Options popup (`getByRole('button', {name:
  /^options/i})` inside the "..." menu) and use `getByLabel(...)` against
  the real current fields, instead of a `.scan-settings` selector that no
  longer exists anywhere in the app. This one fix is what actually cleared
  Offline browser (11/11) and Stop cancellation (11/11) — both suites'
  only failures were this same timeout.
- `scripts/test-manual-ocr-browser.mjs`: rewritten for the real, current
  contract. Renamed (suite label in `test-all.mjs`: "OCR auto-continue
  (real browser)") since "OCR only runs by hand" is no longer true by
  design. Verifies the automatic follow-up pass actually reads a flagged
  file (`usedOcr: true`, `needsOcr` cleared once OCR has run -- it's never
  true at the same time as `usedOcr`, since the OCR code path never sets
  it), leaves an already-readable file untouched, and that the manual "Run
  OCR on flagged" control correctly disables once nothing is left needing
  it. Deliberately does not force-click that control any more, since nothing
  reaches that state after a normal scan now; its own requeue/flag-clearing
  mechanics are still covered at the unit level in `test-recovery.mjs` and
  structurally in `audit.mjs`. 10/10 now.
- `scripts/test-company-info-browser.mjs`: rewritten to check the actual
  current Results sheet instead of a `.paired-info` company/contact detail
  panel that the three-panel layout removed. Verified real current
  rendering first (a throwaway inspection script against the built app,
  deleted after use, not guessed from reading component source) before
  writing new assertions: the company/address cells' primary text is
  always the application's own value, a `.differs-badge` next to it
  carries what the statements say when it disagrees (name and DBA are
  shown together in one badge, not as separate marked fields -- the old
  panel's per-field "differs" flags don't exist in the grid design), and
  owner/bank still come through. 12/12 now.

**Full suite**: 514 passed, 0 failed, across all 15 suites, build clean.

**Not done, per CLAUDE.md's own instruction**: don't add a GitHub Actions
CI workflow (build + `test:suites` on every PR) until the suites are
green -- they are now, so this is the next thing to propose to the user,
not something to add unilaterally this session.

---

## 2026-09-18 (continued) — Storage/cache moved to the header, verified correct

User report: "I cached and there is still 78.4kb, won't let cache more
than once" plus a request to always show storage info + Clear cache in
the main header instead of inside the Options popup.

**Verified before changing anything** (real browser, not guesswork): drove
the built app with Playwright -- scanned files, read `navigator.storage
.estimate()` (which is exactly what `StoragePanel.tsx` already reads --
this was never a custom/approximate calculation), clicked Clear cache,
confirmed `documents`/`files` object stores were genuinely empty
(`readDocuments().length === 0`) right after, then scanned a second batch
afterward with no problem (settled normally, correct extracted data). The
"won't cache more than once" half did not reproduce. The residual-KB half
is real, but it's the browser's own IndexedDB storage engine logging the
delete itself as a write and reclaiming disk space lazily in the
background, not something `scannerStore.clearAll()` (which correctly
calls `store.clear()` on both object stores) can force synchronously from
JS -- usage was observed to go *up* immediately after a clear before
settling, which is consistent with this and not with an incomplete clear.

**Moved**: `StoragePanel` out of `OptionsModal` (which no longer takes
`onClearStorage`/`storageEpoch` at all) and into `QueuePanel`'s header
row, rendered immediately to the left of the Play/Stop/"..." icon buttons
-- always visible, no modal needed. Restyled from a full-width modal
footer into a compact chip matching the 30px icon-button height. Added a
tooltip on the value explaining the residual-bytes behavior above, so it
reads as expected rather than broken.

Verified with `tsc`, `vite build`, the full 514-test regression suite
(unaffected), and a real-browser screenshot confirming the chip's new
position and that it no longer renders inside the Options modal.

---

## 2026-09-18 (continued) — GitHub Actions CI added, now that suites are green

This repo had no real CI — the only PR check was "Vercel Preview
Comments," which runs no tests. Proposed adding one once all 15 suites
were fixed (see above); user said to go ahead. Added
`.github/workflows/ci.yml`: on every PR into `main` and every push to
`main`, checks out, installs deps (`npm ci`), installs Playwright's
Chromium (`npx playwright install --with-deps chromium` -- needed for the
5 real-browser suites), then runs `npm run build` and `npm run
test:suites`.

Verified as much of this as is possible without an actual GitHub Actions
runner: wiped `node_modules`/`dist` and re-ran `npm ci && npm run build
&& npm run test:suites` from a clean state -- the same sequence the
workflow runs -- and got 514/514 again. Confirmed the YAML parses
correctly (the top-level `on:` key coming back as `true` under a generic
YAML 1.1 parser is expected -- GitHub's own workflow parser handles this
correctly; every GitHub Actions workflow file looks like this). Couldn't
verify the Playwright/Chromium install step itself against a real
fresh Ubuntu runner from inside this sandbox (this environment has its
own pre-installed browser at a fixed path the test harness auto-detects,
which a real CI runner won't have) -- that step uses Playwright's own
documented, standard installation command, but genuinely watching it
pass on an actual PR is the real confirmation, worth checking on the
first PR this runs against.

---

## 2026-09-18 (continued) — Page-level scroll, upload box shape, one-click fix for the unmatched-doc banner (Scanner 05)

User reported (with a real screenshot + xlsx export from the live site) that
the page never scrolls as a whole -- only individual panels (Results, Scan
Audit) get their own cramped internal scrollbars -- and that the "N
document(s) could not be matched to a company" banner (added in Scanner 03)
was showing up on effectively every visit.

**Root cause of both, found by reading the CSS, not guessed**: `body {
overflow: hidden }` plus `.demo-shell`/`.forge-scanner` both pinned to a hard
`height: 100vh` meant nothing could ever grow past one viewport -- Results
and Scan Audit were forced to squeeze into whatever was left and handle their
own overflow internally, instead of the page just getting taller and letting
the browser's own scrollbar take over. Fixed by changing those three rules
from a fixed `height: 100vh` to `min-height: 100vh` (`app.css`,
`scanner.css`) and dropping `body`'s `overflow: hidden` and
`.forge-scanner`'s now-redundant `overflow-y: auto`. Nothing about the
Results/Audit panels' own internal layout, CSS-grid rows, or column resize/
reorder was touched -- this only changes what happens once their content is
taller than the panel: the page now grows and the browser scrolls it, rather
than the content being invisibly squeezed to fit.

**Unmatched-document banner**: the count it's built from (`auditSummary`'s
`missingCompany`) is computed over every document ever saved to IndexedDB,
not just the current scan -- documents are never auto-cleared between
sessions (by design, so a scan can be resumed later). So a single stray
unreadable file from any past session keeps the banner up forever, on every
future visit, regardless of whether the current batch scanned cleanly. There
was no way to act on it besides manually hunting through Scan Audit and
deleting the right row. Added a "Remove flagged file(s)" button directly in
the banner (`LeadsSheet.tsx`, wired to the existing `removeDoc` in
`useScannerQueue.ts` via a new `onRemoveUnassociated` prop from
`ScannerPage.tsx`) that deletes exactly the unmatched document(s) tripping
it, in one click.

**Also fixed**: the upload dropzone was a wide, short strip (`flex: 0 0 40%`
stretched to match the toolbar's own compact height) per the user's request
to make it "more square, taller, less wide" -- now a fixed 200×168 box,
`.toolbar-top` changed from `align-items: stretch` to `center` so it no
longer forces the rest of the toolbar taller too.

**Verified live in a real headless browser** (not just `tsc`/build), all in
one throwaway Playwright script (deleted after use, not checked in): 12
synthetic bank-statement PDFs plus one image-only "blank scan" PDF (the same
technique Scanner 03 used to trigger this exact banner) uploaded through the
real file input, Scan Audit opened by clicking it same as a user would.
Confirmed: page content genuinely exceeds the viewport once Scan Audit is
open, `document.body`'s overflow is no longer `hidden`, the page actually
scrolls when asked, the dropzone's real bounding box is narrow-and-tall
(≤210px wide, ≥150px tall), the banner appears for the one genuinely
unmatched file, clicking "Remove flagged file" makes the banner disappear
*and* deletes that document from IndexedDB (not just hides it), and the
other 12 real documents are left untouched. Full 514-test regression suite
and `npm run build` both still clean.

**Also investigated per the user's screenshot/export, not yet acted on**: a
massively repeated block of identical rows in their live Scan Audit table
(the same ~13 companies each appearing many times over) and one exported
lead ("23hundred Ventures INC") whose Statements list carried an identical
date+amount twice while `duplicateCount` was 0 for every lead in that
export. The repeated audit rows are consistent with the documented,
by-design behavior of `duplicateHandling: 'flag'` (duplicates stay visible
in the audit trail, excluded from revenue) combined with documents never
being auto-cleared between sessions -- plausible if that batch (or an
overlapping one) had been uploaded more than once in that browser without
"Clear cache" in between, which the "Remove flagged file" work above doesn't
address (it only targets *unmatched* documents, not flagged *duplicates*).
The 23hundred Ventures anomaly specifically means two documents with
different file hashes produced identical statement numbers -- `findDuplicate`
(SHA-256 content hash + size) correctly did NOT flag them as duplicates,
since they are not byte-identical files, so this is either two genuinely
separate statements that coincidentally match to the cent (very unlikely) or
a duplicate-detection gap worth a closer look with the actual source PDFs.
Not fixed this session -- flagging here so a future session (or this one, if
the user provides the real files) doesn't have to re-discover it.

---

## 2026-09-18 (continued) — OCR auto-continue turned off by default; toolbar shows OCR status + page limits (Scanner 05)

User reported OCR is "very very slow" and wanted to stop it running on its
own, be told when it's actually running, and have Regular/OCR page-limit
numbers reachable without opening Options.

**Auto-continue OCR is now off by default.** The Scanner 04 change that made
a regular scan automatically follow up with one OCR pass on whatever it
flagged is now opt-in: new `autoContinueOcr` field on `ScanSettings`
(`types/scanner.ts`), defaulting to `false`, gates the auto-continue call in
`useScannerQueue.ts`'s `runQueue`. Off (the new default): a scanned file
just sits flagged `needsOcr` until "Run OCR on flagged" is clicked by hand,
same as the original pre-Scanner-04 behaviour. On (a new "Auto-run OCR
after scan" select in `OptionsModal.tsx`): restores the automatic follow-up
exactly as it worked before this change.

**Toolbar now says when OCR is actually running**: the status line next to
"Forge Scanner" (`QueuePanel.tsx`) shows "Running OCR (N) -- this is the
slow part" instead of a generic "Scanning" whenever any document is
mid-OCR, so it's obvious when to expect things to slow down.

**Regular/OCR page-limit numbers moved onto the main toolbar** as a compact
`Reg [ ] OCR [ ]` control (`.page-limits`, next to the storage chip) bound
to the same settings as the Options modal fields -- editable from either
place, no need to open Options just to change a page cap.

**Test suite updated to match the new default contract, not just left
passing by accident**: `test-manual-ocr-browser.mjs` (still labelled "OCR
auto-continue (real browser)" in `test-all.mjs`) now checks both halves --
by default a scanned file is flagged and left unread until the manual "Run
OCR on flagged" button reads it, and with `autoContinueOcr` turned on (a new
`setAutoContinueOcr()` helper in `browser-harness.mjs`, driving the real
Options select) the old automatic-follow-up behaviour is confirmed to still
work. `scripts/audit.mjs`'s existing OCR-related assertions
(`regularPages: 15`, `ocrPages: 2`, `mode: 'regular'`, etc.) were unaffected
since none of them touch the new field.

Verified: full 516-test suite (514 + 2 new checks) and `npm run build` both
clean, plus a real-browser Playwright screenshot confirming the "Running OCR
(1) -- this is the slow part" status text renders correctly mid-run and the
toolbar Reg/OCR inputs actually update stored settings when changed.
