import { fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const lazyDomainModules = vi.hoisted(() => {
  let resolveReminders!: (value: { ReminderPanel: () => JSX.Element }) => void;
  return {
    reminderPromise: new Promise<{ ReminderPanel: () => JSX.Element }>((resolve) => { resolveReminders = resolve; }),
    resolveReminders: (value: { ReminderPanel: () => JSX.Element }) => resolveReminders(value),
    preloadWorkspaceDomain: vi.fn(() => new Promise<never>(() => undefined)),
  };
});

vi.mock("../src/app/workspace-domain-loader", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/app/workspace-domain-loader")>();
  return {
    ...actual,
    loadReminderPanel: vi.fn(() => lazyDomainModules.reminderPromise),
    preloadWorkspaceDomain: lazyDomainModules.preloadWorkspaceDomain,
  };
});

import { App } from "../src/app/App";
import { useWorkspaceClients } from "../src/app/use-workspace-clients";
import { createDomainPreloader } from "../src/app/workspace-domain-loader";
import { WorkspaceShell } from "../src/app/WorkspaceShell";
import { ProductNavigation } from "../src/navigation/ProductNavigation";

const user = { id: "u1", email: "u@example.test", displayName: "用户" };

afterEach(() => {
  lazyDomainModules.preloadWorkspaceDomain.mockClear();
});

describe("workspace performance foundation", () => {
  it("keeps clients stable for a workspace and rotates them without tenant leakage", async () => {
    const request = vi.fn(async () => ({ items: [] }));
    const apiClient = { request } as never;
    const { result, rerender } = renderHook(
      ({ workspaceId }) => useWorkspaceClients(apiClient, workspaceId),
      { initialProps: { workspaceId: "ws-1" } },
    );
    const first = result.current;

    rerender({ workspaceId: "ws-1" });
    expect(result.current).toBe(first);
    expect(result.current.databases).toBe(first.databases);

    rerender({ workspaceId: "ws-2" });
    expect(result.current).not.toBe(first);
    expect(result.current.databases).not.toBe(first.databases);
    await result.current.databases.listDatabases();
    expect(request).toHaveBeenLastCalledWith(expect.objectContaining({
      headers: { "x-workspace-id": "ws-2" },
    }));
  });

  it("deduplicates domain preload work and retries after a failed download", async () => {
    let rejectFirst!: (reason?: unknown) => void;
    const failed = new Promise<unknown>((_resolve, reject) => { rejectFirst = reject; });
    const loadDatabase = vi.fn()
      .mockReturnValueOnce(failed)
      .mockResolvedValueOnce({ DatabaseWorkbench: () => null });
    const preload = createDomainPreloader({ databases: loadDatabase });

    const first = preload("databases");
    expect(preload("databases")).toBe(first);
    rejectFirst(new Error("network"));
    await expect(first).rejects.toThrow("network");

    await expect(preload("databases")).resolves.toEqual({ DatabaseWorkbench: expect.any(Function) });
    expect(loadDatabase).toHaveBeenCalledTimes(2);
  });

  it("preloads a destination on hover and keyboard focus before navigation", () => {
    const onPrefetch = vi.fn();
    render(<ProductNavigation
      active="notes"
      user={user}
      unreadCount={0}
      collaborationEnabled
      notificationsEnabled
      onChange={vi.fn()}
      onPrefetch={onPrefetch}
      onNotifications={vi.fn()}
      onLogout={vi.fn()}
    />);

    const databases = screen.getByRole("button", { name: "数据库" });
    fireEvent.mouseEnter(databases);
    fireEvent.focus(databases);

    expect(onPrefetch).toHaveBeenCalledWith("databases");
    expect(onPrefetch).toHaveBeenCalledTimes(2);
  });

  it("shows the requested page shell instead of retaining a heavy previous domain", () => {
    const { rerender } = render(<WorkspaceShell
      activeDomain="notes"
      requestedDomain="databases"
      domainPending
      mode="desktop"
      navigation={<nav aria-label="测试导航" />}
      inspectorOpen={false}
      onInspectorClose={vi.fn()}
    >
      <section aria-label="旧笔记页面">旧页面</section>
    </WorkspaceShell>);

    expect(screen.getByRole("status", { name: "正在打开数据库" })).toBeVisible();
    expect(screen.queryByRole("region", { name: "旧笔记页面" })).not.toBeInTheDocument();

    rerender(<WorkspaceShell
      activeDomain="databases"
      requestedDomain="databases"
      domainPending={false}
      mode="desktop"
      navigation={<nav aria-label="测试导航" />}
      inspectorOpen={false}
      onInspectorClose={vi.fn()}
    >
      <section aria-label="数据库页面">数据库内容</section>
    </WorkspaceShell>);
    expect(screen.getByRole("region", { name: "数据库页面" })).toBeVisible();
  });

  it("commits navigation shell before a deferred lazy import resolves", async () => {
    const authClient = {
      session: vi.fn(async () => ({
        user,
        workspaces: [{ id: "ws-1", name: "Personal", slug: "personal", role: "owner" as const, revision: 1 }],
        active_workspace_id: "ws-1",
      })),
    };
    const apiClient = {
      request: vi.fn(async (request: { path: string }) => {
        if (request.path === "/api/v2/notifications/unread") return { unread_count: 0 };
        return { items: [], next_cursor: null };
      }),
    };

    render(<App authClient={authClient as never} apiClient={apiClient as never} turnstileSiteKey="test" />);
    expect(lazyDomainModules.preloadWorkspaceDomain).not.toHaveBeenCalled();

    await screen.findByRole("heading", { name: "Public Beta 重写计划" });
    fireEvent.click(screen.getByRole("button", { name: "提醒" }));

    expect(document.querySelector('[data-domain="reminders"]')).toBeInTheDocument();
    expect(screen.getByText("正在加载提醒中心…")).toBeVisible();
    expect(lazyDomainModules.preloadWorkspaceDomain).toHaveBeenCalledWith("reminders");

    lazyDomainModules.resolveReminders({ ReminderPanel: () => <section aria-label="提醒中心">提醒内容</section> });
    await waitFor(() => expect(screen.getByRole("region", { name: "提醒中心" })).toBeVisible());
  });
});
