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
