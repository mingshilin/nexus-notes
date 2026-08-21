# Task 6C Report

## Status

`DONE_WITH_CONCERNS` pending the concern documented below.

## TDD RED Evidence

| Command | Expected/observed RED reason |
| --- | --- |
| `npm run test --workspace=@nexus/contracts -- tests/knowledge-contracts.test.ts` | `AttachmentSchema` was undefined before the attachment contracts were added. |
| `npm run test --workspace=@nexus/worker -- tests/attachment-service.test.ts` | `AttachmentService` was undefined before the service existed. |
| `npm run test --workspace=@nexus/worker -- tests/attachment-service.test.ts` | The 1 GB quota test resolved before quota enforcement was added. |
| `npm run test --workspace=@nexus/worker -- tests/attachment-routes.test.ts` | `registerAttachmentRoutes` was undefined before route registration was added. |
| `npm run test --workspace=@nexus/web -- tests/knowledge-client.test.ts` | `KnowledgeClient.listAttachments` was missing before client methods were added. |
| `npm run test --workspace=@nexus/web -- tests/knowledge-recovery-panel.test.tsx` | `KnowledgeRecoveryPanel` module did not exist before the recovery UI was added. |

An initial contracts command included unsupported Vitest option `--runInBand`; it failed at CLI parsing and was not treated as valid RED. An initial attachment-service test had a syntax error; it was corrected and re-run to the valid RED listed above.

## Modified Files

- `packages/contracts/src/attachments.ts`, `packages/contracts/src/index.ts`, and contracts tests
- `apps/worker/migrations/0003_private_attachments_ocr.sql`
- `apps/worker/src/attachments/*`, `apps/worker/src/routes/attachments.ts`, bootstrap/env/export wiring, and route-registry raw response support
- `apps/web/src/data/knowledge-client.ts`, `apps/web/src/knowledge/KnowledgeRecoveryPanel.tsx`, exports/styles, and Web tests

## Key Design

- New Beta tables (`beta_attachments`, `beta_ocr_jobs`) are additive. They use `workspace_id`, `user_id` for owner state, integer `revision`, and an internal-only `object_key` prefixed as `{workspaceId}/attachments/{attachmentId}`.
- All service/repository operations take caller workspace context; queries bind `workspace_id`, and owner-specific OCR retry binds both `workspace_id` and `user_id`.
- Upload reserve enforces 25 MB per file and 1 GB per workspace. Raw upload validates PDF/JPEG/PNG/WebP signatures or valid UTF-8 text; SVG has no supported MIME path. Private download uses authenticated binary response headers (`private, no-store`, `nosniff`, attachment disposition).
- Deletion marks metadata deleted, removes the object, OCR job state, and attachment search document. Diagnostics are workspace-scoped, stable-key cursor bounded, and non-mutating.
- The Web client reuses the existing API envelope/header/idempotency patterns. The recovery component intentionally adds no scroll owner and exposes MIME filtering, one-item/batch retry and diagnostic navigation callbacks.

## Verification

| Command | Result |
| --- | --- |
| `npm run test --workspace=@nexus/contracts -- tests/knowledge-contracts.test.ts` | PASS, 5 tests |
| `npm run test --workspace=@nexus/worker -- tests/attachment-service.test.ts tests/attachment-routes.test.ts` | PASS, 6 tests |
| `npm run test --workspace=@nexus/web -- tests/knowledge-client.test.ts` | PASS, 4 tests |
| `npm run test --workspace=@nexus/web -- tests/knowledge-recovery-panel.test.tsx` | PASS, 1 test |
| `npm run beta:test` | PASS: Beta Web 38, Worker 79, Contracts 12, Domain 3, UI 2 tests |
| `npm run beta:lint` | PASS: all workspace typechecks |
| `npm run beta:build` | PASS; no Vite `>500 kB` warning |
| `npm test` | PASS: legacy frontend 131 and Worker 62 tests |
| `npm run build` | PASS; no Vite `>500 kB` warning |
| `npm audit --omit=dev` | PASS: 0 vulnerabilities |
| `npm run verify:deploy` | PASS: local deploy-readiness checks |
| `Get-Content dist/index.html; Get-Content apps/web/dist/index.html` | PASS: neither HTML file preloads Markdown or OCR chunks |
| `git diff --check` | PASS: no whitespace errors |

## Commit

Implementation commit: `2c481c69f794efd2d012a85e34556ac24c4f5b02`.
Verification-test commit: `d3dfd5bfb9ab4f6a64073536eaadaa7b2673add1`.

## Self-Review / Risks

- The Queue message lifecycle is persisted and retry-safe, but this repository has no configured OCR extractor or Queue consumer implementation that can transition a pending job through `processing` to `completed` and write OCR text. The current slice therefore does not claim actual OCR recognition; an extractor/consumer must be supplied before production enablement.
- `KnowledgeRecoveryPanel` is an exported embedded recovery surface with real client callback shapes, but the current static Beta demo app has no active workspace selection/data-loading composition point to bind it to a live `KnowledgeClient`. It needs integration when the authenticated workspace shell receives live workspace data.

## Review-Fix Attempt

### RED/GREEN

