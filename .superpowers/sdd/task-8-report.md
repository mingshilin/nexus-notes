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
