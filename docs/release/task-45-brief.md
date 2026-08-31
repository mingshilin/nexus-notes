# Task 45: Isolate Offline Conflict Reads

## Scope

Extract the server-version read triggered by offline sync conflicts from
`AuthenticatedWorkspace` and bind it to the active editor scope.

## Reliability Contract

- Preserve the existing conflict panel and local snapshot semantics: use
  operation patch title/content first, then editor refs as fallback.
- Validate note operation type, operation workspace, active draft state and ref,
  current client, logout state, mounted lifecycle, and request ownership before
  reading or publishing.
- Pass an optional `AbortSignal` to `NotesClient.get` and abort on workspace,
  client, active-draft, logout, or unmount changes.
- Late success, error, and finally callbacks must not affect a new editor scope.
- Keep the existing recoverable error message and avoid applying ordinary auth or
  workspace permissions to public share routes.

## Boundary

No API route, database schema, visual redesign, deployment, GitHub, or production
change.
