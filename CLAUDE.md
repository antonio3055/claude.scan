# Forge Scanner

Client-side PDF bank-statement/application scanner (PDF.js + Tesseract.js +
a plain-JS extraction engine, React/Vite UI). No backend, no server-side
processing — everything runs in the browser.

**Before doing anything else in this repo, read `SESSION_LOG.md`.** It's
the running history of what's been built, fixed, and decided across every
session — read it first so you don't redo work, reintroduce a bug that was
already fixed, or contradict a decision that was already made. Append to
it (don't rewrite past entries) at the end of any session that changed
code, fixed a bug, or made a real decision. Skip it for trivial/no-op
sessions.

## Layout

- Working directory: `Forge-Scanner-React-018-Live-Grid/` — the current,
  actively-developed build. Everything else (`Forge-Scanner-React-0NN-*`)
  is a historical rollback snapshot; don't edit those, don't deploy them.
- `src/scanner/engine/` — plain JS extraction engine (bank recognition,
  transaction parsing, confidence scoring, etc.), runtime-agnostic and
  covered by `scripts/test-*.mjs` (run with `npm run test:engine`,
  `test:extraction`, etc. — see `package.json`).
- `src/scanner/` (components/hooks/lib/services) — the React UI.

## Standing rules

- **Name this session "Scanner NN"** (next number after the highest
  existing one — check the session list if unsure; as of this writing the
  last one was "Scanner 02"), so the user can tell chats apart by order.
  Rename the session to this near the start of the conversation.
- **Never edit, fix, rebuild, rename, save, export, or modify any file
  until the user types the exact literal word `GO`.** Until then: inspect,
  explain, recommend only. This is a repeatedly-stated, non-negotiable
  rule from the project owner — see SESSION_LOG.md for the full context.
- Before claiming something works, verify it — run the test suites
  (`npm run test:engine` etc.), `tsc --noEmit`, `npm run build`, and where
  UI behavior is in question, an actual headless-browser check (Playwright)
  against real or realistic data. Don't report "fixed" on code-reading alone.
- New engine/UI work gets a real regression check (existing test suites +
  build) before it's called done, not just a new-feature test.

## Deployment

- Vercel project: `forge-scanner` (https://forge-scanner-one.vercel.app),
  Root Directory = `Forge-Scanner-React-018-Live-Grid`, auto-deploys from
  `main`. This is the only scanner Vercel project that should exist —
  earlier sessions accumulated ~8 duplicate/misconfigured ones (wrong root
  directory, orphaned, never connected) before this was cleaned up; don't
  recreate that mess.
- This session (Claude Code on the web) generally cannot see or modify the
  user's Vercel project settings directly — redeploys and dashboard config
  changes are the user's to do, unless a later session finds that's changed.
