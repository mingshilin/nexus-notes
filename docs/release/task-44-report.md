# Task 44: Note Draft Input Scope Report

## Outcome

Moved title/content draft input handling into `useNoteDraftInput`. The hook
updates the editor immediately, persists the active local draft, and gates error
feedback by client, workspace, role, logout, mounted, active-draft, scope-token,
and per-draft save sequence.

## Reproduced Defect

The regression held a draft-A local save open, switched to another note, created
draft B, and then rejected the old save. Before the fix the App checked only that
some active draft still existed, so it displayed “本地草稿保存失败…” on draft B.
The regression now confirms the new draft remains free of draft-A's error.

## Reliability Guarantees

- An old save rejection cannot overwrite or report against a newly active draft.
- Retained input callbacks after unmount do not start a save.
- Latest input remains persisted locally while server creation is unavailable.
- Multiple input saves remain serialized by `NoteDraftController` and stale
  failures are suppressed by the per-draft sequence.
- Existing AI content and attachment insertion paths continue to use the same
  editor update contract.

## Verification Evidence

| Check | Result |
| --- | --- |
| Focused draft, live-flow, controller, editor regression | `4 files / 84 tests` passed |
| Full Beta Web | `100 files / 750 tests` passed |
| Full Beta Worker | `97 files / 615 tests` passed |
| Contracts / Domain / UI | `62 + 31 + 2 tests` passed |
| Legacy frontend / Worker | `161 + 63 tests` passed |
| Lint / build / production audit | passed; `0 vulnerabilities` |
| Deploy readiness / forbidden preload | passed; no `markdown-vendor`, `ocr-vendor`, or `ai-vendor` initial preload |
| Independent task review | PASS; no Critical, Important, or Minor findings |

The final web entry chunk is `380.73 kB`; the build emitted no Vite `>500 kB`
warning.

No API route, Worker, schema, deployment, GitHub, or production change was
performed.

## Files

- `apps/web/src/app/use-note-draft-input.ts`
- `apps/web/src/app/App.tsx`
- `apps/web/tests/use-note-draft-input.test.tsx`
- `apps/web/tests/live-notes-flow.test.tsx`
