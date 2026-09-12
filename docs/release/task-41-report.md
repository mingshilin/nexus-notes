# Task 41: Note Conflict Resolution Scope Report

## Outcome

Moved note-conflict resolution into `useNoteConflictResolution`. The hook now
owns request identity and validates controller, workspace, role, logout, active
draft, conflict identity, and mounted scope before starting or publishing work.

## Reproduced Defect

The App integration test delayed “采用服务器版本”, selected another note, and
then completed the old resolution. Before the fix the new editor changed from
“另一篇笔记” to the old conflict's “远程标题”. The test now keeps the newly
selected title and content unchanged.

## Reliability Guarantees

- Stale editor callbacks cannot start after a role or scope change.
- Late success and failure cannot clear or overwrite the current conflict/editor.
- Old finally handlers cannot unlock a newer A-B-A request.
- Concurrent resolutions remain suppressed.
- Existing local/server messages and retry semantics remain unchanged.

## Verification Evidence

| Check | Result |
| --- | --- |
| Focused hook and App red/green regression | `4 hook tests + 45 live-flow tests` passed |
| Notes lifecycle/navigation regression | `5 files / 123 tests` passed |
| Web typecheck | passed |
| Full Beta Web | `98 files / 740 tests` passed |
| Full Beta Worker | `97 files / 615 tests` passed |
| Contracts / Domain / UI | `62 + 31 + 2 tests` passed |
| Legacy frontend / Worker | `161 + 63 tests` passed |
| Lint / build / production audit | passed; `0 vulnerabilities` |
| Deploy readiness / forbidden preload | passed; no `markdown-vendor`, `ocr-vendor`, or `ai-vendor` initial preload |
| Independent task review | PASS; no Critical or Important findings |

The final build entry chunk is `375.52 kB` and emitted no Vite `>500 kB`
warning. The full gate run completed after the unmount hardening.

No API route, Worker, schema, deployment, GitHub, or production change was
performed.

## Files

- `apps/web/src/app/use-note-conflict-resolution.ts`
- `apps/web/src/app/use-notes-workspace-controller.ts`
- `apps/web/src/app/App.tsx`
- `apps/web/tests/use-note-conflict-resolution.test.tsx`
- `apps/web/tests/live-notes-flow.test.tsx`
