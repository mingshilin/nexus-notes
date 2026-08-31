# Task 43: Isolate Task Database Creation

## Scope

Extract task-database bootstrap from `AuthenticatedWorkspace` and bind its
multi-step setup result to the active database workspace scope.

## Reliability Contract

- Preserve the existing six-property, three-view, default-template setup and
  partial-setup cleanup implemented by `createTaskDatabase`.
- Do not publish databases, selection, bundle, records, refresh, pane, or domain
  navigation when the client, workspace, role, logout, mounted, or scope token
  has changed.
- Suppress concurrent setup requests and make stale success/error/finally paths
  harmless, including A-B-A workspace cycles.
- Preserve the existing `CreateActionResult` contract and keep setup failures in
  the Create Center result instead of leaking a database-page error.
- Keep all API routes and database schema behavior unchanged.

## Boundary

No API route, database schema, visual redesign, deployment, GitHub, or production
change.
