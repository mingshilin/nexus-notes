# Nexus Notes AI Tools And Interaction Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Each task ends with a focused test gate and a commit.

**Goal:** Add safe AI actions for notes, reminders, notifications and system email while reducing page-switch latency without changing the existing visual language or API compatibility.

**Architecture:** The Worker will expose a typed AI action proposal/confirmation flow. A provider may suggest only four allowlisted tools; the Worker validates the proposal against the current session and workspace, persists it with an idempotency key, and executes confirmed writes through existing domain services and Queue outboxes. The web app will render confirmation cards and will keep navigation urgent while lazy modules and data refreshes run in the background.

**Tech Stack:** React 19, TypeScript, Zod, Cloudflare Workers, D1, Queues, Resend, Vitest, Testing Library, existing `ApiClient` and workspace-scoped clients.

## Global Constraints

- Email sender is always the configured Worker `EMAIL_FROM`; no user SMTP/Resend identity is added.
- AI writes require an explicit user confirmation and a fresh server-side permission check.
- AI cannot execute SQL, arbitrary HTTP requests, or tools outside the four allowlist entries.
- Idempotency key format is `ai-action:${userId}:${actionId}`.
- Proposal expiry is 10 minutes; proposal ownership is bound to `user_id` and `workspace_id`.
- Email body is plain text with bounded recipient, subject and body lengths; email delivery is asynchronous.
- No prompt, note body, email body, recipient address, token or provider key is written to logs or browser storage.
- Existing `/api/v2/ai/chat`, note, reminder, notification, email and workspace APIs remain compatible.
- Existing visual theme, mobile scroll owner and production R2 bucket remain unchanged.
- Initial preload must not include Markdown, OCR or AI chunks; all JavaScript chunks remain at or below 500,000 bytes.

---

### Task 1: AI Action Contracts And D1 Schema

**Files:**
- Create: `apps/worker/migrations/0017_ai_action_proposals.sql`
- Create: `apps/worker/migrations/0018_ai_email_outbox.sql`
- Modify: `packages/contracts/src/ai.ts`
- Modify: `packages/contracts/src/index.ts`
- Test: `packages/contracts/tests/ai-action-contracts.test.ts`
- Test: `apps/worker/tests/ai-action-migrations.test.ts`

**Interfaces:**
- Produce `AiToolName`, `AiActionProposal`, `AiActionStatus`, `AiActionProposalSchema`, `AiActionConfirmSchema`, `AiActionRejectSchema`.
- Produce `ai_action_proposals` with `id`, `user_id`, `workspace_id`, `tool`, `input_json`, `status`, `idempotency_key`, `revision`, `expires_at`, `created_at`, `updated_at`.
- Produce `ai_email_outbox` with `id`, `action_id`, `user_id`, `workspace_id`, `to_email`, `subject`, `body_text`, `status`, `attempt_count`, `available_at`, `sent_at`, `last_error_code`, `created_at`, `updated_at`.

- [ ] **Step 1: Write the failing contract tests**

```ts
it("accepts only the four side-effect tools and bounded email input", () => {
  expect(AiActionProposalSchema.parse({
    action_id: "a1", tool: "send_email", summary: "发送邮件", input: {
      to_email: "user@example.test", subject: "主题", body_text: "正文",
    }, requires_confirmation: true, expires_at: "2026-08-26T00:10:00.000Z",
  }).tool).toBe("send_email");
  expect(() => AiActionProposalSchema.parse({ tool: "execute_sql" })).toThrow();
});
```

- [ ] **Step 2: Run the focused tests and verify they fail because the schemas/migrations do not exist**

Run: `npx vitest run --config packages/contracts/vitest.config.ts packages/contracts/tests/ai-action-contracts.test.ts`

Expected: FAIL with missing contract exports.

- [ ] **Step 3: Add the Zod contracts and additive SQL migrations**

