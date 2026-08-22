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

## Task 7 Backend Review Fix Wave 2

### RED evidence

- Added real-D1 repository tests before implementation and ran each with the fixed default test timeout. All seven failed for the intended missing behavior: max-100 bulk exceeded the test limit; 500-row member/relation CSV performed per-row processing; a target soft-deleted by an in-transaction trigger left a dangling relation; `view_id` was ignored by list; template defaults accepted a missing member; a `record_values` unique error was mapped to `REVISION_CONFLICT`; and a literal backslash search returned no records.
- The saved-view RED test verifies server-side filters, effective grouping/sort order, visible columns, saved page size, and cursor continuation. The template RED test covers both invalid member defaults and a relation target disappearing during the update transaction.

### GREEN evidence

- `npm run test --workspace @nexus/worker -- tests/d1-database-repository.test.ts -t ... --pool=forks --maxWorkers=1 --minWorkers=1 --reporter=dot`: all 20 repository tests passed in four serial five-test groups. New boundaries passed: max bulk used 11 prepared statements; reference-heavy 500-row CSV stayed at or below 12; transaction reference race rolled back; view cursor ordering passed; template references passed; dedicated guard mapping passed; literal backslash search passed.
- `npm run test --workspace @nexus/worker -- tests/database-routes.test.ts --pool=forks --maxWorkers=1 --minWorkers=1 --reporter=verbose`: 3/3 passed.
- `npm run test --workspace @nexus/web -- tests/database-client.test.ts`: 2/2 passed, including the compatible `view_id` query signature and cache key.
- `npm run test --workspace @nexus/contracts -- tests/database-contracts.test.ts`: 4/4 passed.
- `npm run test --workspace @nexus/domain -- tests/database-values.test.ts tests/database-csv.test.ts`: 6/6 passed.
- Full `@nexus/worker` coverage was run serially in nine file/test shards because the host terminates an individual command after 30 seconds. Every Worker test file and test case completed: 37/37 files, 199/199 tests. Existing `OCR_QUEUE_MESSAGE_INVALID` output is expected poison-message test stderr; no Worker test failed.
- `npm run typecheck --workspace @nexus/worker`, `@nexus/contracts`, `@nexus/domain`, and `@nexus/web`: all passed.
- `git diff --check`: passed with no output.

### Requirement mapping

- Bulk and templates: record IDs/revisions are loaded and guarded through bounded JSON `json_each`; the record revision update and all value upserts are set-based JSON statements. Valid 100-record work avoids bind and statement explosion while retaining one atomic D1 batch.
- CSV references: normalized 500-row input aggregates unique member/relation targets. One bounded JSON join validates them before write and distinct member/relation guards repeat validation at both ends of the D1 transaction.
- Saved views: `GET /records?view_id=` uses saved filters, grouping, sorts, visible columns, and saved page size server-side. Sort-aware cursors include effective sort values plus the deterministic `(updated_at, id)` tie-breaker. Non-query layout settings remain persisted in the v2 view contract and are returned with the view.
- Template defaults: create/update normalize values, validate member/relation references, and execute transaction-time reference guards.
- Guard mapping: revision guards only map the dedicated `workspaces.slug` signature; member/relation guards use separate `users.email` and `database_records.id` signatures. An unrelated `record_values` UNIQUE failure is no longer converted to a revision conflict.
- LIKE: search escapes `\\` before `%` and `_`, and searches the decoded JSON scalar so a literal backslash matches its stored field value.
- Compatibility only: the Web client/routing signature adds optional `view_id`; no Web UI review finding was implemented.

### Remaining Web work

- All Review Fix Wave 2 Web findings remain explicitly for the next agent: typed UI forms, workspace/database/view/page-size cache scoping, incremental board/calendar fetching and virtualization, optimistic bulk preview and per-record rollback serialization, full CSV export pagination, and keyboard/focus-safe tools drawer behavior.

## Task 7 Web Review Fix Wave 2

### RED evidence

- State test: page-size chain was overwritten and record-token coordinator was absent; client test: `DatabaseClient.exportAllCsv` was absent.
- Web behavior test: raw `操作数据 JSON` remained; later, optimistic bulk had no immediate preview. Empty workspace had no first-database creation flow; same-record moves were concurrent; Escape did not return focus.

### GREEN evidence

