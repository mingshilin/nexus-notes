# Nexus Notes AI 助手与流畅度深化实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在保持现有视觉风格和 API 兼容的前提下，让页面切换更快、更稳定，并让 AI 通过受权限、确认、版本和幂等保护的工具完成核心笔记工作流。

**Architecture:** 保留现有 Beta Worker/D1/Queue 和 `/api/v2`，把 AI 能力扩展为共享契约、只读查询工具、确认型写入执行器和用户级可信模式策略。前端把导航 shell、query cache 和 action card 分开，所有长操作均可恢复；生产保持独立迁移、备份和回滚门禁。

**Tech Stack:** React 19、Vite、TypeScript、Zod、Cloudflare Workers、D1、R2、Queues、IndexedDB、Vitest、真实 Chrome/Edge smoke。

## Global Constraints

- 保持现有 Nexus Notes 视觉语言，不重做配色、字体、圆角、glass surface 或导航结构。
- AI 默认 `AI_ENABLED=false`；没有真实 provider、认证 smoke 和 Preview 门禁证据时不启用或切换生产。
- trusted 模式按 workspace 生效，默认 24 小时过期；创建笔记/提醒/站内通知可自动，修改/删除/批量/权限/邮件始终确认。
- AI 默认只处理当前笔记和用户明确选定的实体；不允许跨 workspace 默认搜索。
- 邮件只能使用 Worker `EMAIL_FROM` 和系统 Resend；不接受用户 SMTP；外部收件人始终确认。
- 不执行任意 SQL/HTTP/动态代码；所有工具必须通过现有 tenant-bound service/repository 和字段权限。
- 所有 mutable write 保留 revision CAS、idempotency key、audit 和可恢复错误；数据库删除继续先 detach 笔记。
- 每个 route 只能有一个主 scroll owner；旧 workspace 请求不能覆盖新 workspace 可见数据。
- 构建不得出现 Vite `>500 kB` 警告；Markdown/OCR/AI 不进入初始 modulepreload。
- 不修改已发布 migration；数据库变更只能新增 additive migration，并先在独立 Preview/恢复目录验证。

---

### Task 1: Interaction Baseline And Navigation Contract

**Files:**
- Create: `apps/web/src/performance/interaction-budget.ts`
- Create: `apps/web/src/app/use-workspace-navigation.ts`
- Modify: `apps/web/src/app/App.tsx`
- Modify: `apps/web/src/app/WorkspaceShell.tsx`
- Test: `apps/web/tests/interaction-budget.test.ts`
- Test: `apps/web/tests/workspace-performance.test.tsx`

**Interfaces:**
- `recordInteraction(name: string, startedAt: number, now?: number): InteractionMetric`
- `useWorkspaceNavigation().navigate(domain: ProductDomain): void`
- Navigation must synchronously expose `requestedDomain` and `aria-busy`, while lazy imports remain non-blocking.

- [ ] **Step 1: Write the failing tests**
  Add tests for a click that immediately renders the target shell while its lazy module is unresolved, and for a metric that classifies shell time over 100ms without blocking navigation.

- [ ] **Step 2: Run the focused tests and verify the expected failure**
  Run `npx vitest run --config vitest.config.ts tests/interaction-budget.test.ts tests/workspace-performance.test.tsx` from `apps/web`; confirm the missing synchronous navigation/metric behavior fails.

- [ ] **Step 3: Implement the smallest navigation/metric change**
  Keep the state commit in the click handler; call `preloadWorkspaceDomain` in a detached promise. Do not await a lazy import inside the urgent update and do not add a second vertical scroll owner.

- [ ] **Step 4: Run the focused tests**
  Repeat the command from Step 2 and require all tests to pass with no console errors.

- [ ] **Step 5: Commit**
  Run `git add apps/web/src/performance apps/web/src/app/App.tsx apps/web/src/app/WorkspaceShell.tsx apps/web/tests/interaction-budget.test.ts apps/web/tests/workspace-performance.test.tsx` and commit `perf: measure responsive navigation shell`.

### Task 2: Workspace Query Cache And Request Lifecycle

**Files:**
- Modify: `apps/web/src/data/api-client.ts`
- Modify: `apps/web/src/data/database-client.ts`
- Modify: `apps/web/src/app/use-workspace-clients.ts`
- Test: `apps/web/tests/api-client.test.ts`
- Test: `apps/web/tests/database-client.test.ts`
- Test: `apps/web/tests/workspace-performance.test.tsx`

**Interfaces:**
- Query dedupe keys are `(workspaceId, path, normalizedQuery)`.
- `DatabaseClient` returns stale values immediately and exposes one background refresh promise per key.
- An aborted or superseded request never clears or overwrites visible data.

