# Task 31: Collaboration Center Data Lifecycle Report

## Outcome

Extracted collaboration-center read lifecycle management into
`useCollaborationCenterData`. The center now uses scoped stale-while-revalidate
data, shared request leases, generation checks, and section-aware mutation
feedback without changing the public client API or visual language.

## Reliability Guarantees

- Base and section caches are isolated by client and explicit user/workspace
  plus permission scope.
- Fresh cache values are available on the first render; in-flight reads are
  shared across remounts and concurrent consumers.
- Empty-but-created section caches remain loading until their resource has a
  value, while still reusing an in-flight request.
- Listener registration creates missing section resources and refreshes all
  corresponding refs, preventing stale functional updates from overwriting
  newer cache values.
- Late success and error callbacks are rejected by scope, effect lease,
  section query, generation, and abort checks.
- `refreshing` remains true until all active base and section reads settle.
- A mutation completed after section navigation updates its original cache but
  cannot open a one-time link, clear a form, or show feedback in the new
  section.
- Read retry is exposed only for base/section reads; failed writes are not
  accidentally replayed as a different read operation.

## Verification Evidence

| Check | Result |
| --- | --- |
| Collaboration hook, center, and mobile suites | `35/35` passed; affected live-flow scenario passed |
| Web typecheck | passed |
| Full lint | passed |
| Full Web test suite | `90 files / 643 tests` passed |
| Worker regression | passed; `97 files / 615 tests` |
| Full build | passed; initial entry `349.75 kB`, no Vite `>500 kB` warning |
| Production dependency audit | passed; `0 vulnerabilities` |
| Deploy readiness | passed; initial preload excludes `markdown-vendor`, `ocr-vendor`, and `ai-vendor` |
| Independent review | `PASS`; no Critical, Important, or Minor findings remain |

Authenticated browser validation remains
`BLOCKED AUTHENTICATED_PROFILE_UNSET` because no repository-external Chrome
profile is configured. No production deployment, remote migration, secret
change, GitHub push/merge, or tag action was performed.

## Files

- `apps/web/src/collaboration/use-collaboration-center-data.ts`
- `apps/web/src/collaboration/CollaborationCenter.tsx`
- `apps/web/tests/use-collaboration-center-data.test.tsx`
- `apps/web/tests/collaboration-center.test.tsx`
