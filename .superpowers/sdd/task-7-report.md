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

## Task 7 Web Fix Wave

### RED evidence

- Added `apps/web/tests/database-task7-web.test.tsx` before the Web changes and ran `npm run test --workspace @nexus/web -- tests/database-task7-web.test.tsx`.
- The initial RED run failed `5/5` behavior tests for the expected missing behavior: saved visible columns were ignored, page-three restoration never called the page cursor, `dragend` still allowed a move, the tools drawer had no action controls, and board/calendar did not request later cursor pages.

### GREEN evidence

- `npm run test --workspace @nexus/web -- tests/database-client.test.ts tests/database-state.test.ts tests/database-workbench.test.tsx tests/database-workspace-live.test.tsx tests/database-task7-web.test.tsx`: passed `5/5` files and `15/15` tests.
- `npm run test --workspace @nexus/web`: passed `21/21` files and `81/81` tests.
- `npm run typecheck --workspace @nexus/web`: passed, exit `0`.
- `npm run build --workspace @nexus/web`: passed. Vite emitted no `>500 kB` warning; the lazy `DatabaseWorkbench` chunk is `16.60 kB` (`5.45 kB` gzip).
- `npm run beta:build`: passed for Web, Worker, contracts, domain, testkit, and UI.
- `npm run verify:deploy`: passed local readiness checks. The built Web entry was separately inspected for preload references; `DatabaseWorkbench` remains lazy and no Markdown/OCR modulepreload was introduced.
- `git diff --check`: passed with no output.

### Requirement mapping

- Typed Web client workflows: `DatabaseToolsDrawer` now exposes executable database/property/record/view/template/comment/permission actions, atomic template/bulk actions, and CSV import/export through `DatabaseClient`; all command paths are exercised by a real client mock in the behavior test.
- Saved views: `executeView` applies filters and deterministic sorts before rendering; `visibleProperties` applies visible columns and hidden-field exclusion. Saved page size drives the initial bounded request and later requests.
- Pagination and scale: table uses exact cached remote pages plus a persisted per-page cursor chain; board/calendar drain subsequent bounded cursor pages and retain segment/card caps. The existing 5,000-record test still renders exactly 50 table rows.
- Optimistic mutations: board/calendar attach a per-record operation ID, only commit/restore if it is still current, and restore only that record. The race and failure path is exercised in `database-task7-web.test.tsx`.
- Drag lifecycle: board/calendar clear drag state on `dragend` and on view or record-set revision changes; the canceled drag path is covered.
- Responsive behavior: the mobile workbench test runs at `390px` and `devicePixelRatio=2`, opens the action drawer, executes a real client command, and asserts one page scroll owner. Existing CSS preserves safe-area/keyboard layout and the lazy workbench chunk.

### Files changed

- `apps/web/src/app/App.tsx`
- `apps/web/src/data/database-state.ts`
- `apps/web/src/databases/DatabaseWorkbench.tsx`
- `apps/web/src/databases/DatabaseToolsDrawer.tsx`
- `apps/web/src/databases/DatabaseTableView.tsx`
- `apps/web/src/databases/DatabaseBoardView.tsx`
- `apps/web/src/databases/DatabaseCalendarView.tsx`
- `apps/web/src/databases/database-view-utils.ts`
- `apps/web/src/styles.css`
- `apps/web/tests/database-task7-web.test.tsx`
- Existing database Web tests updated for the cursor-chain page request contract.

### Self-review and residual concerns

- Verified no Worker, domain, contract, migration, deployment, or plan/ledger files were modified.
- Bulk edit is deliberately command-first and refreshes through the App mutation flow; it does not yet provide an optimistic bulk preview with per-record rollback tokens. It is safe from stale local rollback but does not meet the review request's explicit optimistic-bulk UX requirement.
- The tools drawer provides complete `DatabaseClient` operation coverage through an actionable JSON payload editor; the Worker validates each payload against the shared contract boundary. It is a compact operations console rather than dedicated field-by-field forms for every property type.