Use `z.enum(["create_note", "create_reminder", "create_notification", "send_email"])`; enforce `requires_confirmation: true`, ISO expiry, bounded strings, and JSON input. Add indexes on `(user_id, status, expires_at)` and `(workspace_id, idempotency_key)`.

- [ ] **Step 4: Run contract and migration tests**

Run: `npx vitest run --config packages/contracts/vitest.config.ts packages/contracts/tests/ai-action-contracts.test.ts && npm run test --workspace @nexus/worker -- tests/ai-action-migrations.test.ts`

Expected: all focused tests pass and old migrations remain unchanged.

- [ ] **Step 5: Commit**

```text
git add packages/contracts apps/worker/migrations apps/worker/tests/ai-action-migrations.test.ts
git commit -m "feat: add AI action contracts and schema"
```

### Task 2: Worker Tool Validation And Proposal Repository

**Files:**
- Create: `apps/worker/src/ai/ai-tool-model.ts`
- Create: `apps/worker/src/ai/ai-tool-repository.ts`
- Create: `apps/worker/src/ai/ai-tool-orchestrator.ts`
- Test: `apps/worker/tests/ai-tool-orchestrator.test.ts`
- Test: `apps/worker/tests/ai-tool-repository.test.ts`

**Interfaces:**
- `AiToolOrchestrator.propose(context, toolCall): Promise<AiActionProposal>`
- `AiToolOrchestrator.confirm(context, actionId, baseRevision): Promise<AiActionResult>`
- `AiToolOrchestrator.reject(context, actionId, baseRevision): Promise<{ rejected: true }>`
- `AiToolRepository.getOwned`, `insertProposal`, `claimConfirmation`, `markCompleted`, `markRejected`, `markFailed`.

- [ ] **Step 1: Write failing tests for tool allowlisting, workspace isolation, expiry and duplicate confirmation**

```ts
it("rejects a tool call for another workspace before persisting a proposal", async () => {
  await expect(orchestrator.propose(context("ws-1"), {
    name: "create_note", arguments: { workspace_id: "ws-2", title: "x", content: "y" },
  })).rejects.toMatchObject({ code: "AI_ACTION_WORKSPACE_DENIED" });
});
```

- [ ] **Step 2: Run the focused Worker tests and verify the expected missing-symbol failures**

Run: `npm run test --workspace @nexus/worker -- tests/ai-tool-orchestrator.test.ts tests/ai-tool-repository.test.ts`

- [ ] **Step 3: Implement schema normalization and proposal persistence**

Normalize only the four tool names, strip unknown input keys, bind every query to `user_id` and `workspace_id`, and use the proposal id as the idempotency source. `claimConfirmation` must atomically require `status='pending'`, matching revision and `expires_at > now`.

- [ ] **Step 4: Run focused tests and add audit assertions**

Run: `npm run test --workspace @nexus/worker -- tests/ai-tool-orchestrator.test.ts tests/ai-tool-repository.test.ts`

Expected: cross-tenant, expired, stale, duplicate and invalid-tool cases pass; audit rows contain only action id/tool/status.

- [ ] **Step 5: Commit**

```text
git add apps/worker/src/ai apps/worker/tests/ai-tool-orchestrator.test.ts apps/worker/tests/ai-tool-repository.test.ts
git commit -m "feat: add safe AI action proposals"
```

### Task 3: Execute Note, Reminder, Notification And Email Tools

**Files:**
- Modify: `apps/worker/src/ai/ai-tool-orchestrator.ts`
- Modify: `apps/worker/src/bootstrap.ts`
- Create: `apps/worker/src/ai/ai-email-outbox-repository.ts`
- Create: `apps/worker/src/ai/ai-email-consumer.ts`
- Modify: `apps/worker/src/routes/ai.ts`
- Test: `apps/worker/tests/ai-tool-execution.test.ts`
- Test: `apps/worker/tests/ai-email-consumer.test.ts`

