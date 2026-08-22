import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/app/App";
import type { LocalDraft } from "../src/data/local-store";
import { AdaptiveWorkbench } from "../src/layout/AdaptiveWorkbench";
import { ProductNavigation, type ProductDomain } from "../src/navigation/ProductNavigation";

const user = { id: "u1", email: "u@example.test", displayName: "用户" };

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});

function navigationProps(overrides: Partial<Parameters<typeof ProductNavigation>[0]> = {}) {
  return {
    active: "notes" as ProductDomain,
    user,
    unreadCount: 0,
    collaborationEnabled: true,
    notificationsEnabled: true,
    onChange: vi.fn(),
    onPersonalCenter: vi.fn(),
    onNotifications: vi.fn(),
    onWorkspace: vi.fn(),
    onLogout: vi.fn(),
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  return {
    promise: new Promise<T>((next, fail) => { resolve = next; reject = fail; }),
    resolve,
    reject,
  };
}

function authenticatedSession() {
  return {
    user,
    workspaces: [{ id: "ws-1", name: "Personal", slug: "personal", role: "owner" as const, revision: 1 }],
    active_workspace_id: "ws-1",
  };
}

function appApiClient() {
  return {
    request: vi.fn(async (request: { path: string }) => {
      if (request.path === "/api/v2/notifications/unread") return { unread_count: 0 };
      return { items: [], next_cursor: null };
    }),
  };
}

function draftStore() {
  return {
    saveDraft: vi.fn(async () => undefined),
    mutateDraft: vi.fn(async () => null),
    getDraft: vi.fn(async () => null),
    listDrafts: vi.fn(async () => []),
    removeDraft: vi.fn(async () => undefined),
    destroy: vi.fn(async () => undefined),
  };
}

function note(overrides: Partial<{ id: string; title: string; content: string; revision: number }> = {}) {
  return {
    id: "server-1", workspace_id: "ws-1", folder_id: null, database_id: null, created_by: "u1", updated_by: "u1",
    title: "", content: "", status: "active" as const, is_favorite: false, is_pinned: false, daily_date: null,
    revision: 1, created_at: "2026-08-23T00:00:00.000Z", updated_at: "2026-08-23T00:00:00.000Z", ...overrides,
  };
}

function durableDraftStore(order: string[] = []) {
  const drafts = new Map<string, LocalDraft>();
  let nextMutationGate: { promise: Promise<void>; completed(): void } | null = null;
  const store = {
    saveDraft: vi.fn(async (draft: LocalDraft) => { drafts.set(`${draft.workspace_id}:${draft.entity_id}`, { ...draft }); }),
    mutateDraft: vi.fn(async (workspaceId: string, entityId: string, mutation: (current: LocalDraft | null) => LocalDraft | null | undefined) => {
      const gate = nextMutationGate;
      nextMutationGate = null;
      if (gate) {
        await gate.promise;
        gate.completed();
      }
      const key = `${workspaceId}:${entityId}`;
      const current = drafts.get(key) ?? null;
      const next = mutation(current ? { ...current } : null);
      if (next === undefined) return current ? { ...current } : null;
      if (next === null) { drafts.delete(key); return null; }
      drafts.set(key, { ...next });
      return { ...next };
    }),
    getDraft: vi.fn(async (workspaceId: string, entityId: string) => drafts.get(`${workspaceId}:${entityId}`) ?? null),
    listDrafts: vi.fn(async (workspaceId: string) => [...drafts.values()].filter((draft) => draft.workspace_id === workspaceId)),
    removeDraft: vi.fn(async (workspaceId: string, entityId: string) => { drafts.delete(`${workspaceId}:${entityId}`); }),
    destroy: vi.fn(async () => { order.push(screen.queryByRole("navigation") ? "destroy-visible" : "destroy-hidden"); }),
    blockNextMutation(promise: Promise<void>) {
      nextMutationGate = { promise, completed: () => order.push("write") };
    },
  };
  return store;
}

function noteFlowApi(createNote: Promise<ReturnType<typeof note>>) {
  return {
    request: vi.fn(async (request: { path: string; method?: string; body?: Record<string, unknown> }) => {
      if (request.path.startsWith("/api/v2/attachments") || request.path.startsWith("/api/v2/knowledge/diagnostics")) return { items: [], next_cursor: null };
      if (request.path === "/api/v2/notifications/unread") return { unread_count: 0 };
      if (request.path === "/api/v2/notes?limit=50") return { items: [], next_cursor: null };
      if (request.path === "/api/v2/notes" && request.method === "POST") return { note: await createNote };
      if (request.path.startsWith("/api/v2/notes/") && request.method === "PATCH") {
        return { note: note({ title: String(request.body?.title ?? ""), content: String(request.body?.content ?? ""), revision: 2 }) };
      }
      return { items: [], next_cursor: null };
    }),
  };
}

describe("ProductNavigation", () => {
  it("uses direct Chinese destinations and exact domain callbacks", () => {
    const props = navigationProps();
    render(<ProductNavigation {...props} />);

    const destinations: Array<[string, ProductDomain]> = [
      ["笔记", "notes"],
      ["数据库", "databases"],
      ["知识整理", "knowledge"],
      ["协作", "collaboration"],
      ["AI 助手", "ai"],
      ["设置", "account"],
    ];
    for (const [label, domain] of destinations) {
      const button = screen.getByRole("button", { name: label });
      expect(button).toBeVisible();
      fireEvent.click(button);
      expect(props.onChange).toHaveBeenLastCalledWith(domain);
    }
    expect(screen.queryByText("收集")).not.toBeInTheDocument();
  });

  it("exposes active state and honest collaboration unavailability", () => {
    const props = navigationProps({ active: "knowledge", collaborationEnabled: false });
    render(<ProductNavigation {...props} />);

    expect(screen.getByRole("button", { name: "知识整理" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "知识整理" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "笔记" })).toHaveAttribute("aria-pressed", "false");
    const collaboration = screen.getByRole("button", { name: "协作" });
    expect(collaboration).not.toBeDisabled();
    expect(collaboration).not.toHaveAttribute("aria-disabled");
    expect(collaboration).toHaveClass("unavailable");
    expect(collaboration).toHaveAccessibleDescription("协作功能当前未开启");
    const descriptionId = collaboration.getAttribute("aria-describedby");
    expect(descriptionId).toBeTruthy();
    expect(document.getElementById(descriptionId!)).toHaveTextContent("协作功能当前未开启");
    expect(screen.getByText("未开启")).toBeVisible();
    fireEvent.click(collaboration);
    expect(props.onChange).toHaveBeenCalledWith("collaboration");
  });

  it("disables unavailable notifications honestly and skips them in roving menu focus", () => {
    const props = navigationProps({ notificationsEnabled: false });
    render(<ProductNavigation {...props} />);
    const trigger = screen.getByRole("button", { name: "账户" });
    fireEvent.click(trigger);

    const personal = screen.getByRole("menuitem", { name: "个人中心" });
    const notifications = screen.getByRole("menuitem", { name: "通知，当前不可用" });
    const workspace = screen.getByRole("menuitem", { name: "工作区" });
    expect(notifications).toBeDisabled();
    expect(notifications).toHaveAttribute("aria-disabled", "true");
    expect(notifications).toHaveAttribute("tabindex", "-1");
    expect(personal).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "ArrowDown" });
    expect(workspace).toHaveFocus();
    expect(workspace).toHaveAttribute("tabindex", "0");
    expect(personal).toHaveAttribute("tabindex", "-1");
    fireEvent.click(notifications);
    expect(props.onNotifications).not.toHaveBeenCalled();
  });

  it("uses one roving tab stop and closes on Tab or Shift+Tab with trigger focus restored", () => {
    const props = navigationProps();
    render(<ProductNavigation {...props} />);
    const trigger = screen.getByRole("button", { name: "账户" });
    fireEvent.click(trigger);
    const menu = screen.getByRole("menu");
    const items = screen.getAllByRole("menuitem");
    expect(menu).not.toContainElement(screen.getByText(user.email));
    expect(items.filter((item) => item.tabIndex === 0)).toHaveLength(1);
    expect(items[0]).toHaveFocus();

    fireEvent.keyDown(menu, { key: "End" });
    expect(screen.getByRole("menuitem", { name: "退出登录" })).toHaveFocus();
    expect(items.filter((item) => item.tabIndex === 0)).toHaveLength(1);
    fireEvent.keyDown(menu, { key: "Home" });
    expect(screen.getByRole("menuitem", { name: "个人中心" })).toHaveFocus();
    fireEvent.keyDown(menu, { key: "Tab" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();

    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Tab", shiftKey: true });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("labels unread notifications and dispatches account actions once", () => {
    const props = navigationProps({ unreadCount: 7 });
    render(<ProductNavigation {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "账户" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "个人中心" }));
    expect(props.onPersonalCenter).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "账户" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "通知，7 条未读" }));
    expect(props.onNotifications).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "账户" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "工作区" }));
    expect(props.onWorkspace).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "账户" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "退出登录" }));
    expect(props.onLogout).toHaveBeenCalledOnce();
  });

  it("closes on Escape and outside click, restores focus, and suppresses the menu for a modal", () => {
    const props = navigationProps();
    const { rerender } = render(<ProductNavigation {...props} />);
    const trigger = screen.getByRole("button", { name: "账户" });

    fireEvent.click(trigger);
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();

    fireEvent.click(trigger);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();

    fireEvent.click(trigger);
    rerender(<ProductNavigation {...props} modalOpen />);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("renders one accessible navigation set and one page scroll owner in desktop and mobile workbenches", () => {
    const desktopNavigation = <ProductNavigation {...navigationProps()} mode="rail" />;
    const mobileNavigation = <ProductNavigation {...navigationProps()} mode="mobile" />;
    const { container, rerender } = render(createElement(
      AdaptiveWorkbench,
      { mode: "desktop", navigation: desktopNavigation, mobileNavigation, inspectorOpen: false, onInspectorClose: vi.fn() },
      "Editor",
    ));

    expect(screen.getAllByRole("navigation")).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "笔记" })).toHaveLength(1);
    expect(container.querySelectorAll('[data-scroll-owner="page"]')).toHaveLength(1);

    rerender(createElement(
      AdaptiveWorkbench,
      { mode: "mobile", navigation: desktopNavigation, mobileNavigation, inspectorOpen: false, onInspectorClose: vi.fn() },
      "Editor",
    ));
    expect(screen.getAllByRole("navigation")).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "笔记" })).toHaveLength(1);
    expect(container.querySelectorAll('[data-scroll-owner="page"]')).toHaveLength(1);
  });
});