| RED command | Failure | GREEN command | Result |
| --- | --- | --- | --- |
| `npm run test --workspace=@nexus/contracts -- tests/knowledge-contracts.test.ts` | completion schema required undefined `signature` | same | PASS, 5 tests |
| `npm run test --workspace=@nexus/worker -- tests/ocr-consumer.test.ts tests/attachment-routes.test.ts` | `OcrConsumer` missing; single retry accepted a different body id | same | PASS, 4 focused tests after consumer and path guard |
| `npm run test --workspace=@nexus/worker -- tests/d1-attachment-repository.test.ts` | `claimOcrJob` missing | same plus consumer | PASS, repository claim/complete integration test |
| `npm run test --workspace=@nexus/worker -- tests/attachment-service.test.ts` | Queue message used a generated rather than persisted job id | same | PASS, 5 tests |
| `npm run test --workspace=@nexus/web -- tests/app-auth-bootstrap.test.tsx` | live recovery UI was not mounted | same | PASS, 3 tests |

Focused final verification: Worker attachment/repository/consumer tests PASS (10 tests); contracts PASS (5); Worker and Web typechecks PASS.

### Implemented

- Removed the unused upload-completion signature contract field.
- Added OCR Queue consumer with workspace-scoped conditional claim, success-only `search_documents.ocr_text` write, recoverable fail/dead-letter transition, and Beta Worker queue handler.
- Enforced single-retry path/body identity and used repository-persisted job id/attempt/deadline in completion queue messages.
- Mounted recovery UI in the authenticated workspace with injected live `ApiClient`/workspace binding and failure-safe loading.

### Remaining Blockers

The review's remaining Critical/Important requirements are not complete in this attempt: atomic 1 GB D1 reservation plus streaming upload body limit, persistent queue outbox/recovery, unique workspace/attachment/source-revision migration and retry CAS, full image/PDF extractor configuration, aggregated failed-OCR diagnostics cursor changes, and the exhaustive requested real-D1 concurrency/cross-tenant/MIME test matrix. Full Beta/legacy/build/audit/readiness/preload gates were intentionally not claimed or rerun after this partial fix attempt.

## Fix A1 Worker/D1 Consistency Slice

### Status

`DONE_WITH_CONCERNS`. This intentionally excludes Web Fix A2 and does not claim Task 6C complete.

### TDD RED Evidence

| Command | Valid RED observed before production changes |
| --- | --- |
| `npm run test --workspace=@nexus/worker -- tests/d1-attachment-repository.test.ts` | Real local D1 concurrent quota test admitted both final 1 MiB reservations; expected one winner and one rejection. |
| `npm run test --workspace=@nexus/worker -- tests/attachment-routes.test.ts tests/attachment-service.test.ts` | Invalid/oversized `Content-Length` and oversized stream returned `200`; upload returned stale `uploading`, revision 1 metadata instead of refreshed `ready`, revision 2. |
| `npm run test --workspace=@nexus/worker -- tests/attachment-service.test.ts -t "maps an atomic D1 reservation rejection"` | Repository quota error lacked the service/API `status: 403` mapping. |
| `npm run test --workspace=@nexus/worker -- tests/ocr-outbox.test.ts tests/schema.test.ts` | `source_revision` did not exist, no OCR outbox message was persisted, and `OcrOutboxDispatcher` did not exist. |
| `npm run test --workspace=@nexus/worker -- tests/attachment-service.test.ts -t "creates one idempotent OCR job|retries only failed OCR jobs"` | Service did not dispatch the winning outbox id and leaked internal `outbox_ids` in the response. |
| `npm run test --workspace=@nexus/worker -- tests/ocr-consumer.test.ts -t "claims a tenant job once"` | Consumer claimed with only workspace/job id instead of the complete persisted queue message. |

Miniflare initially rejected the future compatibility date and multiline `D1Database.exec()` fixture input. Those setup errors were corrected and rerun; they were not counted as behavioral RED evidence.

### Implemented Design

- Quota admission is now a tenant-scoped single D1 `INSERT ... SELECT` whose predicate includes current non-deleted bytes and the exact 1 GB cap. Delete is status-conditional and therefore releases a reservation once; usage remains derived from non-deleted rows.
- Attachment routes reject malformed/oversized `Content-Length` before body reads, then consume a bounded stream only through byte `MAX_UPLOAD_BYTES + 1`, cancel on overflow, and never call unbounded `request.arrayBuffer()`.
- OCR generations are unique on `(workspace_id, attachment_id, source_revision)` while retaining initiating `user_id`. Creation and retry use D1 batch transactions for job/CAS plus outbox insertion; only the winning transition returns dispatchable outbox ids.
- Persisted messages contain job id, workspace, attachment, source revision, attempt, deadline, and idempotency key. Consumer claim compares every persisted value and current ready source revision, rejecting stale/deleted/cross-workspace work.
- `OcrOutboxDispatcher` leaves failed sends unpublished and increments persistent attempts; later dispatch retries the same payload, and successful dispatch marks it once. A Worker scheduled entry point can drain recovery rows without creating jobs.
- Content upload rereads metadata after the status transition and returns the real `ready` attachment.
- Local D1 tests use Miniflare and execute the actual three Worker migrations. No Web or deployment files/actions were included.

### Files

- Worker migration and implementation: `apps/worker/migrations/0003_private_attachments_ocr.sql`, `apps/worker/src/attachments/*`, `apps/worker/src/routes/attachments.ts`, `apps/worker/src/bootstrap.ts`, and `apps/worker/src/index.ts`.
- Worker tests: attachment route/service/repository/consumer/schema tests, `apps/worker/tests/ocr-outbox.test.ts`, and `apps/worker/tests/helpers/d1.ts`.
- Test dependency declaration: `apps/worker/package.json` and `package-lock.json` (`miniflare` devDependency).

### GREEN / Verification