- Focused Web: `5/5` files, `21/21` tests passed. Full `@nexus/web`: `21/21` files, `86/86` tests passed.
- `npm run typecheck --workspace @nexus/web`, `npm run build --workspace @nexus/web`, `npm run beta:build`, and `npm run verify:deploy`: passed.
- Lazy `DatabaseWorkbench` is `27.38 kB` (`8.66 kB` gzip), no `>500 kB` warning. `apps/web/dist/index.html` has no modulepreload or Markdown/OCR preload.

### Requirement mapping

- Removed the raw JSON console in favor of split typed forms with property editors, entity pickers, validation, browseable templates/comments, and top-level first-database creation.
- Scoped cursor persistence by workspace/database/view/page-size, used one 100-record board/calendar fetch window, added token-guarded bulk rollback, serialized board/calendar mutations, and completed CSV export pagination.
- Drawer supports visualViewport/safe-area/keyboard insets, internal scrolling and focus return. Tests cover forms, cache, bounded fetches, stacked failure, bulk rollback, export, and the 390px/2dppx keyboard/focus path. No browser harness is configured.

### Scope audit

- Modified only `apps/web` source/tests and this report; no Worker, domain, contracts, migrations, deployment, remote, secret, plan, or ledger files changed.

## Task 7 Backend Review Fix Wave 3

### RED evidence

- `rtk npm run test --workspace @nexus/contracts -- tests/database-contracts.test.ts` failed because `CsvExportInputSchema` rejected the compatible `include_header: false` field.
- `rtk npm run test --workspace @nexus/domain -- tests/database-permissions.test.ts` failed because an explicit `{ can_read: false, can_write: false }` row removed an owner's field access.
- `rtk npm run test --workspace @nexus/web -- tests/database-client.test.ts` failed because the second export page without a header was passed through the old newline-based header stripper and was discarded.
- `rtk npm run test --workspace @nexus/worker -- tests/database-routes.test.ts -t 'advertised CSV payload' --pool=forks --maxWorkers=1 --minWorkers=1` failed `413` rather than `201` for a valid JSON CSV payload above 1 MiB.
- `rtk npm run test --workspace @nexus/worker -- tests/d1-database-repository.test.ts -t 'uses typed saved filters|guards relation targets|omits repeated CSV headers' --pool=forks --maxWorkers=1 --minWorkers=1` failed with a numeric saved filter returning zero records, a relation target deleted by a single-record create resolving successfully, and page two repeating its CSV header.
- Controlled RED replay after the focused implementation: temporarily disabling cursor checks and raising the reference cap made `uses typed saved filters and rejects cursors from another view or search query` accept a cross-view cursor and made `rejects reference-heavy CSV input before expanding unbounded guard sets` return `INVALID_RELATION_REFERENCE` instead of `REFERENCE_LIMIT`. The guards were immediately restored before GREEN verification.

### GREEN evidence

- `rtk npm run test --workspace @nexus/worker -- tests/d1-database-repository.test.ts tests/database-routes.test.ts --pool=forks --maxWorkers=1 --minWorkers=1 --reporter=dot`: passed `2/2` files and `28/28` tests.
- `rtk npm run test --workspace @nexus/contracts -- tests/database-contracts.test.ts`: passed `4/4`.
- `rtk npm run test --workspace @nexus/domain -- tests/database-values.test.ts tests/database-permissions.test.ts tests/database-csv.test.ts`: passed `3/3` files and `8/8` tests.
- `rtk npm run test --workspace @nexus/web -- tests/database-client.test.ts`: passed `3/3`, covering the compatible client export pagination contract.
- `rtk npm run test --workspace @nexus/worker -- --pool=forks --maxWorkers=1 --minWorkers=1 --reporter=dot`: passed `37/37` Worker files and `204/204` tests in `129.16s`. Existing poison-message tests emit expected `OCR_QUEUE_MESSAGE_INVALID` stderr lines.
- `rtk npm run typecheck --workspace @nexus/worker`, `@nexus/contracts`, `@nexus/domain`, and `@nexus/web`: all exited `0`.
- `git diff --check`: passed with no output.

### Requirement mapping

