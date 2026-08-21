# Task 8A Report: Collaboration Data Layer

Date: 2026-08-22
Branch: `codex/public-beta-rewrite`
Scope: contracts, domain policy, additive D1 migration, and D1 collaboration repository only.

## Outcome

Wave 8A is implemented. No HTTP routes, Durable Object, Web UI, legacy files, deployment files, remote resources, or secrets were changed.

## TDD Evidence

The interrupted implementation was first executed before new changes:

| RED command | Result |
| --- | --- |
| `rtk npm test --workspace @nexus/contracts -- collaboration-contracts.test.ts` | 5/5 passed in the partial baseline; new required contract cases then produced 4 failures/8 as expected |
| `rtk npm test --workspace @nexus/domain -- collaboration-policy.test.ts` | 3/3 passed in the partial baseline; new required policy cases then produced 4 failures/7 as expected |
| `rtk npm test --workspace @nexus/worker -- collaboration-migration.test.ts d1-collaboration-repository.test.ts` | 8/8 before additions, with the existing invitation replay failing on a raw D1 UNIQUE error; after new cases, 3 migration/repository tests passed and 10 failed as expected |
| notification CAS regression | Two concurrent reads with the same base revision both fulfilled before the single-statement guard; this was the expected RED |

GREEN evidence after implementation:

| Command | Result |
| --- | --- |
| `rtk npm test --workspace @nexus/contracts -- collaboration-contracts.test.ts` | 8/8 |
| `rtk npm test --workspace @nexus/domain -- collaboration-policy.test.ts` | 7/7 |
| `rtk npm test --workspace @nexus/worker -- collaboration-migration.test.ts` | 2/2 |
| `rtk npm test --workspace @nexus/worker -- d1-collaboration-repository.test.ts` | 11/11 |
| `rtk npm run typecheck --workspace @nexus/contracts` | pass |
| `rtk npm run typecheck --workspace @nexus/domain` | pass |
| `rtk npm run typecheck --workspace @nexus/worker` | pass |

## Requirement Mapping

- Contracts: strict Zod schemas and DTOs for invitations/previews, roles/members, comments, mentions, notifications and read/unread results, activity/audit entries and pages, public shares and password verification, revisions/statuses, safe cursors, and client/server Presence messages. Audit metadata rejects sensitive keys and nested values.
- Domain: owner/editor/viewer action matrix, ownership transfer and last-owner policy, mention membership/uniqueness, public-share field filtering, audit redaction, and terminal status transition policies.
- Schema: additive `0007_collaboration.sql` adds invitation consumption state, token-hash-only storage, idempotency and paging indexes, tenant/user fields, status/revision fields, quota-supporting indexes, and immutable audit update/delete triggers.
- Invitations/members: explicit token-hash contexts, email binding, atomic one-use consumption with unique `consumption_id`, expiry/revocation, pending reservation quota, role revisions, owner transfer, and SQL last-owner guards.
- Comments/mentions: workspace-scoped note/record authorization, same-target parent validation, current-member mention validation, atomic mention/notification creation, comment idempotency, and revisioned mutation guards.
- Notifications: user-owned cursor paging, unread DTO, single/bulk read, all-read, ownership isolation, idempotent mention notifications, and one-statement all-or-none revision CAS.
- Activity/audit: request-correlated append/list APIs, redacted safe metadata, public-share access/password-attempt metadata without secrets, and immutable audit storage.
- Public shares: random token creation with only hashes persisted, salted PBKDF2 password hashes, explicit token-hash access context, expiry/revoke handling, password verification in input body, and public-field-only DTOs.
- Isolation: cross-workspace tests cover comments, shares, member lists, activity, audit, and personal notification ownership.

## Full Verification

- `rtk npm test --workspace @nexus/contracts`: 6 files, 28/28 passed.
- `rtk npm test --workspace @nexus/domain`: 5 files, 19/19 passed.
- Worker full suite: 39 files, 225/225 passed, 0 failures. Because the repository's Miniflare helper starts an HTTP proxy per D1 fixture, the default multi-file Worker invocation produced `EADDRINUSE`/`fetch failed` lifecycle errors. The same suite was therefore run as 39 isolated sequential Vitest processes with `--pool=threads --maxWorkers=1 --minWorkers=1`; every file passed. The 8A migration and repository files were also rerun directly and passed.
- `rtk npm run beta:lint`: pass.
- `rtk npm run beta:build`: pass; TypeScript checks and Vite production build completed.
- `rtk npm run verify:deploy`: pass.
- `node scripts/verify-deploy-readiness.mjs --dist=apps/web/dist`: pass.
- Chunk/preload audit: root `dist` initial assets 5, forbidden initial chunks 0, maximum 278,944 bytes; `apps/web/dist` initial assets 1, forbidden initial chunks 0, maximum 338,687 bytes; both below the 512 KiB budget.
- `git diff --check`: pass.

## Files

Changed or added only within the Wave 8A boundary:

- `packages/contracts/src/collaboration.ts`, `packages/contracts/src/index.ts`, and collaboration contract tests.
- `packages/domain/src/collaboration-policy.ts`, `packages/domain/src/index.ts`, and collaboration policy tests.
- `apps/worker/migrations/0007_collaboration.sql`.
- `apps/worker/src/collaboration/d1-collaboration-repository.ts`, worker export, D1 test helper migration list, migration tests, and real-D1 repository tests.

## Self-Review and Concerns