describe("App product navigation", () => {
  it("renders truthful knowledge, AI, and account destinations", async () => {
    render(<App authClient={{ session: vi.fn(async () => authenticatedSession()) } as any} apiClient={appApiClient() as any} turnstileSiteKey="test" />);

    fireEvent.click(await screen.findByRole("button", { name: "知识整理" }));
    expect(screen.getByRole("heading", { name: "知识恢复" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "AI 助手" }));
    expect(screen.getByRole("heading", { name: "AI 助手尚未配置" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Public Beta 重写计划" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "设置" }));
    expect(screen.getByRole("heading", { name: "账户中心" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "个人资料" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "账户" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "个人中心" }));
    expect(screen.getByRole("tab", { name: "个人资料" })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("button", { name: "账户" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "工作区" }));
    expect(screen.getByRole("tab", { name: "工作区" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("heading", { name: "Public Beta 重写计划" })).not.toBeInTheDocument();
  });

  it("updates the navigation identity from the returned profile", async () => {
    const profile = { id: "u1", email: "u@example.test", display_name: "用户", biography: "", locale: "zh-CN", timezone: "Asia/Shanghai", avatar_url: null, updated_at: "2026-08-22T00:00:00.000Z" };
    const updated = { ...profile, display_name: "导航用户", updated_at: "2026-08-23T00:00:00.000Z" };
    const apiClient = {
      request: vi.fn(async (request: { path: string; method?: string }) => {
        if (request.path === "/api/v2/profile" && request.method === "GET") return profile;
        if (request.path === "/api/v2/profile" && request.method === "PATCH") return updated;
        if (request.path === "/api/v2/profile/sessions") return { items: [] };
        if (request.path === "/api/v2/notifications/unread") return { unread_count: 0 };
        return { items: [], next_cursor: null };
      }),
    };
    render(<App authClient={{ session: vi.fn(async () => authenticatedSession()) } as any} apiClient={apiClient as any} turnstileSiteKey="test" />);
    fireEvent.click(await screen.findByRole("button", { name: "设置" }));
    await waitFor(() => expect(screen.getByLabelText("昵称")).toHaveValue("用户"));
    fireEvent.change(screen.getByLabelText("昵称"), { target: { value: "导航用户" } });
    fireEvent.click(screen.getByRole("button", { name: "保存个人资料" }));
    await waitFor(() => expect(screen.getByText("导航用户")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "账户" }));
    expect(screen.getAllByText("导航用户")).toHaveLength(2);
  });

  it("renders honest unavailable collaboration and real available database/collaboration domains", async () => {
    const noWorkspace = { user, workspaces: [], active_workspace_id: null };
    const first = render(<App authClient={{ session: vi.fn(async () => noWorkspace) } as any} apiClient={appApiClient() as any} turnstileSiteKey="test" />);
    fireEvent.click(await screen.findByRole("button", { name: "协作" }));
    expect(screen.getByRole("heading", { name: "协作功能当前不可用" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Public Beta 重写计划" })).not.toBeInTheDocument();
    first.unmount();

    render(<App authClient={{ session: vi.fn(async () => authenticatedSession()) } as any} apiClient={appApiClient() as any} turnstileSiteKey="test" />);
    fireEvent.click(await screen.findByRole("button", { name: "数据库" }));
    expect(await screen.findByRole("heading", { name: "创建第一个数据库" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "协作" }));
    expect(await screen.findByRole("heading", { name: "协作中心" })).toBeInTheDocument();
  });

  it("orders durable controller drain before one server logout, cleanup, and anonymous AuthGate", async () => {
    const signedOut = Object.assign(new Error("Not authenticated"), { code: "UNAUTHENTICATED", status: 401 });
    const order: string[] = [];
    const serverCreate = deferred<ReturnType<typeof note>>();
    const authClient = {
      session: vi.fn().mockResolvedValueOnce(authenticatedSession()).mockImplementationOnce(async () => { order.push("authgate"); throw signedOut; }),
      logout: vi.fn(async () => { order.push("logout"); return { logged_out: true }; }),
      login: vi.fn(),
    };
    const localStore = durableDraftStore(order);
    const apiClient = noteFlowApi(serverCreate.promise);
    localStorage.setItem("nexus:database-pagination:ws-1", "user-state");
    sessionStorage.setItem("nexus:active-pane:ws-1", "canvas");
    localStorage.setItem("other:local-preference", "keep-local");
    sessionStorage.setItem("other:session-preference", "keep-session");
    render(<App authClient={authClient as any} apiClient={apiClient as any} localStore={localStore as any} turnstileSiteKey="test" />);

    fireEvent.click(await screen.findByRole("button", { name: "打开笔记列表" }));
    fireEvent.click(screen.getAllByRole("button", { name: "新建笔记" })[0]!);
    const title = await screen.findByRole("textbox", { name: "笔记标题" });
    await waitFor(() => expect(apiClient.request.mock.calls.some(([request]) => request.path === "/api/v2/notes" && request.method === "POST")).toBe(true));
    const write = deferred<void>();
    localStore.blockNextMutation(write.promise);
    fireEvent.change(title, { target: { value: "退出前持久化" } });

    fireEvent.click(await screen.findByRole("button", { name: "账户" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "退出登录" }));
    await Promise.resolve();
    expect(authClient.logout).not.toHaveBeenCalled();
    expect(localStore.destroy).not.toHaveBeenCalled();

    write.resolve();
    await waitFor(() => expect(order).toContain("write"));
    expect(authClient.logout).not.toHaveBeenCalled();
    serverCreate.resolve(note());

    await waitFor(() => expect(authClient.logout).toHaveBeenCalledOnce());
    await waitFor(() => expect(localStore.destroy).toHaveBeenCalledOnce());
    await waitFor(() => expect(authClient.session).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole("main")).toHaveClass("auth-page");
    expect(order).toEqual(["write", "logout", "destroy-hidden", "authgate"]);
    expect(localStorage.getItem("nexus:database-pagination:ws-1")).toBeNull();
    expect(sessionStorage.getItem("nexus:active-pane:ws-1")).toBeNull();
    expect(localStorage.getItem("other:local-preference")).toBe("keep-local");
    expect(sessionStorage.getItem("other:session-preference")).toBe("keep-session");
  });

  it("resumes authenticated editing and exposes a recoverable error when server logout fails", async () => {
    const authClient = {
      session: vi.fn(async () => authenticatedSession()),
      logout: vi.fn(async () => { throw Object.assign(new Error("offline"), { code: "NETWORK_ERROR" }); }),
    };
    const localStore = draftStore();
    render(<App authClient={authClient as any} apiClient={appApiClient() as any} localStore={localStore as any} turnstileSiteKey="test" />);

    fireEvent.click(await screen.findByRole("button", { name: "账户" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "退出登录" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("退出登录失败");
    expect(screen.getByRole("button", { name: "重试退出登录" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Public Beta 重写计划" })).toBeInTheDocument();
    expect(authClient.session).toHaveBeenCalledOnce();
    expect(localStore.destroy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "打开笔记列表" }));
    fireEvent.click(screen.getAllByRole("button", { name: "新建笔记" })[0]!);
    expect(await screen.findByRole("textbox", { name: "笔记标题" })).toBeEnabled();
  });

  it("keeps AuthGate hidden after cleanup failure and retries cleanup without a second logout", async () => {
    const signedOut = Object.assign(new Error("Not authenticated"), { code: "UNAUTHENTICATED", status: 401 });
    const authClient = {
      session: vi.fn().mockResolvedValueOnce(authenticatedSession()).mockRejectedValueOnce(signedOut),
      logout: vi.fn(async () => ({ logged_out: true })),
      login: vi.fn(),
    };
    const localStore = draftStore();
    localStore.destroy.mockRejectedValueOnce(new Error("IndexedDB blocked")).mockResolvedValueOnce(undefined);
    localStorage.setItem("nexus:database-pagination:ws-1", "user-state");
    render(<App authClient={authClient as any} apiClient={appApiClient() as any} localStore={localStore as any} turnstileSiteKey="test" />);

    fireEvent.click(await screen.findByRole("button", { name: "账户" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "退出登录" }));

    expect(await screen.findByRole("heading", { name: "本地数据清理失败" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "登录" })).not.toBeInTheDocument();
    expect(authClient.session).toHaveBeenCalledOnce();
    expect(authClient.logout).toHaveBeenCalledOnce();
    expect(localStore.destroy).toHaveBeenCalledOnce();
    expect(localStorage.getItem("nexus:database-pagination:ws-1")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "重试清理本地数据" }));
    await waitFor(() => expect(localStore.destroy).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(authClient.session).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole("main")).toHaveClass("auth-page");
    expect(authClient.logout).toHaveBeenCalledOnce();
  });

  it("waits for every cleanup branch to settle before exposing one non-overlapping local retry", async () => {
    const signedOut = Object.assign(new Error("Not authenticated"), { code: "UNAUTHENTICATED", status: 401 });
    const authClient = {
      session: vi.fn().mockResolvedValueOnce(authenticatedSession()).mockRejectedValueOnce(signedOut),
      logout: vi.fn(async () => ({ logged_out: true })),
      login: vi.fn(),
    };
    const firstDestroy = deferred<void>();
    const retryDestroy = deferred<void>();
    const localStore = draftStore();
    localStore.destroy.mockImplementationOnce(() => firstDestroy.promise).mockImplementationOnce(() => retryDestroy.promise);
    localStorage.setItem("nexus:cleanup-probe", "remove-me");
    vi.spyOn(Storage.prototype, "removeItem").mockImplementationOnce(() => {
      throw new Error("browser storage blocked");
    });
    render(<App authClient={authClient as any} apiClient={appApiClient() as any} localStore={localStore as any} turnstileSiteKey="test" />);

    fireEvent.click(await screen.findByRole("button", { name: "账户" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "退出登录" }));
    await waitFor(() => expect(localStore.destroy).toHaveBeenCalledOnce());
    expect(screen.getByRole("heading", { name: "正在清理本地数据" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "重试清理本地数据" })).not.toBeInTheDocument();
    expect(authClient.session).toHaveBeenCalledOnce();

    firstDestroy.resolve();
    const retry = await screen.findByRole("button", { name: "重试清理本地数据" });
    act(() => {
      retry.click();
      retry.click();
    });
    await waitFor(() => expect(localStore.destroy).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("button", { name: "重试清理本地数据" })).not.toBeInTheDocument();
    expect(authClient.logout).toHaveBeenCalledOnce();

    retryDestroy.resolve();
    await waitFor(() => expect(authClient.session).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole("main")).toHaveClass("auth-page");
    expect(localStorage.getItem("nexus:cleanup-probe")).toBeNull();
    expect(localStore.destroy).toHaveBeenCalledTimes(2);
    expect(authClient.logout).toHaveBeenCalledOnce();
  });

  it("treats a missing active local-store destroy capability as a blocking cleanup error", async () => {
    const authClient = {
      session: vi.fn(async () => authenticatedSession()),
      logout: vi.fn(async () => ({ logged_out: true })),
      login: vi.fn(),
    };
    const localStore = { ...draftStore(), destroy: undefined };
    render(<App authClient={authClient as any} apiClient={appApiClient() as any} localStore={localStore as any} turnstileSiteKey="test" />);

    fireEvent.click(await screen.findByRole("button", { name: "账户" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "退出登录" }));

    expect(await screen.findByRole("heading", { name: "本地数据清理失败" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "登录" })).not.toBeInTheDocument();
    expect(authClient.session).toHaveBeenCalledOnce();
    expect(authClient.logout).toHaveBeenCalledOnce();
  });

  it("deduplicates rapid logout activation to one server call", async () => {
    const logout = deferred<{ logged_out: true }>();
    const authClient = { session: vi.fn(async () => authenticatedSession()), logout: vi.fn(() => logout.promise) };
    render(<App authClient={authClient as any} apiClient={appApiClient() as any} localStore={draftStore() as any} turnstileSiteKey="test" />);

    fireEvent.click(await screen.findByRole("button", { name: "账户" }));
    const logoutItem = screen.getByRole("menuitem", { name: "退出登录" });
    act(() => {
      logoutItem.click();
      logoutItem.click();
    });
    await waitFor(() => expect(authClient.logout).toHaveBeenCalledOnce());
    logout.reject(Object.assign(new Error("offline"), { code: "NETWORK_ERROR" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("退出登录失败");
  });
});