| Command | Result |
| --- | --- |
| `npm run test --workspace=@nexus/worker -- tests/d1-attachment-repository.test.ts tests/attachment-routes.test.ts tests/attachment-service.test.ts tests/ocr-outbox.test.ts tests/ocr-consumer.test.ts tests/schema.test.ts` | PASS, 32 tests in 6 files. |
| `npm run test --workspace=@nexus/worker` | PASS, 102 tests in 27 files. |
| `npm run typecheck --workspace=@nexus/worker` | PASS. |
| `npm run test --workspace=@nexus/contracts -- tests/knowledge-contracts.test.ts` | PASS, 5 tests. |
| `npm run typecheck --workspace=@nexus/contracts` | PASS. |
| `git diff --check` | PASS. |

## Task 6C A2.2 Re-review Fix

### Scope

Web-only correction of race, cursor, modal, and focus findings from `task-6c-a22-rereview.md`. Active workspace auth/session remains out of scope.

### TDD RED / GREEN

| Finding | RED observed | GREEN evidence |
| --- | --- | --- |
| Aborted query dedupe | Real `ApiClient` controlled-fetch reused an aborted diagnostics promise, so the replacement fetch count remained 1. | The replacement query starts fetch 2 and resolves fresh data. |
| Filter cursor identity | A failed MIME-filter load retained the prior cursor and left its pagination control visible. | Filter changes clear the attachment cursor; same-query pagination failures retain it. |
| Modal state and focus | `inspectorOpen` without inspector content inerted the page; closing a dialog left focus on `body`. | `modalOpen = inspectorOpen && Boolean(inspector)` controls inert/owners/dialog; the recorded opener regains focus. |

### Verification

| Command | Result |
| --- | --- |
| `npm run test --workspace=@nexus/web -- tests/api-client.test.ts tests/knowledge-client.test.ts tests/knowledge-recovery-panel.test.tsx tests/knowledge-recovery-live.test.tsx tests/app-auth-bootstrap.test.tsx tests/adaptive-workbench.test.tsx` | PASS, 30 tests in 6 files. |
| `npm run typecheck --workspace=@nexus/web` | PASS. |
| `npm run build --workspace=@nexus/web` | PASS. |
| `git diff --check` | PASS. |

### Task 11 Gate

- Add a repeatable committed browser/e2e harness before accepting 390px/200% overflow as a release gate. This review fix does not treat CSS or jsdom assertions as browser-level proof.

Implementation commit: `edf61cc` (`fix: harden beta attachment consistency`).

### Still Failing / Not Completed

- No tests in the focused or full Worker suites remain failing at this commit.
- Failed OCR diagnostics are still emitted once per historical job rather than grouped by attachment with a unique aggregate cursor. Stable aggregated diagnostic pagination remains unimplemented and untested.
- Cross-tenant and concurrency paths use real local D1, and MIME/stream/path checks have focused service/route coverage, but a combined real-D1 plus R2 delete-then-download and MIME-signature end-to-end matrix is not present.
- Outbox delivery is intentionally at-least-once: concurrent dispatchers can send the same unpublished row before either marks it, while the full-message consumer CAS prevents duplicate processing.
- Web filter/loading/retry-refresh work is deferred to Fix A2. OCR image/PDF extraction quality was not changed in this Worker consistency slice. No deploy, readiness, full Beta/Web, or legacy build gates were run.

## Fix A1 Re-review Corrections

### Status

All findings in `task-6c-fixa-review.md` are addressed in this focused Worker/D1 slice. No Web, AI, Task 7, or deployment work was performed.

### TDD RED Evidence

| Finding | RED command | Observed failure before production change |
| --- | --- | --- |
| Published migration compatibility | `npm run test --workspace=@nexus/worker -- tests/schema.test.ts tests/d1-attachment-migration.test.ts` | `0004_attachment_consistency.sql` was absent, and old-shape inserts failed because modified 0003 already required `source_revision`. |
| Expired/crashed OCR recovery | `npm run test --workspace=@nexus/worker -- tests/ocr-outbox.test.ts -t "recovers"` | Both tests failed with `repository.recoverStaleOcrJobs is not a function`. |
| Atomic completion/search | `npm run test --workspace=@nexus/worker -- tests/ocr-outbox.test.ts -t "rolls back completed state"` | Forced search insert failure left the job incorrectly committed as `completed`, revision 3 instead of `processing`, revision 2. |
| Guaranteed preview redrive | `npm run test --workspace=@nexus/worker -- tests/preview-config.test.ts -t "redrives"` | Preview config had no `[triggers]` cron entry. |
| Exact legacy-key backfill | `npm run test --workspace=@nexus/worker -- tests/d1-attachment-migration.test.ts` | A legacy attachment id containing `_` was treated as a SQL `LIKE` wildcard and incorrectly backfilled source revision 9 instead of attachment revision 6. |

The real D1 + fake R2 delete-then-download route test passed on its first run. This review item was a missing integration-evidence finding; existing production deletion behavior required no change, so no artificial RED was manufactured.

### Implemented Design