- Typed saved filters bind normalized native number and boolean values. Multi-select, multi-member, and multi-relation filters use JSON membership for scalar predicates, normalized JSON equality for array predicates, and explicit null/empty-array semantics.
- Record list cursors carry a compact `v1` fingerprint. Saved-view cursors bind database ID, view ID, revision, and config; search cursors bind database ID and query. Missing, stale, cross-view, and cross-query cursors return `INVALID_CURSOR`.
- Reference validation deduplicates across CSV, bulk, template, and single-record values and rejects more than `1,000` distinct member/relation references before D1 validation or write statements.
- Relation transaction guards now use the always-present workspace sentinel instead of an arbitrary database record. Single record creation has pre/post guards and maps a target-delete race to `INVALID_RELATION_REFERENCE`; template create/update/apply retain transaction guards.
- CSV import has a route-specific `12 MiB + 16 KiB` JSON body boundary, which safely accommodates a 2 MiB UTF-8 CSV's JSON escaping overhead while the domain parser retains its 2 MiB CSV limit.
- Owners bypass explicit field denial rows, preserving owner as the highest database role. Hidden/read-only property state remains schema behavior, not a permission override.
- `CsvExportInput.include_header` is optional and defaults to true. The server omits the header only when explicitly false; the compatible client requests it once, so quoted-newline headers cannot be sliced or duplicated while pages remain bounded.

### Remaining Web findings for the next sequential agent

- Refetch page one on selected-view revision/config changes; cancel stale requests and scope/invalidate caches by view revision/config.
- Complete dedicated typed CRUD/settings UI for every database entity and property type, including no-view creation paths.
- Add user/viewport-driven bounded board/calendar loading, robust serialized optimistic bulk rollback, and confirmed snapshot reconciliation.
- Keep CSV export consumption bounded in the UI (chunk/Blob strategy where required) and complete drawer focus-return, modal focus containment, and real-browser 390px/200%/keyboard evidence.

## Task 7 Web Review Fix Wave 3 - Blocked

### Blocking API evidence

- `apps/worker/src/routes/database-metadata.ts` exposes only `PUT /api/v2/databases/:databaseId/permissions` and `PUT /api/v2/databases/:databaseId/properties/:propertyId/permissions`. It has no permission or field-permission list/read route and no deletion route.
- `apps/worker/src/databases/d1-database-views.ts:getDatabase` returns only `database`, `role`, `properties`, `views`, and `templates`. It does not return database permissions or field permissions.
- Both `SetDatabasePermissionInputSchema` and `SetFieldPermissionInputSchema` require a positive `base_revision`. With no list/read response, the Web client cannot discover an existing permission or obtain its current revision before a mutation.

### Consequence

The requested Web scope explicitly requires browseable/selectable database- and field-permission state and typed updates using each entity's current revision. That behavior cannot be implemented correctly against `/api/v2` at backend head `018c10e`; guessing `base_revision: 1` violates the revision contract and fails after the first edit. No Web implementation changes were made, and no Worker/domain/contracts/migration/deployment/remote/secret files were changed.

## Task 7 Web Review Fix Wave 3

### Prerequisite resolution

- The earlier blocker remains recorded above. Backend head `7328558` adds manage-only database/field permission list and revision-CAS delete APIs, so the Web flow can now enumerate current entities and supply their revisions without guessing.

### RED evidence

- `npm run test --workspace @nexus/web -- tests/database-task7-web.test.tsx` failed `5/12` before the Web implementation. The failures were: no refetch on selected-view revision/config change; no header or tools when views were empty; board auto-loaded instead of waiting for a user action; board retained a stale confirmed revision after queue drain/source refresh; and permissions were not browseable or deletable with their returned revisions.
- A follow-up Blob test initially exposed jsdom's missing `Blob.text()` API rather than application behavior. It was adjusted to assert the generated Blob's exact byte size and its `include_header: [true, false]` paging contract; no production behavior or timeout was changed.

### GREEN evidence

- `npm run test --workspace @nexus/web -- tests/database-task7-web.test.tsx tests/database-workbench.test.tsx tests/database-state.test.ts tests/database-client.test.ts tests/database-workspace-live.test.tsx`: passed `5/5` files and `29/29` tests.
- `npm run test --workspace @nexus/web`: passed `21/21` files and `94/94` tests.
- `npm run typecheck --workspace @nexus/web`: passed.
- `npm run build --workspace @nexus/web`: passed. No Vite `>500 kB` warning; lazy `DatabaseWorkbench` is `42.32 kB` (`11.76 kB` gzip).
- `npm run beta:build`: passed for Web, Worker, contracts, domain, testkit, and UI.
- `npm run verify:deploy`: passed local readiness checks.

### Requirement mapping

