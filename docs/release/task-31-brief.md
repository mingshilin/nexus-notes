# Task 31: Collaboration Center Data Lifecycle

## Scope

Move collaboration-center read orchestration into
`useCollaborationCenterData` while preserving the existing collaboration API,
roles, sections, visual structure, and mutation callbacks.

## Reliability Contract

- Cache members, invitations, comments, shares, activity, and audit data by
  client identity, user/workspace scope, permission scope, and section query.
- Hydrate cached values synchronously and deduplicate concurrent requests,
  including StrictMode replays and multiple consumers.
- Keep stale content visible during refresh; failures expose a retryable read
  state without clearing the last usable value.
- Abort or ignore requests that belong to an old workspace, client, section,
  target, generation, or unmounted consumer.
- Aggregate base and section pending requests so one completed request cannot
  clear another request's refresh state.
- Allow completed mutations to update their original section cache after
  navigation, while preventing success UI and one-time links from appearing in
  a different section or target.
- Keep public-share access independent from viewer-only collaboration reads.

## Boundary

No API URL, response schema, permission policy, database schema, or production
deployment change is part of this task.