**Interfaces:**
- Note tool calls existing `NoteService.createNote` with a workspace context.
- Reminder tool calls existing `KnowledgeService.createReminder` with the current user context.
- Notification tool calls existing collaboration notification repository with a member-bound target.
- Email tool inserts `ai_email_outbox`; Queue consumer calls existing `ResendEmailSender` with `EMAIL_FROM`.

- [ ] **Step 1: Write failing execution tests**

Cover one successful execution per tool, viewer denial, missing note, invalid recurrence, email recipient mismatch, idempotent replay, queue retry and permanent Resend failure.

- [ ] **Step 2: Run the tests and confirm they fail before tool dispatch exists**

Run: `npm run test --workspace @nexus/worker -- tests/ai-tool-execution.test.ts tests/ai-email-consumer.test.ts`

- [ ] **Step 3: Implement dispatch through existing domain services**

Do not add direct SQL for notes/reminders/notifications. The email path writes D1 outbox state in the same transaction as the action completion; Queue delivery updates only outbox status and never changes note/reminder content.

- [ ] **Step 4: Verify focused tests and migration integration**

Run: `npm run test --workspace @nexus/worker -- tests/ai-tool-execution.test.ts tests/ai-email-consumer.test.ts tests/ai-action-migrations.test.ts`

- [ ] **Step 5: Commit**

```text
git add apps/worker/src/ai apps/worker/src/routes/ai.ts apps/worker/src/bootstrap.ts apps/worker/tests
git commit -m "feat: execute confirmed AI tools safely"
```

### Task 4: AI Chat Tool Protocol And Confirmation Routes

**Files:**
- Modify: `apps/worker/src/ai/ai-chat-service.ts`
- Modify: `apps/worker/src/routes/ai.ts`
- Modify: `packages/contracts/src/ai.ts`
- Test: `apps/worker/tests/ai-chat-tools.test.ts`
- Test: `apps/worker/tests/ai-config-routes.test.ts`

**Interfaces:**
- Provider request includes a fixed tool declaration and no internal credentials.
- Chat response may contain `{ message, action_proposals }`; legacy `{ message }` consumers remain valid.
- `POST /api/v2/ai/actions/:actionId/confirm` and `/reject` return the standard API envelope.

- [ ] **Step 1: Write failing route/provider tests**

Assert the provider receives only the four tool schemas, invalid provider tool calls are rejected, legacy text chat still works, and confirm/reject routes require the owning session.

- [ ] **Step 2: Verify the tests fail before route registration and provider tool parsing**

Run: `npm run test --workspace @nexus/worker -- tests/ai-chat-tools.test.ts tests/ai-config-routes.test.ts`

- [ ] **Step 3: Implement bounded tool protocol and routes**

Keep provider timeout/body limits. Parse tool arguments with the contracts schema, call `propose`, and return proposals without executing side effects.

- [ ] **Step 4: Run focused tests**

Run: `npm run test --workspace @nexus/worker -- tests/ai-chat-tools.test.ts tests/ai-config-routes.test.ts`

- [ ] **Step 5: Commit**

```text
git add apps/worker/src/ai apps/worker/src/routes/ai.ts packages/contracts/src/ai.ts apps/worker/tests
git commit -m "feat: expose AI tool proposal routes"
```

### Task 5: Web AI Action Cards And Client Methods

**Files:**
- Modify: `apps/web/src/ai/AIChatPanel.tsx`
- Modify: `apps/web/src/data/api-client.ts`
- Create: `apps/web/src/ai/AIActionCard.tsx`
- Test: `apps/web/tests/ai-action-card.test.tsx`
- Test: `apps/web/tests/ai-chat-panel.test.tsx`

**Interfaces:**
- Add `ApiClient.confirmAiAction(actionId, baseRevision)` and `rejectAiAction(...)`.
- `AIActionCard` accepts a typed `AiActionProposal` and emits confirm/reject callbacks.

- [ ] **Step 1: Write failing component/client tests**

Cover keyboard-accessible confirmation, email recipient/body preview, reject state, expired state, server failure retry and no API key/prompt persistence in local storage.

