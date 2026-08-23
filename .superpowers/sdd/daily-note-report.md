# Daily Note Public Beta Parity Report

## Result

- Status: DONE_WITH_CONCERNS
- Base: `1764b539`
- Branch: `codex/public-beta-rewrite`
- Implementation commit: `b019b08`

## RED Evidence

Focused tests were written before production edits and run while the feature was absent:

- Contracts: `DailyNoteInputSchema` was undefined.
- Worker: `/api/v2/notes/daily` returned `405`, `NoteService.openOrCreateDaily` and repository operation were undefined, and migration `0012_daily_notes.sql` was absent.
- Web: `NotesClient.openOrCreateDaily` and the Today action were absent.

The RED runs were therefore feature-missing failures, not assertion or test-setup failures. The migration fixture path was corrected before implementation because it initially resolved to `apps/migrations` rather than `apps/worker/migrations`; no production code had been edited at that point.

## Changed Files

- `packages/contracts/src/notes.ts`: strict `DailyNoteInputSchema` / `DailyNoteInput`.
- `apps/worker/migrations/0012_daily_notes.sql`: additive active Daily Note uniqueness triggers that preserve legacy duplicates.
- `apps/worker/src/notes/note-service.ts`: Daily Note service mapping.
- `apps/worker/src/notes/d1-note-repository.ts`: workspace/date lookup, deterministic newest match, create/re-read winner flow.
- `apps/worker/src/routes/notes.ts`: editor-only, notes-quota `POST /api/v2/notes/daily` with HTTP 200 envelope.
- `apps/web/src/data/notes-client.ts`: non-retryable idempotent Daily Note command.
- `apps/web/src/app/App.tsx`: Today action, local date generation, pending guard, reconciliation, focus, and recoverable Chinese error rendering.
- Focused contract, Worker, migration, repository, route, client, and Web flow tests.

## Idempotency and Transaction Reasoning

The endpoint accepts only a calendar string and never constructs it through a server timezone. Every lookup and insert is scoped by `workspace_id`; cross-workspace notes cannot satisfy the lookup. Existing active matches are ordered by `updated_at DESC, id DESC`.

Migration `0012` is additive. It does not rewrite or delete existing rows, so historical active duplicates remain readable. Insert/update triggers reject future active duplicates with `DAILY_NOTE_EXISTS`. `openOrCreateDaily` first reads the deterministic winner, otherwise reuses the normal `createNote` D1 batch for note, revision 1, sync, search, activity, and audit side effects. If a concurrent creator wins the trigger, the repository re-reads and returns that committed winner; unrelated errors are rethrown.

## GREEN Evidence

- Focused contracts: `5/5` tests passed.
- Focused Worker Daily/service/route suite: `18/18` tests passed.
- Focused Web Daily/client/flow suite: `40/40` tests passed.
- Full Beta test, isolated after an environment-only port collision: Web `37` files / `286` tests; Worker `56` files / `358` tests; contracts `9` files / `39` tests; domain `6` files / `21` tests; UI `1` file / `2` tests; testkit no tests with `passWithNoTests`.
- `npm run beta:lint`: passed for all six workspaces.
- `npm run beta:build`: passed; Vite production build completed.
- `npm audit --omit=dev --audit-level=high`: `0 vulnerabilities`.
- `npm run verify:deploy`: passed.
- `npm run verify:preview`: passed.
- `git diff --check`: passed.

## Self-Review

- Existing `POST /api/v2/notes` remains HTTP 201 and was not changed.
- Static `/api/v2/notes/daily` is registered before `:noteId`, matching the current route matcher safely.
- Viewer access is rejected by the existing workspace gateway role check; editor and notes quota are declared on the new route.
- The Web action uses local `YYYY-MM-DD`, keeps the existing context drawer/scroll owner, prevents duplicate requests, selects and focuses the returned note, and reconciles it into local state.
- Failure preserves the active selection/draft and displays a recoverable Chinese error both in the editor and, when no editor is open, in the Today context list.
- Only task files were staged. Pre-existing untracked `pnpm-lock.yaml` and `pnpm-workspace.yaml` were not staged or modified.

## Concerns

- The full Beta test was first attempted while two earlier test processes were still running and produced Miniflare `EADDRINUSE` failures. Those processes were confirmed stopped, and the full suite was rerun once in isolation with all suites passing. This is an environment/test-process concern, not a product failure.
- The additive trigger intentionally leaves any pre-existing active Daily Note duplicates in place. The repository returns the deterministic newest row, while newly created active duplicates are blocked. A future cleanup migration would require an explicit product decision and is outside this bounded task.

## Review Fixes

### RED Evidence

Starting from `8a43804`, focused tests were added before production edits:

- Contract RED: `2026-02-31` was accepted by the regex-only date schema.
- Service RED: repository `DAILY_NOTE_EXISTS` errors escaped as generic `Error` for both normal create and update.
- Web RED: the mobile Today action carried `note-empty-create-note`, the class hidden by the mobile media query.
- D1 evidence test was changed to start both calls from an empty state; it exposed an order-dependent audit assertion when either caller won.
- The tablet/context recovery test passed in RED because the existing HEAD already rendered the error in the context list. No production change was needed for this finding; the test now protects the behavior and verifies retry re-enablement.

### Fixes and Changed Files

