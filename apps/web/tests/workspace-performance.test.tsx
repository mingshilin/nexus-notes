import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const lazyDomainModules = vi.hoisted(() => {
  let resolveReminders!: (value: { ReminderPanel: () => JSX.Element }) => void;
  const preloadRequests: Array<{
    domain: string;
    promise: Promise<unknown>;
    resolve(value: unknown): void;
    reject(reason?: unknown): void;
  }> = [];
  return {
    reminderPromise: new Promise<{ ReminderPanel: () => JSX.Element }>((resolve) => { resolveReminders = resolve; }),
    resolveReminders: (value: { ReminderPanel: () => JSX.Element }) => resolveReminders(value),
    preloadRequests,
    preloadWorkspaceDomain: vi.fn((domain: string) => {
      let resolveRequest!: (value: unknown) => void;
      let rejectRequest!: (reason?: unknown) => void;
      const promise = new Promise<unknown>((resolve, reject) => {
        resolveRequest = resolve;
        rejectRequest = reject;
      });
      preloadRequests.push({
        domain,
        promise,
        resolve: resolveRequest,
        reject: rejectRequest,
      });
      return promise;
    }),
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
import { useWorkspaceNavigation } from "../src/app/use-workspace-navigation";
import { createDomainPreloader } from "../src/app/workspace-domain-loader";
import { WorkspaceShell } from "../src/app/WorkspaceShell";
import { ProductNavigation } from "../src/navigation/ProductNavigation";

const user = { id: "u1", email: "u@example.test", displayName: "用户" };

afterEach(() => {
  lazyDomainModules.preloadWorkspaceDomain.mockClear();
  lazyDomainModules.preloadRequests.length = 0;
});

function installControlledRaf() {
  const originalRequestAnimationFrame = window.requestAnimationFrame;
  const originalCancelAnimationFrame = window.cancelAnimationFrame;
  const callbacks = new Map<number, FrameRequestCallback>();
  let nextHandle = 1;
  window.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
    const handle = nextHandle;
    nextHandle += 1;
    callbacks.set(handle, callback);
    return handle;
  });
  window.cancelAnimationFrame = vi.fn((handle: number) => {
    callbacks.delete(handle);
  });
  return {
    pendingCount: () => callbacks.size,
    flush(time = 24) {
      const pending = [...callbacks.entries()];
      callbacks.clear();
      act(() => {
        pending.forEach(([, callback]) => callback(time));
      });
    },
    restore() {
      window.requestAnimationFrame = originalRequestAnimationFrame;
      window.cancelAnimationFrame = originalCancelAnimationFrame;
    },
  };
}

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

  it("commits the requested shell immediately while the lazy module is unresolved", async () => {
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

    const shell = document.querySelector('[data-domain="reminders"]');
    expect(shell).toBeInTheDocument();
    expect(shell).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText("正在加载提醒中心…")).toBeVisible();
    expect(lazyDomainModules.preloadWorkspaceDomain).toHaveBeenCalledWith("reminders");

    lazyDomainModules.resolveReminders({ ReminderPanel: () => <section aria-label="提醒中心">提醒内容</section> });
    await waitFor(() => expect(screen.getByRole("region", { name: "提醒中心" })).toBeVisible());
  });

  it("clears shell busy on the next frame even when preload never settles", async () => {
    const raf = installControlledRaf();
    try {
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
      await screen.findByRole("heading", { name: "Public Beta 重写计划" });
      fireEvent.click(screen.getByRole("button", { name: "提醒" }));

      const shell = document.querySelector('[data-domain="reminders"]');
      expect(shell).toHaveAttribute("aria-busy", "true");
      expect(lazyDomainModules.preloadRequests).toHaveLength(1);

      raf.flush();

      expect(document.querySelector('[data-domain="reminders"]')).not.toHaveAttribute("aria-busy");
      expect(document.querySelector('[data-domain="reminders"]')).toBeInTheDocument();
      expect(raf.pendingCount()).toBe(0);
    } finally {
      raf.restore();
    }
  });

  it("records navigation-shell timing on the shell frame without waiting for lazy preload", () => {
    const raf = installControlledRaf();
    let now: ReturnType<typeof vi.spyOn> | undefined;
    try {
      const { result } = renderHook(() => useWorkspaceNavigation());
      now = vi.spyOn(performance, "now")
        .mockReturnValueOnce(10)
        .mockReturnValue(34);

      act(() => result.current.navigate("reminders"));

      expect(result.current.domainPending).toBe(true);
      expect(result.current.lastInteraction).toBeNull();
      expect(lazyDomainModules.preloadRequests).toHaveLength(1);

      raf.flush(34);

      expect(result.current.domainPending).toBe(false);
      expect(result.current.lastInteraction).toEqual({
        name: "navigation-shell:reminders",
        startedAt: 10,
        endedAt: 34,
        durationMs: 24,
        budgetMs: 100,
        overBudget: false,
      });
      expect(lazyDomainModules.preloadRequests).toHaveLength(1);
      expect(raf.pendingCount()).toBe(0);
    } finally {
      now?.mockRestore();
      raf.restore();
    }
  });

  it("keeps the current navigation pending when an older preload finishes during A to B navigation", async () => {
    const raf = installControlledRaf();
    try {
      const { result } = renderHook(() => useWorkspaceNavigation());

      act(() => result.current.navigate("databases"));
      const firstPreload = lazyDomainModules.preloadRequests[0]!;
      act(() => result.current.navigate("reminders"));

      expect(result.current.activeDomain).toBe("reminders");
      expect(result.current.requestedDomain).toBe("reminders");
      expect(result.current.domainPending).toBe(true);

      await act(async () => {
        firstPreload.resolve({ DatabaseWorkbench: () => null });
        await firstPreload.promise;
      });

      expect(result.current.activeDomain).toBe("reminders");
      expect(result.current.requestedDomain).toBe("reminders");
      expect(result.current.domainPending).toBe(true);

      raf.flush();

      expect(result.current.activeDomain).toBe("reminders");
      expect(result.current.requestedDomain).toBe("reminders");
      expect(result.current.domainPending).toBe(false);
      expect(raf.pendingCount()).toBe(0);
    } finally {
      raf.restore();
    }
  });

  it("does not start a busy shell for current-domain no-ops or domains without lazy loaders", () => {
    const raf = installControlledRaf();
    try {
      const notesNavigation = renderHook(() => useWorkspaceNavigation("notes"));
      act(() => notesNavigation.result.current.navigate("notes"));

      expect(notesNavigation.result.current.activeDomain).toBe("notes");
      expect(notesNavigation.result.current.requestedDomain).toBe("notes");
      expect(notesNavigation.result.current.domainPending).toBe(false);
      expect(lazyDomainModules.preloadWorkspaceDomain).not.toHaveBeenCalled();
      expect(raf.pendingCount()).toBe(0);

      const remindersNavigation = renderHook(() => useWorkspaceNavigation("reminders"));
      act(() => remindersNavigation.result.current.navigate("reminders"));

      expect(remindersNavigation.result.current.activeDomain).toBe("reminders");
      expect(remindersNavigation.result.current.requestedDomain).toBe("reminders");
      expect(remindersNavigation.result.current.domainPending).toBe(false);
      expect(lazyDomainModules.preloadWorkspaceDomain).not.toHaveBeenCalled();
      expect(raf.pendingCount()).toBe(0);
    } finally {
      raf.restore();
    }
  });
});
