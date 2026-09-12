# Task 44: Isolate Note Draft Input Saves

## Scope

Extract title/content draft input persistence from `AuthenticatedWorkspace` and
bind local-save failure feedback to the exact active draft scope.

## Reliability Contract

- Preserve the existing editor, AI content insertion, attachment-link insertion,
  local draft persistence, and retry message behavior.
- Bind input updates to the current client, workspace, role, logout, mounted, and
  per-render scope lifecycle.
- Track save attempts per draft so an older rejection cannot surface after a new
  draft or selected note becomes active.
- Keep current input in the editor when saving fails; do not silently discard the
  local draft.
- Retained callbacks after unmount must not start a new local save.

## Boundary

No API route, database schema, visual redesign, deployment, GitHub, or production
change.
