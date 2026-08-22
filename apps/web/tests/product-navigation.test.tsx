import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { App } from "../src/app/App";
import { AdaptiveWorkbench } from "../src/layout/AdaptiveWorkbench";
import { ProductNavigation, type ProductDomain } from "../src/navigation/ProductNavigation";

const user = { id: "u1", email: "u@example.test", displayName: "用户" };

function navigationProps(overrides: Partial<Parameters<typeof ProductNavigation>[0]> = {}) {
  return {
    active: "notes" as ProductDomain,
    user,
    unreadCount: 0,
    collaborationEnabled: true,
    onChange: vi.fn(),
    onPersonalCenter: vi.fn(),
    onNotifications: vi.fn(),
    onWorkspace: vi.fn(),
    onLogout: vi.fn(),
    ...overrides,
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
    expect(collaboration).toBeDisabled();
    expect(collaboration).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(collaboration);
    expect(props.onChange).not.toHaveBeenCalled();
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
    expect(screen.getByText("个人中心将在后续任务中提供。" )).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Public Beta 重写计划" })).not.toBeInTheDocument();
  });

  it("logs out through AuthClient, clears scoped state, and reboots AuthGate as anonymous", async () => {
    const signedOut = Object.assign(new Error("Not authenticated"), { code: "UNAUTHENTICATED", status: 401 });
    const authClient = {
      session: vi.fn().mockResolvedValueOnce(authenticatedSession()).mockRejectedValueOnce(signedOut),
      logout: vi.fn(async () => ({ logged_out: true })),
      login: vi.fn(),
    };
    const localStore = draftStore();
    const storageRead = vi.spyOn(Storage.prototype, "getItem");
    render(<App authClient={authClient as any} apiClient={appApiClient() as any} localStore={localStore as any} turnstileSiteKey="test" />);

    fireEvent.click(await screen.findByRole("button", { name: "账户" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "退出登录" }));

    await waitFor(() => expect(authClient.logout).toHaveBeenCalledOnce());
    await waitFor(() => expect(localStore.destroy).toHaveBeenCalledOnce());
    await waitFor(() => expect(authClient.session).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole("main")).toHaveClass("auth-page");
    expect(storageRead).not.toHaveBeenCalled();
    storageRead.mockRestore();
  });

  it("keeps the authenticated workspace and exposes a recoverable logout error on failure", async () => {
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
  });
});
