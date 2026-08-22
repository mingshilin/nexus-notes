# Product Completion Phase 1 Task 7 Report

## Status

PASS. Durable one-activation note creation is implemented and committed on `codex/public-beta-rewrite`.

## Commit

`2ca4d2c6833f1e9f844d5a2aac42b1c9738c534e`

Message: `feat(notes): make new note visible and durable`

## Files

- `apps/web/src/data/local-store.ts`
- `apps/web/tests/local-store.test.ts`
- `apps/web/src/notes/note-draft-controller.ts`
- `apps/web/tests/note-draft-controller.test.ts`
- `apps/web/src/app/App.tsx`
- `apps/web/tests/live-notes-flow.test.tsx`
- `apps/web/src/styles.css`

## TDD Evidence

Focused RED after adding local-store/controller tests:

- Test files: 2 failed, 1 passed.
- Tests: 1 failed, 3 passed.
- Expected failures: missing `listDrafts`/`removeDraft` implementation and unresolved `note-draft-controller` import.

Focused RED after adding the interaction/recovery coverage:

- Test files: 1 failed, 8 tests executed.
- Tests: 7 failed, 1 passed.
- Expected failures: missing durable activation, title focus, shortcut handling, recovery, reconciliation, and labeled empty-state action.

Final GREEN:

- Command: `npm run test --workspace @nexus/web -- tests/local-store.test.ts tests/note-draft-controller.test.ts tests/live-notes-flow.test.tsx`
- Test files: 3 passed.
- Tests: 15 passed, 0 failed.

## Verification

- `npm run typecheck --workspace @nexus/web`: passed, exit code 0.
- `git diff --check`: passed, no output.
- No backend, API, schema, deployment, or external state changes.

## Self-review

- Local draft creation awaits IndexedDB persistence before exposing the draft; failed persistence does not create an ephemeral editor.
- Draft writes are serialized per workspace/local ID, and unmount/workspace transitions flush pending writes before reconciliation or teardown.
- Recovery is workspace-scoped, newest-first, waits for note loading, and does not replace a user-selected note.
- Click, Ctrl+N/Cmd+N, repeat suppression, editable-target filtering, one-activation focus, server success, server failure, remount recovery, workspace isolation, and both visible labeled actions are covered.
- Server creation starts after the local draft is rendered, preserves latest edits through reconciliation, and removes the local draft only after the server note is installed/open.

## Concerns

- The requested verification is focused on the three Task 7 test files; the full repository test suite and browser-level E2E were not run.
- The browser integration uses the existing `BetaLocalStore` by default and accepts an injected store for deterministic tests; a production browser smoke test with real IndexedDB remains a useful follow-up.
- An unavailable reviewer subagent prevented an independent second-pass review; the final review was performed locally against the Task 7 requirements and race/error paths.

## Fix Review

### Status

PASS. Review lifecycle defects are fixed in a separate commit on `codex/public-beta-rewrite`.

### Commit

`283b622f6fb878dd5d6a019e4b9d03bd426585dc` (`fix(notes): harden durable draft lifecycle`)

### TDD RED Evidence

- `local-store.test.ts`: `1 failed, 2 passed`; the new unavailable-IndexedDB test received the old `undefined.open` error instead of the recoverable `IndexedDB is unavailable` error.
- `note-draft-controller.test.ts`: `1 failed, 10 passed`; reload incorrectly changed persisted PATCH key `local-1:update:7` to `local-1:update:0`.
- `note-draft-controller.test.ts`: `2 failed, 11 passed`; controlled POST/PATCH interleavings showed that retries reused a key with a newer payload instead of replaying the original durable request payload.

### GREEN Evidence

- Focused command: `4` test files passed, `33/33` tests passed.
- Full Web command: `31` test files passed, `161/161` tests passed, with no unhandled errors.
- `npm run typecheck --workspace @nexus/web`: passed.
- `git diff --check`: passed with no output.

### Changed Files

- `apps/web/src/app/App.tsx`
- `apps/web/src/data/local-store.ts`
- `apps/web/src/data/notes-client.ts`
- `apps/web/src/notes/note-draft-controller.ts`
- `apps/web/tests/live-notes-flow.test.tsx`
- `apps/web/tests/local-store.test.ts`
- `apps/web/tests/note-draft-controller.test.ts`
- `apps/web/tests/notes-client.test.ts`

### Lifecycle Self-Review

