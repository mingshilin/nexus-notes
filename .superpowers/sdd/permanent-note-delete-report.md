# Permanent Note Delete Report

## Scope

Implemented Public Beta permanent deletion for one trashed note via `DELETE /api/v2/notes/:noteId`. The implementation includes the shared contract, workspace editor-gated route, service/repository CAS behavior, D1 cleanup and audit/tombstone effects, web client, and Trash confirmation dialog.

## RED Evidence

All focused tests were added before production edits and run RED first.

| Command | Expected RED evidence |
| --- | --- |
| `npm run test --workspace @nexus/contracts -- tests/notes-contracts.test.ts` | Failed at `expected undefined to be defined` because `DeleteNoteInputSchema` was not exported. |
| `npm run test --workspace @nexus/worker -- tests/d1-permanent-note-delete.test.ts` | Failed in all three initial real D1 cases with `repository.deletePermanently is not a function`. |
| `npm run test --workspace @nexus/worker -- tests/note-service.test.ts tests/note-routes.test.ts` | Failed because `deletePermanently` was missing and DELETE returned `405`, rather than the expected success, validation, and viewer authorization responses. |
| `npm run test --workspace @nexus/web -- tests/notes-client.test.ts tests/live-notes-flow.test.tsx` | Failed because `NotesClient.deletePermanently` was missing and the Trash UI had no `永久删除` action. |

## Changed Files

- `packages/contracts/src/notes.ts`
- `packages/contracts/tests/notes-contracts.test.ts`
- `apps/worker/src/notes/d1-note-repository.ts`
- `apps/worker/src/notes/note-service.ts`
- `apps/worker/src/routes/notes.ts`
- `apps/worker/tests/d1-permanent-note-delete.test.ts`
- `apps/worker/tests/note-routes.test.ts`
- `apps/worker/tests/note-service.test.ts`
- `apps/web/src/data/notes-client.ts`
- `apps/web/src/app/App.tsx`
- `apps/web/tests/notes-client.test.ts`
- `apps/web/tests/live-notes-flow.test.tsx`

## Implementation And Atomicity

- `DeleteNoteInputSchema` accepts only a positive integer `base_revision`.
- The route requires workspace authentication and role `editor`; its normal gateway behavior returns 403 to a viewer.
- `NoteService.deletePermanently` maps repository outcomes to `NOTE_NOT_FOUND` (404), `NOTE_NOT_TRASHED` (409), and `NOTE_CONFLICT` (409).
- `D1NoteRepository.deletePermanently` uses one D1 `batch`. Each explicit cleanup (`comments`, `public_shares`, `search_documents`), the `sync_changes` delete tombstone, and request-correlated activity/audit inserts carry the same workspace/id/trashed/exact-revision guard. The guarded final `DELETE FROM notes ... RETURNING` commits only after those statements.
- A failed CAS therefore rolls back and/or no-ops every pre-delete effect. The final delete lets existing foreign keys cascade revisions, tags, links, reminders, and mentions; it preserves attachments and database records through their existing `ON DELETE SET NULL` relationships. Explicit search-document deletion activates the existing FTS cleanup trigger. Presence invalidation executes only after a committed delete and is caught as advisory.
- The Trash editor displays `永久删除`. Its in-app dialog explains irreversibility, starts focus on cancel, traps Tab focus, restores focus to the trigger after dismissal, prevents duplicate submission while pending, preserves the selected note/dialog on failure for retry, and clears the deleted selection without navigation on success.

## GREEN Evidence

Focused GREEN runs:

- contracts: `notes-contracts.test.ts` passed 4/4.
- worker focused: `d1-permanent-note-delete.test.ts`, `note-service.test.ts`, and `note-routes.test.ts` passed 17/17; the final real-D1-only run passed 5/5, including Presence-failure isolation.
- web focused: `notes-client.test.ts` and `live-notes-flow.test.tsx` passed 28/28.

Affected package verification:

- `npm run test --workspace @nexus/contracts`: 9 files, 38 tests passed.
- `npm run typecheck --workspace @nexus/contracts`: passed.
- `npm run test --workspace @nexus/worker`: 54 files, 353 tests passed.
- `npm run typecheck --workspace @nexus/worker`: passed.
- `npm run test --workspace @nexus/web`: 36 files, 271 tests passed.
- `npm run typecheck --workspace @nexus/web`: passed.

## Self-Review

- Checked `git diff --check` before staging and confirmed the staged implementation contained only the 12 task code/test files.
- Confirmed the permanent deletion path does not delete R2 files, attachment rows, database-record rows, historical logs, or whole-trash contents.
- Confirmed explicit public-share cleanup remains workspace-scoped and routes do not alter public-share authentication/isolation paths.
- Confirmed the UI uses no `window.confirm` or `window.alert`.

## Concerns

None. The repository already had untracked `pnpm-lock.yaml` and `pnpm-workspace.yaml`; they were preserved, never staged, and are unrelated to this task.

## Commit SHA

Implementation and tests: `cf187dc312ea06c503e24a39cbbcd95e25b65461` (`feat(beta): permanently delete trashed notes`).

## Review Fixes

### RED Evidence

Added focused tests before changing the dialog implementation or CSS, then ran:

- `npm run test --workspace @nexus/web -- tests/live-notes-flow.test.tsx tests/permanent-note-delete-styles.test.ts`
  - Five normalized-error cases initially rendered the same generic message.
  - Pending `Tab` did not prevent focus from escaping because disabled buttons left no focusable target.
  - The dialog lacked `tabindex="-1"`.
  - The destructive selector and 390px safe-area/scroll CSS rules were absent.