- [ ] **Step 1: Write the failing tests**
  Cover workspace-isolated dedupe, two callers with different `AbortSignal`s, concurrent stale reads issuing one refresh, mutation invalidation blocking an old response, and stable client identity across renders.

- [ ] **Step 2: Run and verify RED**
  Run `npx vitest run --config vitest.config.ts tests/api-client.test.ts tests/database-client.test.ts tests/workspace-performance.test.tsx` from `apps/web`; record the expected failures.

- [ ] **Step 3: Implement cache generation and signal isolation**
  Use workspace-scoped keys, active-generation guards, and signal-safe dedupe. Preserve old values during refresh and invalidate only the affected workspace/domain.

- [ ] **Step 4: Run focused Web tests and typecheck**
  Run the Step 2 command and `npm run typecheck --workspace @nexus/web`; both must exit 0.

- [ ] **Step 5: Commit**
  Commit `perf: harden workspace query cache` with only the listed source/tests.

### Task 3: Authenticated Workspace Decomposition

**Files:**
- Create: `apps/web/src/app/domains/NotesDomain.tsx`
- Create: `apps/web/src/app/domains/KnowledgeDomain.tsx`
- Create: `apps/web/src/app/domains/DatabaseDomain.tsx`
- Create: `apps/web/src/app/domains/AccountAndAIDomain.tsx`
- Modify: `apps/web/src/app/App.tsx`
- Test: `apps/web/tests/domain-facade.test.tsx`

**Interfaces:**
- `WorkspaceDomainProps` carries only the domain client, workspace ID, user role, selected entity and domain callbacks.
- `AuthenticatedWorkspace` remains the compatibility facade; existing route props and public API URLs do not change.

- [ ] **Step 1: Write the failing facade test**
  Assert each domain facade renders independently with a fake client and that switching domains does not unmount the stable navigation shell.

- [ ] **Step 2: Run the RED test**
  Run `npx vitest run --config vitest.config.ts tests/domain-facade.test.tsx` from `apps/web` and verify the new modules are absent.

- [ ] **Step 3: Extract only domain rendering and callbacks**
  Move JSX and domain-local derived values into the four facades; leave workspace lifecycle, logout, modal ownership and client creation in the shell until later tasks.

- [ ] **Step 4: Run Web tests and typecheck**
  Run `npm run test --workspace @nexus/web` and `npm run typecheck --workspace @nexus/web`; no existing test may be weakened.

- [ ] **Step 5: Commit**
  Commit `refactor: split authenticated workspace domains`.

### Task 4: AI Tool Catalog And Trusted-Mode Policy

**Files:**
- Modify: `packages/contracts/src/ai.ts`
- Create: `packages/domain/src/ai-policy.ts`
- Modify: `packages/domain/src/index.ts`
- Create: `apps/worker/migrations/0021_ai_trusted_mode.sql`
- Test: `packages/contracts/tests/ai-policy-contracts.test.ts`
- Test: `packages/domain/tests/ai-policy.test.ts`
- Test: `apps/worker/tests/ai-policy-migration.test.ts`

**Interfaces:**
- `AiToolRisk = "read" | "safe_write" | "confirmed_write" | "external_or_destructive"`.
- `AiTrustedMode = { workspace_id: string; enabled: boolean; expires_at: string | null; revision: number }`.
- `evaluateAiToolPolicy(input: { tool: AiToolName; trusted: boolean; target: "current" | "selected" | "workspace"; externalRecipient: boolean }): { requiresConfirmation: boolean; risk: AiToolRisk }`.

- [ ] **Step 1: Write failing contract/domain/migration tests**
  Cover every catalog risk, trusted-mode expiry, selected-context requirement, external-recipient confirmation, revision CAS and additive migration columns.

- [ ] **Step 2: Run RED**
  Run `npm run test --workspace @nexus/contracts -- tests/ai-policy-contracts.test.ts`, `npm run test --workspace @nexus/domain -- tests/ai-policy.test.ts`, and `npm run test --workspace @nexus/worker -- tests/ai-policy-migration.test.ts --pool=forks --maxWorkers=1 --minWorkers=1`.

- [ ] **Step 3: Implement shared policy**
  Add strict schemas and pure policy evaluation; store only workspace ID, enabled state, expiry and revision. Never store prompts, keys or note bodies in the policy table.

- [ ] **Step 4: Run focused tests and typechecks**
  Repeat Step 2 plus `npm run typecheck --workspace @nexus/contracts --workspace @nexus/domain --workspace @nexus/worker` using the repository's workspace command form.

