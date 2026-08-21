# Task 7 Full-Gate Regression Report

## Gate failure

The full Worker gate failed before this fix in `apps/worker/tests/d1-attachment-repository.test.ts:41`:

- Full suite: `36` test files passed, `1` failed; `183/184` tests passed.
- The quota test timed out at `5099ms` against the fixed `5000ms` timeout.
- The failing test was the only failure under all `37` Worker test files.

## Root cause evidence

The first quota test seeded the workspace quota with `40` sequential `reserveUpload` calls for `25 MiB` each, followed by one sequential `reserveUpload` call for `23 MiB`, before making the two-call concurrency assertion. Each repository call performs D1 insert and lookup work, so full-suite process contention pushed this setup over the fixed test timeout.

Observed and verified behavior:

- The attachment test file alone passed; the first test took `3509ms` in the baseline run. The prior verified run recorded `3684ms`.
- The attachment test passed alongside `d1-database-repository.test.ts`; the prior verified run recorded `3839ms`.
- Under all `37` Worker files, the first test took `5099ms` and timed out.
- Production attachment behavior was not changed or implicated.

## Fix

In `apps/worker/tests/d1-attachment-repository.test.ts` only, replaced the `41` sequential `reserveUpload` setup calls with one `db.batch` seed containing the same valid rows for `ws-1/user-1`: `40 x 25 MiB` and `1 x 23 MiB`, all with uploading status and valid attachment fields.

The two concurrent `1 MiB` `reserveUpload` calls and all assertions are unchanged. No timeout was increased, quota coverage was not reduced, and production code was not modified.

## Exact verification results

- `rtk npm run test --workspace @nexus/worker -- tests/d1-attachment-repository.test.ts`: passed, `3/3` tests; first quota test `2944ms`.
- `rtk npm run test --workspace @nexus/worker`: passed, `37/37` test files and `184/184` tests; first quota test `4482ms`.
- `rtk npm run typecheck --workspace @nexus/worker`: passed, `tsc -p tsconfig.json --noEmit` exited `0`.
- `git diff --check`: passed with no output.

The Worker suite still emits the existing `OCR_QUEUE_MESSAGE_INVALID` stderr lines from poison-message tests; the command exits successfully and reports no test failures.
