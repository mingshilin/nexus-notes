# Task 28: Reminder Workspace Data

## Scope

Extract reminder list and delivery request lifecycle from `ReminderPanel` into
`useReminderWorkspaceData` without changing the reminder client API or the
existing visual surface.

## Behaviors

- Cache reminder pages per client and query with a 60-second TTL.
- Hydrate the default query during the first render when a remount has a fresh
  cache; expired entries remain visible while a refresh runs.
- Preserve list and delivery state on successful mutations and expose retryable
  failures to the panel.
- Cancel and scope list, pagination, delivery, and retry results by client,
  query generation, and the currently open reminder.
- Keep delivery loading and retry indicators isolated when the user switches or
  closes a delivery panel.

## Verification Target

The task is complete only after the focused reminder tests, full Web tests,
workspace typechecks, lint, build, audit, deployment readiness, and Worker
regression have all passed, and an independent review has no blocking finding.
