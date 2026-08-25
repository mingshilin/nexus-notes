# Nexus Notes Entry And Account Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make creation and account-management actions immediately discoverable on desktop and mobile while preserving the existing Nexus Notes visual language and behavior.

**Architecture:** Keep `ProductNavigation` presentational and keep business actions in `App`. Expose one persistent visual `创建内容` action with accessible name `创建中心`, retain the existing `个人资料与设置` shortcut in every responsive navigation mode, and keep `CreateCenter` and `AccountCenter` as the action destinations. Use accessible labels and a single mobile scroll owner so the new controls do not cover the canvas.

**Tech Stack:** React, TypeScript, Vite, Vitest, Testing Library, existing CSS layout tokens and Lucide icons.

## Global Constraints

- Preserve the existing visual language, API URLs, database schema, and account behavior.
- Do not remove or rename existing `aria-label` values used by current tests unless the replacement is backward-compatible.
- Do not add API keys, sessions, database files, or build output to Git.
- Desktop and 390px mobile must keep one main scroll owner and no fixed control may cover editor content.
- Every behavior change must have a failing test before production code is changed.

---

### Task 1: Lock The Discoverability Contract

**Files:**
- Modify: `apps/web/tests/product-navigation.test.tsx`
- Modify: `apps/web/tests/core-ux-mobile.test.tsx`
- Test: the existing navigation test files above

**Interfaces:**
- Consumes: `ProductNavigation` props `onCreateNote`, `onCreateCenter`, `onPersonalCenter`, `onContextToggle`, and `mode`.
- Produces: a stable visual `创建内容` trigger with accessible name `创建中心` in addition to the existing `新建笔记` shortcut, while retaining the existing `个人资料与设置` shortcut for desktop and mobile entry points.

- [x] **Step 1: Write the failing tests**

Add one desktop assertion to the existing product-navigation suite. Keep the existing `新建笔记` and `个人资料与设置` assertions unchanged, and add a separate create-center callback:

```tsx
it("exposes creation and account actions without relying on icon recognition", () => {
  const onCreateCenter = vi.fn();
  const onAccount = vi.fn();
  render(<ProductNavigation
    active="notes"
    user={user}
    unreadCount={0}
    collaborationEnabled
    notificationsEnabled
    onChange={vi.fn()}
    onCreateCenter={onCreateCenter}
    onPersonalCenter={onAccount}
    onNotifications={vi.fn()}
    onLogout={vi.fn()}
  />);

  fireEvent.click(screen.getByRole("button", { name: "创建中心" }));
  fireEvent.click(screen.getByRole("button", { name: "个人资料与设置" }));
  expect(onCreateCenter).toHaveBeenCalledTimes(1);
  expect(onAccount).toHaveBeenCalledTimes(1);
});
```

Add a mobile assertion that renders the same component with `mode="mobile"` and verifies one enabled visual `创建内容` action with accessible name `创建中心` and the existing `个人资料与设置` action remain reachable without opening the context list.

- [x] **Step 2: Run the focused tests and verify the expected failure**

Run:

```text
npm run test --workspace @nexus/web -- product-navigation.test.tsx core-ux-mobile.test.tsx
```

Expected failure: the current navigation has no `创建中心` callback/button; the existing account shortcut remains named `个人资料与设置`.

### Task 2: Implement Persistent Creation And Account Actions

**Files:**
- Modify: `apps/web/src/navigation/ProductNavigation.tsx`
- Modify: `apps/web/src/app/App.tsx`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- Consumes: existing `CreateCenter`, `AccountCenter`, `onCreateNote`, `onPersonalCenter`, `mode`, and `workbenchModalOpen` state.
- Produces: an accessible `创建中心` button whose visible text is `创建内容`, plus the existing `新建笔记` and `个人资料与设置` actions, with no duplicated modal or account logic.

- [x] **Step 1: Add the smallest navigation implementation**

Add optional `onCreateCenter?(): void` to `ProductNavigationProps`. Render a clearly labeled `创建内容` button with accessible name `创建中心` that calls it, while retaining the existing direct `新建笔记` button and `个人资料与设置` shortcut for backward compatibility. Add `onCreateCenter={() => setCreateCenterOpen(true)}` from `App`; the existing `CreateCenter` remains the only modal.

- [x] **Step 2: Reserve layout space instead of overlaying the canvas**

Update the existing navigation CSS so the new labels fit within the rail/mobile chrome using the current spacing variables. Use `min-width`, `overflow`, and safe-area padding on the navigation container; do not use a higher `z-index` as the primary fix for content overlap.

- [x] **Step 3: Run the focused tests and verify the expected pass**

Run:

```text
npm run test --workspace @nexus/web -- product-navigation.test.tsx core-ux-mobile.test.tsx
```

Expected: all focused tests pass, including the new desktop and mobile discoverability assertions.

### Task 3: Verify The Destinations End To End

**Files:**
- Modify: `apps/web/tests/live-notes-flow.test.tsx`
- Modify: `apps/web/tests/product-navigation.test.tsx`

**Interfaces:**
- Consumes: `App` callbacks that open `CreateCenter` and `AccountCenter`.
- Produces: regression coverage that a user can create a note and reach profile/security without keyboard shortcuts.

- [x] **Step 1: Add failing integration assertions**

Cover these exact flows:

```tsx
fireEvent.click(within(screen.getByRole("navigation", { name: "主导航" })).getByRole("button", { name: "创建中心" }));
expect(await screen.findByRole("dialog", { name: "创建内容" })).toBeInTheDocument();
fireEvent.click(screen.getByRole("button", { name: "新建笔记" }));
expect(await screen.findByRole("textbox", { name: "笔记标题" })).toBeInTheDocument();
```

Then open `个人资料与设置`, assert the `账户中心` heading, select `个人资料` and `安全`, and assert their panel headings.

- [x] **Step 2: Run the integration tests and confirm the failure is about the missing user path**

Run:

```text
npm run test --workspace @nexus/web -- product-navigation.test.tsx live-notes-flow.test.tsx
```

- [x] **Step 3: Wire only the existing callbacks**

Ensure `ProductNavigation` opens the existing `CreateCenter` trigger/action and `openAccountSubsection("personal")`; do not duplicate modal state or account mutation logic.

- [x] **Step 4: Run the integration tests again**

Expected: creation opens a note editor and the account path reaches both profile and security panels without direct URL navigation.

### Task 4: Release Gates For Stage 1

**Files:**
- Verify: `apps/web/src/navigation/ProductNavigation.tsx`
- Verify: `apps/web/src/app/App.tsx`
- Verify: `apps/web/src/styles.css`
- Verify: `apps/web/tests/product-navigation.test.tsx`
- Verify: `apps/web/tests/core-ux-mobile.test.tsx`
- Verify: `apps/web/tests/live-notes-flow.test.tsx`

- [x] **Step 1: Run the complete frontend regression**

```text
npm run test --workspace @nexus/web
```

- [x] **Step 2: Run type checks and build gates**

```text
npm run lint
npm run build
npm run verify:deploy
git diff --check
```

- [x] **Step 3: Verify the artifact contract**

Check `apps/web/dist/index.html` and confirm it does not contain initial `markdown-vendor`, `ocr-vendor`, or `ai-vendor` modulepreload entries and that the main JavaScript chunk remains below 500 kB.

- [x] **Step 4: Record the stage result**

Update the product parity matrix with the desktop/mobile entry evidence before starting the next stage. Do not deploy or push this worktree as part of Stage 1.
