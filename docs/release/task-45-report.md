# Task 45: Offline Conflict Read Scope Report

## Outcome

Moved offline conflict server-version reads into `useOfflineConflictRead`. The
hook owns read request identity, abort handling, workspace/client/draft scope,
logout state, and mounted lifecycle before publishing the conflict panel state.

## Reproduced Defects

- An old conflict callback could read through its old client after workspace
  change. The new regression blocks the read before it starts.
- A-B-A active-draft changes could let an old pending response pass an ID-only
  check. Active-draft identity now participates in the scope token and request
  is aborted on transition.
- A running sync callback could start a conflict read while logout was pending.
  Logout is now a scope boundary and blocks both start and publication.
- The extracted implementation initially replaced operation patch values with
  editor refs. The compatibility regression now verifies patch-first local
  conflict snapshots.

## Reliability Guarantees

- Only a current note operation from the current workspace and active draft can
  start a server-version read.
- Old success/error/finally callbacks cannot update the new conflict or editor.
- Abort signals are passed through to the note client and stale aborts are silent.
- Existing conflict local/server choice UI and recoverable error text remain
  unchanged.

## Verification Evidence

| Check | Result |
| --- | --- |
| Focused conflict read, live notes, sync, and conflict recovery | `6 files / 66 tests` passed |
| Final hook regression suite | `8 tests` passed |
| Full Beta Web | `101 files / 758 tests` passed |
| Full Beta Worker | `97 files / 615 tests` passed |
| Contracts / Domain / UI | `62 + 31 + 2 tests` passed |
| Legacy frontend / Worker | `161 + 63 tests` passed |
| Lint / build / production audit | passed; `0 vulnerabilities` |
| Deploy readiness / forbidden preload | passed; no `markdown-vendor`, `ocr-vendor`, or `ai-vendor` initial preload |
| Independent task review | PASS; no Critical, Important, or Minor findings |

The final web entry chunk is `382.25 kB`; the build emitted no Vite `>500 kB`
warning.

No API route, Worker, schema, deployment, GitHub, or production change was
performed.

## Files

- `apps/web/src/app/use-offline-conflict-read.ts`
- `apps/web/src/app/App.tsx`
- `apps/web/tests/use-offline-conflict-read.test.tsx`
