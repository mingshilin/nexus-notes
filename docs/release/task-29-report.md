# Task 29: Notification Center Data Lifecycle Report

## Outcome

Completed the notification-center lifecycle extraction on top of the verified
Task 28 baseline. `NotificationCenter` keeps its existing modal markup,
labels, client methods, and deep-link contract while
`useNotificationCenterData` owns notification list state, cursor pagination,
read mutations, cancellation, and workspace/user-scoped cache state.

## Reliability Guarantees

- Cache keys are scoped by the CollaborationClient identity and the explicit
  `userId:workspaceId` value passed by `App`.
- Fresh cache entries hydrate during render; StrictMode effect replay and
  simultaneous consumers share one in-flight list request.
- Scope changes hide the old page immediately and abort or invalidate stale
  list, pagination, and read work. Consumer release is idempotent so one
  remount cannot cancel another consumer's shared request.
- Successful read mutations preserve the read state across late refresh/page
  responses and do not leave the UI pending after a cancelled page request.
- An unread notification deep-link navigates only after its read request
  succeeds. Failed or cancelled reads stay in the notification center.
- Cache updates from another same-scope instance refresh once without a
  self-triggered invalidation loop. Existing notification visuals remain
  unchanged; no extra refresh/retry controls were added to the modal.

## Verification Evidence

| Check | Result |
| --- | --- |
| Task 29 focused tests | `26/26` passed (`14` hook lifecycle tests + `12` collaboration regressions) |
| Full Beta Web tests | `88 files / 608 tests` passed |
| Web typecheck | passed via `npm run typecheck --workspace @nexus/web` |
| Full lint | passed via `npm run lint` |
| Full build | passed; initial entry `349.70 kB`, no Vite `>500 kB` warning |
| Production dependency audit | `0 vulnerabilities` via `npm audit --omit=dev` |
| Deploy readiness | passed; initial preload excludes `markdown-vendor`, `ocr-vendor`, and `ai-vendor` |
| Worker regression | `97 files / 615 tests` passed |
| Mobile baseline regression | `45/45` targeted tests passed; fix committed separately as `e6156d9` |
| Independent review | `PASS`; all review-blocking races were fixed and the remaining page-close lifecycle minor was closed with a regression test |

The authenticated browser gate remains intentionally unavailable without a
repository-external Chrome profile and must report
`BLOCKED AUTHENTICATED_PROFILE_UNSET`; no credentials, session data, preview
deployment, production deployment, migration, GitHub merge, or tag operation
was performed for this task.

## Files

- `apps/web/src/collaboration/use-notification-center-data.ts`
- `apps/web/src/collaboration/NotificationCenter.tsx`
- `apps/web/src/app/App.tsx`
- `apps/web/tests/use-notification-center-data.test.tsx`
- `apps/web/tests/collaboration-center.test.tsx`
- `apps/web/tests/product-navigation.test.tsx`
