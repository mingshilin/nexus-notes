# Task 12 Preview Release Report

Date: 2026-08-28
Branch: `codex/ai-assistant-fluency`

## Scope

Completed the Preview-only release handoff. Production Worker, production D1 (`notes_db`), production domain, and production secrets were not changed in this task.

## Recovery Evidence

- External backup: `D:\mingSL\Documents\nexus-notes-beta-backups\20260828-171927\preview-data.sql`
- Backup SHA-256: `1CB5C34C27A64CD86FB6A34F5C406CDE3F56DE9B67982FD291B9A622634FA45F`
- Restore runtime: `D:\mingSL\Documents\nexus-notes-restore-runtime\20260828-171927`
- Restored counts: `users=10`, `workspaces=8`, `notes=25`, `databases=1`, `reminders=0`, `ai_action_proposals=0`, `ai_email_outbox=0`
- Local `PRAGMA foreign_key_check`: no rows
- Remote Preview `PRAGMA foreign_key_check`: no rows
- Remote migrations: `0001` through `0024`

## Preview Deployment

- Worker: `nexus-notes-public-beta-preview`
- URL: <https://nexus-notes-public-beta-preview.shilinming9.workers.dev/>
- New version: `bcdf6053-25d4-4d55-8112-4936d4414f81`
- Rollback version: `5c70961e-e737-4420-b5f9-754222a2ffe1`
- Preview D1: `a41db2e1-74f6-4fea-bc8c-2053c60ebfc8`
- `AI_ENABLED=false` preserved
- Existing secret names preserved; secret values were not read or copied into Git

## Verification

- `npm run build`: passed; largest JavaScript chunk `317.40 kB`, no Vite `>500 kB` warning
- `npm run verify:deploy:online -- --url=https://nexus-notes-public-beta-preview.shilinming9.workers.dev --turnstile-site-key=0x4AAAAAAEYIUPG_TODCo3nO`: passed
- Online health: `status=ok`, `ocr=ready`, required security headers present
- Online HTML: no initial Markdown/OCR/AI preload
- 390px public-shell: passed; viewport `390`, DPR `2`, scroll width `390`, zero unnamed controls, zero runtime diagnostics
- Load gate: `32` requests, p95 `875ms`
- Authenticated AI/navigation E2E: `BLOCKED AUTHENTICATED_PROFILE_UNSET`; no external authenticated profile was configured, so no false pass was recorded

## Remaining Release Gates

The following are intentionally not claimed as complete: real authenticated AI provider flow, real browser email/share/OCR scenarios, production migration/deployment, production secret rotation, GitHub PR merge, and release tag creation.