- View query identity: page and cursor state now include a `view id + revision + config` fingerprint. A changed selected view aborts the prior request, invalidates the old pages, and fetches page one with `{ cursor: null, viewId, limit }`; the signal is carried through `App` to `DatabaseClient`.
- Empty view state: the database header and tool drawer remain available with no saved view, so first property and view creation is not a dead end.
- Typed workflows: the focused drawer forms expose database, property, record, view, template, comment, database-permission, and field-permission create/update/delete/list/select paths. Existing entities provide their current revision to updates/deletes; view editing exposes page size, visible columns, grouping, frozen field, row height, card segmentation, date field, undated records, and week start.
- Board/calendar scale: collection pages are loaded only by the explicit `加载更多记录` control, in a bounded 100-record request. There is no automatic cursor drain or two-page truncation.
- Optimistic safety: bulk operations serialize through a queue; board/calendar serialize per record and clear confirmed snapshots when a record queue drains or a newer source revision arrives.
- CSV: export accumulates bounded response strings as Blob parts through the server's `include_header` contract rather than concatenating an unbounded JavaScript string; quoted-newline chunks are not parsed or sliced in the client.
- Focus: drawer view changes close through the same focus-return path, Escape returns focus to the trigger, and Tab/Shift+Tab are contained inside the modal drawer. Existing visualViewport/safe-area and one-scroll-owner behavior remain covered by the mobile test.
- Build audit: `apps/web/dist/index.html` has no initial Markdown/OCR preload. The only modulepreload text in the generated JS is Vite/React runtime support, not an eager Markdown/OCR dependency.

### Scope and remaining evidence gap

- Modified only `apps/web` sources/tests and this report; no Worker, domain, contracts, migration, deployment, remote, or secret files were changed by this wave.
- No real-browser 390px/200%/mobile-keyboard harness is configured. The code and jsdom 390px/2dppx/visualViewport/focus behavior are covered here; real-browser evidence remains the named Task 11 gate.

## Task 7 Permission API Unblocker

### RED evidence

- Added repository, route, and compatible Web client tests before the API implementation. The client RED run failed with `client.listDatabasePermissions is not a function`; the Worker tests initially lacked the corresponding repository methods and route registrations.

### GREEN evidence

- `rtk npm run test --workspace @nexus/worker -- tests/d1-database-repository.test.ts -t "lists current permission revisions|deletes permissions" --pool=forks --maxWorkers=1 --minWorkers=1 --reporter=dot`: passed `2/2` new repository tests. They cover deterministic list order, current revision after the first update, stale delete CAS, field permission deletion, viewer denial, and cross-workspace denial.
- `rtk npm run test --workspace @nexus/worker -- tests/database-routes.test.ts --pool=forks --maxWorkers=1 --minWorkers=1 --reporter=verbose`: passed `4/4`, including GET/DELETE route registration and v2 success envelopes for both permission collections.
- `rtk npm run test --workspace @nexus/contracts -- tests/database-contracts.test.ts`: passed, including typed permission list response and deletion input schemas.
- `rtk npm run test --workspace @nexus/web -- tests/database-client.test.ts`: passed, including typed list/delete calls through the v2 paths.
- Full `@nexus/worker` suite: `rtk npm run test --workspace @nexus/worker -- --pool=forks --maxWorkers=1 --minWorkers=1 --reporter=dot` passed `37/37` files and `206/206` tests in `132.88s`. Existing `OCR_QUEUE_MESSAGE_INVALID` stderr is expected poison-message coverage.
- `rtk npm run typecheck --workspace @nexus/worker`, `@nexus/contracts`, and `@nexus/web` passed. `git diff --check` passed.

### Requirement mapping

- Added strict shared list response and deletion-CAS contracts for database and field permissions.
- Repository list/delete methods require database `manage` access, scope every query to workspace/database/property, select only API fields, order by subject type/ID/entity ID, and enforce revision-CAS deletes.
- Added `GET` list and `DELETE` routes for database and field permissions while preserving existing PUT upserts and v2 envelopes.
- Permission collections deliberately remain outside the normal database bundle: only owner/database-manage callers can list them, so viewers cannot receive permission assignments through a readable database bundle.
- Added `DatabaseClient` typed list/delete methods with workspace-scoped query dedupe keys and standard command idempotency policies.

## Task 7 Review Fix Wave 4

### RED evidence