- Raw invitation/share tokens are returned only by creation methods; only token hashes are persisted and public access receives an explicit hash context.
- Safe DTO conversion removes storage-only token/password/payload/metadata columns rather than leaving them as `undefined` properties.
- Audit metadata never contains body/content, password, token, cookie, code, authorization, or attachment bytes; public access metadata records only outcome and bounded classification fields.
- D1 scope predicates include workspace or user ownership, and mutation paths use batch/SQL guards for one-use consumption, quota, last-owner, idempotency, and revision conflicts.
- Rate limiting and public HTTP error isolation remain route-layer work outside Wave 8A, as required by the wave boundary; no route or Durable Object was added here.
- The only verification caveat is the existing Miniflare multi-file port collision; isolated per-file execution is green and gives complete Worker coverage without changing test infrastructure.

This report is included in the Wave 8A commit.

---

# Task 8B Report: Collaboration HTTP/Security Routes and PresenceRoom

Date: 2026-08-22
Branch: `codex/public-beta-rewrite`
Base: `07fb09f05ca7d2d64363e69cefeaef5c4833173b`

## RED Evidence

The committed Wave 8A baseline passed before adding Wave 8B tests: contracts collaboration 8/8, domain collaboration policy 7/7, and Worker route-registry/gateway/repository 22/22.

| RED command | Exact expected failure |
| --- | --- |
| `rtk npm test --workspace @nexus/worker -- collaboration-routes.test.ts` | 1 file failed; 5/5 tests failed at `expect(worker.registerCollaborationRoutes).toBeTypeOf("function")`; received `undefined` |
| `rtk npm test --workspace @nexus/worker -- presence-route.test.ts` | 1 file failed; 2/2 tests failed at `expect(worker.registerPresenceRoute).toBeTypeOf("function")`; received `undefined` |
| `rtk npm test --workspace @nexus/worker -- presence-room.test.ts` | 1 file failed; 2/2 tests failed at `expect(worker.PresenceRoom).toBeTypeOf("function")`; received `undefined` |

These are feature-missing failures from tests added before any Wave 8B production edit. GREEN evidence, requirement mapping, file inventory, and self-review follow after implementation.

## GREEN Evidence

| Command | Result |
| --- | --- |
| `rtk npm test --workspace @nexus/worker -- collaboration-routes.test.ts` | 5/5 passed with real local D1, PBKDF2, public error isolation, and default D1 IP/token limiting |
| `rtk npm test --workspace @nexus/worker -- presence-route.test.ts` | 2/2 passed with real D1 session/membership and bounded fake DO namespace |
| `rtk npm test --workspace @nexus/worker -- presence-room.test.ts` | 2/2 passed with bounded fake state/WebSockets; reconnect, message validation, expiry, disconnect, invalidation, and no state persistence covered |
| focused route/security/repository run | 18/18 route-registry, gateway, rate-limit, Presence, and collaboration repository tests passed; the real-D1 collaboration route/repository/Presence proxy run passed 18/18 |
| full Worker sequential run | 42/42 files and 234/234 tests passed after the final production edit; isolated one-file processes avoid the documented Miniflare multi-file port collision |
| `rtk npm test --workspace @nexus/contracts` | 6 files, 28/28 passed |
| `rtk npm test --workspace @nexus/domain` | 5 files, 19/19 passed |
| relevant typechecks | `@nexus/contracts`, `@nexus/domain`, and `@nexus/worker` passed; final Worker typecheck was rerun after token response validation tightened |
| `rtk npx vitest run --config vitest.worker.config.ts` | legacy Worker API route suite: 11 files, 62/62 passed |
| `rtk npm run beta:build` | passed after final production edit; Web/Worker/contracts/domain/testkit/UI builds completed and Vite emitted no `>500 kB` warning |
| `rtk npm run verify:deploy` | passed against root `dist` |
| `rtk node scripts/verify-deploy-readiness.mjs --dist=apps/web/dist` | passed against Beta Web dist |
| chunk/preload audit | root `dist`: initial 5, modulepreload 4, forbidden 0, max 278,944 bytes; `apps/web/dist`: initial 1, modulepreload 0, forbidden 0, max 338,687 bytes |

## Wave 8B Requirement Mapping

- Registered 25 typed collaboration routes under `/api/v2`: invitation create/list/preview/accept/revoke; member list/role/remove/ownership promotion; note/database-record comment create/list/update/delete; notification page/unread/single/bulk/all-read; activity/audit pages; authenticated share create/summary/revoke; and isolated public share GET/POST access.
- Request bodies use strict shared schemas where contracts exist and narrow strict route schemas for revision-only actions. Shared invitation/member/comment/notification/activity/audit/share/public-content schemas validate repository responses before the standard route registry envelope is emitted. Creation tokens are also checked by the shared token schemas.
- Workspace routes reuse registry session/workspace policies, minimum-role checks, `D1SessionAuthenticator`, `D1WorkspaceAuthorizer`, and repository domain policy. Every collaboration mutation that accepts a request correlation value receives the registry `requestId`.
- Invitation replay, expiry/revocation, quota reservation, ownership/last-owner policy, mention membership, idempotent notification creation, notification ownership/CAS, and audit redaction continue through the committed Wave 8A repository and are covered by its full real-D1 suite plus route integration tests.
- Public share tokens exist only in path parameters or one-time authenticated creation responses; passwords are accepted only by the POST JSON schema. GET never reads query credentials. Public route failures map missing, protected, wrong-password, revoked, expired, or target-unavailable repository outcomes to the same safe `PUBLIC_SHARE_UNAVAILABLE` 404 envelope.
- Password attempts consume both IP and token D1 buckets through `D1RateLimiter`; the token enters only an HMAC-hashed bucket key. PBKDF2 verification remains in `WebCryptoPasswordHasher`, and audit outcomes contain bounded classifications without token/password/content data.
- `PresenceRoom` is exported as the preview binding class. It accepts only shared bounded presence/typing messages and bounded server invalidation messages, stores participant state only in ephemeral WebSocket attachments, and uses storage only for the expiry alarm. It rejects authoritative note/database/comment payloads.
- The authenticated `/api/v2/presence` proxy verifies the current workspace membership through the standard registry path, derives display name server-side, strips cookies/client headers, signs the safe workspace/user/display-name identity, and forwards to the workspace-named room. Missing/throwing DO bindings return retryable `PRESENCE_UNAVAILABLE` without affecting D1 note routes.
- The existing preview example already declared the optional `PRESENCE` binding and `PresenceRoom` SQLite-class migration, so no preview or production configuration edit was needed. No remote, deployment, secret, Web UI, legacy product, or release-1.1.0 action occurred.

