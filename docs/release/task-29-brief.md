# Task 29: Notification Center Data Lifecycle

## Scope

Move notification list, cursor pagination, selected IDs, read mutations, and
request lifecycle out of `NotificationCenter` into a focused workspace-scoped
hook. Preserve existing collaboration client methods, notification labels,
deep-link behavior, and modal visuals.

## Reliability Contract

- Cache the first notification page per client and explicit user/workspace
  scope for a short TTL; a fresh remount must render cached items immediately
  and avoid a duplicate request.
- Hide old notifications on a client/scope switch before the new request
  resolves.
- Abort superseded requests and reject late list, pagination, and read results;
  no old workspace notification or pending state may leak into the new view.
- Keep selected IDs and read actions bounded to the currently visible page.

## Boundary

No API URL, response shape, permission policy, or production deployment changes
are part of this task.
