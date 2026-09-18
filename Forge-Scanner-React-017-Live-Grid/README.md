# Forge Scanner React 017 — Live Grid

A new front end for the same verified scanner engine, built as a standalone
React/TanStack app with a live-updating results grid, real scan controls,
drag/drop + zip upload, and IndexedDB-backed caching. The extraction engine
itself is unchanged: `src/lib/scan-engine/` is a byte-for-byte copy of
`Forge-Scanner-React-016-Full-Document/src/scanner/engine` and
`services/{pdfRows,vendorLoader,jobRunner,fileValidation,scannerConfig,offlineVendor}`
— nothing about how a statement is read, parsed, or reconciled was rewritten.

`Forge-Scanner-React-016-Full-Document` is untouched and remains the source
of truth for the engine, as are all earlier builds.

## Where this came from

The front end (upload, live grid, controls, storage panel) was scaffolded by
a different AI tool from a written spec, using a mock scan function as a
placeholder. This build:

1. Audited that scaffold against real files (found and fixed two real bugs:
   every file upload double-queued and double-scanned because the file
   input had both `onChange` and `onInput` wired to the same handler; and a
   second bug where the "Choose files" picker read `e.currentTarget` after
   an `await`, which the DOM has already nulled by then — both fixed, see
   `git log` for exact diffs).
2. Replaced `localStorage` caching with IndexedDB, using the real
   `navigator.storage.estimate()` API for the storage panel's byte count
   where available.
3. Replaced the external Google-Fonts-CDN-loaded IBM Plex with a locally
   vendored Inter Variable font (`@fontsource-variable/inter`) — zero
   external network requests for fonts now, consistent with the rest of
   this project's offline-only rule.
4. Wired in the real engine: `src/lib/scan/real-scan-file.ts` is the only
   new adapter file. It drives the ported `extractPdfText` /
   `ocrPdfPages` (PDF.js + Tesseract, same OCR-fallback heuristic as 016:
   OCR only runs when the text layer is short or has no printed dollar
   amount) and reshapes the engine's real per-document result into this
   app's `ScanResult` type. `src/lib/scan/mock-scan-file.ts` was deleted —
   nothing references it any more.

## Verified

Not just "it builds" — the real engine was run against real documents from
this project's existing test batches and directly diffed against
`batch1-016.json`, the already-verified output of build 016 on the same
files:

| file | field | 016 baseline | this build |
|---|---|---|---|
| `366 (1).pdf` | company / bank / balances / reconciles | 2 EVERFRESH MARKET INC., Bank of America, $17,163.93 → $8,242.09, deposits $123,176.10, withdrawals $132,097.94, reconciles true | **identical, to the cent** |
| `01-2026 Abbaspour Farmers.pdf` (OCR path) | company / bank / balances / reconciles | ABBASPOUR INC, Farmers Bank, $56,002.94 → $169,194.36, deposits $487,393.71, withdrawals $374,202.29, reconciles true, confidence medium | **identical, to the cent** |
| `366 Metro Mart INC USE_THIS_APP.pdf` (application, not a statement) | docType / company | application, "366 Metro Mart INC" | **identical** |

Also exercised directly, for real, via Playwright against the built app
(not assumed from reading the code):

- Stop mid-scan actually cancels the in-flight file and returns the queue to
  a clean, restartable state.
- Export to .xlsx produces a real, correctly-populated downloadable file at
  any point during or after a scan.
- The storage panel reports real IndexedDB usage (grew from 0 B to a few KB
  across a real batch) and "Clear cache" actually frees it back to 0 B.
- Zero browser console/page errors across every run once both upload-zone
  bugs were fixed.

## Running it on Windows

Double-click `start.bat`. First run installs dependencies and builds the app
(only once, a couple of minutes); every run after that starts it in a few
seconds and opens your browser straight to it. Requires Node.js already
installed — if it isn't, `start.bat` says so with a link to
https://nodejs.org.

The server itself runs completely hidden — no console window, nothing to
leave open. `start.bat`'s own window can be closed the moment it says the
scanner is running; it exits on its own a few seconds later anyway. To stop
the scanner, double-click `stop.bat`.

### A real bug this surfaced, and the real fix

The first version of `start.bat` (shipped with the very first cut of this
build) ran the *development* server and opened the browser after a fixed
6-second guess. Real testing found a production-build bug it would have hit
regardless: `package.json` had `"sideEffects": false`, a bundler hint that
lets the production build silently delete any import kept only for its side
effects. `src/lib/scan-engine/` is exactly that — 21 files that do nothing
but attach themselves to `globalThis.ScannerEngine` when imported — so the
real production build was quietly shipping a scanner with **no engine
in it at all**, failing every file with "Scanner extraction engine did not
initialize." Dev mode never tree-shakes, so this never showed up there,
which is why it looked fine right up until it was actually built for real.
Fixed by explicitly marking those files (and CSS) as side-effectful in
`package.json`, verified by rebuilding and re-running the same real
documents through the finished production build — same exact results as
dev mode, to the cent.

`start.bat` now runs the production build (`npm run preview`) instead of
dev mode — fewer moving parts, faster startup, and it sidesteps an
unrelated dev-server-only plugin in `vite.config.ts` that blocks first
request on an embedded database bootstrap (harmless as shipped, since it
turned out not to trigger, but dev-mode-only complexity this build has no
reason to depend on). It also restores `VITE_AUTH_ENABLED=false` via a
plain `.env` file — an earlier cleanup pass in this build deleted the
platform-specific file that was setting it, which is a real regression
from this build's intended default; nothing else here uses auth, so
`.env` is the safe, standard way to guarantee it stays off regardless of
how the app is launched.

## Not done in this build

- No bundled portable Node and no auto-created desktop shortcut — Node.js
  must already be on the machine (`start.bat` checks and tells you if it
  isn't). The fuller one-click launcher described in the original build-017
  spec sheet remains a separate follow-up if still wanted.
- The hidden-window behavior of `start.bat`/`stop.bat`/`scripts/hidden-
  launch.vbs` could not be tested on real Windows from this environment
  (no Windows machine here) — the logic was reasoned through carefully and
  every piece that *can* run on Linux (the build, the production server,
  the exact commands the scripts invoke, the polling script) was actually
  run and verified for real. The Windows-specific parts (VBScript hidden
  launch, `netstat`/`taskkill` process detection) are unverified until
  someone runs them on a real Windows machine.
- Mid-scan editable page-count settings, Pause/Continue, and the zip-upload
  path were built by the scaffolding tool per the original spec and were
  not independently re-verified with the same rigor as the engine wiring
  above (Stop was; Pause/Continue/zip were exercised only during the
  earlier structural audit, not stress-tested against real batches).
- This is a different framework (TanStack Start + Vite 8) from the other
  numbered builds (plain Vite + React). It carries some unrelated
  scaffolding from the tool that generated it (an auth subsystem, a
  multiplayer library, game-asset skills) that this scanner does not use —
  harmless, but not lean. A future pass could strip it down.