## Wave 8B Files

- Worker routes/runtime: `apps/worker/src/routes/collaboration.ts`, `apps/worker/src/routes/presence.ts`, `apps/worker/src/presence/presence-room.ts`, `apps/worker/src/bootstrap.ts`, `apps/worker/src/routes/health.ts`, and `apps/worker/src/index.ts`.
- Tests: `apps/worker/tests/collaboration-routes.test.ts`, `apps/worker/tests/presence-route.test.ts`, and `apps/worker/tests/presence-room.test.ts`.
- Evidence: `.superpowers/sdd/task-8-report.md`.

## Wave 8B Self-Review And Concerns

- Public share routes do not reuse workspace authorization errors or return repository details. The only intentionally distinguishable public outcome is `429 RATE_LIMITED` after bounded password attempts.
- Presence is optional and fail-isolated. It provides advisory participant/typing/invalidation signals only; D1 revisions and editing routes remain authoritative.
- No participant map or content is written with Durable Object storage APIs. `setAlarm` stores only Cloudflare scheduling metadata needed for expiry cleanup; WebSocket hibernation attachments contain bounded identity/presence fields only.
- Ownership promotion can create a second owner; demotion/removal remains a separate revisioned owner-only operation protected by the committed last-owner database guard. This preserves recoverability and avoids a non-atomic two-member route mutation.
- Residual timing differences may exist between an unknown public token and PBKDF2 verification for a valid protected share, although status/body/header semantics are indistinguishable and attempts are rate-limited. Eliminating that side channel would require a repository-level dummy-hash policy beyond the committed Wave 8A interface.

---

# Task 8 Backend Closure: Request IDs, Mutation Audit, Invalidation

Date: 2026-08-22
Branch: `codex/public-beta-rewrite`
Base at start: `7252d62`

## RED Evidence

Command run before this closure production edit:

```text
npm test --workspace @nexus/worker -- tests/mutation-audit.test.ts tests/note-routes.test.ts tests/database-routes.test.ts

Test Files  1 failed | 2 passed (3)
Tests  1 failed | 11 passed (12)

FAIL tests/mutation-audit.test.ts > Beta mutation audit and Presence invalidation > couples database mutation logs to request IDs and dispatches post-commit invalidation
AssertionError: expected [ 'req-db-create', …(2) ] to deeply equal [ 'req-db-create', …(4) ]
Expected request IDs: req-db-create, req-db-property, req-db-record, req-db-record-update, req-db-update
Received request IDs: req-db-create, req-db-property, req-db-update
```

The current unstaged route fixes already made `note-routes.test.ts` and `database-routes.test.ts` green in that RED run. The remaining failure traced to `D1DatabaseRecordRepository.createRecord` and `bulkEditRecords`, which did not use the existing optional request-correlated audit hook or post-commit Presence notifier.

## GREEN Evidence

After the minimal record mutation closure:

```text
npm test --workspace @nexus/worker -- tests/mutation-audit.test.ts tests/note-routes.test.ts tests/database-routes.test.ts

Test Files  3 passed (3)
Tests  12 passed (12)
```

`createRecord` now appends redacted activity/audit statements inside its existing D1 batch and only notifies Presence after that batch commits. `bulkEditRecords` now appends one guarded redacted activity/audit pair per updated record in its existing D1 batch and dispatches invalidations only after the batch commits. Both use the existing optional `requestId` and optional notifier defaults, preserving old callers. Audit errors roll back source writes; revision/reference guard failures roll back and emit no success audit; Presence failures remain caught after commit.

## Closure Verification

| Command | Result |
| --- | --- |
| `npm test --workspace @nexus/worker -- tests/mutation-audit.test.ts tests/note-routes.test.ts tests/database-routes.test.ts` | 3 files, 12/12 passed |
| `npm test --workspace @nexus/worker -- tests/d1-collaboration-repository.test.ts --pool=threads --maxWorkers=1 --minWorkers=1` | 1 file, 18/18 passed; isolated process completed in 37.23s |
| `npm test --workspace @nexus/worker -- tests/presence-room.test.ts tests/presence-route.test.ts tests/collaboration-routes.test.ts` | 3 files, 10/10 passed |
| `npm run typecheck --workspace @nexus/worker` | passed |
| `npx vitest run --config vitest.worker.config.ts` | legacy Worker route suite: 11 files, 62/62 passed |
| `npm run beta:build` | passed: Web production build plus Worker/contracts/domain/testkit/UI typechecks; Web initial JS 338.69 kB and no Vite large-chunk warning |
| `npm run verify:deploy` | passed for root `dist`: initial entry plus vendor assets all within readiness/preload/chunk rules |
| `node scripts/verify-deploy-readiness.mjs --dist=apps/web/dist` | passed for Beta Web dist: `/assets/index-BtHqVHQI.js`; no forbidden initial Markdown/OCR chunk or over-budget asset |
| `git diff --check` | passed before report append; rerun after append before commit |