- Restored `0003_private_attachments_ocr.sql` byte-for-byte to its published shape. New `0004_attachment_consistency.sql` rebuilds the OCR table with `source_revision` and `(workspace_id, attachment_id, source_revision)` uniqueness, parses exact legacy idempotency prefixes, falls back to attachment revision, and preserves canonical row status/attempt/revision/timestamps.
- Old user-scoped duplicates are ranked deterministically; the canonical generation remains active and every displaced row is preserved in `beta_ocr_jobs_0003_duplicates` with its original state and timestamps. `queue_outbox` and its ready index are guaranteed with `IF NOT EXISTS`.
- `recoverStaleOcrJobs` scans expired `pending`/`processing` jobs on the current ready source. It uses status/revision/deadline/source CAS to either create exactly one new attempt and outbox message, or terminally mark exhausted attempt 3 as `dead_letter`; unpublished stale messages are removed in the same D1 batch.
- Scheduled redrive now runs stale recovery before draining the persistent outbox. Preview config guarantees invocation every minute with `[triggers] crons = ["*/1 * * * *"]`.
- OCR completion state and attachment search upsert now execute in one D1 batch. A real abort trigger proves a failed search write rolls the job transition back.
- Route integration uses actual 0001→0004 local D1 migrations, `D1AttachmentRepository`, `AttachmentService`, and Map-backed fake R2; after DELETE, metadata and file routes both return `ATTACHMENT_NOT_FOUND` and stored bytes are gone.

### Files

- Migrations/config: restored `apps/worker/migrations/0003_private_attachments_ocr.sql`, added `apps/worker/migrations/0004_attachment_consistency.sql`, and updated `apps/worker/wrangler.preview.example.toml`.
- Runtime: `apps/worker/src/attachments/d1-attachment-repository.ts` and `apps/worker/src/bootstrap.ts`.
- Tests: `apps/worker/tests/d1-attachment-migration.test.ts`, local D1 helper, schema/outbox/preview-config/attachment-route suites.

### GREEN / Verification

| Command | Result |
| --- | --- |
| `npm run test --workspace=@nexus/worker -- tests/schema.test.ts tests/d1-attachment-migration.test.ts tests/ocr-outbox.test.ts tests/preview-config.test.ts tests/attachment-routes.test.ts` | PASS, 20 tests in 5 files. |
| `npm run test --workspace=@nexus/worker` | PASS, 108 tests in 28 files. |
| `npm run typecheck --workspace=@nexus/worker` | PASS. |
| `git diff --check` | PASS. |

Commit: focused re-review commit containing this report section; SHA is reported in the final handoff.

### Self-review / Residual Risk

- Recovery is deliberately bounded to 50 stale jobs per minute; deterministic deadline/id ordering lets later cron runs drain additional rows.
- Duplicate old generations cannot all remain active under the new invariant, so non-canonical rows are losslessly retained in the migration archive table rather than discarded or assigned a false source revision.
- Queue delivery remains at-least-once; full-message consumer CAS remains the duplicate-processing guard.

## Task 6C Fix A2.1: Worker/Contracts Diagnostics and Attachment Lifecycle

### Scope

Worker/contracts only. No Web code, Workers AI extractor, Task 7 work, or deployment was changed. The mounted recovery UI filters, loading/empty/error/success states, and retry-refresh behavior remain scoped to independent A2.2.

### TDD RED Evidence

| Command | Valid RED observed before production change |
| --- | --- |
| `npm run test --workspace=@nexus/contracts -- tests/knowledge-contracts.test.ts` | `AttachmentSchema` stripped the requested OCR status/metadata and did not strictly reject private response fields. |
| `npm run test --workspace=@nexus/worker -- tests/d1-attachment-repository.test.ts` | Historical failed jobs produced duplicate diagnostics for one attachment with `count: 1`, no latest safe error/status, and no aggregate failure count. |
| `npm run test --workspace=@nexus/worker -- tests/attachment-routes.test.ts tests/d1-attachment-repository.test.ts` | Real D1 list ignored `ocr_status`, returned unprojected attachment rows, and failed the private R2 lifecycle/filter assertion. |
| `npm run test --workspace=@nexus/contracts -- tests/knowledge-contracts.test.ts` and `npm run test --workspace=@nexus/worker -- tests/d1-attachment-repository.test.ts` | New `failure_count` assertion failed because neither strict contract nor diagnostic output exposed it. |

### Implemented

- Failed OCR diagnostics now group every failed/dead-letter job by attachment. The per-attachment `failure_count`/legacy `count`, latest failed status, and allowlisted safe error are emitted once under the existing globally unique deterministic `failed_ocr:{attachmentId}` cursor key. Raw job errors are never returned.
- `Attachment` responses are strict and project only `ocr_status`, latest job `ocr_attempt_count`, and `ocr_updated_at`; `object_key`, OCR text, job id, and raw/internal error fields remain absent. Attachment lists accept server-side latest `ocr_status` filtering.
- Local Miniflare D1 plus a Map-backed private R2 integration covers all supported signatures (PDF/JPEG/PNG/WebP/UTF-8 text), invalid signature rejection, list/filter behavior, cross-workspace metadata/download/delete/OCR denial, and delete cleanup of object bytes, OCR jobs, search documents, and diagnostics.

### Files

- Contracts: `packages/contracts/src/attachments.ts`, `packages/contracts/tests/knowledge-contracts.test.ts`.
- Worker: `apps/worker/src/attachments/attachment-service.ts`, `apps/worker/src/attachments/d1-attachment-repository.ts`, `apps/worker/src/routes/attachments.ts`.
- Tests: `apps/worker/tests/d1-attachment-repository.test.ts`, `apps/worker/tests/attachment-routes.test.ts`.

### GREEN / Verification

| Command | Result |
| --- | --- |
| `npm run test --workspace=@nexus/contracts -- tests/knowledge-contracts.test.ts` | PASS, 6 tests. |
| `npm run test --workspace=@nexus/worker -- tests/attachment-routes.test.ts tests/d1-attachment-repository.test.ts tests/attachment-service.test.ts` | PASS, 25 tests in 3 files. |
| `npm run typecheck --workspace=@nexus/contracts` | PASS. |
| `npm run typecheck --workspace=@nexus/worker` | PASS. |
| `git diff --check` | PASS. |

