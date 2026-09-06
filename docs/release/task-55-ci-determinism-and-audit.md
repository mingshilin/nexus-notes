# Task 55: CI Determinism and Production Audit

## Failures

The Linux release workflow exposed two independent gates:

- `fflate@0.8.2` matched `GHSA-px8p-9vwx-vf98` in the production dependency
  audit.
- Full Web execution allowed database tests to reuse process-global IndexedDB
  state, and an AI focus assertion ran before its React effect completed.

## Fix

- Upgrade root and Worker declarations plus `package-lock.json` to
  `fflate@0.8.3`.
- Inject an isolated draft store into every `database-workspace-live` scenario.
- Await the existing asynchronous proposal autofocus effect in the AI component
  test.

No database, product API, or runtime UI behavior changed.

## Evidence

- Database and AI component regression: `2 files / 37 tests` passed.
- `npm audit --omit=dev`: `0 vulnerabilities`.
- Full lint passed.
- Production build passed; entry chunk `382.43 kB` with no chunk-budget
  warning.
- Fresh Linux CI remains required after push.
