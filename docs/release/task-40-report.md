# Task 40: Notes Inspector Mutation Scope Report

## Outcome

Hardened Inspector tag creation, tag assignment, and note-link writes with
workspace/note/role/logout/client lifecycle guards and cancellable requests.
Existing API routes, optimistic behavior, rollback, and UI messages remain
compatible.

## Reliability Guarantees

- Old tag, link, or tag-creation callbacks cannot write after the selected note,
  workspace, role, or logout scope changes.
- Active Inspector writes are cancelled on scope changes and unmount; aborts do
  not surface stale errors or update the new Inspector state.
- Concurrent writes in the same mutation class are suppressed.
- Failed tag writes restore the previous selection only while the original
  scope remains current.
- Existing callers remain compatible because all new signals are optional.

## Verification Evidence

| Check | Result |
| --- | --- |
| Inspector hook and client regression | `2 files / 26 tests` passed |
| App tags, panel, links, and live note regression | `7 files / 116 tests` passed |
| Web typecheck | passed |
| Full Beta Web | `97 files / 735 tests` passed |
| Full Beta Worker | `97 files / 615 tests` passed |
| Contracts / Domain / UI | `62 + 31 + 2 tests` passed |
| Legacy frontend / Worker | `161 + 63 tests` passed |
| Lint / build / production audit | passed; `0 vulnerabilities` |
| Deploy readiness / forbidden preload | passed; no `markdown-vendor`, `ocr-vendor`, or `ai-vendor` initial preload |
| Independent task review | PASS; no Critical or Important findings |

The initial review found that late tag/link successes could still return
`true` to the App after the underlying request had become stale. Success now
requires the original mutation sequence, controller, and scope to remain
current; stale success returns `false` and cannot trigger old UI feedback.

The final review also identified stale non-abort failures from `createTag`.
The hook now converts any non-current create-tag failure into an `AbortError`,
so the App cannot publish the old error in a new Inspector scope.

A later review identified an A-B-A controller race and a finally-order bug.
Rollback/error/saving cleanup now requires controller ownership, while the
current request clears its saving state before releasing that ownership.

The final test-only hardening directly verifies that a current-scope link
failure clears the saving lock and publishes the recoverable error. A temporary
mutation that removed the finally cleanup made the test fail before the real
implementation was restored and the focused suite returned green.

The production build completed without a Vite `>500 kB` warning. The initial
entry chunk is `373.70 kB`; local deploy readiness passed after the final build.

No Worker/API route, schema, deployment, GitHub, or production changes were
performed.

## Files

- `apps/web/src/app/use-note-inspector-data.ts`
- `apps/web/src/app/use-notes-workspace-controller.ts`
- `apps/web/src/app/App.tsx`
- `apps/web/src/data/knowledge-client.ts`
- `apps/web/tests/use-note-inspector-data.test.tsx`
- `apps/web/tests/knowledge-client.test.ts`
