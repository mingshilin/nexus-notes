# Task 46: Portable Release Smoke Fixtures

## Scope

Make release browser smoke temporary profile and fixture paths portable across
Windows and Linux CI runners.

## Reliability Contract

- Use platform-aware path joining for temporary profiles and missing fixtures.
- Preserve the existing machine-readable blocked reasons and external-profile
  safety checks.
- Do not change authenticated browser requirements or use repository-local
  session state.

## Boundary

No product API, database schema, visual redesign, or production deployment
change.
