# Task 39: Note Mutation Scope Report

## Outcome

Hardened `useNoteMutations` across manual save, status changes, favorite/pin
updates, and permanent deletion. The hook now owns request cancellation and
scope validation while preserving existing UI callbacks and API compatibility.

## Reliability Guarantees

- Late mutation results cannot reselect an old note, overwrite a newer draft,
  change the current list view, close or clear the wrong delete flow, or publish
  stale feedback.
- Workspace, client, role, logout, selected-note, and unmount changes abort
  active requests. Draft edits keep the current request serialized while
  invalidating its UI publication, avoiding overlapping writes.
- A successful response received after a local draft edit records its server
  revision for a safe subsequent retry while preserving the newer local draft;
  a real server conflict is never silently rebased.
- Viewer mutations are rejected before any update or permanent-delete request.
- Optional abort signals reach update and permanent-delete requests; existing
  callers remain valid.

## Verification Evidence

| Check | Result |
| --- | --- |
| Mutation hook and client regression | `2 files / 34 tests` passed |
| Real note/navigation workflow regression | `4 files / 116 tests` passed |
| Web typecheck | passed |
| Full Beta Web suite | `97 files / 723 tests` passed |
| Full Beta Worker suite | `97 files / 615 tests` passed |
| Legacy frontend and API suites | `35 files / 161 tests` + `11 files / 63 tests` passed |
| Contracts, domain, and UI workspace suites | `62 + 31 + 2 tests` passed |
| Lint, build, audit, and deploy readiness | passed; initial entry `371.83 kB`, `0 vulnerabilities`, no Vite `>500 kB` warning |
| Independent task review | approved after final scope fixes; no Critical or Important findings |

No Worker/API route, schema, deployment, GitHub, or production changes were
performed.

The final scope fixes also cover stale saved callbacks after draft changes,
stale destructive-delete callbacks, replacement clients, response identity and
revision validation, and workspace-isolated known revisions. A real server
conflict is intentionally not silently rebased.

## Files

- `apps/web/src/app/use-note-mutations.ts`
- `apps/web/src/data/notes-client.ts`
- `apps/web/tests/use-note-mutations.test.tsx`
- `apps/web/tests/notes-client.test.ts`
