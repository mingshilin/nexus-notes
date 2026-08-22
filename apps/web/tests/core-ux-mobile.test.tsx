import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/app/App";
import { AdaptiveWorkbench } from "../src/layout/AdaptiveWorkbench";
import "../src/styles.css";

const session = {
  user: { id: "user-1", email: "user@example.test", displayName: "用户" },
  workspaces: [{ id: "ws-1", name: "个人", slug: "personal", role: "owner" as const, revision: 1 }],
  active_workspace_id: "ws-1",
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  return { promise: new Promise<T>((next) => { resolve = next; }), resolve };
}

function draftStore() {
  const drafts = new Map<string, unknown>();
  return {
    saveDraft: vi.fn(async (draft: { workspace_id: string; entity_id: string }) => {
      drafts.set(`${draft.workspace_id}:${draft.entity_id}`, draft);
    }),
    mutateDraft: vi.fn(async () => null),
    getDraft: vi.fn(async () => null),
    listDrafts: vi.fn(async () => []),
    removeDraft: vi.fn(async () => undefined),
    destroy: vi.fn(async () => undefined),
  };
}

function renderMobile(options: { api?: ReturnType<typeof mobileApi>; localStore?: ReturnType<typeof draftStore> } = {}) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
  Object.defineProperty(window, "visualViewport", {
    configurable: true,
    value: { height: 844, offsetTop: 0, addEventListener: vi.fn(), removeEventListener: vi.fn() },
  });
  const api = options.api ?? mobileApi();
  const localStore = options.localStore ?? draftStore();
  return { ...render(<App authClient={{ session: vi.fn(async () => session) } as any} apiClient={api as any} localStore={localStore as any} turnstileSiteKey="test" />), api, localStore };
}

function mobileApi(createResponse: Promise<unknown> | unknown = { note: { id: "note-1", workspace_id: "ws-1", title: "", content: "", status: "active", revision: 1, created_at: "2026-08-23T00:00:00.000Z", updated_at: "2026-08-23T00:00:00.000Z" } }) {
  return {
    request: vi.fn(async (input: { path: string; method?: string }) => {
      if (input.path === "/api/v2/notes" && input.method === "POST") return await createResponse;
      if (input.path === "/api/v2/notes?limit=50") return { items: [], next_cursor: null };
      if (input.path === "/api/v2/profile") return { id: "user-1", email: "user@example.test", display_name: "用户", biography: "", locale: "zh-CN", timezone: "Asia/Shanghai", avatar_url: null, updated_at: "2026-08-23T00:00:00.000Z" };
      if (input.path === "/api/v2/profile/sessions") return { items: [] };
      if (input.path.startsWith("/api/v2/attachments") || input.path.startsWith("/api/v2/knowledge/diagnostics")) return { items: [], next_cursor: null };
      if (input.path.startsWith("/api/v2/notifications/unread")) return { unread_count: 0 };
      if (input.path === "/api/v2/members") return { items: [] };
      if (input.path.startsWith("/api/v2/operations/")) return { notes: 0, databases: 0, attachment_bytes: 0, queued_jobs: 0, queue: "ready", storage: "ready", ocr: "ready", version: "test" };
      return { items: [], next_cursor: null };
    }),
  };
}

