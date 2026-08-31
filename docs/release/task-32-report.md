# Task 32: Collaboration Workspace Controller Report

## Outcome

Extracted unread-count loading, notification dialog state, notification
deep-link resolution, and collaboration domain composition from
`AuthenticatedWorkspace` into `useCollaborationWorkspaceController` and
`CollaborationDomain`.

## Reliability Guarantees

- Unread-count requests are idle-scheduled, abortable, and scoped to the exact
  client, user, workspace, capability, and role. Scope switches start exactly
  one replacement request.
- Notification dialog opener/focus state is reset on scope changes.
- Retained notification callbacks reject old-scope reads and deep links before
  they can start requests or mutate the current workspace.
- Note notification targets navigate immediately without unnecessary reads.
- Loaded database targets are reused; unloaded targets use cancellable database
  discovery and reject late or cross-workspace results.
- Failure keeps a recoverable collaboration destination and an explicit
  database error instead of silently dropping the target.
- `NotificationCenter` remains globally reachable, while the heavy
  `CollaborationCenter` lazy module mounts only in the collaboration domain.

## Verification Evidence

| Check | Result |
| --- | --- |
| Controller unit tests | `25/25` passed |
| Database workspace data tests | `8/8` passed |
| Collaboration/domain/database focused regression | `4 files / 55 tests` passed |
| Full Web test suite | `91 files / 676 tests` passed |
| Worker regression | `97 files / 615 tests` passed |
| Legacy regression | `35 files / 161 frontend tests`; `11 files / 63 API tests` passed |
| Full lint and workspace typechecks | passed |
| Full build | passed; initial entry `356.51 kB`, no Vite `>500 kB` warning |
| Production dependency audit | `0 vulnerabilities` |
| Deploy readiness | passed; initial preload excludes `markdown-vendor`, `ocr-vendor`, and `ai-vendor` |
| Independent review | `PASS`; final short-scope review found no Critical/Important/Minor issues |

Authenticated browser validation remains
`BLOCKED AUTHENTICATED_PROFILE_UNSET` because no repository-external Chrome
profile is configured. No production deployment, remote migration, secret
change, GitHub push/merge, or tag action was performed.

The final local audit also confirmed `dist/index.html` contains no initial
`markdown-vendor`, `ocr-vendor`, or `ai-vendor` preload. `npm audit` was
retried after a transient registry TLS failure and returned `0 vulnerabilities`.

## Files

- `apps/web/src/app/App.tsx`
- `apps/web/src/app/WorkspaceShell.tsx`
- `apps/web/src/app/domains/CollaborationDomain.tsx`
- `apps/web/src/app/use-collaboration-workspace-controller.ts`
- `apps/web/src/app/use-database-workspace-data.ts`
- `apps/web/src/layout/AdaptiveWorkbench.tsx`
- `apps/web/tests/use-collaboration-workspace-controller.test.tsx`
- `apps/web/tests/use-database-workspace-data.test.tsx`
- `apps/web/tests/domain-facade.test.tsx`
- `apps/web/tests/collaboration-center.test.tsx`
- `apps/web/tests/product-navigation.test.tsx`
- `apps/web/tests/workspace-performance.test.tsx`