- `npm run test --workspace @nexus/worker -- tests/note-routes.test.ts`
  - The strengthened exact success-envelope assertion passed immediately because the existing route already returned `{ success: true, data: { deleted: true }, request_id }`; this was a coverage-only test correction, not missing production behavior.

### Changed Files

- `apps/web/src/app/App.tsx`
- `apps/web/src/styles.css`
- `apps/web/tests/live-notes-flow.test.tsx`
- `apps/web/tests/permanent-note-delete-styles.test.ts`
- `apps/worker/tests/note-routes.test.ts`

### Fix Summary

- Permanent-delete failures now distinguish `NOTE_CONFLICT`, `NOTE_NOT_TRASHED`, `NOTE_NOT_FOUND`, retryable network/timeout failures, and unknown failures. The rendered message retains a request ID only when it matches a safe bounded identifier format.
- While a delete request is pending, the dialog receives programmatic focus and intercepts both Tab directions when all actions are disabled. Escape and backdrop dismissal remain blocked while pending.
- Added destructive styling for the Trash action and confirmation button. The confirmation selector is more specific and appears after the generic blue account-action rule.
- Added mobile rules for safe-area padding, overlay scrolling, dialog height bounds, and tall-content scrolling at 390px.
- The DELETE route success test now asserts the entire normal envelope.

### GREEN Evidence

- Focused Web: `live-notes-flow.test.tsx` and `permanent-note-delete-styles.test.ts` passed 29/29.
- Focused Worker: `note-routes.test.ts` passed 6/6.
- `npm run typecheck --workspace @nexus/web`: passed.
- `npm run typecheck --workspace @nexus/worker`: passed.
- Full Web suite: 37 files, 280 tests passed.
- Full Worker suite: 54 files, 353 tests passed.

### Self-Review And Concerns

- The atomic D1 repository and API surface were not changed.
- Confirmed no write retries, whole-trash deletion, or browser-native confirmation were introduced.
- Confirmed the fix commit contains only dialog, CSS, and focused test files; `pnpm-lock.yaml` and `pnpm-workspace.yaml` remain untracked and unstaged.
- No remaining concerns.

### Fix Commit SHA

`0c3d970eaba2c8c9b4c75ffaec65da4911f8ff92` (`fix(beta): harden permanent delete dialog`).

## Review Fixes 2

### RED Evidence

Focused Web tests were added before production edits, then run with the checked-in root Vitest binary because the preserved, untracked `pnpm-workspace.yaml` is not recognized by pnpm's workspace filter in this checkout.

- `..\\..\\node_modules\\.bin\\vitest run --config vitest.config.ts tests/adaptive-workbench.test.tsx tests/live-notes-flow.test.tsx`
  - `applies the existing modal boundary for a parent-owned external modal` failed because rail `aria-hidden` was absent: `externalModalOpen` did not exist in `AdaptiveWorkbench`'s modal truth.
  - `keeps the workbench inert and ignores Ctrl+N while permanent deletion is pending` failed because the workbench canvas had no `inert` attribute while the parent dialog was open.
  - The extended permanent-delete success test failed because focus landed on `body`, not the surviving `Public Beta 重写计划` heading after deleting the opener note.

### Changed Files

- `apps/web/src/layout/AdaptiveWorkbench.tsx`
- `apps/web/src/app/App.tsx`
- `apps/web/tests/adaptive-workbench.test.tsx`
- `apps/web/tests/live-notes-flow.test.tsx`

### Fix Summary And Atomicity

- `AdaptiveWorkbench` now accepts the controlled optional `externalModalOpen` state and folds it into its sole `modalOpen` value. Existing rail, context, canvas, scroll-owner, body-overflow, and mobile-chrome handling therefore applies without duplicating a second modal implementation.
- `App` passes permanent-delete visibility to that boundary and explicitly exits the window-level Ctrl/Cmd+N shortcut while the dialog is open, including pending deletion.
- The permanent-delete close path records either the triggering opener for cancellation or failure dismissal, or a focusable Notes canvas heading for successful deletion. The layout effect focuses that surviving fallback only after the trashed note/editor has been removed.
- The pending-promise flow verifies no POST draft request occurs, the selected trashed note remains selected until deletion resolves, and no unrelated draft is cleared by the completed delete.
- No D1, API, client, migration, or deletion atomicity code changed.

### GREEN Evidence

- Focused Web: `..\\..\\node_modules\\.bin\\vitest run --config vitest.config.ts tests/adaptive-workbench.test.tsx tests/live-notes-flow.test.tsx` passed 2 files / 36 tests.
- Web typecheck: `node_modules\\.bin\\tsc -p apps\\web\\tsconfig.json --noEmit` passed.
- Worker typecheck: `node_modules\\.bin\\tsc -p tsconfig.worker.json --noEmit` passed.
- Full Web suite: `..\\..\\node_modules\\.bin\\vitest run --config vitest.config.ts --reporter=dot` completed successfully.

### Self-Review And Concerns

- `git diff --check` passed before staging. The implementation commit contains only the four bounded Web files above.
- Cancel focus restoration remains covered by the existing test; success now asserts the dialog closes, the row disappears, and the surviving canvas heading owns focus.
- `pnpm-lock.yaml` and `pnpm-workspace.yaml` remained untracked and unstaged throughout. No browser, session, token, secret, API, D1, or migration artifact was touched.
- Concern: pnpm's workspace command could not run in this checkout because its workspace manifest is intentionally untracked, and `pnpm --dir apps/web` attempted an install blocked by ignored build-script policy. Equivalent direct checked-in Vitest and TypeScript binaries completed all required verification.

### Fix Commit SHA

`16e1796ec95bc669f1e05ffa8c58fdb5f2c96325` (`fix(beta): isolate permanent delete modal`).