- Baseline before new tests: focused Web `35/35`, domain `3/3`, and Worker repository `26/26` passed.
- `rtk npm run test --workspace @nexus/web -- tests/database-task7-web.test.tsx tests/database-workbench.test.tsx tests/database-client.test.ts tests/database-workspace-live.test.tsx --reporter=dot` failed as expected with `11 failed / 21 passed`. The failures reproduced serializer-compatible CSV chunks merging rows, a deferred board page leaking into calendar, scalar member values becoming arrays, untyped saved filters, missing synchronized template defaults/cross-database relation choices, generic bulk inputs, missing drawer inert/scroll transfer, the hard 60-item undated cap, and the App-level child cursor update restoring the initial page.
- `rtk npm run test --workspace @nexus/domain -- tests/database-values.test.ts` failed as expected with `1 failed / 3 passed`: 129-character reference IDs and 101-item reference arrays were accepted.
- `rtk npm run test --workspace @nexus/worker -- tests/d1-database-repository.test.ts -t 'classifies a transaction-time stale revision with valid relations as a revision conflict' --pool=forks --maxWorkers=1 --minWorkers=1 --reporter=dot` failed as expected: the transaction-time stale revision was misclassified as `INVALID_RELATION_REFERENCE` instead of `REVISION_CONFLICT`.
- All RED failures were observed before any production-code edit. Two test-fixture issues were corrected and replayed before accepting RED: the stale-revision trigger was changed to `AFTER UPDATE`, and the deferred collection resolver was flushed through React `act`.

## Task 7 Review Fix Wave 4A - Web

### Scope and TDD sequence

- Base/head at start: `71379af` on `codex/public-beta-rewrite`. Existing Worker/domain changes for the sequential backend wave were preserved and excluded from this Web commit.
- The accepted test-first RED run is recorded immediately above: `rtk npm run test --workspace @nexus/web -- tests/database-task7-web.test.tsx tests/database-workbench.test.tsx tests/database-client.test.ts tests/database-workspace-live.test.tsx --reporter=dot` failed as expected with `11 failed / 21 passed` before production edits. It covered App parent/child cursor isolation, deferred cross-view collection responses, serializer-compatible CSV boundaries, all ten typed property/filter/bulk/template workflows, cross-database relation targets, drag-success-then-bulk-failure, undated expansion, and drawer inert/scroll transfer.
- On continuation from the preserved partial worktree, the same focused command failed `8/32` (`3` files failed, `1` passed). The remaining failures isolated missing template/property data flow, stale collection acceptance, pre-drag bulk rollback snapshots, the fixed 60-record undated cap, missing drawer scroll ownership, and App child-page cursor writeback.
- After the first minimal implementation, the same command failed `3/32`: two existing call-shape assertions detected an unnecessary collection `AbortSignal`, and child modal state incorrectly rendered/focused the inspector. The collection path was kept identity-ignored (the brief allows abort or ignore), and inspector rendering was separated from child modal background state without weakening tests.

### GREEN and gate evidence

- Focused Web behavior suite: `4/4` files and `32/32` tests passed.
- Full `@nexus/web`: `21/21` files and `101/101` tests passed.
- `rtk npm run typecheck --workspace @nexus/web`: passed (`tsc --noEmit`, exit 0).
- `rtk npm run build --workspace @nexus/web`: passed. Vite transformed `1,752` modules; main JS is `333.11 kB` (`98.97 kB` gzip), lazy `DatabaseWorkbench` is `46.04 kB` (`12.81 kB` gzip), and there was no `>500 kB` warning.
- `rtk npm run beta:build`: passed for Web, Worker, contracts, domain, testkit, and UI.
- `rtk npm run verify:deploy`: passed local deploy readiness checks.
- `git diff --check`: passed with no whitespace errors.
- Generated Web audit: `modulepreload_count=0`, `database_workbench_preload_count=0`, initial script `/assets/index-RLnBzEtJ.js`, lazy chunk `DatabaseWorkbench-LLyY9kZF.js`, and `markdown_ocr_named_assets=0`.

### Requirement mapping