function scrollOwners() {
  return [...document.querySelectorAll<HTMLElement>(".adaptive-workbench *")].filter((element) => {
    const style = getComputedStyle(element);
    return style.overflowY === "auto" || style.overflowY === "scroll";
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  document.documentElement.style.removeProperty("--keyboard-inset");
});

describe("core UX mobile", () => {
  it("keeps one computed page scroll owner across notes, database, knowledge, and account at 390px", async () => {
    renderMobile();
    expect(await screen.findByRole("button", { name: "新建笔记" })).toBeVisible();
    expect(screen.getByRole("button", { name: "账户" })).toBeVisible();
    expect(screen.getAllByRole("navigation", { name: "移动端主导航" })).toHaveLength(1);
    expect(scrollOwners()).toHaveLength(1);

    for (const domain of ["数据库", "知识整理", "设置"] as const) {
      fireEvent.click(screen.getByRole("button", { name: domain }));
      if (domain === "设置") await screen.findByRole("heading", { name: "账户中心" });
      expect(scrollOwners()).toHaveLength(1);
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390);
    }
  });

  it("renders one mobile create action and suppresses it with navigation during modal and text focus", async () => {
    const { api } = renderMobile();
    const fab = await screen.findByRole("button", { name: "新建笔记" });
    expect(screen.getAllByRole("button", { name: "新建笔记" })).toHaveLength(1);

    fireEvent.click(fab);
    const title = await screen.findByRole("textbox", { name: "笔记标题" });
    const navigation = screen.getByRole("navigation", { name: "移动端主导航" });
    expect(title).toHaveFocus();
    fireEvent.focus(title);
    expect(navigation).toHaveAttribute("data-visible", "false");
    fireEvent.blur(title);
    expect(navigation).toHaveAttribute("data-visible", "true");
    const content = await screen.findByRole("textbox", { name: "笔记内容" });
    fireEvent.focus(content);
    expect(navigation).toHaveAttribute("data-visible", "false");
    const fabChrome = fab.closest(".mobile-create-note") as HTMLElement;
    expect(fabChrome).toHaveAttribute("aria-hidden", "true");
    expect(fabChrome).toHaveAttribute("inert");
    expect(fabChrome).toHaveStyle({ visibility: "hidden", pointerEvents: "none" });

    fireEvent.blur(content);
    expect(navigation).toHaveAttribute("data-visible", "true");
    expect(fabChrome).toHaveAttribute("data-visible", "true");

    const opener = screen.getByRole("button", { name: "打开检查器" });
    fireEvent.click(opener);
    expect(screen.getByRole("dialog", { name: "检查器" })).toBeInTheDocument();
    expect(navigation).toHaveAttribute("data-visible", "false");
    expect(fabChrome).toHaveAttribute("data-visible", "false");
    fireEvent.click(screen.getByRole("button", { name: "关闭检查器" }));
    expect(opener).toHaveFocus();
    expect(api.request).toHaveBeenCalled();
  });

  it("hides and restores chrome for password and file inputs", async () => {
    renderMobile();
    fireEvent.click(await screen.findByRole("button", { name: "设置" }));
    await screen.findByRole("heading", { name: "账户中心" });
    fireEvent.click(screen.getByRole("tab", { name: "安全" }));
    const navigation = screen.getByRole("navigation", { name: "移动端主导航" });
    const password = await screen.findByLabelText("当前密码");
    fireEvent.focus(password);
    expect(navigation).toHaveAttribute("data-visible", "false");
    fireEvent.blur(password);
    expect(navigation).toHaveAttribute("data-visible", "true");

    fireEvent.click(screen.getByRole("tab", { name: "个人资料" }));
    const file = await screen.findByLabelText("头像文件");
    fireEvent.focus(file);
    expect(navigation).toHaveAttribute("data-visible", "false");
    fireEvent.blur(file);
    expect(navigation).toHaveAttribute("data-visible", "true");
  });

  it("activates the mobile FAB once and suppresses duplicate durable draft creation", async () => {
    const create = deferred<unknown>();
    const api = mobileApi(create.promise);
    const localStore = draftStore();
    renderMobile({ api, localStore });
    const fab = await screen.findByRole("button", { name: "新建笔记" });
    fireEvent.click(fab);
    fireEvent.click(fab);
    await waitFor(() => expect(localStore.saveDraft).toHaveBeenCalledOnce());
    expect(api.request.mock.calls.filter(([input]) => input.path === "/api/v2/notes" && input.method === "POST")).toHaveLength(0);
    create.resolve({ note: { id: "note-1", workspace_id: "ws-1", title: "", content: "", status: "active", revision: 1, created_at: "2026-08-23T00:00:00.000Z", updated_at: "2026-08-23T00:00:00.000Z" } });
    await waitFor(() => expect(screen.getByRole("textbox", { name: "笔记标题" })).toBeInTheDocument());
    expect(localStore.saveDraft).toHaveBeenCalledOnce();
  });

  it("updates the keyboard inset from visualViewport", () => {
    const viewport = { height: 500, offsetTop: 0, addEventListener: vi.fn(), removeEventListener: vi.fn() };
    Object.defineProperty(window, "visualViewport", { configurable: true, value: viewport });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 844 });
    render(<AdaptiveWorkbench mode="mobile" navigation="Navigation" mobileNavigation="Mobile navigation" inspectorOpen={false} onInspectorClose={vi.fn()}>Editor</AdaptiveWorkbench>);
    expect(document.documentElement.style.getPropertyValue("--keyboard-inset")).toBe("344px");
    expect(viewport.addEventListener).toHaveBeenCalledWith("resize", expect.any(Function));
  });
});
