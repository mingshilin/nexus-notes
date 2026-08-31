# Task 42: Note Folder Creation Scope Report

## Outcome

Moved note-folder creation into `useNoteFolderCreation`. The hook owns request
identity and validates client, workspace, role, logout, mounted, and response
scope before publishing a new folder or selecting its filter.

## Reproduced Defect

The App integration test held a folder creation request open, switched workspace,
and then completed the old request. Before the fix the request had no abort
signal. The new test verifies that the old request is aborted and cannot publish
the old workspace folder.

## Reliability Guarantees

- Active folder writes are cancelled on workspace changes and unmount.
- Late success and failure cannot update the new workspace's folder list or
  filter.
- A response from another workspace is rejected before state publication.
- Aborted writes keep the user's input and do not show a stale failure alert.
- Existing folder creation success behavior and client API callers remain
  compatible.

## Verification Evidence

| Check | Result |
| --- | --- |
| Focused folder lifecycle regression | `3 files / 103 tests` passed |
| Full Beta Web | `98 files / 743 tests` passed |
| Full Beta Worker | `97 files / 615 tests` passed |
| Contracts / Domain / UI | `62 + 31 + 2 tests` passed |
| Legacy frontend / Worker | `161 + 63 tests` passed |
| Lint / build / production audit | passed; `0 vulnerabilities` |
| Deploy readiness / forbidden preload | passed; no `markdown-vendor`, `ocr-vendor`, or `ai-vendor` initial preload |
| Independent task review | PASS; no Critical or Important findings |

The final web entry chunk is `377.07 kB`; the build emitted no Vite `>500 kB`
warning. The reviewer noted one non-blocking cleanup refinement: the panel's
unconditional `setPending(false)` after unmount is ignored by React and cannot
affect data or the new scope.

No API route, Worker, schema, deployment, GitHub, or production change was
performed.

## Files

- `apps/web/src/app/use-note-folder-creation.ts`
- `apps/web/src/app/App.tsx`
- `apps/web/src/data/knowledge-client.ts`
- `apps/web/src/notes/NoteOrganizationPanel.tsx`
- `apps/web/tests/live-notes-flow.test.tsx`
- `apps/web/tests/product-navigation.test.tsx`
- `apps/web/tests/knowledge-client.test.ts`