1. `App` no longer writes child page cursors into the initial bundle cursor state. `DatabaseWorkbench` owns page/collection cursors and caches, keyed by workspace/database plus selected view revision/config fingerprint; view changes synchronously invalidate collection requests, and deferred responses must still match request ID and fingerprint before publishing.
2. Shared typed controls now cover text, number, checkbox, select, multi-select, date, URL, email, member, and relation across record creation/update, saved filters, bulk editing, and synchronized template defaults. Scalar member/relation values stay scalar unless `allow_multiple` is true, and relation property settings receive the full database list for cross-database targets.
3. CSV paging retains `include_header: true` only for page one and `false` thereafter. Non-empty chunks receive exactly one CRLF boundary when neither adjacent chunk supplies one; `exportCsvBlob` retains bounded response strings as Blob parts rather than parsing or slicing CSV rows.
4. Board/calendar collection loads capture database/view/config identity and request ID. Database/view/fingerprint changes abort the local acceptance token and stale deferred responses are ignored.
5. Board and calendar mutations delegate to the parent confirmed-state coordinator used by bulk preview. Per-record queues update the confirmed revision before later commands; a failed bulk edit restores the latest confirmed drag result rather than the original source record.
6. Calendar undated records use the saved view `segment_size`, reset on view/segment changes, and expose every bounded-page record through deterministic `加载更多未安排 N` expansion with no 60-item truncation.
7. Drawer state propagates through `AdaptiveWorkbench` context. The drawer is portaled outside its inert database background, owns the sole `data-scroll-owner`, removes the page owner, freezes/restores body scrolling, preserves focus containment/return, and keeps inspector rendering independent.

### Files changed

- Web sources: `apps/web/src/app/App.tsx`, `apps/web/src/data/database-client.ts`, `apps/web/src/databases/DatabaseBoardView.tsx`, `DatabaseBulkCsvForms.tsx`, `DatabaseCalendarView.tsx`, `DatabasePropertyEditor.tsx`, `DatabaseRecordForm.tsx`, `DatabaseToolsDrawer.tsx`, `DatabaseViewTemplateForms.tsx`, `DatabaseWorkbench.tsx`, `database-form-utils.ts`, and `apps/web/src/layout/AdaptiveWorkbench.tsx`.
- Web tests: `apps/web/tests/database-client.test.ts`, `database-task7-web.test.tsx`, `database-workbench.test.tsx`, and `database-workspace-live.test.tsx`.
- Evidence: `.superpowers/sdd/task-7-report.md`.

### Self-review and residual concern

- Correctness/robustness: checked empty values, scalar/array reference semantics, stale async completion, view/database changes, operation ordering, rollback revision selection, source refresh, and modal unmount cleanup. Tests assert behavior rather than implementation mocks where real components are available.
- Security/resources: no SQL, command construction, secrets, or new external inputs were introduced. Existing client validation/contracts remain authoritative; request tokens/controllers, mutation maps, portal focus, body overflow, and modal context are cleaned up on completion or unmount.
- Performance/readability: collection fetches remain bounded at 100, calendar expansion is segmented, CSV strings remain page-bounded Blob parts, and the workbench remains lazy. No new quadratic path is introduced beyond existing bounded record/property scans.
- Scope: only the 16 Web source/test files above plus this report are staged for Wave 4A. Existing `apps/worker` and `packages/domain` modifications remain unstaged for the sequential backend wave.
- Residual concern: the repository still has no real-browser 390px/200%/mobile-keyboard gate. This wave retains jsdom coverage for viewport, `visualViewport`, inert state, focus, and scroll-owner transfer; real-browser evidence remains the Task 11 gate.

## Task 7 Review Fix Wave 4B - Worker and Domain

### RED evidence

- Preserved prior RED evidence above for stale transaction revision classification, overlong member/relation IDs, and over-limit reference arrays.
- Added `returns REFERENCE_LIMIT before normalizing later CSV rows or bulk mutations`. Before the incremental collector change, the focused Worker run failed as expected: the CSV path returned `INVALID_FIELD_VALUE` from the later malformed row instead of `REFERENCE_LIMIT` after the 1,001st distinct reference.
- Added exact 1,000/1,001 boundary coverage for single-record create, template create, bulk edit, and CSV import, plus transaction-time member guard classification and relation-default application to a stale record.

### GREEN evidence

- `npm run test --workspace @nexus/worker -- tests/d1-database-repository.test.ts tests/database-routes.test.ts --pool=forks --maxWorkers=1 --minWorkers=1 --reporter=dot`: passed `2/2` files and `35/35` tests.
- `npm run test --workspace @nexus/domain -- tests/database-values.test.ts --reporter=dot`: passed `1/1` file and `4/4` tests.
- `npm run test --workspace @nexus/contracts -- tests/database-contracts.test.ts --reporter=dot`: passed `1/1` file and `5/5` tests.
- `npm run test --workspace @nexus/worker -- --pool=forks --maxWorkers=1 --minWorkers=1 --reporter=dot`: passed `37/37` files and `211/211` tests in `135.53s`. Existing poison-message tests emit expected `OCR_QUEUE_MESSAGE_INVALID` stderr lines.
- `npm run typecheck --workspace @nexus/worker`, `@nexus/domain`, and `@nexus/contracts`: all exited `0`.
- `npm run beta:build`: passed Web, Worker, contracts, domain, testkit, and UI builds. Web output retained the lazy `DatabaseWorkbench` chunk and had no large-chunk warning.
- `npm run verify:deploy`: passed local deploy readiness checks.
- `git diff --check`: passed with no output.
- Chunk/preload audit after build: `modulepreload_count=0`, `database_workbench_chunk_count=1`, `markdown_ocr_named_assets=0`.

