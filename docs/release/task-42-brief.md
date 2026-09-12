# Task 42: Isolate Note Folder Creation

## Scope

Extract note-folder creation from `AuthenticatedWorkspace` and bind the write to
the active workspace lifecycle.

## Reliability Contract

- Preserve the existing folder creation route, payload, response shape, sorting,
  automatic filter selection, and `Promise<void>` callback contract.
- Pass an optional `AbortSignal` through `KnowledgeClient.createFolder` without
  breaking existing callers.
- Abort active folder creation when the workspace, client, role, or logout scope
  changes, and reject stale responses before they update folders or filters.
- Validate that a successful folder response belongs to the active workspace.
- Keep the panel input on abort or failure; only real failures show the existing
  retryable error message.

## Boundary

No API route, database schema, visual redesign, deployment, GitHub, or production
change.
