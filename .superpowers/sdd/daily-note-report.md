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