### Requirement mapping

1. Record revision guards now use the `workspaces.id` conflict signature, distinct from relation `workspaces.slug` and member `users.email` guards. A stale bulk/template-application mutation containing valid relations returns `REVISION_CONFLICT`; disappearing relation/member references retain their specific errors. Board and calendar writes continue through the same guarded record update path.
2. Domain normalization rejects member/relation IDs longer than `128` characters and multi-value arrays longer than `100` items before repository expansion.
3. A bounded reference collector deduplicates by kind/property/target/id and throws at the 1,001st distinct item while CSV rows and bulk mutations are being normalized. Single-record and template paths use the same bounded collector before validation, guard statements, or JSON bindings. Tests cover exact 1,000 acceptance and 1,001 rejection across all four input paths.

### Files changed in this wave

- Worker sources: `apps/worker/src/databases/database-repository-base.ts`, `d1-database-records.ts`, `d1-database-csv.ts`, and `d1-database-views.ts`.
- Worker tests: `apps/worker/tests/d1-database-repository.test.ts`.
- Domain source/test: `packages/domain/src/database-values.ts` and `packages/domain/tests/database-values.test.ts`.
- Evidence: `.superpowers/sdd/task-7-report.md`.

### Self-review

- Correctness: checked distinct-reference deduplication, exact cap boundaries, early cap failure, member/relation transaction races, stale revision precedence, scalar versus array normalization, and atomic rollback behavior.
- Security/resources: IDs and arrays are bounded at the domain boundary; reference guard sets and JSON bindings cannot exceed the 1,000-item cap. No SQL, deployment, secret, remote, migration, or Web files were changed.
- Compatibility: `/api/v2` envelopes, `WorkspaceContext`, D1 rollback, and detach-before-delete behavior remain unchanged. No contracts changes were required because existing `EntityIdSchema` already enforces the 128-character ID bound.
- Residual concern: full Worker validation uses a serial fork pool to avoid the known Miniflare contention/timeout behavior; no test timeout or assertion was changed. Real-browser Web evidence remains outside this backend wave.

## Task 7 Review Fix Wave 5

### RED evidence

- Base/head before Wave 5 tests: `d41cb34` on `codex/public-beta-rewrite`; the worktree was clean.
- Worker focused RED: `rtk npm run test --workspace @nexus/worker -- tests/d1-database-repository.test.ts -t "round-trips scalar member and relation values through CSV as string IDs" --pool=forks --maxWorkers=1 --minWorkers=1 --reporter=dot` failed `1/1` as expected. CSV import coerced scalar member/relation IDs to arrays, and repository normalization raised `Invalid value` before the export/import round trip could complete.
- Web focused RED: `rtk npm run test --workspace @nexus/web -- tests/database-view-utils.test.ts tests/database-task7-web.test.tsx -t "local saved-view array filters|upserts database and field permissions for role subjects" --reporter=dot` failed `3/3` as expected. The permission drawer had no `主体类型` control; array equality removed the exact server-matched record; array `contains` used substring matching and incorrectly retained the `ab`/`record-20` prefix record.
- All Wave 5 behavior tests were added and observed failing for the expected missing behavior before any production-code edit.

### GREEN and gate evidence

