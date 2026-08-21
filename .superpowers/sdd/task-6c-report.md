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
