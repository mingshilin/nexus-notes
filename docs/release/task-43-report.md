# Task 43: Task Database Creation Scope Report

## Outcome

Moved task-database bootstrap orchestration into `useTaskDatabaseCreation`. The
hook validates client/workspace/role/logout/mounted scope and request ownership
before publishing the completed setup into the current database workspace.

## Reproduced Defect

The regression test held the task-database setup promise open, changed from
`ws-1` to `ws-2`, and then resolved the old setup. Before extraction the inline
callback could publish old database state into the current controller. The test
now returns a rejected action and leaves every current database state setter
untouched.

## Reliability Guarantees

- Late setup results cannot change databases, selection, bundle, records, refresh,
  pane, or domain navigation for a new workspace.
- Role changes, logout, unmount, concurrent requests, and A-B-A scope cycles are
  guarded by request ownership and a per-render scope token.
- A mismatched workspace response is rejected before any UI publication.
- Setup failures retain the existing Create Center rejection message and do not
  leave a stale database-page error behind.
- StrictMode effect replay restores the mounted lifecycle correctly.
- A stable `ApiClient` transport/workspace lease remains registered until the
  multi-step setup settles, so an A-B-A remount cannot start a duplicate backend
  setup; the lease is released after settlement for a later legitimate create.

## Verification Evidence

| Check | Result |
| --- | --- |
| Focused task-database, Create Center, database-controller regression | `3 files / 21 tests` passed |
| Full Beta Web | `99 files / 745 tests` passed |
| Full Beta Worker | `97 files / 615 tests` passed |
| Contracts / Domain / UI | `62 + 31 + 2 tests` passed |
| Legacy frontend / Worker | `161 + 63 tests` passed |
| Lint / build / production audit | passed; `0 vulnerabilities` |
| Deploy readiness / forbidden preload | passed; no `markdown-vendor`, `ocr-vendor`, or `ai-vendor` initial preload |
| Independent task review | PASS after A-B-A lease hardening; no Critical or Important findings |

The final web entry chunk is `378.93 kB`; the build emitted no Vite `>500 kB`
warning.

No API route, Worker, schema, deployment, GitHub, or production change was
performed.

## Files

- `apps/web/src/app/use-task-database-creation.ts`
- `apps/web/src/app/App.tsx`
- `apps/web/tests/use-task-database-creation.test.tsx`
- `apps/web/tests/create-center.test.tsx`
- `apps/web/tests/use-database-workspace-controller.test.tsx`