- Exact RED commands after implementation: Worker passed `1/1`; Web passed `3/3` across `2/2` files.
- Broader focused gates: `d1-database-repository.test.ts` passed `32/32`; domain `database-values.test.ts` passed `4/4`; affected Web files passed `21/21`.
- Mandatory full Worker suite: `rtk npm run test --workspace @nexus/worker -- --pool=forks --maxWorkers=1 --minWorkers=1 --reporter=dot` passed `37/37` files and `212/212` tests in `145.05s`. Existing poison-message coverage emitted the expected `OCR_QUEUE_MESSAGE_INVALID` stderr lines.
- Mandatory full Web suite: the final non-concurrent run passed `22/22` files and `104/104` tests. An initial run executed concurrently with the full Worker suite passed `103/104` but observed the pre-existing inspector focus effect after dialog removal; the exact focused test immediately passed `1/1`, no code/timeout/assertion was changed, and the required sequential full Web rerun passed completely.
- `rtk npm run typecheck --workspace @nexus/worker`, `@nexus/web`, and `@nexus/domain`: all exited `0`.
- `rtk npm run beta:build`: passed Web, Worker, contracts, domain, testkit, and UI. Vite transformed `1,752` modules; main JS is `333.11 kB` (`98.97 kB` gzip), lazy `DatabaseWorkbench` is `46.82 kB` (`12.98 kB` gzip), and no `>500 kB` warning was emitted.
- `rtk npm run verify:deploy`: passed local deploy readiness checks. `git diff --check` passed with no output.
- Generated Web audit: `modulepreload_count=0`, `database_workbench_preload_count=0`, initial script `/assets/index-DL0xl6Tm.js`, lazy chunk `DatabaseWorkbench-DaKmW9m2.js`, and `markdown_ocr_named_assets=0`.

### Requirement mapping

1. Worker CSV coercion now always parses `multi_select` as a normalized semicolon-delimited array, but parses member/relation as arrays only when property config has `allow_multiple: true`; scalar references remain string IDs. A real D1 repository test creates scalar member/relation source values, exports CSV, imports it into equivalent destination properties, and verifies both imported values remain strings.
2. Local saved-view execution now mirrors server array semantics: array-valued filter needles use exact ordered equality (including missing/null/empty equivalence for `[]`), while scalar `equals`/`contains` against an array performs exact membership rather than substring matching. Multi-select and multi-value member/relation tests cover exact, partial, prefix, empty, missing, contains, not-contains, equals, and not-empty cases.
3. Database and field permission workflows expose a `user`/`role` subject-type selector. User subjects use a member-ID input; role subjects use owner/editor/viewer options. Both upserts include the selected subject type, and both existing-row lookups match `(subject_type, subject_id)` before selecting `base_revision`; the role update test includes a same-ID user row to prove revisions cannot cross subject types.

### Attachment quota gate justification

- Task 7 requires a deterministic full Worker gate. The attachment quota concurrency test historically seeded `1,023 MiB` through `41` sequential `reserveUpload` calls (`40 x 25 MiB` plus `1 x 23 MiB`); each call performs D1 insert/lookup work, and suite contention previously pushed the unchanged `5,000ms` test past timeout at `5,099ms`.
- The existing test-only setup optimization in `apps/worker/tests/d1-attachment-repository.test.ts` seeds the same 41 valid uploading rows in one `db.batch`, then runs the same two concurrent `1 MiB` reservations and the same fulfillment/rejection/final-usage assertions. This optimization is necessary to test the quota race rather than repeated setup I/O. Wave 5 retained it unchanged; no production behavior, timeout, or assertion was altered.

### Files changed

- Worker: `apps/worker/src/databases/d1-database-csv.ts` and `apps/worker/tests/d1-database-repository.test.ts`.
- Web: `apps/web/src/databases/DatabaseCollaborationForms.tsx`, `DatabaseToolsDrawer.tsx`, `database-view-utils.ts`, `apps/web/tests/database-task7-web.test.tsx`, and new `database-view-utils.test.ts`.
- Evidence: `.superpowers/sdd/task-7-report.md`.

### Self-review and concerns

- Correctness/robustness: verified scalar/array coercion at export/import boundaries, ordered array equality, exact membership, missing/null/empty arrays, same-ID cross-subject permission revisions, and both database/field role payloads. Existing multi-value CSV, user permission, rollback, detach-before-delete, and saved-view tests remain green.
- Security/resources: authorization remains server-enforced through existing `/api/v2` endpoints and `WorkspaceContext`; no SQL shape, dynamic command, secret, migration, remote, deployment, or legacy code changed. CSV values still pass domain normalization and bounded reference validation.
- Performance/readability: changes are constant-time branches over already bounded property arrays and permission lists; no new requests or unbounded accumulations were introduced. Shared subject controls avoid duplicate user/role parsing logic.
- Test quality: tests exercise real repository/component/utility behavior; mocks are limited to the existing HTTP boundary and include competing user/role rows so revision selection is observable. No assertion was weakened to obtain GREEN.
- Residual concern: the inspector focus test is scheduler-sensitive when full Web and the 145-second Miniflare suite run concurrently on this host; required full suites pass when run sequentially. This is a test-runner contention concern, not a Wave 5 product behavior change.
