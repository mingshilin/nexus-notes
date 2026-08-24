# Nexus AI Assistant Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing Worker-proxied AI assistant discoverable, recoverable, and safe to operate with a provider configured outside the browser.

**Architecture:** Keep `AIChatPanel` as the browser conversation surface and keep provider credentials inside `AiChatService` in the Worker. Add bounded client-side interaction helpers only; all provider calls continue through `/api/v2/ai/status` and `/api/v2/ai/chat`.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, Cloudflare Worker, Zod contracts, Vite.

## Global Constraints

- `AI_CHAT_API_KEY` must never be exposed to the browser, `.env.production`, Git, or build output.
- Provider URL must be HTTPS and the model must be non-empty and at most 128 characters.
- AI failures must preserve the current draft and must not block note editing, database editing, or offline sync.
- Conversation input remains limited to 20 messages and 32,000 characters; one message remains limited to 4,000 characters.
- Existing `/api/v2/ai/status` and `/api/v2/ai/chat` response shapes remain unchanged.
- No production Worker deployment, secret write, remote migration, domain switch, or GitHub PR operation is part of this phase.

---

### Task 1: Lock AI Conversation Interaction Behavior

**Files:**
- Modify: `apps/web/tests/ai-chat-panel.test.tsx`
- Modify: `apps/web/src/ai/AIChatPanel.tsx`

**Interfaces:**
- Consumes: `ApiClient.request`, `AiChatMessage`, and existing `workspaceId` prop.
- Produces: visible quick-prompt buttons, a `清空对话` action after the first message, and retained draft/error state after a failed send.

- [x] **Step 1: Add failing tests**

Add these behaviors to the existing panel test suite:

```tsx
it("fills a quick prompt without sending it", async () => {
  const client = { request: vi.fn(async () => ({ configured: true })) };
  render(<AIChatPanel client={client as any} workspaceId="ws-1" showStatus />);

  fireEvent.click(await screen.findByRole("button", { name: "制定今日计划" }));

  expect(screen.getByRole("textbox", { name: "输入问题" })).toHaveValue("制定今日计划");
  expect(client.request).toHaveBeenCalledWith(expect.objectContaining({ path: "/api/v2/ai/status" }));
  expect(client.request).not.toHaveBeenCalledWith(expect.objectContaining({ path: "/api/v2/ai/chat" }));
});

it("clears a completed conversation without clearing the provider status", async () => {
  const client = { request: vi.fn()
    .mockResolvedValueOnce({ configured: true })
    .mockResolvedValueOnce({ message: "已完成", model: "test-model" }) };
  render(<AIChatPanel client={client as any} workspaceId="ws-1" showStatus />);
  const input = await screen.findByRole("textbox", { name: "输入问题" });
  fireEvent.change(input, { target: { value: "测试问题" } });
  fireEvent.click(screen.getByRole("button", { name: "发送" }));
  expect(await screen.findByText("已完成")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "清空对话" }));
  expect(screen.queryByText("已完成")).not.toBeInTheDocument();
  expect(screen.getByText("AI 服务已连接，可以开始对话。")).toBeInTheDocument();
});
```

- [x] **Step 2: Run the focused test and verify the expected failure**

Run:

```text
npm run test --workspace @nexus/web -- ai-chat-panel.test.tsx
```

Expected: the test fails because quick-prompt and clear-conversation buttons do not exist.

- [x] **Step 3: Implement the smallest UI behavior**

Add constants and handlers inside `AIChatPanel`:

```tsx
const QUICK_PROMPTS = ["制定今日计划", "整理我的任务", "如何改进这篇笔记"] as const;

const clearConversation = () => {
  setMessages([]);
  setError(null);
};
```

Render quick prompts only when `messages.length === 0`, and render this button in the heading when `messages.length > 0`:

```tsx
<button type="button" onClick={clearConversation}>清空对话</button>
```

Quick-prompt buttons set `draft` and focus the textarea through an existing local ref; they do not issue a network request.

- [x] **Step 4: Run the focused test and verify it passes**

Run the same command. Expected: all AI panel tests pass.

---

### Task 2: Make AI Requests Abortable And Recoverable

**Files:**
- Modify: `apps/web/tests/ai-chat-panel.test.tsx`
- Modify: `apps/web/src/ai/AIChatPanel.tsx`

**Interfaces:**
- Consumes: existing `ApiClient.request` policy signal support.
- Produces: abort-safe request lifecycle and no state updates after unmount or workspace change.

- [x] **Step 1: Add a failing abort test**

