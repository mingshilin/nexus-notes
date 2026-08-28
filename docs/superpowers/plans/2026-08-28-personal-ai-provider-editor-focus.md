# Personal AI Provider And Note Editor Focus Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 支持系统 AI/个人 AI 可选与安全 fallback，并把笔记管理信息移出默认写作首屏。

**Architecture:** 在现有 `UserAiConfigService` 上增加用户 provider preference 解析，系统 provider 继续由 Worker variables/secrets 提供。笔记页面将现有组织、链接和 AI 辅助内容包进受控 Inspector，不改变 Notes API 或数据模型。

**Tech Stack:** React 19, TypeScript, Cloudflare Workers, D1, Vitest, Testing Library, Vite.

## Global Constraints

- 保持现有 API URL 和已有响应字段兼容。
- 用户 API Key 只允许进入 Worker 加密存储，不能进入 Git、日志、Analytics、IndexedDB、Service Worker cache 或前端 bundle。
- 所有 AI 写入、发信、提醒和删除操作继续经过确认、workspace 权限、revision 和 idempotency 校验。
- 系统 AI 关闭时，完整个人 AI 配置仍可用；没有个人配置时返回可恢复状态。
- 笔记 Inspector 默认关闭且不占写作主画布空间，移动端只有一个主滚动容器。
- 构建不能出现 Vite `>500 kB` 警告，Markdown/OCR/AI 不进入初始 modulepreload。

---

### Task 1: Provider Preference And Fallback

**Files:**
- Create: `apps/worker/migrations/0025_ai_provider_preference.sql`
- Modify: `packages/contracts/src/profile.ts`
- Modify: `apps/worker/src/profile/d1-profile-repository.ts`
- Modify: `apps/worker/src/profile/profile-service.ts`
- Modify: `apps/worker/src/routes/profile.ts`
- Modify: `apps/worker/src/ai/user-ai-config-service.ts`
- Modify: `apps/worker/src/bootstrap.ts`
- Test: `apps/worker/tests/ai-provider-selection.test.ts`

**Interfaces:**
- Add `AiProviderSource = "system" | "personal"`.
- Add user preference methods `getAiProviderPreference(userId)` and `updateAiProviderPreference(userId, source, baseRevision)` with revision CAS.
- Preserve `/api/v2/ai/status`, `/api/v2/ai/config`, `/api/v2/ai/chat` and action endpoints; add `selected_source`, `personal_configured`, and `system_configured` only where status is returned.

- [ ] **Step 1: Write the failing test**

Add tests proving that a personal config can chat while `AI_ENABLED=false`, that a missing personal config falls back to the enabled system provider, and that provider selection is isolated by user.

- [ ] **Step 2: Run the focused test and verify the expected failure**

Run `npm run test --workspace @nexus/worker -- tests/ai-provider-selection.test.ts`.
Expected: FAIL because the migration, preference methods, and personal-provider bypass do not exist.

- [ ] **Step 3: Add the additive preference migration and contracts**

Create `0025_ai_provider_preference.sql` with an additive `ai_provider_source` column on `user_preferences`, defaulting to `system`, and a check constraint allowing only `system` and `personal`. Extend profile contracts with the source union and revisioned update input.

- [ ] **Step 4: Implement repository/service preference storage**

Implement the repository read/update with user scoping and revision compare-and-swap. Return `system` when no preference row exists. Reject stale revisions with the existing conflict taxonomy.

- [ ] **Step 5: Implement provider resolution**

Change the AI bootstrap resolver to inspect the preference and personal config before enforcing `AI_ENABLED`: use personal config when selected and present; otherwise use the system fallback. Keep system-only requests disabled when the system flag is false. Let config/status endpoints remain accessible for authenticated users so they can configure themselves.

- [ ] **Step 6: Add the preference route and focused green test**

Register a session-authenticated `GET/PATCH /api/v2/ai/provider` route with the same request envelope and revision semantics as the existing account preferences. Run `npm run test --workspace @nexus/worker -- tests/ai-provider-selection.test.ts` and require all focused tests to pass.

- [ ] **Step 7: Commit the task**

Run `git add apps/worker/migrations/0025_ai_provider_preference.sql packages/contracts/src/profile.ts apps/worker/src/profile/d1-profile-repository.ts apps/worker/src/profile/profile-service.ts apps/worker/src/routes/profile.ts apps/worker/src/ai/user-ai-config-service.ts apps/worker/src/bootstrap.ts apps/worker/tests/ai-provider-selection.test.ts` and commit with `feat: support personal AI provider fallback`.

### Task 2: Provider Selection UI

**Files:**
- Modify: `apps/web/src/ai/AIConfigPanel.tsx`
- Modify: `apps/web/src/ai/AIChatPanel.tsx`
- Modify: `apps/web/src/account/AccountCenter.tsx`
- Modify: `apps/web/src/styles.css`
- Test: `apps/web/tests/ai-chat-panel.test.tsx`
- Test: `apps/web/tests/ai-provider-selection.test.tsx`

