# Task 38: Isolate Daily Note Opening Lifecycle

## Scope

Move the authenticated Daily Note open/create orchestration from
`AuthenticatedWorkspace` into `useDailyNoteOpen`.

## Reliability Contract

- Preserve the existing `POST /api/v2/notes/daily` path, date body, idempotent
  command behavior, existing-note fast path, focus behavior, failure message,
  and `CreateActionResult` compatibility.
- Bind an in-flight open/create request to the exact notes client, workspace,
  logout state, selected note, active draft, creation state, and note-list view.
- Abort and ignore late results when the user changes selection, view,
  workspace, logout state, or the component unmounts; a stale response must not
  replace the current editor contents.
- Prevent duplicate Daily requests while one is pending.
- Validate the returned note workspace, active status, and requested local date
  before installing it.
- Pass an optional `AbortSignal` through `NotesClient.openOrCreateDaily`
  without changing existing one-argument callers.

## Boundary

No Worker/API route, database schema, Daily Note server semantics, visual
styling, or production deployment changes.
