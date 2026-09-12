# Task 39: Harden Note Mutation Scope

## Scope

Harden the existing `useNoteMutations` save, status, flag, and permanent-delete
flows against stale async results and incomplete client-side role guards.

## Reliability Contract

- Preserve existing note API paths, request bodies, response shapes, user-facing
  success/error messages, list-view transitions, and database-delete detach
  behavior.
- Bind each mutation to the exact client, workspace, role, logout state,
  selected note ID/revision/status, captured draft, and mounted lifecycle.
- Abort and ignore late results after note/workspace/client/role/logout scope
  changes or unmount. Draft changes must keep the dispatched write serialized,
  but its stale result must not replace the current editor, selection, list
  view, dialog state, or feedback.
- Preserve a server revision learned from a stale successful response so a
  retry can use the newest known base revision without discarding newer local
  edits. A real server conflict must not be silently rebased.
- Block viewer writes before calling the client.
- Pass optional `AbortSignal` values through `NotesClient.update` and
  `deletePermanently` without breaking existing callers.

## Boundary

No Worker/API route, database schema, visual redesign, migration, deployment,
GitHub, or production changes.
