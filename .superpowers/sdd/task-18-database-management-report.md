# Task 18: Database Management Recovery

## Status

PASS for the scoped Task 18 implementation and verification gates.

## Changed Paths

- `apps/web/src/databases/DatabaseToolsDrawer.tsx`
- `apps/web/src/databases/DatabaseManagementPanels.tsx`
- `apps/web/tests/database-management-recovery.test.tsx`
- `apps/web/tests/database-management-center.test.tsx`

## Implementation Commit

`d328eed` (`fix: harden database management recovery`)

## Behavior

- Database changes synchronously invalidate the previous database scope, abort pending stats, comment, database-permission, field-permission, member, and CSV-preview requests, clear scoped state, and advance a database generation.
- Panel changes abort panel-scoped requests and advance a panel generation. Success, failure, and finally callbacks verify the current database, panel, generation, mounted state, and request owner before writing state.
- CSV preview keeps the entered CSV and mappings after failure, exposes a specific alert and `重试 CSV 预览`, retries the same captured input, and clears the error after success.
- `DatabaseClient.previewCsv` is always called with the third `AbortSignal` argument; no runtime `function.length` detection is used.
- Member permissions continue to use the readable member selector when workspace members are available.

## RED

Command:

```text
apps/web> npx vitest run --config vitest.config.ts tests/database-management-recovery.test.tsx
```

Observed result: `4` tests failed as intended. Failures demonstrated the missing CSV retry alert, stale comment response, stale database/field permission response, and stale member response behavior. Test setup assertions were corrected without weakening the required behavior checks.

## GREEN And Gates

Focused regression command:

```text
apps/web> npx vitest run --config vitest.config.ts tests/database-management-recovery.test.tsx tests/database-management-center.test.tsx tests/database-workspace-live.test.tsx
```

Result: `3` test files passed, `10/10` tests passed.

Web typecheck:

```text
npm run typecheck --workspace @nexus/web
```

Result: passed.

Deploy readiness:

```text
npm run verify:deploy
```

Result: passed. The readiness check reported `13` JavaScript chunks and no initial `markdown-vendor`, `ocr-vendor`, or `ai-vendor` preload.

## Self-Review

- No Critical or Important findings remain within the Task 18 scope.
- Existing visual structure, API URLs, client method signatures, delete semantics, and `DatabaseWorkbench` behavior were preserved.
- Command mutations do not expose an abort parameter in the existing client; their late UI callbacks are protected by the database/panel scope guard.
- Full repository tests, build, audit, and authenticated browser E2E were not rerun in this finalization because the requested verification scope was limited to the focused tests, typecheck, and readiness command.

