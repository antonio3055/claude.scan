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
