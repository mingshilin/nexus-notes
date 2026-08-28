# Task 13 Personal AI And Editor Focus Report

Date: 2026-08-28
Branch: `codex/personal-ai-provider-editor-focus`

## Delivered

- System AI defaults to Cloudflare Workers AI and requires no user API key.
- Users can select `system` or `personal`; a missing personal config falls back to system AI.
- Personal API keys remain encrypted with `UserSecretBox` and provider preference is isolated by user.
- Note folder, database, tags, links, and note AI actions moved to the default-closed Note Info Inspector.
- The writing surface is wider and taller; the editor keeps a compact accessible heading and puts the body before metadata.

## Verification

- Legacy Web: `152/152`
- Legacy Worker: `63/63`
- Beta Web: `473/473`
- Beta Worker: `585/585`
- Contracts: `60/60`
- Domain: `31/31`
- UI: `2/2`
- `npm run lint`, build, deploy readiness, preview readiness and `npm audit --omit=dev`: passed
- Largest JavaScript chunk: `318.20 kB`; no Vite `>500 kB` warning
- Initial Markdown/OCR/AI preload: absent

## Preview

- Backup: `D:\mingSL\Documents\nexus-notes-beta-backups\20260828-192040\preview-data.sql`
- SHA-256: `A43B189849FE1E3569C667E02FE15BB6C08024FF511C583B2BDE4AA9F355332B`
- Migration: `0025_ai_provider_preference.sql`
- Version: `2b5f331e-a37a-4532-9b58-48f9ebcaafb3`
- Rollback: `bcdf6053-25d4-4d55-8112-4936d4414f81`
- 390px public shell: pass
- Load: 32 requests, p95 `822ms`

## Production

- Backup: `D:\mingSL\Documents\nexus-notes-production-backups\20260828-193055\production-beta-data.sql`
- SHA-256: `29699F963170EA257357702F4C427FAB218E2A08F36A9662D3C96B646D5068AF`
- Migration: `0025_ai_provider_preference.sql`
- Version: `4cff06b5-0807-410f-b4f8-7ca1cb639014`
- Rollback: `1c5198ff-7671-4e97-9c1a-1e9dc3c131cc`
- Health/security/preload: pass
- 390px public shell: pass
- Load: 32 requests, p95 `948ms`

## Blocked Gate

Authenticated online AI chat and note-editor browser validation is blocked because the provided Preview credentials returned `401` and no external authenticated Chrome profile is configured. No session was created. Worker route tests cover Workers AI system chat, personal override, fallback, user isolation, action confirmation, and permission boundaries; this is not reported as an authenticated online PASS.
