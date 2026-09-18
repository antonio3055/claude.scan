# Forge Scanner

Bank-statement scanning tool. Split out from the `antonio3055/crm` repo's
`claude/tender-bell-lxu05z` branch into its own repository and its own
Vercel project, so Scanner builds/deploys can never break or get mixed up
with the CRM's.

## Folders

Each `Forge-Scanner-React-0NN-*` folder is a build snapshot, kept for
rollback. `Forge-Scanner-React-018-Live-Grid` is the current one.

## Status

Copied over as-is from the CRM repo on 2026-09-18. See that repo's
`SESSION_LOG.md` (CRM section) for background: why this split happened,
and the six-plus failed Vercel deployments on the old branch that
prompted it.
