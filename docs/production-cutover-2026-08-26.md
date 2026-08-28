# Nexus Notes Production Cutover Report

Cutover date: 2026-08-28 (Asia/Shanghai)

## Deployment

- Production URL: <https://notes.msl88ljctengxun.xyz/>
- Worker: `modern-notes-saas`
- Beta Worker version: `4cff06b5-0807-410f-b4f8-7ca1cb639014`
- Source branch: `codex/personal-ai-provider-editor-focus-clean`
- Source commit deployed: `4b4c7a9` (system Workers AI plus personal provider fallback and Note Info Inspector changes); the same tree was merged to `main` by PR #12 as `2f2dca2`.
- GitHub PRs: <https://github.com/mingshilin/nexus-notes/pull/10> and <https://github.com/mingshilin/nexus-notes/pull/12> (both merged)
- Previous Worker version retained for rollback: `1c5198ff-7671-4e97-9c1a-1e9dc3c131cc`

## Backup And Data Migration

- External legacy D1 backup: `D:\mingSL\Documents\nexus-notes-production-backups\20260825-231936\notes-db-full.sql`
- Final external Beta D1 backup: `D:\mingSL\Documents\nexus-notes-production-backups\20260828-175458\production-beta-data.sql`
- Final Beta backup size: 62,013 bytes
- Final Beta backup SHA-256: `29699F963170EA257357702F4C427FAB218E2A08F36A9662D3C96B646D5068AF`
- Legacy D1 retained: `notes_db` / `dc2e2ccc-58dc-4b2e-9c46-401d56449bb0`
- Production Beta D1: `nexus-notes-public-beta-production` / `38fd5c16-44a2-43c6-ae5b-6ecb7ce6e7da`
- All 25 additive Beta migrations applied successfully.
- Legacy conversion report and generated import SQL remain in the external backup directory.

Post-import and pre-cutover evidence:

- users: 9, including one suspended recovery account
- workspaces: 10, including one isolated recovery workspace
- notes: 42 of 42 migrated
- databases: 3
- attachments: 1, with its R2 object verified in `nexus-notes-avatars`
- orphaned note foreign keys: 0
- `PRAGMA foreign_key_check`: no rows

The final backup was restored into the disposable external D1 runtime `D:\mingSL\Documents\nexus-notes-restore-runtime\20260828-175458`; all Beta migrations `0001` through `0024` applied and the restore `PRAGMA foreign_key_check` returned no rows. The source backup hash remained unchanged. The follow-up provider preference migration `0025_ai_provider_preference.sql` was then applied additively to production.

One historical note with no legacy user/workspace was preserved in `legacy-recovery-workspace`. One unresolved legacy backlink was not recreated because the target note did not exist. Five old public shares were imported as revoked because the old one-way token hash cannot be converted to the Beta HMAC token format; users must create new shares.

Legacy sessions, email codes, reset tokens and offline drafts were intentionally not imported. Existing users must sign in again. Password hashes were converted from the legacy `pbkdf2$...` label to the compatible Beta `pbkdf2_sha256$...` label without exposing passwords.

## Production Bindings

- R2: existing `nexus-notes-avatars` bucket, now bound as private `FILES`
- Queue: `nexus-notes-public-production-jobs`
- Durable Object: `PresenceRoom`
- Workers AI binding present; `AI_ENABLED=true`; system AI requires no user API key and personal provider selection is user-scoped
- Turnstile, Resend, rate-limit, user-secret encryption and Web Push VAPID values are Cloudflare Secrets and are not stored in Git.

## Verification

- GitHub Public Beta CI: PR #10 and PR #12 passed before merge
- `/api/v2/health`: `status=ok`, `version=personal-ai-editor-focus-release`, `ocr=ready`
- CSP, HSTS, X-Frame-Options, X-Content-Type-Options and Referrer-Policy present
- Initial HTML does not preload Markdown, OCR or AI chunks
- 390 px public Chrome shell: pass, no horizontal overflow or unnamed controls
- Production shell load: 32 requests, p95 948 ms
- Production 390 px public-shell: pass, `DOMContentLoaded=1783 ms`, no horizontal overflow, unnamed controls, or browser runtime diagnostics
- Production online readiness: pass; initial HTML excludes Markdown/OCR/AI preloads and Turnstile site key is present in the bundle
- Migrated real account: login 200, session 200, one workspace, eight active notes, logout 200

## Rollback

If a production gate regresses, restore Worker version `1c5198ff-7671-4e97-9c1a-1e9dc3c131cc` and its original bindings from the external release config, then verify the old health/read/write flow. Keep both legacy and Beta D1 databases, the existing R2 bucket and the external backup for at least 30 days. Do not delete the old D1 or Worker version as part of this release.