- `packages/contracts/src/notes.ts`: validate month/day ranges and Gregorian leap years using string components and integer arithmetic only; no timezone conversion.
- `apps/worker/src/notes/note-service.ts`: map `DAILY_NOTE_EXISTS` from normal repository create/update operations to `DAILY_NOTE_CONFLICT`, HTTP 409, non-retryable; Daily open/create re-read behavior remains unchanged.
- `apps/web/src/app/App.tsx`: use dedicated `daily-note-action` class so the Today action remains reachable at 390px.
- Focused contract, service, route, repository, and Web tests were strengthened or added.

Fix implementation commit: `2985703`

### GREEN and Full Gates

- Focused contracts: `5/5` tests passed.
- Focused Worker repository/service/routes: `21/21` tests passed.
- Focused Web flow: `33/33` tests passed.
- Full Beta test: Web `37/37 files, 288 tests`; Worker `56/56 files, 362 tests`; contracts `9/9 files, 39 tests`; domain `6/6 files, 21 tests`; UI `1/1 file, 2 tests`; testkit no tests with `passWithNoTests`.
- `npm run beta:lint`: passed for all six workspaces.
- `npm run beta:build`: passed.
- `npm audit --omit=dev --audit-level=high`: `0 vulnerabilities`.
- `npm run verify:deploy`: passed.
- `npm run verify:preview`: passed.
- `git diff --check`: passed.

### Fix Self-Review and Concerns

- Existing paths, envelopes, authorization, quota, normal note side effects, and historical duplicate preservation remain unchanged.
- Normal `POST /api/v2/notes` and `PATCH /api/v2/notes/:noteId` now return the stable 409 conflict envelope for controlled Daily Note uniqueness conflicts; Daily open/create still returns its committed winner.
- The context-pane recovery behavior was already present at the review baseline and is now directly covered at tablet width with the retry button enabled after failure.
- No unresolved concerns. Historical duplicate rows remain intentionally preserved as required; OCR invalid-message stderr in the full suite is expected test output.

## Review Fix 2

### Scope and RED Evidence

Starting from `dbd496c`, fix2 addressed the remaining Important context-surface alert issue and strengthened historical duplicate evidence. Tests were added before the production edit.

- The first 390px test attempt exposed a test-flow issue because mobile chrome was hidden while the draft title still had focus; the test was corrected to blur the title before opening the context pane.
- The corrected web RED run failed only the new mobile draft/context test: `34 tests, 1 failed`, with `Unable to find role="alert"` inside the active context pane while `creatingNote` remained true.
- The migration evidence run passed `2/2` before production edits, showing the existing repository ordering and migration triggers already had the required behavior but lacked this explicit historical fixture and update-branch evidence.

### Changed Files

- `apps/web/src/app/App.tsx`: render the Daily Note error in the Today context surface whenever `activePane === "context"`, regardless of selection or draft creation; suppress the duplicate editor alert while that context surface is active.
- `apps/web/tests/live-notes-flow.test.tsx`: add a 390px unsaved-draft failure regression covering context placement, draft preservation after returning to the editor, Today selection, and retry re-enablement.
- `apps/worker/tests/daily-note-migration.test.ts`: seed two historical active duplicates before migration, assert `openOrCreateDaily` returns the newest by `updated_at`, exercise the update trigger through a new candidate row, and verify both historical rows remain unchanged.

### Idempotency and Transaction Reasoning

The UI change only changes error placement and duplicate suppression; it does not alter the Daily POST, pending guard, retry reset, selection, or draft state transitions. `openOrCreateDaily` continues to read active rows with `ORDER BY updated_at DESC, id DESC`, so preserved duplicates have a deterministic winner. Migration `0012` remains additive: the insert and update triggers reject future active duplicates without rewriting historical rows. The update test uses a separate candidate row, proving trigger rollback without attempting cleanup or revision of either historical duplicate.

### GREEN Evidence

- Focused web GREEN: `tests/live-notes-flow.test.tsx`, `34/34` tests passed.
- Focused worker GREEN: migration and repository suites, `4/4` tests passed.
- Full `npm run beta:test`: web `37/37 files, 289 tests`; worker `56/56 files, 363 tests`; contracts `9/9 files, 39 tests`; domain `6/6 files, 21 tests`; UI `1/1 file, 2 tests`; testkit `passWithNoTests`.
- `npm run beta:lint`: passed for all six workspaces.
- `npm run beta:build`: passed, including the Vite production build.
- `npm run verify:deploy`: passed.
- `npm run verify:preview`: passed.
- `npm audit --omit=dev --audit-level=high`: `0 vulnerabilities`.
- `git diff --check`: passed.

### Self-Review

- Today context errors now remain visible over an existing selected note or an in-flight unsaved draft on mobile and tablet, while closing the context pane restores the editor error without duplicating alerts.
- The retry button becomes enabled through the existing `finally` state reset; no API, route matching, authorization, quota, date validation, migration, or transaction behavior changed.
- Historical duplicates are neither deleted nor revised. The new evidence checks both timestamp ordering and the update-trigger rejection path.
- Only the three bounded task files plus this required report are intended for commit. Untracked `pnpm-lock.yaml` and `pnpm-workspace.yaml` remain untouched and unstaged.

### Concerns and Commit

- Full audit currently reports 11 vulnerabilities in the installed dependency tree, primarily development tooling; this fix changes no dependency or pnpm file. Production-only audit is clean. This is retained as a non-blocking concern for dependency maintenance.
- Historical active duplicates remain intentionally preserved as required; cleanup would need a separate product decision.

Fix implementation commit: pending after verification and bounded staging.
