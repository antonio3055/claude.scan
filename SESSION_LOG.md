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
