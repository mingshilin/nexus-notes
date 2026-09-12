# Task 37: Note Revision Restore Lifecycle Report

## Outcome

Extracted selected-note history restoration from `AuthenticatedWorkspace` into
`useNoteRevisionRestore`. The existing restore endpoint and three-argument
`NotesClient.restore` behavior remain compatible; the new signal argument is
optional.

## Reliability Guarantees

- Restore requests are bound to client, workspace, role, logout state, note ID,
  note revision, requested revision identity, and mounted lifecycle.
- Changing the selected note or workspace aborts the active request and makes
  any late success or failure a no-op, preventing stale content from replacing
  the current editor.
- Viewer, trashed-note, missing-scope, duplicate, and mismatched revision
  requests are rejected before the endpoint is called.
- An `AbortSignal` reaches the restore request and is cancelled on scope change
  or unmount.
- Conflict and generic failures remain retryable through the existing history
  panel; successful restores preserve the existing note installation and
  history reset behavior.

## Verification Evidence

| Check | Result |
| --- | --- |
| Revision restore hook, client, and live workspace regression | `3 files / 61 tests` passed |
| Full Beta Web suite | `96 files / 700 tests` passed |
| Legacy frontend suite | `35 files / 161 tests` passed |
| Legacy Worker suite | `11 files / 63 tests` passed |
| Full Beta Worker suite | `97 files / 615 tests` passed |
| Contracts, domain, and UI workspace suites | `62 + 31 + 2 tests` passed |
| Lint and workspace typechecks | passed |
| Build | passed; initial entry `365.03 kB`, no Vite `>500 kB` warning |
| Production dependency audit | `0 vulnerabilities` |
| Deploy readiness | passed; initial preload excludes `markdown-vendor`, `ocr-vendor`, and `ai-vendor` |
| Independent task review | approved; no Critical or Important findings |

No Worker/API route, schema, deployment, GitHub, or production changes were
performed.

The review noted that the current abort evidence is hook/client level rather
than a real network-level browser abort scenario. That broader E2E case remains
part of the authenticated browser gate and is not claimed as complete here.

## Files

- `apps/web/src/app/App.tsx`
- `apps/web/src/app/use-note-revision-restore.ts`
- `apps/web/src/app/use-notes-workspace-controller.ts`
- `apps/web/src/data/notes-client.ts`
- `apps/web/tests/live-notes-flow.test.tsx`
- `apps/web/tests/notes-client.test.ts`
- `apps/web/tests/use-note-revision-restore.test.tsx`