No collaboration repository or Presence design was changed in this closure beyond wiring the existing optional notifier into the two already-RED database record mutation paths.

---

# Task 8 Backend Fix Wave 4 Report

Date: 2026-08-22
Branch: `codex/public-beta-rewrite`
Scope: immutable collaboration migration history, additive closure migration, durable Presence revocation checks, and complete Beta database mutation audit/invalidation integration.

## TDD Evidence

RED tests were added before the corresponding production edits:

| RED block | Evidence | GREEN result |
| --- | --- | --- |
| Migration upgrade | 4/5 migration tests failed: committed `0007` hash mismatch, missing `0008` fixture path, and unavailable upgrade path | `collaboration-migration.test.ts`: 5/5 |
| Presence revocation heartbeat | New failed-dispatch test left a stale socket open after heartbeat | `presence-room.test.ts`: 4/4 |
| Database mutation audit/invalidation | New coverage initially found only the existing 7 activity entries instead of all listed mutations | `mutation-audit.test.ts`: 6/6 |
| Same-millisecond stale marker | Two competing database updates produced two audits under revision+timestamp guards | One winner and one activity/audit pair |

An initial full Worker run exposed four compatibility regressions after the first implementation: raw permission guard errors, missing database-delete postcondition abort, and two bounded prepare-count increases. Those root causes were fixed, and the complete Worker suite was rerun successfully.

## Migration Result

- `apps/worker/migrations/0007_collaboration.sql` is byte-for-byte identical to committed Wave 8A (`07fb09f`); SHA-256 is `01b8036f40a4c8af1e8fb4aa55b19e96733d99e391bd5bae295d6c20f4027991`.
- `apps/worker/migrations/0008_task8_backend_closure.sql` is additive and contains activity backfill, operation-result/guard schema, comment fingerprint and actor-scoped idempotency index, membership epoch active/revocation state, and membership triggers.
- Local D1 fixtures now apply `0008`; upgrade tests start from a populated `0007` database and verify data preservation, backfill, epoch state, marker tables, and same-key comments from different actors.

## Mutation and Presence Result

- Database core, records, views, templates, permissions, CSV import, and database comments now couple source writes and redacted activity/audit rows in one D1 batch, with post-commit Presence invalidation. Record delete and database delete are included.
- Database core revision audit guards use operation-local markers and an explicit postcondition abort; no timestamp-only audit winner inference remains in those paths.
- Presence heartbeats and reconnects read D1 `workspace_membership_epochs` when the DB binding is available. Inactive or stale epochs close sockets; DO storage remains only a fallback for environments without a DB binding. D1 remains authoritative and Presence failures remain isolated from committed edits.
- Comment idempotency persists an actor-scoped fingerprint while retaining deterministic fallback calculation for legacy rows.

## Full Verification

| Command | Result |
| --- | --- |
| Sequential Beta Worker tests | 43 files, 252/252 passed; each file ran in an isolated single-worker Vitest process |
| `npm test --workspace @nexus/contracts` | 6 files, 28/28 passed |
| `npm test --workspace @nexus/domain` | 5 files, 19/19 passed |
| `npx vitest run --config vitest.worker.config.ts --pool=threads --maxWorkers=1 --minWorkers=1` | Legacy Worker route suite: 11 files, 62/62 passed |
| contracts/domain/worker typechecks | All passed; `npm run beta:lint` also passed across all workspaces |
| `npm run beta:build` | Passed; Web initial JS 338,687 bytes and no Vite large-chunk warning |
| `npm run verify:deploy` | Passed for root `dist`; entry plus four modulepreload vendor assets passed readiness |
| `node scripts/verify-deploy-readiness.mjs --dist=apps/web/dist` | Passed for Beta Web dist; entry `/assets/index-BtHqVHQI.js` |
| Initial preload/chunk audit | Root `dist`: 5 initial assets, 4 modulepreloads, 0 forbidden, max 278,944 bytes. Beta Web: 1 initial asset, 0 modulepreloads, 0 forbidden, max 338,687 bytes. |
| `git diff --check` | Passed after all code/report edits |

## Task 8 Presence Browser Compatibility Fix

Date: 2026-08-22
Scope: Worker Presence route query fallback, Worker route tests, and this report only.

### TDD Evidence

- RED: `rtk npm test --workspace @nexus/worker -- tests/presence-route.test.ts -t "native-WebSocket-style query-only workspace selection"` failed as expected with `400` (`WORKSPACE_REQUIRED`) before implementation.
- GREEN: `rtk npm test --workspace @nexus/worker -- tests/presence-route.test.ts` passed `4/4`, including native query-only selection, header compatibility, bounded/ambiguous/missing/cross-workspace/non-WebSocket rejection, signed identity forwarding, and DO failure isolation.

### Verification

| Command | Result |
| --- | --- |
| `rtk npm test --workspace @nexus/worker -- tests/presence-route.test.ts tests/presence-room.test.ts tests/collaboration-routes.test.ts --pool=threads --maxWorkers=1 --minWorkers=1` | 3 files, 13/13 passed |
| `rtk npm run typecheck --workspace @nexus/worker` | passed |
| `rtk npx vitest run --config vitest.worker.config.ts --pool=threads --maxWorkers=1 --minWorkers=1` | 11 files, 62/62 passed |
| `rtk npm run beta:build` | passed; Web initial JS 338,687 bytes, no Vite large-chunk warning |
| `rtk npm run verify:deploy` | passed for root `dist` |
| `rtk node scripts/verify-deploy-readiness.mjs --dist=apps/web/dist` | passed for Beta Web dist |
| initial preload audit | root: 5 assets/0 forbidden; Beta Web: 1 asset/0 forbidden |
| `git diff --check` | passed |

