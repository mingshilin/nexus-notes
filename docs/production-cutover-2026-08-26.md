# Nexus Notes Production Cutover Report

Cutover date: 2026-08-26 (Asia/Shanghai)

## Deployment

- Production URL: <https://notes.msl88ljctengxun.xyz/>
- Worker: `modern-notes-saas`
- Beta Worker version: `03d67b5b-0e32-4210-94df-6a34097a8ad7`
- Source branch: `codex/public-beta-rewrite`
- Source commit deployed: `2cdf723` plus data migration commit `1c88436`; later commits only harden test isolation/mocks.
- GitHub PR: <https://github.com/mingshilin/nexus-notes/pull/8>
- Previous Worker version retained for rollback: `3437236b-ad54-4a13-a6c0-a0f7968bb15e`

## Backup And Data Migration

- External legacy D1 backup: `D:\mingSL\Documents\nexus-notes-production-backups\20260825-231936\notes-db-full.sql`
- Backup size: 109,796 bytes
- SHA-256: `369415C99FBE5CAF9587CE374B04F81067231884E860DBDDAE411DB41E0C728D`
- Legacy D1 retained: `notes_db` / `dc2e2ccc-58dc-4b2e-9c46-401d56449bb0`
- Production Beta D1: `nexus-notes-public-beta-production` / `38fd5c16-44a2-43c6-ae5b-6ecb7ce6e7da`
- All 16 additive Beta migrations applied successfully.
- Legacy conversion report and generated import SQL remain in the external backup directory.

Post-import evidence:

- users: 9, including one suspended recovery account
- workspaces: 10, including one isolated recovery workspace
- notes: 42 of 42 migrated
- databases: 3
- attachments: 1, with its R2 object verified in `nexus-notes-avatars`
- orphaned note foreign keys: 0
- `PRAGMA foreign_key_check`: no rows

One historical note with no legacy user/workspace was preserved in `legacy-recovery-workspace`. One unresolved legacy backlink was not recreated because the target note did not exist. Five old public shares were imported as revoked because the old one-way token hash cannot be converted to the Beta HMAC token format; users must create new shares.

Legacy sessions, email codes, reset tokens and offline drafts were intentionally not imported. Existing users must sign in again. Password hashes were converted from the legacy `pbkdf2$...` label to the compatible Beta `pbkdf2_sha256$...` label without exposing passwords.

## Production Bindings

- R2: existing `nexus-notes-avatars` bucket, now bound as private `FILES`
- Queue: `nexus-notes-public-production-jobs`
- Durable Object: `PresenceRoom`
- Workers AI binding present; `AI_ENABLED=false`
- Turnstile, Resend, rate-limit, user-secret encryption and Web Push VAPID values are Cloudflare Secrets and are not stored in Git.

## Verification

- GitHub Public Beta CI: success
- `/api/v2/health`: `status=ok`, `version=production-beta-2cdf723`, `ocr=ready`
- CSP, HSTS, X-Frame-Options, X-Content-Type-Options and Referrer-Policy present
- Initial HTML does not preload Markdown, OCR or AI chunks
- 390 px public Chrome shell: pass, no horizontal overflow or unnamed controls
- Production shell load: 32 requests, p95 693 ms
- Migrated real account: login 200, session 200, one workspace, eight active notes, logout 200

## Rollback

If a production gate regresses, restore Worker version `3437236b-ad54-4a13-a6c0-a0f7968bb15e` and its original bindings from the external `wrangler.production.toml`, then verify the old health/read/write flow. Keep both legacy and Beta D1 databases, the existing R2 bucket and the external backup for at least 30 days. Do not delete the old D1 or Worker version as part of this release.
