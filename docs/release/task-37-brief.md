# Task 37: Isolate Note Revision Restore Lifecycle

## Scope

Move the selected-note revision restore orchestration out of
`AuthenticatedWorkspace` into `useNoteRevisionRestore`.

## Reliability Contract

- Preserve the existing `POST /api/v2/notes/:id/revisions/:revision/restore`
  path, request body, response mapping, conflict message, and editor behavior.
- Bind a restore request to the exact notes client, workspace, role, logout
  state, selected note ID, selected note base revision, requested revision
  workspace, and mounted lifecycle.
- Abort and ignore a request when the user changes notes, workspace, role, or
  logout state; a late result must not replace the current editor contents or
  history state.
- Prevent duplicate restore requests while one is pending.
- Pass an optional `AbortSignal` through `NotesClient.restore` without changing
  existing three-argument callers.
- Reject viewer, trashed-note, missing-workspace, mismatched-revision, and
  missing-selection requests without a write.

## Boundary

No Worker/API route, database schema, revision conflict semantics, visual
styling, or production deployment changes.