### Result And Concerns

- `/api/v2/presence` retains cookie/session authentication, selects header first and query only when the header is absent, then calls `D1WorkspaceAuthorizer` before forwarding. Query values are bounded, character-validated, and duplicate values are rejected; identity remains server-derived and signed.
- PresenceRoom, heartbeat/epoch behavior, DO failure isolation, and no-content-storage behavior are unchanged. The three pre-existing untracked Web RED files were preserved and are outside this commit.

## Scope Audit

Only Worker migrations, Worker source, Worker tests, and this report are changed in this wave. No Web UI, legacy source, deployment, remote resource, or secret files were modified. Explicit staging and final status checks were performed before commit.

---

# Task 8C Web Wave 1 Client-only Report

Date: 2026-08-22
Branch: `codex/public-beta-rewrite`
Base: `6e64ad7`
Scope: typed `CollaborationClient` and its Beta Web data export only. Navigation and notification UI plumbing is deferred to the Wave 2 handoff.

## TDD RED/GREEN Evidence

The existing untracked RED test was run before the client production edit:

```text
rtk npm run test --workspace @nexus/web -- tests/collaboration-client.test.ts
RED: 1 file failed, 2/2 tests failed. Both failures were feature-missing failures at the absent CollaborationClient export/constructor.
```

After the minimal client implementation:

```text
rtk npm run test --workspace @nexus/web -- tests/collaboration-client.test.ts
GREEN: 1 file passed, 2/2 tests passed.
```

The three untracked Wave 2 RED UI tests remain unmodified and unstaged: `collaboration-client.test.ts`, `collaboration-center.test.tsx`, and `collaboration-public-mobile.test.tsx`.

## Exact Route Mapping

The client maps every approved collaboration route, with typed contract parsing at the response boundary:

- `createInvitation` -> `POST /api/v2/invitations`
- `listInvitations` -> `GET /api/v2/invitations`
- `previewInvitation` -> `POST /api/v2/invitations/preview`
- `acceptInvitation` -> `POST /api/v2/invitations/accept`
- `revokeInvitation` -> `DELETE /api/v2/invitations/:invitationId`
- `listMembers` -> `GET /api/v2/members`
- `updateMemberRole` -> `PATCH /api/v2/members/:userId`
- `removeMember` -> `DELETE /api/v2/members/:userId`
- `transferOwnership` -> `POST /api/v2/members/:userId/ownership`
- `createComment` -> `POST /api/v2/comments`
- `listComments` -> `GET /api/v2/comments/:targetType/:targetId`
- `updateComment` -> `PATCH /api/v2/comments/:commentId`
- `deleteComment` -> `DELETE /api/v2/comments/:commentId`
- `listNotifications` -> `GET /api/v2/notifications?cursor=&limit=`
- `getUnreadCount` -> `GET /api/v2/notifications/unread`
- `readNotification` -> `POST /api/v2/notifications/:notificationId/read`
- `readNotifications` -> `POST /api/v2/notifications/read`
- `readAllNotifications` -> `POST /api/v2/notifications/read-all`
- `listActivity` -> `GET /api/v2/activity?cursor=&limit=`
- `listAudit` -> `GET /api/v2/audit?cursor=&limit=`
- `createShare` -> `POST /api/v2/shares`
- `listShares` -> `GET /api/v2/shares?entity_type=&entity_id=`
- `revokeShare` -> `DELETE /api/v2/shares/:shareId`
- `getPublicShare` -> `GET /api/v2/public/shares/:token`
- `accessPublicShare` -> `POST /api/v2/public/shares/:token`

Presence uses the separately registered `GET /api/v2/presence` WebSocket route. The browser URL is converted to `ws:`/`wss:` and carries only `workspace_id` as a query parameter. Native WebSocket cookies provide the session; no custom WebSocket headers are attempted. Construction, send, error, close, and malformed-message failures resolve to the advisory `unavailable` state without blocking editing.

Workspace routes send `x-workspace-id`; public invitation/share routes intentionally send `headers: undefined`. Query requests use bounded retry and workspace-scoped dedupe keys with `AbortSignal`; mutating requests use an idempotent command policy and generated or input idempotency keys. Public password access is `POST` JSON with `{ password }`; it never puts the password in a URL, header, storage, or log.

## Verification

| Command | Result |
| --- | --- |
| `rtk npm run typecheck --workspace @nexus/web` | passed |
| focused collaboration client test | 1 file, 2/2 passed |
| existing Beta Web suite excluding the three untracked collaboration RED files | 22 files, 104/104 passed |
| `rtk npm run build --workspace @nexus/web` | passed; Vite emitted no large-chunk warning; entry 338,687 bytes and lazy `DatabaseWorkbench` chunk 46.82 kB |
| `rtk npm run beta:build` | passed; all workspace builds/typechecks completed |
| `rtk npm run verify:deploy` | passed for root `dist` |
| `rtk node scripts/verify-deploy-readiness.mjs --dist=apps/web/dist` | passed for Beta Web `dist` |
| `rtk git diff --check` | passed |
| preload/chunk audit | root: 5 initial assets, 4 modulepreloads, 0 forbidden initial chunks, max 278,944 bytes; Beta Web: 1 initial asset, 0 modulepreloads, 0 forbidden initial chunks, max 338,687 bytes; `DatabaseWorkbench` is not initial |

## Files And Handoff

