# Task 41: Isolate Note Conflict Resolution

## Scope

Extract the offline note-conflict resolution request from `AuthenticatedWorkspace`
and bind it to the exact active draft scope.

## Reliability Contract

- Preserve the existing local/server resolution choices, messages, draft field
  updates, retry behavior, and `Promise<void>` UI callback.
- Bind a resolution to the exact draft controller, workspace, role, logout state,
  active draft, conflict object, and mounted lifecycle.
- Old callbacks must not start after the scope changes. A request that was already
  running may finish its local-store operation, but its late success, error, and
  finally handlers must not update the new editor scope.
- Suppress overlapping conflict resolutions and protect A-B-A scope cycles with
  request and scope-token ownership.
- Viewers and logout-pending scopes cannot start conflict resolution.

## Boundary

No API route, Worker, database schema, visual design, deployment, GitHub, or
production change.