### Commit and Residual Risk

Implementation commit: `11e111423486aa6fa412be517130880ff8f4fc79` (`fix: complete task 6c a2.1 attachment diagnostics`).

- A2.2 Web recovery filters/loading/retry refresh and layout regressions are intentionally not implemented or tested here.
- Diagnostics retain the established key-ordered cross-kind cursor. The new `failed_ocr:{attachmentId}` key is globally unique and stable, but adding new diagnostic kinds whose keys sort before an already-issued cursor follows the existing cursor consistency model.

## Task 6C A2.1 Review Fix: Discriminated Diagnostics Contract

### TDD RED / Root Cause

`KnowledgeDiagnosticSchema` was a single strict object with optional failed-OCR fields. It therefore accepted invalid combinations such as `kind: "failed_ocr"` with `ocr_status: "completed"`, missing `failure_count`, or an unrelated diagnostic carrying OCR recovery fields.

| Command | Valid RED observed before production change |
| --- | --- |
| `npm run test --workspace=@nexus/contracts -- tests/knowledge-contracts.test.ts` | A `failed_ocr` diagnostic with `ocr_status: "completed"` was accepted, proving the broad optional schema did not enforce kind-specific state. |
| `npm run test --workspace=@nexus/contracts -- tests/knowledge-contracts.test.ts` | A `failed_ocr` diagnostic missing `failure_count` was accepted. |

### Implemented

- Replaced the broad schema with a `kind`-discriminated union.
- `failed_ocr` now requires positive `failure_count`, `ocr_status` limited to `failed | dead_letter`, and allowlisted `latest_error`.
- `unfiled_note`, `orphan_note`, `duplicate_title`, and `broken_link` remain strict and reject all failed-OCR recovery fields.
- Added an actual Worker route envelope assertion for a valid failed-OCR recovery diagnostic; no Worker production behavior, Web, or AI code changed.

### GREEN / Verification

| Command | Result |
| --- | --- |
| `npm run test --workspace=@nexus/contracts -- tests/knowledge-contracts.test.ts` | PASS, 6 tests. |
| `npm run test --workspace=@nexus/worker -- tests/attachment-routes.test.ts tests/d1-attachment-repository.test.ts tests/attachment-service.test.ts` | PASS, 25 tests in 3 files. |
| `npm run typecheck --workspace=@nexus/contracts` | PASS. |
| `npm run typecheck --workspace=@nexus/worker` | PASS. |
| `git diff --check` | PASS. |

Implementation commit: `b8e01b7327ba99321035cf13b45e4e0dad6a81b8` (`fix: discriminate OCR recovery diagnostics`).

## Task 6C Fix A2.2: Live Web Recovery Surface

### Scope

Web-only implementation on `codex/public-beta-rewrite` from baseline `4da0c54`. No Worker, schema, AI, deployment, or Task 7 changes were made.

### TDD RED Evidence

| Command | Valid RED observed before production change |
| --- | --- |
| `npm run test --workspace=@nexus/web -- tests/knowledge-client.test.ts tests/knowledge-recovery-panel.test.tsx tests/app-auth-bootstrap.test.tsx` | 5 expected failures: missing attachment `ocr_status` query, no controlled panel state, workspace requests had no abort signal, and duplicate retry clicks issued duplicate requests. |
| `npm run test --workspace=@nexus/web -- tests/knowledge-recovery-panel.test.tsx` | The 390px/200% CSS assertion failed because the recovery surface had no shrinkable filter grid, narrow-screen wrapping, or reduced-motion rule. |

### Implemented

- `KnowledgeClient.listAttachments` now sends `ocr_status` and accepts the existing `AbortSignal` through the query policy.
- The authenticated Web container uses the supplied active workspace only; it does not invent a fallback workspace. It aborts attachment/diagnostic requests on workspace or filter changes, preserves already loaded safe data during refresh, and exposes loading, empty, error, pagination, and stale-refresh states.
- MIME/OCR status controls are fully controlled, reset deterministically, and update the attachment query. Single and batch retry are deduplicated while pending, give categorized feedback, and refresh both data surfaces after either success or failure.
- Diagnostics are passed to an injected `onDiagnosticNavigate` callback before safe UI navigation; no note mutation is performed by the recovery component.
- The panel adds no scroll owner. Responsive CSS keeps controls shrinkable/wrappable at 390px/200%, preserves safe-area shell behavior, provides visible focus treatment, and disables recovery motion under `prefers-reduced-motion`.

### GREEN / Verification

| Command | Result |
| --- | --- |
| `npm run test --workspace=@nexus/web -- tests/knowledge-client.test.ts tests/knowledge-recovery-panel.test.tsx tests/app-auth-bootstrap.test.tsx tests/adaptive-workbench.test.tsx` | PASS, 17 tests in 4 files. |
| `npm run typecheck --workspace=@nexus/web` | PASS. |
| `npm run build --workspace=@nexus/web` | PASS. |
| `npm run typecheck --workspace=@nexus/contracts` | PASS. |
| `git diff --check` | PASS. |

### Residual Risk

- The Beta auth-session payload currently exposes no workspace selector. The Web surface therefore requires the active workspace id from its existing app/environment integration and deliberately renders a safe no-workspace state instead of querying a demo workspace.

## Task 5A: Worker/Contracts Authenticated Active Workspace

### Scope and Status

