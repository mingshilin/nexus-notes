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

## Review Follow-Up: Delayed Permission Refresh

### Root Cause

The original database and field permission save handlers awaited a post-save list request and passed its result directly to a state setter. That request had no captured database/panel scope, no abort signal, and no late-response check, so a refresh started for database A could overwrite permission state after the drawer had switched to database B.

### TDD RED

Command:

```text
apps/web> npx vitest run --config vitest.config.ts tests/database-management-recovery.test.tsx
```

Result: exit code `1`; `6` tests ran, `4` passed and `2` failed. The two failures were the new cases `ignores a delayed database-permission refresh after switching databases` and `ignores a delayed field-permission refresh after switching databases`; both observed stale `user-a` content after the delayed A refresh resolved.

### Implementation

- Both save handlers capture `databaseId`, `databaseGenerationRef.current`, `panel`, and `panelGenerationRef.current` before starting the mutation.
- Each handler aborts the prior permission request, owns a fresh `AbortController` through the existing permission controller ref, and passes its signal to the post-save list request.
- The mutation completion, refresh completion, and controller cleanup use `requestIsCurrent`, which combines the captured scope, generation, mounted state, abort state, and controller ownership before updating state.
- Database and panel layout cleanup already aborts both controller refs and increments the corresponding generation, so switching scope invalidates an in-flight post-save refresh.
- No `function.length` detection or duplicate refresh path was added.

### GREEN And Gates

Focused regression and database management command:

```text
apps/web> npx vitest run --config vitest.config.ts tests/database-management-recovery.test.tsx tests/database-management-center.test.tsx tests/database-workspace-live.test.tsx
```

Result at `03:49:51`: exit code `0`; `3` test files passed and `12/12` tests passed. The two new delayed-refresh tests passed, including assertions that the post-save list calls received an `AbortSignal`.

Web typecheck:

```text
npm run typecheck --workspace @nexus/web
```

Result: exit code `0`.

Deploy readiness:

```text
npm run verify:deploy
```

Result: exit code `0`:

```text
local: deploy readiness checks passed
  - /assets/index--uGFrFPF.js
  - /assets/react-vendor-CXBjE_KV.js
  - /assets/ui-vendor-BOwHZ60u.js
  - JavaScript chunks checked=13; initial forbidden chunks absent=markdown-vendor, ocr-vendor, ai-vendor
```

## Self-Review

- No Critical or Important findings remain within the Task 18 scope.
- Existing visual structure, API URLs, client method signatures, delete semantics, and `DatabaseWorkbench` behavior were preserved.
- Command mutations do not expose an abort parameter in the existing client; their late UI callbacks are protected by the database/panel scope guard.
- Full repository tests, build, audit, and authenticated browser E2E were not rerun in this finalization because the requested verification scope was limited to the focused tests, typecheck, and readiness command.

## Final Review Follow-Up

### TDD RED

Added regression coverage for late database/field permission deletions and for a successful permission write whose follow-up list refresh fails. Before the final source change, the focused Task 18 file reported `12` tests with `3` failures: both late deletion cases removed the current database's shared permission ID, and the refresh failure was reported as `操作失败，未保存本地更改。`.

### Final Fix

- `deleteDatabasePermission` and `deleteFieldPermission` now capture database/panel generation and check `scopeIsCurrent` before mutating state after the awaited delete.
- Permission save refresh failures are handled separately from the write itself. A committed write reports `权限已保存，但权限列表刷新失败，请稍后重试。` (or the field equivalent), returns a completion-with-warning result to the mutation runner, and still triggers the normal invalidation callback.
- Abort errors are recognized for both DOMException and Error-shaped `AbortError` values.

### Final GREEN Evidence

Fresh focused run:

```text
npm run test --workspace @nexus/web -- tests/database-management-recovery.test.tsx
```

Result: `1` file passed, `12/12` tests passed.

Fresh combined run:

```text
npm run test --workspace @nexus/web -- tests/database-management-recovery.test.tsx tests/database-management-center.test.tsx tests/database-workspace-live.test.tsx
```

Result: `3` files passed, `18/18` tests passed.

Fresh `npm run typecheck --workspace @nexus/web`: exit code `0`.

Fresh `npm run build`: exit code `0`; main entry `339.17 kB`, no Vite `>500 kB` warning.

Fresh `npm run verify:deploy`: passed; initial `markdown-vendor`, `ocr-vendor`, and `ai-vendor` chunks absent.

The source/test fixes were committed on the optimization branch as `8e2a78b` (CSV file-read recovery) and `7ba19fc` (permission refresh/deletion recovery); this report update is intentionally kept with the local verification ledger.
