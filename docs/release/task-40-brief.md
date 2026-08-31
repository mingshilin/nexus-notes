# Task 40: Harden Notes Inspector Mutations

## Scope

Harden the note Inspector's tag creation, tag assignment, and note-link save
flows in `useNoteInspectorData`.

## Reliability Contract

- Preserve existing tag/link API paths, request bodies, optimistic tag rollback,
  return values, error messages, and Inspector UI behavior.
- Bind Inspector writes to the exact knowledge client, workspace, selected note,
  creation state, role, logout state, and mounted lifecycle.
- Reject stale callbacks before issuing a write; late results after selection,
  workspace, role, logout, client, or unmount changes must not update current
  Inspector state.
- Prevent overlapping writes of the same Inspector mutation class while one is
  pending, and abort active writes when their scope changes or the component
  unmounts.
- Pass optional `AbortSignal` values through `KnowledgeClient.createTag`,
  `setNoteTags`, and `setNoteLinks` without breaking existing callers.
- Abort errors must remain silent and must not be converted into user-facing
  failure messages for a new scope.

## Boundary

No Worker/API route, database schema, visual redesign, migration, deployment,
GitHub, or production changes.