`DONE` for Task 5A only. This slice changes contracts, Worker auth/session behavior, and the additive `0005_personal_workspace.sql` migration. AuthClient/AuthGate/App integration is intentionally deferred to Task 5B. No Web, deployment, invitation/member-management, Task 8, or legacy migration changes were made.

### TDD RED Evidence

| Command | Valid RED observed before production change |
| --- | --- |
| `npm test --workspace @nexus/contracts -- tests/auth-contracts.test.ts` | `AuthSessionSchema` and `WorkspaceMembershipSummarySchema` were undefined. |
| `npm test --workspace @nexus/worker -- tests/personal-workspace-migration.test.ts` | Additive `0005_personal_workspace.sql` did not exist. |
| `npm test --workspace @nexus/worker -- tests/personal-workspace-repository.test.ts` | Personal-workspace verification/reconciliation/list methods did not exist. |
| `npm test --workspace @nexus/worker -- tests/auth-service.test.ts` | Verification still called the old user-only method and `getSession()` did not exist. |
| `npm test --workspace @nexus/worker -- tests/auth-routes.test.ts` | Session route still called `getSessionUser`, so the full workspace session request failed. |
| `npm test --workspace @nexus/worker -- tests/personal-workspace-repository.test.ts` | A legacy team workspace using `personal-user-1` caused a global slug uniqueness failure during reconciliation. |

### Implemented Design

- Shared strict contracts expose only safe user/workspace summaries: workspace `id`, `name`, `slug`, `role`, and positive `revision`, plus `active_workspace_id`. Capability data, member lists, and internal workspace kind are excluded.
- `0005` adds `workspace_type = personal | team`, defaults all existing rows to `team`, and adds a partial unique owner index for personal workspaces. Existing `0001-0004` remain unchanged.
- The migration's Beta quota trigger rejects a third explicit team workspace while allowing the required personal reconciliation to proceed for legacy users already at quota.
- Verification updates the user and creates the personal workspace plus owner membership in one D1 batch. Session reconciliation uses the same idempotent batch. The partial unique index is the concurrent winner invariant; owner membership is inserted/repaired without repeat-write revision churn.
- Personal slugs derive from the generated workspace ID, so legacy user-derived team slugs cannot block reconciliation.
- Session workspace reads join only the authenticated user's memberships and sort personal first, then case-insensitive name, slug, and ID. The service chooses personal as active, otherwise the first authorized workspace, and the route returns the full data inside the existing API envelope.

### GREEN / Verification

| Command | Result |
| --- | --- |
| `npm test --workspace @nexus/worker -- tests/auth-service.test.ts tests/auth-routes.test.ts tests/d1-auth-repository.test.ts tests/personal-workspace-repository.test.ts tests/personal-workspace-migration.test.ts tests/schema.test.ts` | PASS, 23 tests in 6 files. |
| `npm test --workspace @nexus/worker` | PASS, 117 tests in 30 files. |
| `npm test --workspace @nexus/contracts` | PASS, 15 tests in 4 files. |
| `npm run typecheck --workspace @nexus/worker` | PASS. |
| `npm run typecheck --workspace @nexus/contracts` | PASS. |
| `git diff --check` | PASS. |
| `git diff --quiet 190ef48 -- apps/web` | PASS, Web unchanged. |
| `git diff --quiet 190ef48 -- apps/worker/migrations/0001_beta_schema.sql apps/worker/migrations/0002_search_document_sync.sql apps/worker/migrations/0003_private_attachments_ocr.sql apps/worker/migrations/0004_attachment_consistency.sql` | PASS, published migrations unchanged. |

Commit: the independent Task 5A commit containing this section; SHA is recorded in the final handoff.

## Task 5A Review Important Fix: Atomic Email Verification Activation

### Scope and Root Cause

This is the single remaining Task 5A review fix. The previous implementation consumed `email_codes.consumed_at` in one repository call, then verified the user and ensured the personal workspace in a second call. A failure in the second call could permanently consume a valid code without activating the account. No Web files were changed.

### TDD RED / GREEN

| Command | Evidence |
| --- | --- |
| `npm test --workspace @nexus/worker -- tests/personal-workspace-repository.test.ts tests/auth-service.test.ts` | RED: service still called the removed two-stage methods and the repository had no atomic method. After fixing test fixtures, 2 expected production-method failures remained. |
| `npm test --workspace @nexus/worker -- tests/personal-workspace-repository.test.ts tests/auth-service.test.ts` | GREEN: 12/12 after the atomic repository batch was implemented. |

The repository test uses a real Miniflare D1 database. A database proxy replaces only the workspace statement in the four-statement batch with an invalid D1 insert. The real D1 batch rejects and rolls back `consumed_at`, `email_verified_at`, user `status`, all workspace rows, and all membership rows. A normal repository retry with the same valid code then succeeds once; a second retry returns `null`, leaving exactly one personal workspace and one owner membership.

### Implemented

- Added `verifyEmailCodeAndEnsurePersonalWorkspace(codeHash, now)` as the sole verification repository operation. Its D1 batch conditionally consumes the code, updates the user, creates the personal workspace, and ensures owner membership using the consumed code as the transaction-local join key.
- `AuthService.verifyEmail()` now hashes the code and performs exactly one repository call; it no longer has a consume-then-activate window.
- Removed the old `consumeEmailCode` and `markEmailVerifiedAndEnsurePersonalWorkspace` repository API paths to prevent future two-stage use.

### Verification