**Interfaces:**
- Use `GET/PATCH /api/v2/ai/provider` for the selected source.
- Keep existing config form URL `GET/PUT/DELETE /api/v2/ai/config` unchanged.

- [ ] **Step 1: Write the failing UI tests**

Test that the panel renders “系统 AI/我的 AI”, persists the selected source, reports personal fallback when no personal config exists, and keeps the personal configuration form available while system AI is disabled.

- [ ] **Step 2: Run the focused UI tests and verify failure**

Run `npm run test --workspace @nexus/web -- ai-provider-selection.test.ts ai-chat-panel.test.tsx`.
Expected: FAIL because the selector and provider endpoint are not rendered or called.

- [ ] **Step 3: Implement selection state and status copy**

Load provider preference and status in `AIConfigPanel`; show explicit source, availability and fallback state. Persist changes with a revisioned PATCH and keep configuration save/test/delete actions available.

- [ ] **Step 4: Update chat availability handling**

Treat a personal configured status as available even when the system status is disabled. Preserve the current disabled recovery message for users without either provider.

- [ ] **Step 5: Run focused UI tests and commit**

Run the focused command again, then commit with `feat: add AI provider selector`.

### Task 3: Note Editor Inspector Focus

**Files:**
- Modify: `apps/web/src/notes/NoteEditorSurface.tsx`
- Modify: `apps/web/src/app/domains/NotesDomain.tsx`
- Modify: `apps/web/src/app/App.tsx`
- Modify: `apps/web/src/styles.css`
- Test: `apps/web/tests/note-editor-surface.test.tsx`
- Test: `apps/web/tests/product-navigation.test.tsx`
- Test: `apps/web/tests/core-ux-mobile.test.tsx`

**Interfaces:**
- Keep existing note organization, tag, link, database and AI action props and callbacks.
- Add only local `inspectorOpen` state and an accessible opener/close control.

- [ ] **Step 1: Write failing layout tests**

Test that opening a note renders the writing surface before organization panels, Inspector is absent from layout by default, and opening/closing it preserves focus and one mobile scroll owner.

- [ ] **Step 2: Run focused tests and verify failure**

Run `npm run test --workspace @nexus/web -- note-editor-surface.test.tsx product-navigation.test.tsx core-ux-mobile.test.tsx`.
Expected: FAIL because current organization panels render inline in the main editor and no Inspector opener exists.

- [ ] **Step 3: Implement the Inspector shell**

Move organization, database, tag, link and AI action panel composition behind a local Inspector. Use `aria-expanded`, `aria-controls`, focus restoration and a mobile full-screen drawer. Keep panel content and callbacks unchanged.

- [ ] **Step 4: Make the writing surface fill the editor**

Adjust the existing editor grid/flex styles so title and textarea occupy the available main column height; Inspector uses overlay or a separate desktop panel only while open and never reduces the default writing area.

- [ ] **Step 5: Run focused tests and commit**

Run the focused command again, then commit with `feat: focus note editor on writing`.

### Task 4: Integration Verification And Preview

**Files:**
- Modify: `apps/worker/wrangler.preview.example.toml` only if a checked-in variable name is required; never add secrets.
- Modify: `docs/ai-chat-configuration.md`
- Modify: `docs/feature-parity-matrix.md`
- Create: `.superpowers/sdd/task-13-personal-ai-editor-focus-report.md`

- [ ] **Step 1: Run all relevant tests**

Run `npm run lint`, `npx vitest run --config vite.config.ts`, `npx vitest run --config vitest.worker.config.ts`, and `npm run build`. Require zero failures and no Vite `>500 kB` warning.

- [ ] **Step 2: Run release readiness**

Run `npm run verify:deploy`, `npm run verify:preview`, and `npm run verify:deploy:online -- --url=https://nexus-notes-public-beta-preview.shilinming9.workers.dev --turnstile-site-key=0x4AAAAAAEYIUPG_TODCo3nO`. Confirm no initial Markdown/OCR/AI preload.

- [ ] **Step 3: Apply migration and deploy Preview only**

Back up Preview D1 outside the repository, apply migration `0025_ai_provider_preference.sql` to Preview, deploy only `nexus-notes-public-beta-preview`, and retain the prior version ID for rollback.

- [ ] **Step 4: Run browser and production smoke**

Run the public 390px browser shell against Preview and production. Authenticated AI tests must report `BLOCKED` if no external profile/provider is configured; never convert that to PASS.

- [ ] **Step 5: Record evidence and commit**

Update the docs and report with exact version IDs, migration result, backup hash, test counts and any blocked gates. Commit with `docs: record personal AI and editor focus release`.