- [ ] **Step 5: Commit**
  Commit `feat: add scoped AI trusted mode policy`.

### Task 5: AI Read Tools And Source-Aware Context

**Files:**
- Modify: `packages/contracts/src/ai.ts`
- Create: `apps/worker/src/ai/ai-read-tools.ts`
- Modify: `apps/worker/src/ai/ai-chat-service.ts`
- Modify: `apps/worker/src/routes/ai.ts`
- Test: `apps/worker/tests/ai-read-tools.test.ts`
- Test: `apps/worker/tests/ai-chat-tools.test.ts`

**Interfaces:**
- Read tools: `search_notes`, `get_note`, `list_reminders`, `search_databases`, `get_database_record`.
- `AiReadContext = { workspaceId: string; userId: string; selectedNoteIds: readonly string[]; selectedDatabaseIds: readonly string[]; allowWorkspaceSearch: boolean }`.
- Read results include `source_type`, `source_id`, `workspace_id` and redacted hit fields; no unauthorized field/value is returned.

- [ ] **Step 1: Write failing read/permission tests**
  Cover current-note reads, explicit selected entities, denied workspace search, source labels, database/field filtering and cross-workspace rejection.

- [ ] **Step 2: Run RED**
  Run `npx vitest run --config vitest.config.ts tests/ai-read-tools.test.ts tests/ai-chat-tools.test.ts --pool=forks --maxWorkers=1 --minWorkers=1` from `apps/worker`.

- [ ] **Step 3: Implement service-backed read tools**
  Reuse Notes, Knowledge and Database repositories; never let the provider construct SQL or URLs. Enforce bounded result counts and request deadlines.

- [ ] **Step 4: Run focused Worker tests and typecheck**
  Require the Step 2 command and `npm run typecheck --workspace @nexus/worker` to pass.

- [ ] **Step 5: Commit**
  Commit `feat: add scoped AI read tools`.

### Task 6: AI Note Lifecycle Actions

**Files:**
- Modify: `packages/contracts/src/ai.ts`
- Modify: `apps/worker/src/ai/ai-tool-model.ts`
- Modify: `apps/worker/src/ai/ai-tool-orchestrator.ts`
- Modify: `apps/worker/src/bootstrap.ts`
- Test: `apps/worker/tests/ai-note-actions.test.ts`

**Interfaces:**
- Write tools: `create_note`, `update_note`, `move_note`, `archive_note`, `restore_note`, `delete_note`.
- Every proposal includes `target_note_id` when applicable, `base_revision`, normalized patch and `requires_confirmation` from Task 4 policy.
- Execution returns `{ action_id: string; status: "executed" | "failed" | "conflict"; entity_id?: string; revision?: number }`.

- [ ] **Step 1: Write failing action tests**
  Cover trusted create, confirmation-required update/delete, note revision conflict, deterministic replay, trash/restore semantics and detach-preserving content.

- [ ] **Step 2: Run RED**
  Run `npx vitest run --config vitest.config.ts tests/ai-note-actions.test.ts tests/ai-tool-execution.test.ts --pool=forks --maxWorkers=1 --minWorkers=1` from `apps/worker`.

- [ ] **Step 3: Implement through NoteService**
  Extend only internal trusted execution context; preserve ordinary note HTTP payloads and existing delete-detach ordering. Map conflicts to stable 409 business errors.

- [ ] **Step 4: Run focused Worker tests and typecheck**
  Run the Step 2 command and `npm run typecheck --workspace @nexus/worker`.

- [ ] **Step 5: Commit**
  Commit `feat: add AI note lifecycle actions`.

### Task 7: AI Organization And Database Actions

**Files:**
- Modify: `packages/contracts/src/ai.ts`
- Create: `apps/worker/src/ai/ai-organization-tools.ts`
- Modify: `apps/worker/src/ai/ai-tool-orchestrator.ts`
- Test: `apps/worker/tests/ai-organization-tools.test.ts`
- Test: `apps/worker/tests/database-routes.test.ts`

**Interfaces:**
- Tools: `create_folder`, `apply_tag`, `create_database_record`, `update_database_record`, `apply_template`.
- Database writes accept typed values and `base_revision`; server field permissions are authoritative.
- Batch organization is always confirmed, bounded to 100 entities and uses one transaction per action.

- [ ] **Step 1: Write failing typed-value/permission tests**
  Cover trusted single safe organization, confirmed database writes, field type errors, denied fields, template defaults, transaction rollback and bounded batch size.

- [ ] **Step 2: Run RED**
  Run `npx vitest run --config vitest.config.ts tests/ai-organization-tools.test.ts tests/database-routes.test.ts --pool=forks --maxWorkers=1 --minWorkers=1` from `apps/worker`.

