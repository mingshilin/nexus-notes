# Task 33: Extract Notes Context Panel

## Scope

Move the notes contextual list markup out of `AuthenticatedWorkspace` into a
small `NotesContextPanel` component. The panel owns no data fetching or domain
state; it receives the existing note list state and callbacks and renders the
same folder, view, search, pagination, and creation controls.

## Reliability Contract

- Preserve all existing callback signatures and user-visible labels.
- Keep server-backed search, folder selection, note selection, daily-note
  action, and cursor pagination behavior unchanged.
- Preserve the existing CSS classes, visual language, accessibility labels,
  disabled states, and empty/error/loading states.
- Do not change API routes, database behavior, authentication, or scrolling
  ownership.

## Boundary

This task is a presentation extraction only. Data fetching and mutation
orchestration remain in the existing controllers and `AuthenticatedWorkspace`
facade.
