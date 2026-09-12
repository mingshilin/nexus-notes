import { act, render, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Reminder, ReminderDelivery, ReminderListQuery } from "@nexus/contracts";
import { useReminderWorkspaceData } from "../src/reminders/use-reminder-workspace-data";

function ReminderDataHarness({ client, now, onRender }: { client: object; now?: () => number; onRender(snapshot: ReturnType<typeof useReminderWorkspaceData>): void }) {
  const state = useReminderWorkspaceData({ client: client as never, now });
  onRender(state);
  return null;
}

function ScopedReminderDataHarness({ client, cacheScope, onRender }: { client: object; cacheScope: string; onRender(snapshot: ReturnType<typeof useReminderWorkspaceData>): void }) {
  const state = useReminderWorkspaceData({ client: client as never, cacheScope });
  onRender(state);
  return null;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

function reminder(id: string, title: string): Reminder {
  return {
    id,
    workspace_id: "ws-1",
    note_id: null,
    user_id: "user-1",
    title,
    remind_at: "2026-08-29T09:00:00.000Z",
    timezone: "UTC",
    channels: ["in_app"],
    recurrence: null,
    recurrence_anchor_local: null,
    occurrence_count: 0,
    delivery_enabled_at: "2026-08-28T00:00:00.000Z",
    snoozed_until: null,
    last_delivered_at: null,
    status: "pending",
    revision: 1,
    created_at: "2026-08-28T00:00:00.000Z",
    updated_at: "2026-08-28T00:00:00.000Z",
  };
}

function delivery(id: string, reminderId: string): ReminderDelivery {
  return {
    id,
    workspace_id: "ws-1",
    reminder_id: reminderId,
    occurrence_at: "2026-08-29T09:00:00.000Z",
    channel: "in_app",
    status: "queued",
    attempt_count: 1,
    last_error_code: null,
    created_at: "2026-08-28T00:00:00.000Z",
    updated_at: "2026-08-28T00:00:00.000Z",
  };
}

describe("useReminderWorkspaceData", () => {
  it("ignores a late list response after the search scope changes", async () => {
    const oldRequest = deferred<{ items: Reminder[]; next_cursor: string | null }>();
    const newRequest = deferred<{ items: Reminder[]; next_cursor: string | null }>();
    const client = {
      listReminderPage: vi.fn((input: ReminderListQuery) => input.query === "new" ? newRequest.promise : oldRequest.promise),
    };
    const { result } = renderHook(() => useReminderWorkspaceData({ client: client as never }));

    await waitFor(() => expect(client.listReminderPage).toHaveBeenCalledOnce());
    act(() => result.current.setSearch("new"));
    await waitFor(() => expect(client.listReminderPage).toHaveBeenCalledTimes(2), { timeout: 1000 });

    newRequest.resolve({ items: [reminder("new", "新提醒")], next_cursor: null });
    await waitFor(() => expect(result.current.reminders.map((item) => item.id)).toEqual(["new"]));
    oldRequest.resolve({ items: [reminder("old", "旧提醒")], next_cursor: null });
    await act(async () => { await oldRequest.promise; });

    expect(result.current.reminders.map((item) => item.id)).toEqual(["new"]);
  });

  it("shows the cached list immediately when the same client remounts", async () => {
    const client = {
      listReminderPage: vi.fn(async () => ({ items: [reminder("cached", "缓存提醒")], next_cursor: null })),
    };
    const first = renderHook(() => useReminderWorkspaceData({ client: client as never }));
    await waitFor(() => expect(first.result.current.reminders).toHaveLength(1));
    first.unmount();

    const snapshots: Array<ReturnType<typeof useReminderWorkspaceData>> = [];
    const second = render(<ReminderDataHarness client={client} onRender={(snapshot) => snapshots.push(snapshot)} />);
    expect(snapshots[0]?.reminders.map((item) => item.id)).toEqual(["cached"]);
    expect(snapshots[0]?.loading).toBe(false);
    expect(second).toBeTruthy();
    expect(client.listReminderPage).toHaveBeenCalledOnce();
  });

  it("refreshes an expired cache without clearing the stale reminder", async () => {
    let currentTime = 1_000;
    const refreshed = deferred<{ items: Reminder[]; next_cursor: null }>();
    const client = {
      listReminderPage: vi.fn()
        .mockResolvedValueOnce({ items: [reminder("stale", "旧提醒")], next_cursor: null })
        .mockReturnValueOnce(refreshed.promise),
    };
    const first = renderHook(() => useReminderWorkspaceData({ client: client as never, now: () => currentTime }));
    await waitFor(() => expect(first.result.current.reminders).toHaveLength(1));
    first.unmount();
    currentTime += 60_001;

    const second = renderHook(() => useReminderWorkspaceData({ client: client as never, now: () => currentTime }));
    expect(second.result.current.reminders[0]?.id).toBe("stale");
    expect(second.result.current.refreshing).toBe(true);
    expect(client.listReminderPage).toHaveBeenCalledTimes(2);
    refreshed.resolve({ items: [reminder("fresh", "新提醒")], next_cursor: null });
    await waitFor(() => expect(second.result.current.reminders[0]?.id).toBe("fresh"));
  });

  it("updates the cached list when a mutation changes the visible reminder", async () => {
    const original = reminder("cached-mutation", "待完成");
    const client = {
      listReminderPage: vi.fn(async () => ({ items: [original], next_cursor: null })),
    };
    const first = renderHook(() => useReminderWorkspaceData({ client: client as never }));
    await waitFor(() => expect(first.result.current.reminders).toHaveLength(1));
    act(() => first.result.current.setReminders([{ ...original, status: "dismissed", revision: 2 }]));
    first.unmount();

    const second = renderHook(() => useReminderWorkspaceData({ client: client as never }));
    expect(second.result.current.reminders[0]?.status).toBe("dismissed");
  });

  it("invalidates other cached filters after a mutation", async () => {
    const pending = reminder("shared", "待处理提醒");
    const client = {
      listReminderPage: vi.fn(async (input: ReminderListQuery) => ({
        items: input.status === "completed" ? [] : [pending],
        next_cursor: null,
      })),
    };
    const { result } = renderHook(() => useReminderWorkspaceData({ client: client as never }));
    await waitFor(() => expect(result.current.reminders).toHaveLength(1));
    act(() => result.current.setStatusFilter("completed"));
    await waitFor(() => expect(result.current.reminders).toHaveLength(0));
    act(() => result.current.setStatusFilter("all"));
    await waitFor(() => expect(result.current.reminders).toHaveLength(1));
    expect(client.listReminderPage).toHaveBeenCalledTimes(2);

    act(() => result.current.setReminders([{ ...pending, status: "dismissed", revision: 2 }]));
    act(() => result.current.setStatusFilter("completed"));
    await waitFor(() => expect(client.listReminderPage).toHaveBeenCalledTimes(3));
  });

  it("does not let a background refresh overwrite a newer mutation", async () => {
    let currentTime = 10_000;
    const original = reminder("refresh-race", "刷新前");
    const staleRefresh = deferred<{ items: Reminder[]; next_cursor: null }>();
    const client = {
      listReminderPage: vi.fn()
        .mockResolvedValueOnce({ items: [original], next_cursor: null })
        .mockReturnValueOnce(staleRefresh.promise),
    };
    const first = renderHook(() => useReminderWorkspaceData({ client: client as never, now: () => currentTime }));
    await waitFor(() => expect(first.result.current.reminders).toHaveLength(1));
    first.unmount();
    currentTime += 60_001;
    const second = renderHook(() => useReminderWorkspaceData({ client: client as never, now: () => currentTime }));
    expect(second.result.current.refreshing).toBe(true);

    act(() => second.result.current.setReminders([{ ...original, title: "用户已更新", revision: 2 }]));
    staleRefresh.resolve({ items: [original], next_cursor: null });
    await act(async () => { await staleRefresh.promise; });

    expect(second.result.current.reminders[0]?.title).toBe("用户已更新");
  });

  it("does not install delivery details for a reminder that is no longer open", async () => {
    const firstDelivery = deferred<ReminderDelivery[]>();
    const secondDelivery = deferred<ReminderDelivery[]>();
    const client = {
      listReminderPage: vi.fn(async () => ({ items: [reminder("one", "一"), reminder("two", "二")], next_cursor: null })),
      listReminderDeliveries: vi.fn((id: string) => id === "one" ? firstDelivery.promise : secondDelivery.promise),
    };
    const { result } = renderHook(() => useReminderWorkspaceData({ client: client as never }));
    await waitFor(() => expect(result.current.reminders).toHaveLength(2));

    act(() => result.current.toggleDeliveryStatus("one"));
    act(() => result.current.toggleDeliveryStatus("two"));
    firstDelivery.resolve([delivery("delivery-one", "one")]);
    await act(async () => { await firstDelivery.promise; });
    expect(result.current.deliveryOpenId).toBe("two");
    expect(result.current.deliveryItems.one).toBeUndefined();

    secondDelivery.resolve([delivery("delivery-two", "two")]);
    await waitFor(() => expect(result.current.deliveryItems.two?.[0]?.id).toBe("delivery-two"));
  });

  it("clears delivery loading state when switching to a cached reminder", async () => {
    const firstDetails = deferred<ReminderDelivery[]>();
    const client = {
      listReminderPage: vi.fn(async () => ({ items: [reminder("one", "一"), reminder("two", "二")], next_cursor: null })),
      listReminderDeliveries: vi.fn((id: string) => id === "one" ? firstDetails.promise : Promise.resolve([delivery("delivery-two", "two")])),
    };
    const { result } = renderHook(() => useReminderWorkspaceData({ client: client as never }));
    await waitFor(() => expect(result.current.reminders).toHaveLength(2));
    act(() => result.current.toggleDeliveryStatus("two"));
    await waitFor(() => expect(result.current.deliveryItems.two).toBeDefined());
    act(() => result.current.toggleDeliveryStatus("one"));
    expect(result.current.deliveryLoadingId).toBe("one");
    act(() => result.current.toggleDeliveryStatus("two"));
    expect(result.current.deliveryOpenId).toBe("two");
    expect(result.current.deliveryLoadingId).toBeNull();
    firstDetails.resolve([delivery("delivery-one", "one")]);
  });

  it("ignores a late delivery retry after the user opens another reminder", async () => {
    const retry = deferred<ReminderDelivery>();
    const client = {
      listReminderPage: vi.fn(async () => ({ items: [reminder("one", "一"), reminder("two", "二")], next_cursor: null })),
      listReminderDeliveries: vi.fn(async (id: string) => [delivery(`delivery-${id}`, id)]),
      retryReminderDelivery: vi.fn(() => retry.promise),
    };
    const { result } = renderHook(() => useReminderWorkspaceData({ client: client as never }));
    await waitFor(() => expect(result.current.reminders).toHaveLength(2));
    act(() => result.current.toggleDeliveryStatus("one"));
    await waitFor(() => expect(result.current.deliveryItems.one).toBeDefined());
    act(() => result.current.retryDelivery("one", "delivery-one"));
    act(() => result.current.toggleDeliveryStatus("two"));
    retry.resolve({ ...delivery("delivery-one", "one"), status: "sent" });
    await act(async () => { await retry.promise; });

    expect(result.current.deliveryItems.one).toBeUndefined();
    expect(result.current.feedback).toBeNull();
    expect(result.current.deliveryRetryId).toBeNull();
  });

  it("does not expose the previous client list during a scope switch", async () => {
    const firstClient = {
      listReminderPage: vi.fn(async () => ({ items: [reminder("first-client", "旧工作区")], next_cursor: null })),
    };
    const secondRequest = deferred<{ items: Reminder[]; next_cursor: null }>();
    const secondClient = { listReminderPage: vi.fn(() => secondRequest.promise) };
    const snapshots: Array<ReturnType<typeof useReminderWorkspaceData>> = [];
    const view = render(<ReminderDataHarness client={firstClient} onRender={(snapshot) => snapshots.push(snapshot)} />);
    await waitFor(() => expect(snapshots.at(-1)?.reminders).toHaveLength(1));

    const switchRenderIndex = snapshots.length;
    view.rerender(<ReminderDataHarness client={secondClient} onRender={(snapshot) => snapshots.push(snapshot)} />);
    expect(snapshots[switchRenderIndex]?.reminders).toEqual([]);
    expect(snapshots[switchRenderIndex]?.loading).toBe(true);
    secondRequest.resolve({ items: [reminder("second-client", "新工作区")], next_cursor: null });
    await waitFor(() => expect(snapshots.at(-1)?.reminders.map((item) => item.id)).toEqual(["second-client"]));
  });

  it("ignores a mutation setter retained from a previous client scope", async () => {
    const firstClient = {
      listReminderPage: vi.fn(async () => ({ items: [reminder("first-client-mutation", "旧工作区")], next_cursor: null })),
    };
    const secondClient = {
      listReminderPage: vi.fn(async () => ({ items: [reminder("second-client-mutation", "新工作区")], next_cursor: null })),
    };
    let staleSetter: ReturnType<typeof useReminderWorkspaceData>["setReminders"] | null = null;
    let latest: ReturnType<typeof useReminderWorkspaceData> | null = null;
    const view = render(<ReminderDataHarness client={firstClient} onRender={(snapshot) => { latest = snapshot; if (!staleSetter) staleSetter = snapshot.setReminders; }} />);
    await waitFor(() => expect(firstClient.listReminderPage).toHaveBeenCalledOnce());
    view.rerender(<ReminderDataHarness client={secondClient} onRender={(snapshot) => { latest = snapshot; }} />);
    await waitFor(() => expect(secondClient.listReminderPage).toHaveBeenCalledOnce());

    act(() => staleSetter?.((current) => [...current, reminder("stale-mutation", "不应出现")])) ;
    expect(latest?.reminders.map((item) => item.id)).toEqual(["second-client-mutation"]);
  });

  it("aborts a delivery retry when its panel closes", async () => {
    const retry = deferred<ReminderDelivery>();
    let retrySignal: AbortSignal | undefined;
    const client = {
      listReminderPage: vi.fn(async () => ({ items: [reminder("one", "一")], next_cursor: null })),
      listReminderDeliveries: vi.fn(async () => [delivery("delivery-one", "one")]),
      retryReminderDelivery: vi.fn((...args: unknown[]) => {
        retrySignal = args[2] as AbortSignal | undefined;
        return retry.promise;
      }),
    };
    const { result } = renderHook(() => useReminderWorkspaceData({ client: client as never }));
    await waitFor(() => expect(result.current.reminders).toHaveLength(1));
    act(() => result.current.toggleDeliveryStatus("one"));
    await waitFor(() => expect(result.current.deliveryItems.one).toBeDefined());
    act(() => result.current.retryDelivery("one", "delivery-one"));
    expect(retrySignal?.aborted).toBe(false);

    act(() => result.current.toggleDeliveryStatus("one"));
    expect(retrySignal?.aborted).toBe(true);
    expect(result.current.deliveryRetryId).toBeNull();
    act(() => result.current.toggleDeliveryStatus("one"));
    await waitFor(() => expect(client.listReminderDeliveries).toHaveBeenCalledTimes(2));
    retry.resolve({ ...delivery("delivery-one", "one"), status: "sent" });
  });

  it("ignores a mutation setter retained from a previous query", async () => {
    let completedLoads = 0;
    const client = {
      listReminderPage: vi.fn(async (input: ReminderListQuery) => ({
        items: [reminder(input.status === "completed"
          ? ++completedLoads === 1 ? "completed-query" : "completed-refreshed"
          : "all-query", input.status)],
        next_cursor: null,
      })),
    };
    const { result } = renderHook(() => useReminderWorkspaceData({ client: client as never }));
    await waitFor(() => expect(result.current.reminders[0]?.id).toBe("all-query"));
    const staleSetter = result.current.setReminders;

    act(() => result.current.setStatusFilter("completed"));
    await waitFor(() => expect(result.current.reminders[0]?.id).toBe("completed-query"));
    act(() => staleSetter((current) => [...current, reminder("stale-query-mutation", "不应出现")])) ;

    await waitFor(() => expect(client.listReminderPage).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(result.current.reminders.map((item) => item.id)).toEqual(["completed-refreshed"]));
    expect(result.current.loading).toBe(false);
  });

  it("isolates cache entries for distinct explicit client scopes", async () => {
    const client = {
      listReminderPage: vi.fn()
        .mockResolvedValueOnce({ items: [reminder("scope-a", "工作区 A")], next_cursor: null })
        .mockResolvedValueOnce({ items: [reminder("scope-b", "工作区 B")], next_cursor: null }),
    };
    const first = renderHook(() => useReminderWorkspaceData({ client: client as never, cacheScope: "user-1:workspace-a" }));
    await waitFor(() => expect(first.result.current.reminders.map((item) => item.id)).toEqual(["scope-a"]));
    first.unmount();
    const snapshots: Array<ReturnType<typeof useReminderWorkspaceData>> = [];
    render(<ScopedReminderDataHarness client={client} cacheScope="user-1:workspace-b" onRender={(snapshot) => snapshots.push(snapshot)} />);
    expect(snapshots[0]?.reminders).toEqual([]);
    await waitFor(() => expect(snapshots.at(-1)?.reminders.map((item) => item.id)).toEqual(["scope-b"]));
  });

  it("persists the latest pagination cursor when a mutation updates the cache", async () => {
    const client = {
      listReminderPage: vi.fn(async (input: ReminderListQuery) => input.cursor
        ? { items: [reminder("page-two", "第二页")], next_cursor: "next-two" }
        : { items: [reminder("page-one", "第一页")], next_cursor: "next-one" }),
    };
    const first = renderHook(() => useReminderWorkspaceData({ client: client as never }));
    await waitFor(() => expect(first.result.current.nextCursor).toBe("next-one"));
    act(() => first.result.current.loadMore());
    await waitFor(() => expect(first.result.current.nextCursor).toBe("next-two"));
    act(() => first.result.current.setReminders((current) => current.map((item) => ({ ...item, revision: item.revision + 1 }))));
    first.unmount();

    const second = renderHook(() => useReminderWorkspaceData({ client: client as never }));
    expect(second.result.current.nextCursor).toBe("next-two");
  });

  it("lets an unmounted mutation invalidate and refresh the active instance", async () => {
    const client = {
      listReminderPage: vi.fn()
        .mockResolvedValueOnce({ items: [reminder("before", "变更前")], next_cursor: null })
        .mockResolvedValueOnce({ items: [reminder("after", "变更后")], next_cursor: null }),
    };
    const first = renderHook(() => useReminderWorkspaceData({ client: client as never, cacheScope: "user-1:workspace-1" }));
    await waitFor(() => expect(first.result.current.reminders[0]?.id).toBe("before"));
    const staleSetter = first.result.current.setReminders;
    first.unmount();

    const second = renderHook(() => useReminderWorkspaceData({ client: client as never, cacheScope: "user-1:workspace-1" }));
    expect(second.result.current.reminders[0]?.id).toBe("before");
    act(() => staleSetter([reminder("mutation-result", "旧实例结果")]));

    await waitFor(() => expect(client.listReminderPage).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(second.result.current.reminders[0]?.id).toBe("after"));
  });

  it("releases a delivery retry lock when a reminder mutation supersedes it", async () => {
    const retry = deferred<ReminderDelivery>();
    const client = {
      listReminderPage: vi.fn(async () => ({ items: [reminder("one", "一")], next_cursor: null })),
      listReminderDeliveries: vi.fn(async () => [delivery("delivery-one", "one")]),
      retryReminderDelivery: vi.fn(async () => retry.promise),
    };
    const { result } = renderHook(() => useReminderWorkspaceData({ client: client as never }));
    await waitFor(() => expect(result.current.reminders).toHaveLength(1));
    act(() => result.current.toggleDeliveryStatus("one"));
    await waitFor(() => expect(result.current.deliveryItems.one).toBeDefined());
    act(() => result.current.retryDelivery("one", "delivery-one"));
    expect(result.current.deliveryRetryId).toBe("one:delivery-one");

    act(() => result.current.setReminders((current) => current));
    expect(result.current.deliveryRetryId).toBeNull();
    retry.resolve({ ...delivery("delivery-one", "one"), status: "sent" });
  });

  it("broadcasts a current mutation to another mounted hook in the same scope", async () => {
    const client = {
      listReminderPage: vi.fn()
        .mockResolvedValueOnce({ items: [reminder("before", "变更前")], next_cursor: null })
        .mockResolvedValueOnce({ items: [reminder("after", "变更后")], next_cursor: null }),
    };
    const first = renderHook(() => useReminderWorkspaceData({ client: client as never, cacheScope: "user-1:workspace-1" }));
    await waitFor(() => expect(first.result.current.reminders[0]?.id).toBe("before"));
    const second = renderHook(() => useReminderWorkspaceData({ client: client as never, cacheScope: "user-1:workspace-1" }));
    expect(second.result.current.reminders[0]?.id).toBe("before");

    act(() => first.result.current.setReminders([reminder("mutated", "已变更")]));
    await waitFor(() => expect(client.listReminderPage).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(second.result.current.reminders[0]?.id).toBe("after"));
  });
});