- [ ] **Step 3: Implement through existing Database/Knowledge services**
  Do not duplicate database validation or permission SQL in the AI layer. Return field-level errors without returning hidden values.

- [ ] **Step 4: Run focused Worker tests and typecheck**
  Require both tests and `npm run typecheck --workspace @nexus/worker` to pass.

- [ ] **Step 5: Commit**
  Commit `feat: add AI organization and database actions`.

### Task 8: Reminder Notification And System Email Workflow

**Files:**
- Modify: `apps/worker/src/ai/ai-tool-orchestrator.ts`
- Modify: `apps/worker/src/ai/ai-email-outbox-repository.ts`
- Modify: `apps/worker/src/routes/ai.ts`
- Modify: `apps/web/src/ai/AIActionCard.tsx`
- Test: `apps/worker/tests/ai-reminder-notification-email.test.ts`
- Test: `apps/web/tests/ai-action-card.test.tsx`

**Interfaces:**
- Tools: `create_reminder`, `complete_reminder`, `create_notification`, `send_email`.
- Email execution accepts `{ to_email, subject, body_text, recipient_scope }`; `recipient_scope` is `self | workspace_member | external` and external always confirms.
- System sender is resolved only from Worker `EMAIL_FROM`; client never supplies a sender.

- [ ] **Step 1: Write failing workflow tests**
  Cover reminder creation/completion, in-app notification, member/external recipient policy, system sender, outbox retry, stale proposal expiry and bounded email preview.

- [ ] **Step 2: Run RED**
  Run `npx vitest run --config vitest.config.ts tests/ai-reminder-notification-email.test.ts tests/ai-action-card.test.tsx --pool=forks --maxWorkers=1 --minWorkers=1` from the respective workspaces.

- [ ] **Step 3: Implement policy and UI integration**
  Keep current outbox generation/delivery lease safety, expose recipient scope and risk in the card, and preserve old `/api/v2/ai/chat` response compatibility.

- [ ] **Step 4: Run focused tests and typechecks**
  Run the Step 2 tests plus Worker/Web typechecks.

- [ ] **Step 5: Commit**
  Commit `feat: complete AI reminder notification email actions`.

### Task 9: Trusted Mode And Action History UI

**Files:**
- Create: `apps/web/src/ai/AITrustedModePanel.tsx`
- Create: `apps/web/src/ai/AIActionHistoryPanel.tsx`
- Modify: `apps/web/src/account/AccountCenter.tsx`
- Modify: `apps/web/src/ai/AIChatPanel.tsx`
- Modify: `apps/worker/src/routes/ai.ts`
- Modify: `apps/worker/src/bootstrap.ts`
- Test: `apps/web/tests/ai-trusted-mode.test.tsx`
- Test: `apps/web/tests/ai-chat-panel.test.tsx`

**Interfaces:**
- `GET/PATCH /api/v2/ai/trusted-mode` returns only workspace-scoped enabled/expiry/revision.
- History returns action id, tool, risk, status, created/updated timestamps and safe error code; never prompt/body/key/token.
- UI clearly shows active workspace, expiry countdown, scope and a one-click disable/revoke action.

- [ ] **Step 1: Write failing component/route tests**
  Cover enable/disable CAS, expiry, workspace switch reset, action history filtering, keyboard focus and no sensitive text in rendered/storage output.

- [ ] **Step 2: Run RED**
  Run `npx vitest run --config vitest.config.ts tests/ai-trusted-mode.test.tsx tests/ai-chat-panel.test.tsx` from `apps/web` and the matching Worker route test.

- [ ] **Step 3: Implement the panels and endpoints**
  Use existing Account Center visual language and ApiClient; keep optimistic state reversible and invalidate only the current workspace AI cache.

- [ ] **Step 4: Run Web/Worker focused tests and typechecks**
  Require all affected tests and both workspace typechecks to pass.

- [ ] **Step 5: Commit**
  Commit `feat: add AI trusted mode controls`.

### Task 10: Product Gap Completion Wave

**Files:**
- Modify: `apps/web/src/knowledge/KnowledgeSearchPanel.tsx`
- Modify: `apps/web/src/knowledge/KnowledgeRecoveryPanel.tsx`
- Modify: `apps/web/src/databases/DatabaseToolsDrawer.tsx`
- Modify: `apps/web/src/databases/DatabaseManagementPanels.tsx`
- Modify: `apps/web/src/reminders/ReminderPanel.tsx`
- Modify: `apps/web/src/account/AccountOverviewPanel.tsx`
- Test: `apps/web/tests/product-gap-completion.test.tsx`