- POST identity is the persisted local `entity_id`; explicit idempotency keys remain optional in `NotesClient`, and default key generation is unchanged for existing callers.
- Pending POST and PATCH payloads, PATCH base revision, server note ID, revision, and update metadata are persisted before network replay or local deletion. Reload therefore skips POST when `server_note_id` exists and can safely replay a lost response with the original key and payload.
- Saves, server-state writes, and tombstone removal share one per-draft serialized queue. Reconciliation marks the draft tombstoned before observing the queue; pre-tombstone saves finish before removal, while later saves are rejected and cannot resurrect the draft.
- Each draft has its own sync promise and generation. `finally` releases sync state after success or failure, so a failed or late old-workspace request cannot block another draft. Late responses only mutate UI when the component is still mounted and the same draft remains active; durable server identity is still coordinated independently.
- Latest edits are re-read after each network operation. A request that raced with an edit is followed by another PATCH using a new key; a replayed request uses its persisted original payload first.
- Recovery remains settled-load, workspace-scoped, newest-first, deterministic by `updated_at` then `entity_id`, and never overwrites an already selected note. Focus, one-activation suppression, editable-target shortcut filtering, failure recovery, workspace isolation, and both labeled actions remain green.
- IndexedDB opening is lazy and reports an explicit recoverable error when unavailable, preventing default App mounts in non-IDB environments from producing unhandled rejections or exposing an ephemeral draft.

### Concerns

- No backend, API, schema, deployment, or external state changes were made. Browser smoke testing with a real production IndexedDB implementation was not part of this revision; the local-store suite uses `fake-indexeddb` and the full Web suite is green.

## Fix Review 2

### Status

PASS. The second lifecycle review is addressed in a separate commit.

### Commit

`613c51c` (`fix(notes): separate sync and reconcile lifecycle`)

### RED Evidence

- The final uncovered legacy-reload case was run before implementation: `tests/note-draft-controller.test.ts -t "hydrates a legacy"` produced `1 failed, 18 skipped` and stopped at the missing persisted server snapshot path.
- The review-2 interleaving RED cases covered the reported failures: sync had to be separated from deletion, late same-workspace responses could steal selection, unmount/workspace changes could lose server-bound recovery, local server state could be inferred from edited draft fields, and PATCH replay could lose its exact operation identity. The implementation was then driven by the controlled-promise tests now listed in the focused suite.

### GREEN Evidence

- Focused command: `4` test files passed, `43/43` tests passed, including the prior `33` focused tests and the legacy server-bound hydration regression.
- Full Web command: `31` test files passed, `171/171` tests passed with no unhandled errors.
- `npm run typecheck --workspace @nexus/web`: passed, exit code 0.
- `git diff --check`: passed with no output.

### Changed Files

- `apps/web/src/app/App.tsx`
- `apps/web/src/data/local-store.ts`
- `apps/web/src/notes/note-draft-controller.ts`
- `apps/web/tests/live-notes-flow.test.tsx`
- `apps/web/tests/note-draft-controller.test.ts`

### Lifecycle Proof

- `sync()` only creates/binds/updates server state and returns the exact `Note`, persisted `LocalDraft`, and synchronized generation. It never calls `removeDraft`. App installs the server note into the current list first; the React effect reconciles only after installation is observable. A same-workspace selection change therefore adds the note without replacing selection, while unmount or workspace change leaves the bound draft persisted for recovery.
- `LocalDraft.server_note` stores the complete serializable server snapshot. Existing server-bound drafts without that field hydrate it through `NotesClient.get()` and persist the returned snapshot before any PATCH. Sync comparisons use that snapshot's title/content, so a reload detects edits made after binding instead of deleting on an inferred match.
- `pending_patch` stores a unique monotonic generation, idempotency key, exact title/content payload, source, and base revision before dispatch. A replay uses the same key and payload; only the matching response clears the pending operation after its returned server snapshot is durably saved. A later edit receives the next persisted key.
- Every local save, server-state write, patch-intent write, and reconcile/delete operation chains through the same per-draft tail. Reconcile tombstones before observing the tail, so already queued saves finish and later saves no-op. Tail cleanup is attached to the current tail, and delete failure clears the tombstone so a later retry remains recoverable.
- Sync and reconcile state is per draft, with `finally` release for success and failure. Late server responses still persist server identity in the old workspace but UI installation checks mount/current-draft state, preventing mutation of a new workspace or selected note and avoiding a global stuck lock.
- Active draft edits are persisted only from input handlers. Initial creation and recovery continue to use their existing durable paths, avoiding duplicate effect writes while retaining one-activation creation and title focus.

### Concerns

- No backend, API, schema, deployment, or external state changes were made. Correct one-note recovery for a committed POST relies on the existing server idempotency-key contract; browser-level testing against a live backend was not run.
- Legacy drafts with `server_note_id` but no snapshot require a client implementing `get`; without it, the controller keeps the draft and reports a recoverable error rather than risking a duplicate POST.