```tsx
it("aborts a pending chat when the panel unmounts", async () => {
  let resolveRequest!: (value: { message: string; model: string }) => void;
  const request = vi.fn((input: { path: string; policy?: { signal?: AbortSignal } }) => input.path === "/api/v2/ai/chat"
    ? new Promise<{ message: string; model: string }>((resolve) => { resolveRequest = resolve; })
    : Promise.resolve({ configured: true }));
  const view = render(<AIChatPanel client={{ request } as any} workspaceId="ws-1" showStatus />);
  const input = await screen.findByRole("textbox", { name: "输入问题" });
  fireEvent.change(input, { target: { value: "测试" } });
  fireEvent.click(screen.getByRole("button", { name: "发送" }));
  await waitFor(() => expect(request).toHaveBeenCalledWith(expect.objectContaining({ path: "/api/v2/ai/chat" })));
  const signal = request.mock.calls.find(([value]) => value.path === "/api/v2/ai/chat")?.[0].policy.signal as AbortSignal;
  view.unmount();
  expect(signal.aborted).toBe(true);
  resolveRequest({ message: "过期响应", model: "test-model" });
  await Promise.resolve();
});
```

- [x] **Step 2: Run the focused test and verify it fails**

Run `npm run test --workspace @nexus/web -- ai-chat-panel.test.tsx`. Expected: the signal is missing or not aborted.

- [x] **Step 3: Implement abort lifecycle**

Create an `AbortController` per chat request, pass `policy.signal`, abort it in an effect cleanup and before a new request, and ignore `AbortError` without replacing the retained draft with a generic failure.

- [x] **Step 4: Run focused AI tests**

Run `npm run test --workspace @nexus/web -- ai-chat-panel.test.tsx`. Expected: all tests pass with no unhandled rejection.

---

### Task 3: Enforce Provider Configuration And Secret Boundaries

**Files:**
- Modify: `apps/worker/tests/ai-chat.test.ts`
- Modify: `apps/web/tests/ai-chat-panel.test.tsx`
- Modify: `docs/ai-chat-configuration.md`
- Verify: `.env.example`, `apps/worker/wrangler.preview.example.toml`

**Interfaces:**
- Consumes: `AiChatService.status()`, `AiChatService.chat()`, and existing status/chat routes.
- Produces: explicit configuration diagnostics and documentation that only uses Worker variables plus a Worker Secret.

- [x] **Step 1: Add provider-boundary assertions**

Assert that an invalid HTTP URL returns `configured: false`, an empty model returns `configured: false`, provider calls use `authorization: Bearer <key>` only inside the Worker fetch mock, and no Web test DOM contains a key-like value.

- [x] **Step 2: Run Worker AI tests and verify the new assertions**

Run `npm run test --workspace @nexus/worker -- ai-chat.test.ts`. Expected: existing tests pass and any missing boundary assertion fails before implementation.

- [x] **Step 3: Keep configuration documentation explicit**

Document exactly:

```text
AI_CHAT_API_URL=https://provider.example/v1/chat/completions
AI_CHAT_MODEL=provider-model
npx wrangler secret put AI_CHAT_API_KEY
```

State that the key must not be written to `VITE_*`, `.env.production`, `wrangler.toml`, Git, or browser storage.

- [x] **Step 4: Run Worker AI tests and secret scan**

Run:

```text
npm run test --workspace @nexus/worker -- ai-chat.test.ts
rg -n --hidden --glob '!node_modules/**' --glob '!apps/web/dist/**' '(sk-[A-Za-z0-9_-]{20,}|Bearer [A-Za-z0-9._-]{20,})' apps packages docs scripts
```

Expected: Worker tests pass and the scan returns no real key-like value.

---

### Task 4: Release Gates For AI Phase 2

**Files:**
- Verify: `apps/web/src/ai/AIChatPanel.tsx`
- Verify: `apps/worker/src/ai/ai-chat-service.ts`
- Verify: `apps/worker/src/routes/ai.ts`
- Verify: `packages/contracts/src/ai.ts`

- [x] **Step 1: Run Web and Worker targeted tests**

```text
npm run test --workspace @nexus/web -- ai-chat-panel.test.tsx note-ai-actions.test.tsx
npm run test --workspace @nexus/worker -- ai-chat.test.ts
```

- [x] **Step 2: Run full gates**

```text
npm run lint
npm run test --workspace @nexus/web
npm run test --workspace @nexus/worker
npm run build
npm run verify:deploy
npm run verify:preview
git diff --check
```

- [x] **Step 3: Verify lazy loading and secret boundaries**

Confirm `apps/web/dist/index.html` has no initial `markdown-vendor`, `ocr-vendor`, or `ai-vendor` modulepreload and that the generated browser JavaScript does not contain a provider key.

- [x] **Step 4: Stop before external writes**

Do not run `wrangler secret put`, remote migration, `wrangler deploy`, domain routing, GitHub push, PR merge, or tag creation until the user supplies provider configuration through the approved secret channel and explicitly authorizes release operations.
