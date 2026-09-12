# Task 34: Extract Database Context Panel

## Scope

Move the database contextual list and inline creation form out of
`AuthenticatedWorkspace` into a presentation-only `DatabaseContextPanel`.

## Reliability Contract

- Preserve the existing workspace-filtered database collection supplied by
  the caller.
- Preserve database selection, new-database request, inline name editing,
  cancel, submit, loading, error, and empty-state callbacks and labels.
- Preserve existing CSS classes, selection styling, and accessibility roles.
- Keep all database requests, workspace filtering, record/comment clearing,
  and active-pane changes in the existing controller/facade.

## Boundary

No API, schema, permission, database mutation, or visual design changes are
part of this task.