| Command | Result |
| --- | --- |
| `npm test --workspace @nexus/worker -- tests/auth-crypto.test.ts tests/auth-routes.test.ts tests/auth-service.test.ts tests/d1-auth-repository.test.ts tests/personal-workspace-repository.test.ts tests/personal-workspace-migration.test.ts tests/schema.test.ts tests/session-tenancy.test.ts tests/resend-email.test.ts tests/turnstile.test.ts` | PASS, 31 tests in 10 files. |
| `npm run typecheck --workspace @nexus/worker` | PASS. |
| `git diff --check` | PASS. |

Commit: the independent atomicity-fix commit containing this section; SHA is recorded in the final handoff.

## Task 6C A2.2 Web Review Fix

### Scope

Web-only correction of the three Important findings in `task-6c-a22-review.md`. The separately confirmed active-workspace auth/session gap remains intentionally untouched; no Worker, auth, schema, AI, deployment, or Task 7 code changed.

### TDD RED Evidence

| Command | Valid RED observed before production change |
| --- | --- |
| `npm run test --workspace=@nexus/web -- tests/knowledge-recovery-live.test.tsx tests/knowledge-recovery-panel.test.tsx tests/adaptive-workbench.test.tsx` | Successful attachment data disappeared when diagnostics rejected because the initial load used coupled `Promise.all`; the inspector rendered two recovery regions. |
| Same command after the first implementation pass | Attachment pagination error was written in `catch` then unconditionally cleared in `finally`; the test exposed the state-transition bug before the minimal correction. |

### Implemented

- Initial attachment and diagnostics requests now settle independently. Each successful result updates only its own data/cursor and clears only its own error; a failed peer keeps safe cached data visible with a source-specific degraded error.
- Attachment/diagnostic pagination appends only fulfilled pages, retains its cursor and existing data after failure, and leaves the failed page retryable.
- The recovery surface is mounted only in the main canvas. When inspector is open, the background is inert/hidden, its page scroll owner is removed, close control receives focus, and the bounded dialog is the single `inspector` scroll owner.
- Added behavioral coverage for filter abort, cursor append/failure recovery, partial source failure, batch retry dedupe/disable/refresh, modal focus/390px scroll ownership, and modal background isolation. Static CSS checks remain supplemental only.

### GREEN / Verification

| Command | Result |
| --- | --- |
| `npm run test --workspace=@nexus/web -- tests/knowledge-client.test.ts tests/knowledge-recovery-panel.test.tsx tests/knowledge-recovery-live.test.tsx tests/app-auth-bootstrap.test.tsx tests/adaptive-workbench.test.tsx` | PASS, 22 tests in 5 files. |
| `npm run typecheck --workspace=@nexus/web` | PASS. |
| `npm run build --workspace=@nexus/web` | PASS. |
| `git diff --check` | PASS. |

## Task 5B: Active Workspace Web Binding

### Scope

Web-only active-workspace binding from the Task 5A server session contract. No Worker, schema, invitation/member-management, deployment, or Task 8 changes were made.

### TDD RED / GREEN

| Requirement | RED evidence | GREEN evidence |
| --- | --- | --- |
| Full typed session parsing | apps/web/tests/auth-client.test.ts accepted a payload without active_workspace_id; AuthClient.session() returned it unchanged. | The same focused test rejects malformed payloads and returns the full parsed AuthSession. |
| Gate session render path and post-login refresh | apps/web/tests/auth-gate.test.tsx rendered function children as invalid React children and rendered authenticated content from the login response without a second session request. | ReactNode children remain supported; typed render props receive the parsed session; post-login refresh blocks children, and a network failure exposes retry without invented workspace data. |
| Server workspace binding and safe transitions | apps/web/tests/app-auth-bootstrap.test.tsx made no requests for a server-only active id, still used VITE_WORKSPACE_ID, and could not transition request headers through a refreshed session. | App derives the active id from session.active_workspace_id, ignores VITE_WORKSPACE_ID, keeps no-workspace requests at zero, and keys the workspace shell so old recovery requests abort before the new tenant loads. |

### Implemented

- AuthClient.session() validates /api/v2/auth/session using shared AuthSessionSchema and exposes AuthSession/AuthUserSummary types.
- AuthGate stores the complete session, supports typed render-prop children in addition to ReactNode children, and refreshes session state after AuthPanel reports authentication. Refresh failures stay retryable and never synthesize a workspace.
- App has no production workspace environment fallback. Its optional explicit workspaceId prop remains an embedding/test override; otherwise session.active_workspace_id drives the keyed authenticated workspace shell.

### Verification

| Command | Result |
| --- | --- |
| npm run test --workspace=@nexus/web -- tests/auth-client.test.ts tests/auth-gate.test.tsx tests/auth-panel.test.tsx tests/auth-mobile-overflow.test.ts tests/app-auth-bootstrap.test.tsx tests/knowledge-recovery-panel.test.tsx tests/knowledge-recovery-live.test.tsx | PASS, 35 tests in 7 files. |
| npm run typecheck --workspace=@nexus/web | PASS. |
| npm run build --workspace=@nexus/web | PASS. |
| npm run typecheck --workspace=@nexus/contracts | PASS. |
| git diff --check | PASS. |

## Task 5B Review Fix: Workspace Request Lifecycle And AuthUser Compatibility

### TDD RED / GREEN