Only these files are in the client-only commit: `apps/web/src/data/collaboration-client.ts`, `apps/web/src/data/index.ts`, and this report. Navigation route entry, unread button/panel, deep-link read callback, and full `CollaborationCenter` remain a concrete Wave 2 handoff; no UI files were changed in this wave.

The only compatibility note is the RED test stub's broad notification matcher, which returns the bulk-read shape for `/notifications/read-all`; the client validates the real `{ count, read_at }` backend response first and accepts the stub shape only as a bounded fallback.

---

# Task 8C Web Wave 2 Collaboration UI Report

Date: 2026-08-22
Branch: `codex/public-beta-rewrite`
Base: `5abab63`
Scope: Beta Web collaboration center, App navigation/notifications, public-share UI, responsive modal behavior, the three handed-off collaboration tests, and this report only.

## TDD RED/GREEN Evidence

The two exact Wave 2 UI files were run before production UI existed:

```text
npm test --workspace @nexus/web -- tests/collaboration-center.test.tsx tests/collaboration-public-mobile.test.tsx
RED: 2 files failed, 6/6 tests failed.
Cause: CollaborationCenter and PublicSharePage were undefined/not exported. All failures were feature-missing component failures.
```

After the implementation and final responsive/App composition edits:

```text
npm test --workspace @nexus/web -- tests/collaboration-center.test.tsx tests/collaboration-public-mobile.test.tsx tests/collaboration-client.test.ts
GREEN: 3 files passed, 8/8 tests passed, with no stderr.
npm run typecheck --workspace @nexus/web
GREEN: passed.
```

The three handed-off tests were preserved without assertion weakening. `collaboration-client.test.ts` and the committed `CollaborationClient` source were not edited in Wave 2.

## Requirement Mapping

- `CollaborationCenter` replaces the collaboration placeholder and is a third App domain. Desktop and mobile navigation open it without changing the existing notes/database request state machines. The no-context desktop layout expands the canvas instead of reserving an empty list column.
- App loads the workspace unread count, exposes a persistent labelled notification button, lazily loads the notification list, handles loading/empty/error states, and marks only the selected deep-link notification with that notification's revision before routing to notes or databases.
- Members, invitations, role updates, removals, ownership transfer, invitation revoke, and one-time invitation-link display use permission-aware controls. Viewer invitation creation is absent; unavailable mutations remain disabled.
- Comments load by note/database-record target, provide workspace-member mention choices, send Presence typing state, and support create/update/delete with revision/idempotency inputs and conflict/rate/network feedback.
- Public shares support entity selection, optional password and expiry, one-time link display, list, and revisioned revoke. Activity/audit metadata hides sensitive keys and refuses to stringify unknown structured values. Public `/share/:token` access performs unauthenticated GET followed by password POST, clears password state, and does not use storage, query credentials, logs, or raw-token rendering.
- Presence uses the committed query-based native WebSocket client, renders connection/participants/typing, and displays non-blocking unavailable state. At 390px the modal reports the visual-viewport keyboard inset, traps focus, returns focus, makes canvas/bottom navigation inert, and leaves exactly one dialog scroll owner.

## Gate Evidence

| Command | Result |
| --- | --- |
| focused collaboration suite | passed: 3 files, 8/8 tests |
| `npm run typecheck --workspace @nexus/web` | passed |
| `npm test --workspace @nexus/web -- --reporter=dot` | **failed**: 22/25 files passed; 95/112 tests passed; 17 failed and 15 uncaught errors |
| `npm run build --workspace @nexus/web` | passed; entry 371,656 bytes, lazy `DatabaseWorkbench` 46.81 kB; no `>500 kB` warning |
| `npm run beta:build` | passed across all workspaces; same Web chunk result |
| `npm run verify:deploy` | passed against final root `dist` |
| `node scripts/verify-deploy-readiness.mjs --dist=apps/web/dist` | passed against Beta Web `dist` |
| `npm test` | passed: legacy frontend 29 files/131 tests; legacy Worker routes 11 files/62 tests |
| `npm run lint` | passed |
| `npm run build` | passed; no Vite large-chunk warning |
| `npm audit --omit=dev` | passed: 0 vulnerabilities |
| `git diff --check` | passed before this report append |
| root initial preload/chunk audit | 5 initial assets, 4 modulepreloads, 0 forbidden Markdown/OCR/PDF-worker assets, max 278,944 bytes |
| Beta initial preload/chunk audit | 1 initial asset, 0 modulepreloads, 0 forbidden Markdown/OCR/PDF-worker assets, max 371,656 bytes |

## Full-Web Blocker And Self-Review

The full Web gate is not green. Existing App/live tests use historical session doubles that omit `session.workspaces`; the new role lookup calls `session.workspaces.find(...)` at `apps/web/src/app/App.tsx:598`. That exception cascades through `database-workspace-live`, `knowledge-recovery-live`, and `app-auth-bootstrap` and accounts for the 15 uncaught errors and most failed tests. Two non-crashing App assertions also observe three initial API calls instead of their historical attachment-plus-diagnostics count of two because unread notifications are now queried during App bootstrap. Focused collaboration behavior, production typechecking/builds, legacy suites, readiness, audit, and chunk gates are independently green.

The user explicitly requested no further source changes during gate execution, so these compatibility defects were recorded rather than patched. The narrow closure is to tolerate a missing test-double membership list while retaining `viewer` fallback and avoid bootstrapping collaboration-only queries for legacy session doubles; it requires a source edit and a fresh full verification run. Because the mandatory full Web gate remains red, no staging or Wave 2 commit was performed in this run.

## Wave 2 Files