- [ ] **Step 2: Verify the tests fail because proposals are not rendered or confirmed**

Run: `npx vitest run --config apps/web/vitest.config.ts apps/web/tests/ai-action-card.test.tsx apps/web/tests/ai-chat-panel.test.tsx`

- [ ] **Step 3: Implement the card and client methods**

Render proposals in the chat transcript, keep action state local to the panel, disable duplicate clicks, and update only the action card after confirmation.

- [ ] **Step 4: Run focused Web tests**

Run: `npx vitest run --config apps/web/vitest.config.ts apps/web/tests/ai-action-card.test.tsx apps/web/tests/ai-chat-panel.test.tsx`

- [ ] **Step 5: Commit**

```text
git add apps/web/src/ai apps/web/src/data/api-client.ts apps/web/tests
git commit -m "feat: add AI action confirmation cards"
```

### Task 6: Navigation And Query Responsiveness

**Files:**
- Modify: `apps/web/src/app/App.tsx`
- Modify: `apps/web/src/app/workspace-domain-loader.ts`
- Modify: `apps/web/src/data/api-client.ts`
- Modify: `apps/web/src/data/database-client.ts`
- Test: `apps/web/tests/workspace-performance.test.tsx`
- Test: `apps/web/tests/api-client.test.ts`
- Test: `apps/web/tests/database-client.test.ts`

**Interfaces:**
- Navigation state commits synchronously; lazy module preloading is non-blocking.
- Query cache entries are workspace-scoped and stale-while-revalidate; aborted requests never clear visible data.

- [ ] **Step 1: Add failing timing/cache tests**

Assert a click renders the target shell before a deferred lazy import resolves, cached database/account/reminder data is shown without a second request within TTL, and a late aborted request cannot replace another workspace's data.

- [ ] **Step 2: Run focused tests and verify the new timing assertions fail**

Run: `npx vitest run --config apps/web/vitest.config.ts apps/web/tests/workspace-performance.test.tsx apps/web/tests/api-client.test.ts apps/web/tests/database-client.test.ts`

- [ ] **Step 3: Implement only the required cache/dedupe/request-lifecycle changes**

Use stable client instances, preserve stale data during refresh, and move preloading to idle/hover/focus. Do not add a second scroll owner or increase initial bundle size.

- [ ] **Step 4: Run focused tests and build readiness**

Run: `npx vitest run --config apps/web/vitest.config.ts apps/web/tests/workspace-performance.test.tsx apps/web/tests/api-client.test.ts apps/web/tests/database-client.test.ts && npm run beta:build && npm run verify:deploy`

- [ ] **Step 5: Commit**

```text
git add apps/web/src apps/web/tests
git commit -m "perf: reduce page transition latency"
```

### Task 7: Full Verification And Preview Deployment

**Files:**
- Modify: `docs/feature-parity-matrix.md`
- Modify: `docs/preview-acceptance-handoff.md`
- Modify: `docs/ai-chat-configuration.md`
- Test: existing root/Beta/Worker test suites

- [ ] **Step 1: Run all local gates**

```text
npm run lint
npm test
npm run beta:lint
npm run beta:test
npm run beta:build
npm run test:fault
npm run test:perf
npm run verify:deploy
npm run verify:preview
npm audit --omit=dev
```

- [ ] **Step 2: Run Preview online health, headers, 390px shell and load gates**

Use the Preview URL and keep AI disabled until a real provider is configured.

- [ ] **Step 3: Run real authenticated action smoke with a browser profile outside the repository**

Verify create note, reminder, notification and system email proposal/confirm/retry paths. Do not store credentials, cookies or email body artifacts.

- [ ] **Step 4: Update evidence and commit**

```text
git add docs
git commit -m "docs: record AI tools and performance gates"
```

- [ ] **Step 5: Push a new PR and deploy only after CI is green**

Use `git push -u origin codex/ai-tools-performance`, create a separate PR, and keep production unchanged until the new PR and Preview gates pass.