| Finding | RED evidence | GREEN evidence |
| --- | --- | --- |
| Old attachment pagination could survive a workspace remount | Controlled deferred attachment page retained signal.aborted false after the ws-2 session remount. | The original request signal is aborted and the late ws-1 page never appears in the ws-2 UI. |
| Old diagnostic pagination could survive a workspace remount | Controlled deferred diagnostic page retained signal.aborted false after the ws-2 session remount. | The original request signal is aborted and the late ws-1 diagnostic never appears in the ws-2 UI. |
| OCR retry was neither cancellable nor lifecycle-guarded | The retry command policy had no signal after remount. | Retry receives an AbortSignal, it aborts on old workspace unmount, and a late resolution produces no stale feedback. |
| AuthUser API compatibility regressed | Standalone strict TypeScript compilation rejected a legacy AuthUser without displayName. | The same compilation accepts the legacy public type while AuthClient.session() retains strict AuthSessionSchema parsing. |

### Implemented

- Recovery effect cleanup now aborts the shared initial/pagination controller set on every dependency transition and unmount.
- OCR retry commands accept an optional signal. The workspace owns retry controllers, aborts them at lifecycle end, and checks cancellation before every success, error, or final state update.
- AuthUser is again a public compatibility interface with optional displayName; the strict shared session contract remains internal to AuthClient.session().

### Verification

| Command | Result |
| --- | --- |
| npm run test --workspace=@nexus/web -- tests/auth-client.test.ts tests/auth-gate.test.tsx tests/auth-panel.test.tsx tests/auth-mobile-overflow.test.ts tests/app-auth-bootstrap.test.tsx tests/knowledge-client.test.ts tests/knowledge-recovery-panel.test.tsx tests/knowledge-recovery-live.test.tsx | PASS, 43 tests in 8 files. |
| npx tsc --noEmit --strict --skipLibCheck --jsx react-jsx --module ESNext --moduleResolution Bundler --target ES2022 apps/web/tests/auth-client.test.ts | PASS. |
| npm run typecheck --workspace=@nexus/web | PASS. |
| npm run build --workspace=@nexus/web | PASS. |
| npm run typecheck --workspace=@nexus/contracts | PASS. |
| git diff --check | PASS. |

## Task 6C Fix B1: Isolated OCR Extractor Adapter

### Scope

This B1 slice adds only the typed Worker-side OCR extraction adapter and fake object-store/AI tests. It does not wire the Queue consumer, bootstrap, environment bindings, or Wrangler configuration; those remain the separately scoped B2 slice.

### TDD RED / GREEN

| Command | Result |
| --- | --- |
| `npm run test --workspace=@nexus/worker -- tests/ocr-extractor.test.ts` | RED: `../src/attachments/ocr-extractor` did not exist. |
| Same focused command | GREEN: PASS, 11 tests. |

### Implemented

- `OcrExtractor` reads only an injected private object store key. It decodes valid `text/plain` UTF-8 locally and sends PDF, JPEG, PNG, and WebP as `{ name, blob }` to an optional typed `AI.toMarkdown` dependency.
- Input is capped at the existing 25 MiB attachment maximum using declared object size and bounded stream reads. Extracted text is capped at 1 MiB before any future D1/search consumer can receive it.
- The adapter never logs source bytes or extracted text. It returns stable `OcrExtractionError` codes with explicit retryability for object absence/read failures, missing AI, unsupported MIME, conversion error/empty output, input/output bounds, deadline, timeout, cancellation, and invalid UTF-8.

### Verification

| Command | Result |
| --- | --- |
| `npm run test --workspace=@nexus/worker -- tests/ocr-extractor.test.ts` | PASS, 11 tests. |
| `npm run typecheck --workspace=@nexus/worker` | PASS. |

### B2 Boundary

No Queue ack/retry/dead-letter wiring, D1/search completion, Beta `Env.AI`, preview `[ai]`, bootstrap, or frontend changes are included. B2 must inject the authorized object key and binding, then own queue state transitions.

Commit: independent B1 commit containing this report section; SHA is recorded in the final handoff.

## Task 6C Fix B1 Review Fix: Bounded, Runtime-Safe Extraction

### TDD RED / GREEN

| Command | Result |
| --- | --- |
| `npm run test --workspace=@nexus/worker -- tests/ocr-extractor.test.ts` | RED: 7 expected failures. Local text over 1 MiB returned successfully; malformed AI payloads leaked `TypeError` or an over-broad format error; a late R2 body was not cancelled. |
| Same focused command | GREEN: PASS, 18 tests. |

### Review Fixes

- Local `text/plain` output now uses the same UTF-8 byte limit as AI output and returns terminal `OCR_OUTPUT_TOO_LARGE` above 1 MiB.
- AI responses are treated as runtime `unknown`. Unknown formats, missing/non-string Markdown data, missing/unsafe error data, null, and property-access failures map to retryable `OCR_AI_INVALID_RESPONSE`; documented safe provider error results remain terminal `OCR_AI_FORMAT_ERROR`.
- A per-extraction AbortController propagates a signal to the injected object-store and AI adapter, checks cancellation/deadline before and after each asynchronous boundary, cancels a body that resolves after timeout, and never parses a late AI result. Tests assert Blob name, MIME, and exact source bytes.

### Platform Limitation

Cloudflare's native `env.AI.toMarkdown` binding does not provide a hard-cancellation API. The B1 adapter passes an advisory signal to its injected AI adapter and ignores late results; B2 must bridge `env.AI.toMarkdown` without claiming that an already-issued Cloudflare AI request is forcibly cancelled.

### Verification

| Command | Result |
| --- | --- |
| `npm run test --workspace=@nexus/worker -- tests/ocr-extractor.test.ts` | PASS, 18 tests. |
| `npm run typecheck --workspace=@nexus/worker` | PASS. |

Commit: independent B1 review-fix commit containing this report section; SHA is recorded in the final handoff.