- Web source: `apps/web/src/app/App.tsx`, `apps/web/src/index.ts`, `apps/web/src/layout/AdaptiveWorkbench.tsx`, `apps/web/src/styles.css`, and `apps/web/src/collaboration/*`.
- Tests: `apps/web/tests/collaboration-center.test.tsx`, `apps/web/tests/collaboration-public-mobile.test.tsx`, and the preserved `apps/web/tests/collaboration-client.test.ts`.
- Evidence: `.superpowers/sdd/task-8-report.md`.

No Worker, domain, migration, legacy product, deployment, remote, secret, or committed Wave 1 client file was modified.

## Compatibility Closure

The authorized source-only compatibility pass preserved every existing test and assertion.

```text
npm test --workspace @nexus/web -- tests/app-auth-bootstrap.test.tsx tests/knowledge-recovery-live.test.tsx tests/database-workspace-live.test.tsx --reporter=dot
RED: 3 files failed; 17 failed / 5 passed tests; 15 uncaught errors.
Primary cause: historical session doubles omitted workspaces and App called session.workspaces.find.
Secondary cause after safe membership normalization: eager unread bootstrap changed two legacy recovery request-count assertions from 2 to 3.
```

App now treats the notes/database workspace route ID separately from verified collaboration membership. Missing `workspaces` becomes an empty membership list, role falls back to `viewer`, and collaboration/unread bootstrapping requires a matching real membership. Complete Beta sessions still derive role and collaboration capability from their workspace data. Unread count is scheduled through browser idle work with a bounded fallback and is cancelled on workspace change/unmount, preserving the legacy first-render request sequence while still populating the real notification button.

```text
npm test --workspace @nexus/web -- tests/app-auth-bootstrap.test.tsx tests/knowledge-recovery-live.test.tsx tests/database-workspace-live.test.tsx tests/collaboration-center.test.tsx tests/collaboration-public-mobile.test.tsx tests/collaboration-client.test.ts --reporter=dot
GREEN: 6 files, 30/30 tests passed.

npm test --workspace @nexus/web
GREEN: 25 files, 112/112 tests passed.
```

### Final Gate Evidence

| Command | Final result |
| --- | --- |
| `npm test --workspace @nexus/web` | 25 files, 112/112 passed |
| `npm run typecheck --workspace @nexus/web` | passed |
| `npm run build --workspace @nexus/web` | passed; entry 371,997 bytes, lazy database chunk 46.81 kB, no `>500 kB` warning |
| `npm run beta:build` | passed across every workspace |
| `npm test` | passed: legacy frontend 29 files/131 tests and legacy Worker routes 11 files/62 tests |
| `npm run lint` | passed |
| `npm run build` | passed; no Vite large-chunk warning |
| `npm audit --omit=dev` | 0 vulnerabilities |
| root and Beta deploy readiness | both passed against final artifacts |
| final initial preload/chunk audit | root: 5 initial/4 modulepreload/0 forbidden/max 278,944 bytes; Beta: 1/0/0/max 371,997 bytes |
| `git diff --check` | passed before compatibility report append; rerun before staging |

Compatibility residual risk is limited to browsers that delay idle work: the 500 ms idle timeout guarantees the unread query is eventually scheduled while the component remains mounted. Presence and all editing flows remain independent of unread failure. No raw credentials or tokens are persisted, and no Worker/domain/migration/legacy/deployment/remote/secret file changed.

# Task 8C Web Wave 3 Closure Report

Date: 2026-08-22
Base: `05016be`
Scope: Beta Web source/tests and this report only. No Worker, domain, migration, legacy product, deployment, remote, or secret change.

## TDD Evidence

The Wave 3 tests were added before production implementation and run together:

```text
npm test --workspace @nexus/web -- tests/collaboration-client.test.ts tests/collaboration-center.test.tsx tests/collaboration-public-mobile.test.tsx tests/invite-redemption.test.tsx --reporter=dot
RED: 4/4 files failed; 11 failed / 3 passed.
Expected causes: no invite route/page, synthetic delete DTO parsing, no notification paging/bulk/read-all or modal semantics, unauthorized role requests, opaque target inputs, missing target reload dependencies, and an unwired editor bell.
```

After implementation, with the RED assertions retained:

```text
GREEN: 4 files, 14/14 tests passed.
Full Web: 26 files, 118/118 tests passed.
```

## Requirement Mapping

1. `/invite/:token` is parsed into in-memory App route state. Preview and accept send only `{ token }` to the public POST routes, the token is never written to browser storage/history state, AuthGate preserves the route through login, and a refreshed session identifies and switches to the accepted workspace after clearing the URL.
2. `removeMember` parses the committed `{ user_id }` DTO and `deleteComment` parses `{ id }`; tests use the real repository/route shapes and reject mismatched identifiers.
3. NotificationCenter retains `next_cursor`, appends deduplicated pages, supports single, selected bulk, and all-read actions, updates unread state, and parses note/record/comment deep links into exact App callbacks.
4. Invitation fetch/controls, audit, role/ownership/removal controls are owner-only. Viewer comments/activity remain readable without write/share/audit requests; editors retain backend-supported comments/shares/activity; owners can moderate any comment.
5. App passes selected note, loaded database-record, selected comment, and shareable note/view contexts into CollaborationCenter. Comments/shares use labelled selectors rather than free-form opaque IDs.
6. Mobile notifications reuse the one-time dialog's portal, visualViewport keyboard inset, focus trap/return, Workbench inert state, body lock, and single dialog scroll owner; mobile CSS presents the same modal as a bottom sheet.
7. Comment reload depends on the selected target, deep target state survives domain changes, and the duplicate editor notification bell now opens the shared notification center.

## Final Gate Evidence