**Interfaces:**
- Every incomplete panel has loading, empty, permission, partial failure, retry and success feedback states.
- Search results display hit source and selected filters; recovery actions preserve original note content; database tools close without reducing canvas width; reminders show grouped status and retry state.

- [ ] **Step 1: Write failing product-gap tests**
  Cover source-aware search, attachment/OCR filter combinations, unfiled/orphan/duplicate recovery, database management drawer close, reminder retry and account trusted-mode status link.

- [ ] **Step 2: Run RED**
  Run `npx vitest run --config vitest.config.ts tests/product-gap-completion.test.tsx tests/knowledge-search-panel.test.tsx tests/database-management-center.test.tsx tests/reminder-panel.test.tsx` from `apps/web`.

- [ ] **Step 3: Implement only missing UI states and wiring**
  Reuse current API clients and visual tokens; do not add duplicate data fetches or a second scroll container.

- [ ] **Step 4: Run focused tests and mobile checks**
  Run the Step 2 command plus `npm run test:browser-shell -- --url=https://nexus-notes-public-beta-preview.shilinming9.workers.dev/` against the independent Preview candidate.

- [ ] **Step 5: Commit**
  Commit `feat: close core product workflow gaps`.

### Task 11: Performance, Accessibility And Real Browser Gates

**Files:**
- Modify: `scripts/smoke-beta-browser.mjs`
- Create: `tests/e2e/ai-assistant-flow.mjs`
- Create: `tests/e2e/navigation-performance.mjs`
- Test: `apps/web/tests/accessibility-regression.test.tsx`
- Test: `apps/web/tests/performance-budget.test.ts`

**Interfaces:**
- Browser evidence must use a profile outside the repository and never write credentials/cookies/body content to Git.
- E2E covers login, note create/update, workspace switch, selected-context AI read, trusted safe create, confirmed update/delete, rejected action and email outbox status.

- [ ] **Step 1: Write failing browser/metric assertions**
  Add assertions for shell <=100ms, cached return <=250ms where measurable, one scroll owner at 390px, 200% zoom, keyboard focus, no initial AI/Markdown/OCR preload and no sensitive logs.

- [ ] **Step 2: Run RED or explicit blocked evidence**
  Run the browser scripts with an external profile. If credentials/provider are unavailable, emit machine-readable `BLOCKED` and do not treat it as pass.

- [ ] **Step 3: Implement only test harness fixes**
  Keep browser actions user-visible and use current route APIs; never bypass Turnstile or confirmation gates.

- [ ] **Step 4: Run all local gates**
  Run `npm run lint`, `npm run test:unit`, `npm run test:integration`, `npm run beta:test`, `npm run beta:build`, `npm run test:fault`, `npm run test:perf`, `npm run verify:deploy`, and `npm audit --omit=dev`.

- [ ] **Step 5: Commit**
  Commit `test: add AI and navigation browser gates`.

### Task 12: Preview Release And Handoff

**Files:**
- Modify: `docs/feature-parity-matrix.md`
- Modify: `docs/preview-acceptance-handoff.md`
- Modify: `docs/ai-chat-configuration.md`
- Create: `docs/ai-assistant-user-guide.md`
- Test: existing root/Beta/Worker suites and deployment readiness scripts

**Interfaces:**
- Preview uses separate Worker, D1, R2, Queue and Durable Object bindings; production remains unchanged until separately authorized.
- Handoff records commit, migration list, backup hash, restore result, online health/headers/load, browser status and rollback version.

- [ ] **Step 1: Run the complete local release gates**
  Run every command in Task 11 Step 4 and `npm run verify:preview`.

- [ ] **Step 2: Create an external backup and restore drill**
  Export ordinary application tables outside the repository, apply all additive migrations in a fresh local persistence directory, restore, compare counts/hashes and run `PRAGMA foreign_key_check`. Use the existing Preview D1 name `nexus-notes-public-beta-preview` and the external backup root `D:\mingSL\Documents\nexus-notes-beta-backups`.

- [ ] **Step 3: Deploy only to independent Preview**
  Apply additive migrations to Preview, deploy with `AI_ENABLED=false`, then run online health, headers, 390px shell, load and browser gates. Record any blocked authenticated/provider gate explicitly.

- [ ] **Step 4: Update handoff docs and commit**
  Record exact evidence and remaining risks; run `git diff --check`; commit `docs: record AI assistant release gates`.

- [ ] **Step 5: Stop before production mutation**
  Production secret changes, remote production migrations, domain routing, PR merge and release tags require a separate explicit authorization after all evidence is green.
