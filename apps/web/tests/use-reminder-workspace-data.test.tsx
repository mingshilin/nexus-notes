import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Reminder, ReminderDelivery, ReminderListQuery } from "@nexus/contracts";
import { useReminderWorkspaceData } from "../src/reminders/use-reminder-workspace-data";

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

    const second = renderHook(() => useReminderWorkspaceData({ client: client as never }));
    expect(second.result.current.reminders.map((item) => item.id)).toEqual(["cached"]);
    expect(second.result.current.refreshing).toBe(false);
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
});
