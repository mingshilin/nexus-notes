# Task 30: Account Center Data Lifecycle

## Scope

Move profile and login-session query orchestration out of `AccountCenter` into
`useAccountCenterData`. Preserve the existing account tabs, child-panel props,
ProfileClient methods, callback ordering, and visual markup.

## Reliability Contract

- Cache profile and session data per ProfileClient and explicit user/workspace
  scope for five minutes.
- Hydrate fresh cache entries during render and share in-flight requests across
  StrictMode replays and simultaneous consumers.
- Keep stale values visible during an expired-cache refresh; refresh failures
  must not erase the last usable value.
- Scope/client changes hide old profile and session values immediately and
  reject late query or mutation results.
- Profile updates and session changes invalidate only the affected resource;
  session refresh loading remains compatible with existing controls.
- Compatibility callers may omit `cacheScope`; `AccountCenter` derives a
  user/workspace scope from its existing optional identity props.

## Boundary

No account API URL, response schema, authentication policy, or production
deployment change is part of this task.