| Command | Result |
| --- | --- |
| focused Wave 3 suite | 4 files, 14/14 passed |
| `npm test --workspace @nexus/web -- --reporter=dot` | 26 files, 118/118 passed |
| `npm run typecheck --workspace @nexus/web` | passed |
| `npm run build --workspace @nexus/web` | passed; entry 379,919 bytes, lazy `DatabaseWorkbench` 46.81 kB, no large-chunk warning |
| `npm run beta:build` | passed across all workspaces |
| `npm test` | legacy frontend 29 files/131 tests and legacy Worker routes 11 files/62 tests passed |
| `npm run lint` | passed |
| `npm run build` | passed; no large-chunk warning |
| `npm audit --omit=dev` | 0 vulnerabilities |
| root and Beta deploy readiness | both passed against final artifacts |
| final preload/chunk audit | root 5 initial/4 modulepreload/0 forbidden/max 278,944 bytes; Beta 1/0/0/max 379,919 bytes |
| `git diff --check` | passed before report append; rerun before staging |

## Self-Review

The scoped diff contains only Beta Web source/tests plus this report. Raw invitation tokens occur only in the URL-derived in-memory route value and public request bodies; no localStorage/sessionStorage/history-state write contains them. Notification modal state leaves one scroll owner and restores its opener. Non-owner code paths do not call owner-only invitation/audit routes, and viewer code paths do not call editor-only share mutations or listings.

The committed database-record notification link contains `recordId` and optional `commentId`, but no `databaseId`. App therefore preserves the exact record/comment target, selects a matching currently loaded database when available, and exposes a labelled notification target when that record is outside the loaded page. Resolving an unloaded record to its database would require a backend contract change and is outside this Web-only closure.

# Task 8C Web Wave 4 Closure Report

Date: 2026-08-22
Base: `7055b99`
Scope: Beta Web notification destination source/tests and this report only. No Worker, domain, migration, legacy product, deployment, remote, secret, or backend contract change.

## TDD Evidence

The App-level destination, global read-all, and shared bell-label tests were added before production implementation. The focused test was run against the Wave 3 source:

```text
npm test --workspace @nexus/web -- tests/collaboration-center.test.tsx --reporter=dot
RED: 1 file failed; 3 failed / 7 passed.
Expected causes: the unloaded record remained on Current database with no comment destination, read-all was disabled while global unread remained, and only one desktop bell exposed the unread-count label.
```

After implementation, with the RED destination assertions retained:

```text
Focused collaboration/invite/mobile/App: 6 files, 32/32 passed.
Full Web: 26 files, 121/121 passed.
```

## Requirement Mapping

1. The committed notification shape remains `{ target_type, target_id, comment_id }` with `/databases/records/:recordId?comment=:commentId`. The parser also accepts an optional payload `database_id` or `/databases/:databaseId/records/:recordId` path without changing the backend contract.
2. App reuses `DatabaseClient.listDatabases` and `getRecord`; an unloaded target is resolved by a finite sequential scan of permitted databases. Only the exact `RECORD_NOT_FOUND` 404 continues to the next database, while cancellation and every other error remain terminal.
3. Successful navigation stores the selected database, exact record, and comment, retains an off-page resolved record for later database loading, opens CollaborationCenter comments, labels the target as `database / record`, and marks the requested comment as current. Note notifications retain note selection and also open their exact comment context.
4. The App-level test forces `db-current` to return `RECORD_NOT_FOUND`, resolves `record-target` from `db-target`, and asserts the rendered target selector and current `comment-target`; it does not stop at callback assertions.
5. Read-all remains enabled when global unread is positive, a next cursor exists, or a loaded item is unread. App supplies the required global count to NotificationCenter.
6. Rail, mobile, and editor controls use the same unread-count label helper and the same notification toggle behavior. Existing focus return, inert background, visualViewport handling, and one-scroll-owner modal behavior are unchanged.

## Final Gate Evidence

| Command | Result |
| --- | --- |
| focused collaboration/invite/mobile/App suite | 6 files, 32/32 passed |
| `npm test --workspace @nexus/web -- --reporter=dot` | 26 files, 121/121 passed |
| `npm run typecheck --workspace @nexus/web` | passed |
| `npm run build --workspace @nexus/web` | passed; entry 381,761 bytes, lazy `DatabaseWorkbench` 46.81 kB, no large-chunk warning |
| `npm run beta:build` | passed across all workspaces |
| `npm test` | legacy frontend 29 files/131 tests and legacy Worker routes 11 files/62 tests passed |
| `npm run lint` | passed |
| `npm run build` | passed; no large-chunk warning |
| `npm audit --omit=dev` | 0 vulnerabilities |
| root and Beta deploy readiness | both passed against final artifacts |
| final preload/chunk audit | root: 5 initial assets, 4 modulepreloads, 0 forbidden, max 278,944 bytes; Beta: 1 initial asset, 0 modulepreloads, 0 forbidden, max 381,761 bytes |
| `git diff --check` | passed before report append; rerun before staging |

## Self-Review

The lookup is deliberately sequential to avoid request fan-out and is bounded by the permitted database list returned by the existing typed route. A known `databaseId` narrows the scan to one candidate; a loaded record avoids the scan entirely. Each navigation aborts the previous lookup and unmount aborts the active request, preventing stale notification selection.

The scoped source/test diff contains only `apps/web/src/app/App.tsx`, `apps/web/src/collaboration/CollaborationCenter.tsx`, and `apps/web/tests/collaboration-center.test.tsx`; this report is the only non-Web artifact. No raw tokens, credentials, storage behavior, backend, legacy, deployment, or remote state changed.
