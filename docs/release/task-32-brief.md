# Task 32: Collaboration Workspace Controller

## Scope

Move collaboration-domain composition, unread notification state, notification
dialog lifecycle, and notification deep-link resolution out of
`AuthenticatedWorkspace` into a bounded controller and domain facade.

## Reliability Contract

- Keep the existing `CollaborationClient`, `DatabaseClient`,
  `NotificationCenter`, and `CollaborationCenter` APIs unchanged.
- Bind unread-count and deep-link requests to client, user, workspace, request
  generation, and `AbortSignal`; late old-scope responses must not update the
  current workspace.
- Reuse loaded database records when possible, otherwise resolve the target
  with cancellable database discovery.
- Reject database or record responses that do not belong to the active
  workspace or database.
- Keep the notification dialog available across product domains while mounting
  collaboration content only when collaboration is the active domain.
- Preserve note, database-record, comment, and public-share navigation behavior.

## Boundary

This task does not change API URLs, response schemas, backend permissions,
database migrations, notification delivery, or visual styling.
