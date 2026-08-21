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

## Task 7 backend fix wave

### RED evidence

- `apps/worker/tests/d1-database-repository.test.ts` initially had the five reported failures: property manage and field-write mutations resolved; normal delete reported `REVISION_CONFLICT`; conflict delete leaked a D1 `NOT NULL` error; and the 500-row many-column CSV import exceeded the focused run. The stale concurrent record-value CAS test was already green.
- New RED tests then reproduced both permission upserts succeeding from the same revision, missing member references being accepted, and search returning `next_cursor: null` for a page with more results.
- New contract/domain RED evidence showed date property config accepted unsupported `{ include_time: true }`; the domain date value test also verifies timestamp values remain invalid.

### GREEN evidence

- `npm run test --workspace @nexus/worker -- tests/d1-database-repository.test.ts tests/database-routes.test.ts`: focused repository and route suites passed; repository `13/13`, routes `3/3`.
- `npm run test --workspace @nexus/contracts -- tests/database-contracts.test.ts`: `4/4` passed.
- `npm run test --workspace @nexus/domain -- tests/database-values.test.ts`: `3/3` passed.
- `npm run test --workspace @nexus/web -- tests/database-client.test.ts`: `2/2` passed for the compatible search cursor client signature.
- `npm run test --workspace @nexus/worker -- --pool=forks --maxWorkers=1 --minWorkers=1 --reporter=dot`: `37/37` files and `192/192` tests passed in `110.54s`. The serial pool avoids Miniflare port contention seen in an unconstrained parallel run; no timeout or assertion was changed. Existing poison-message tests emit `OCR_QUEUE_MESSAGE_INVALID` on stderr.
- `npm run typecheck --workspace @nexus/worker`, `npm run typecheck --workspace @nexus/contracts`, and `npm run typecheck --workspace @nexus/domain`: all exited `0`.
- `git diff --check`: passed with no output.

### Requirement mapping

- Record mutation guards: bulk, board, calendar, and template mutations now use transaction-time expected-revision guards before and after record updates; value writes roll back with the record batch on conflict.
- Database deletion: guarded detach-before-delete runs atomically; delete races and trigger-simulated conflicts map to `REVISION_CONFLICT` and preserve notes, records, and attachments.
- Property authorization: schema creation requires database manage capability; update/delete require manage plus current field write authorization.
- Permission CAS: database and field permission upserts include revision predicates and reject zero-change writes as `REVISION_CONFLICT`.
- CSV: validated 500-row imports use bounded JSON `json_each` set-based inserts for records and values in one atomic batch; invalid input performs no partial writes.
- References and dates: member values require workspace membership, relation config and values require same-workspace target databases and live target records, and date config no longer accepts `include_time`.
- Search: contracts/routes/repository/client carry deterministic `(updated_at, id)` keyset cursors with bounded pages.
- Remaining Web review findings: the broader Web workflow/UI gaps from Review Fix Wave 1 remain outside this backend worker scope for the next sequential agent.
