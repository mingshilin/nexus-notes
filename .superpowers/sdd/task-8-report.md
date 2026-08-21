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
