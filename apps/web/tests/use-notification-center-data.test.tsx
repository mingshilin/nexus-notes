import { act, render, renderHook, waitFor } from "@testing-library/react";
import type { Notification } from "@nexus/contracts";
import { StrictMode } from "react";
import { describe, expect, it, vi } from "vitest";

import { useNotificationCenterData } from "../src/collaboration/use-notification-center-data";

function notification(id: string, type = "mention"): Notification {
  return {
    id,
    workspace_id: "workspace-1",
    user_id: "user-1",
    type,
    payload: {},
    deep_link: `/notes/${id}`,
    read_at: null,
    revision: 1,
    created_at: "2026-08-29T00:00:00.000Z",
    updated_at: "2026-08-29T00:00:00.000Z",
  };
}

function Harness({ client, cacheScope, onRender }: { client: object; cacheScope: string; onRender(snapshot: ReturnType<typeof useNotificationCenterData>): void }) {
  const state = useNotificationCenterData({ client: client as never, open: true, cacheScope });
  onRender(state);
  return null;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => { resolve = nextResolve; });
  return { promise, resolve };
}

describe("useNotificationCenterData", () => {
  it("renders a fresh cached page on remount without another list request", async () => {
    const client = {
      listNotifications: vi.fn(async () => ({ items: [notification("cached")], next_cursor: null })),
    };
    const first = renderHook(() => useNotificationCenterData({ client: client as never, open: true, cacheScope: "user-1:workspace-1" }));
    await waitFor(() => expect(first.result.current.notifications).toHaveLength(1));
    first.unmount();

    const snapshots: Array<ReturnType<typeof useNotificationCenterData>> = [];
    render(<Harness client={client} cacheScope="user-1:workspace-1" onRender={(snapshot) => snapshots.push(snapshot)} />);
    expect(snapshots[0]?.notifications.map((item) => item.id)).toEqual(["cached"]);
    expect(snapshots[0]?.loading).toBe(false);
    expect(client.listNotifications).toHaveBeenCalledOnce();
  });

  it("deduplicates the initial list request during StrictMode effect replay", async () => {
    const client = {
      listNotifications: vi.fn(async () => ({ items: [notification("strict")], next_cursor: null })),
    };
    render(
      <StrictMode>
        <Harness client={client} cacheScope="user-1:workspace-strict" onRender={() => undefined} />
      </StrictMode>,
    );

    await waitFor(() => expect(client.listNotifications).toHaveBeenCalledOnce());
  });

  it("hides the previous scope and ignores its late list response", async () => {
    const oldPage = deferred<{ items: Notification[]; next_cursor: null }>();
    const oldRefresh = deferred<{ items: Notification[]; next_cursor: null }>();
    const newPage = deferred<{ items: Notification[]; next_cursor: null }>();
    const oldClient = {
      listNotifications: vi.fn()
        .mockReturnValueOnce(oldPage.promise)
        .mockReturnValueOnce(oldRefresh.promise),
    };
    const newClient = { listNotifications: vi.fn(() => newPage.promise) };
    const snapshots: Array<ReturnType<typeof useNotificationCenterData>> = [];
    const view = render(<Harness client={oldClient} cacheScope="user-1:workspace-old" onRender={(snapshot) => snapshots.push(snapshot)} />);
    oldPage.resolve({ items: [notification("old")], next_cursor: null });
    await waitFor(() => expect(snapshots.at(-1)?.notifications.map((item) => item.id)).toEqual(["old"]));
    act(() => snapshots.at(-1)?.retry());
    await waitFor(() => expect(oldClient.listNotifications).toHaveBeenCalledTimes(2));

    const switchIndex = snapshots.length;
    view.rerender(<Harness client={newClient} cacheScope="user-1:workspace-new" onRender={(snapshot) => snapshots.push(snapshot)} />);
    expect(snapshots[switchIndex]?.notifications).toEqual([]);
    expect(snapshots[switchIndex]?.loading).toBe(true);
    oldRefresh.resolve({ items: [notification("late-old")], next_cursor: null });
    newPage.resolve({ items: [notification("new")], next_cursor: null });
    await waitFor(() => expect(snapshots.at(-1)?.notifications.map((item) => item.id)).toEqual(["new"]));
    expect(snapshots.at(-1)?.notifications.some((item) => item.id === "late-old")).toBe(false);
  });

  it("isolates explicit cache scopes even when the client instance stays the same", async () => {
    const oldPage = deferred<{ items: Notification[]; next_cursor: null }>();
    const newPage = deferred<{ items: Notification[]; next_cursor: null }>();
    const client = {
      listNotifications: vi.fn()
        .mockReturnValueOnce(oldPage.promise)
        .mockReturnValueOnce(newPage.promise),
    };
    const { result, rerender } = renderHook(
      (props: { cacheScope: string }) => useNotificationCenterData({ client: client as never, open: true, cacheScope: props.cacheScope }),
      { initialProps: { cacheScope: "user-old:workspace-1" } },
    );
    rerender({ cacheScope: "user-new:workspace-1" });
    expect(result.current.notifications).toEqual([]);
    expect(result.current.loading).toBe(true);
    oldPage.resolve({ items: [notification("late-old-scope")], next_cursor: null });
    newPage.resolve({ items: [notification("new-scope")], next_cursor: null });
    await waitFor(() => expect(result.current.notifications.map((item) => item.id)).toEqual(["new-scope"]));
    expect(result.current.notifications.some((item) => item.id === "late-old-scope")).toBe(false);
    expect(client.listNotifications).toHaveBeenCalledTimes(2);
  });

  it("ignores a late page append after the notification scope changes", async () => {
    const nextPage = deferred<{ items: Notification[]; next_cursor: null }>();
    const oldClient = {
      listNotifications: vi.fn(async ({ cursor }: { cursor?: string }) => cursor ? nextPage.promise : { items: [notification("page-one")], next_cursor: "next" }),
    };
    const newClient = { listNotifications: vi.fn(async () => ({ items: [notification("new-scope")], next_cursor: null })) };
    const { result, rerender } = renderHook(
      (props: { client: object; cacheScope: string }) => useNotificationCenterData({ ...props, client: props.client as never, open: true }),
      { initialProps: { client: oldClient, cacheScope: "user-1:workspace-old" } },
    );
    await waitFor(() => expect(result.current.nextCursor).toBe("next"));
    act(() => { void result.current.loadMore(); });
    rerender({ client: newClient, cacheScope: "user-1:workspace-new" });
    await waitFor(() => expect(newClient.listNotifications).toHaveBeenCalled());
    await waitFor(() => expect(result.current.notifications[0]?.id).toBe("new-scope"));
    nextPage.resolve({ items: [notification("late-page")], next_cursor: null });
    await act(async () => { await nextPage.promise; });
    expect(result.current.notifications.map((item) => item.id)).toEqual(["new-scope"]);
  });

  it("keeps stale notifications visible while a retry refreshes the page", async () => {
    const refreshed = deferred<{ items: Notification[]; next_cursor: null }>();
    const client = {
      listNotifications: vi.fn()
        .mockResolvedValueOnce({ items: [notification("stale")], next_cursor: null })
        .mockReturnValueOnce(refreshed.promise),
    };
    const { result } = renderHook(() => useNotificationCenterData({ client: client as never, open: true, cacheScope: "user-1:workspace-1" }));
    await waitFor(() => expect(result.current.notifications[0]?.id).toBe("stale"));

    act(() => result.current.retry());
    expect(result.current.notifications[0]?.id).toBe("stale");
    expect(result.current.refreshing).toBe(true);
    refreshed.resolve({ items: [notification("fresh")], next_cursor: null });
    await waitFor(() => expect(result.current.notifications[0]?.id).toBe("fresh"));
  });

  it("does not let a stale list refresh overwrite a successful read", async () => {
    const refreshed = deferred<{ items: Notification[]; next_cursor: null }>();
    const client = {
      listNotifications: vi.fn()
        .mockResolvedValueOnce({ items: [notification("read-race")], next_cursor: null })
        .mockReturnValueOnce(refreshed.promise),
      readNotification: vi.fn(async () => ({ notification_ids: ["read-race"], read_at: "2026-08-29T01:00:00.000Z" })),
    };
    const { result } = renderHook(() => useNotificationCenterData({ client: client as never, open: true, cacheScope: "user-1:workspace-read-race" }));
    await waitFor(() => expect(result.current.notifications[0]?.id).toBe("read-race"));

    act(() => result.current.retry());
    await waitFor(() => expect(client.listNotifications).toHaveBeenCalledTimes(2));
    await act(async () => { await result.current.markNotificationRead("read-race", 1); });
    expect(result.current.notifications[0]?.read_at).toBe("2026-08-29T01:00:00.000Z");

    refreshed.resolve({ items: [notification("read-race")], next_cursor: null });
    await act(async () => { await refreshed.promise; });
    expect(result.current.notifications[0]?.read_at).toBe("2026-08-29T01:00:00.000Z");
  });

  it("preserves a successful read when a late page append contains the old unread value", async () => {
    const nextPage = deferred<{ items: Notification[]; next_cursor: null }>();
    const first = notification("page-read-race");
    const client = {
      listNotifications: vi.fn(async ({ cursor }: { cursor?: string }) => cursor
        ? nextPage.promise
        : { items: [first], next_cursor: "next" }),
      readNotification: vi.fn(async () => ({ notification_ids: [first.id], read_at: "2026-08-29T01:00:00.000Z" })),
    };
    const { result } = renderHook(() => useNotificationCenterData({ client: client as never, open: true, cacheScope: "user-1:workspace-page-read-race" }));
    await waitFor(() => expect(result.current.nextCursor).toBe("next"));
    act(() => { void result.current.loadMore(); });
    await waitFor(() => expect(client.listNotifications).toHaveBeenCalledTimes(2));
    await act(async () => { await result.current.markNotificationRead(first.id, first.revision); });
    expect(result.current.pending).toBe(false);

    nextPage.resolve({ items: [notification(first.id), notification("page-two")], next_cursor: null });
    await act(async () => { await nextPage.promise; });
    expect(result.current.notifications.find((item) => item.id === first.id)?.read_at).toBe("2026-08-29T01:00:00.000Z");
  });

  it("ignores a late read response from the previous notification scope", async () => {
    const oldRead = deferred<{ notification_ids: string[]; read_at: string }>();
    const oldClient = {
      listNotifications: vi.fn(async () => ({ items: [notification("old")], next_cursor: null })),
      readNotification: vi.fn(() => oldRead.promise),
    };
    const newClient = {
      listNotifications: vi.fn(async () => ({ items: [notification("new")], next_cursor: null })),
      readNotification: vi.fn(),
    };
    const { result, rerender } = renderHook(
      (props: { client: object; cacheScope: string }) => useNotificationCenterData({ ...props, client: props.client as never, open: true }),
      { initialProps: { client: oldClient, cacheScope: "user-1:workspace-old" } },
    );
    await waitFor(() => expect(result.current.notifications[0]?.id).toBe("old"));
    const readPromise = result.current.markNotificationRead("old", 1);
    rerender({ client: newClient, cacheScope: "user-1:workspace-new" });
    await waitFor(() => expect(result.current.notifications[0]?.id).toBe("new"));
    oldRead.resolve({ notification_ids: ["old"], read_at: "2026-08-29T01:00:00.000Z" });
    await readPromise;
    expect(result.current.notifications[0]?.read_at).toBeNull();
  });

  it("does not create a refresh loop when two instances share a scope", async () => {
    let listCalls = 0;
    const client = {
      listNotifications: vi.fn(() => {
        listCalls += 1;
        if (listCalls > 2) return new Promise<{ items: Notification[]; next_cursor: string | null }>(() => undefined);
        return Promise.resolve({ items: [notification("shared")], next_cursor: null });
      }),
      readAllNotifications: vi.fn(async () => ({ count: 1, read_at: "2026-08-29T01:00:00.000Z" })),
    };
    const first = renderHook(() => useNotificationCenterData({ client: client as never, open: true, cacheScope: "user-1:workspace-1" }));
    await waitFor(() => expect(first.result.current.notifications).toHaveLength(1));
    const second = renderHook(() => useNotificationCenterData({ client: client as never, open: true, cacheScope: "user-1:workspace-1" }));
    expect(listCalls).toBe(1);

    await act(async () => { await first.result.current.readAll(); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 25)); });
    expect(listCalls).toBe(2);
    second.unmount();
    first.unmount();
  });

  it("deduplicates a list request when two instances mount concurrently", async () => {
    const page = deferred<{ items: Notification[]; next_cursor: null }>();
    const client = { listNotifications: vi.fn(() => page.promise) };
    const first = renderHook(() => useNotificationCenterData({ client: client as never, open: true, cacheScope: "user-concurrent:workspace-1" }));
    const second = renderHook(() => useNotificationCenterData({ client: client as never, open: true, cacheScope: "user-concurrent:workspace-1" }));
    expect(client.listNotifications).toHaveBeenCalledOnce();
    page.resolve({ items: [notification("concurrent")], next_cursor: null });
    await waitFor(() => expect(first.result.current.notifications).toHaveLength(1));
    await waitFor(() => expect(second.result.current.notifications).toHaveLength(1));
    first.unmount();
    second.unmount();
  });

  it("keeps a shared list request alive when one concurrent consumer changes scope", async () => {
    const sharedPage = deferred<{ items: Notification[]; next_cursor: null }>();
    const newPage = deferred<{ items: Notification[]; next_cursor: null }>();
    const signals: AbortSignal[] = [];
    const client = {
      listNotifications: vi.fn(({ signal }: { signal: AbortSignal }) => {
        signals.push(signal);
        return signals.length === 1 ? sharedPage.promise : newPage.promise;
      }),
    };
    const first = renderHook(
      (props: { cacheScope: string }) => useNotificationCenterData({ client: client as never, open: true, cacheScope: props.cacheScope }),
      { initialProps: { cacheScope: "user-shared:workspace-old" } },
    );
    const second = renderHook(() => useNotificationCenterData({ client: client as never, open: true, cacheScope: "user-shared:workspace-old" }));
    expect(client.listNotifications).toHaveBeenCalledOnce();

    first.rerender({ cacheScope: "user-shared:workspace-new" });
    await waitFor(() => expect(client.listNotifications).toHaveBeenCalledTimes(2));
    expect(signals[0]?.aborted).toBe(false);
    sharedPage.resolve({ items: [notification("shared-old")], next_cursor: null });
    await waitFor(() => expect(second.result.current.notifications[0]?.id).toBe("shared-old"));
    newPage.resolve({ items: [notification("shared-new")], next_cursor: null });
    await waitFor(() => expect(first.result.current.notifications[0]?.id).toBe("shared-new"));
    first.unmount();
    second.unmount();
  });

  it("allows pagination to resume after closing while a page request is unsettled", async () => {
    const firstPage = { items: [notification("page-close")], next_cursor: "next" as string | null };
    const abandonedPage = deferred<{ items: Notification[]; next_cursor: null }>();
    const resumedPage = deferred<{ items: Notification[]; next_cursor: null }>();
    const client = {
      listNotifications: vi.fn(({ cursor }: { cursor?: string }) => cursor
        ? (client.listNotifications.mock.calls.length === 2 ? abandonedPage.promise : resumedPage.promise)
        : Promise.resolve(firstPage)),
    };
    const { result, rerender } = renderHook(
      (props: { open: boolean }) => useNotificationCenterData({ client: client as never, open: props.open, cacheScope: "user-page-close:workspace-1" }),
      { initialProps: { open: true } },
    );
    await waitFor(() => expect(result.current.nextCursor).toBe("next"));
    act(() => { void result.current.loadMore(); });
    await waitFor(() => expect(client.listNotifications).toHaveBeenCalledTimes(2));
    const pageSignal = client.listNotifications.mock.calls[1]?.[0]?.signal as AbortSignal;
    rerender({ open: false });
    expect(pageSignal.aborted).toBe(true);

    rerender({ open: true });
    act(() => { void result.current.loadMore(); });
    await waitFor(() => expect(client.listNotifications).toHaveBeenCalledTimes(3));
    resumedPage.resolve({ items: [notification("page-resumed")], next_cursor: null });
    await waitFor(() => expect(result.current.notifications.some((item) => item.id === "page-resumed")).toBe(true));
    abandonedPage.resolve({ items: [notification("page-abandoned")], next_cursor: null });
  });

  it("clears pending commands when the notification dialog closes", async () => {
    let rejectRead!: (reason: unknown) => void;
    const read = new Promise<{ notification_ids: string[]; read_at: string }>((_resolve, reject) => { rejectRead = reject; });
    let readSignal: AbortSignal | undefined;
    const client = {
      listNotifications: vi.fn(async () => ({ items: [notification("pending-read")], next_cursor: null })),
      readNotification: vi.fn((_id: string, _revision: number, signal?: AbortSignal) => {
        readSignal = signal;
        signal?.addEventListener("abort", () => rejectRead(new DOMException("aborted", "AbortError")), { once: true });
        return read;
      }),
    };
    const { result, rerender } = renderHook(
      (props: { open: boolean }) => useNotificationCenterData({ client: client as never, open: props.open, cacheScope: "user-1:workspace-1" }),
      { initialProps: { open: true } },
    );
    await waitFor(() => expect(result.current.notifications).toHaveLength(1));
    let readPromise!: Promise<unknown>;
    act(() => { readPromise = result.current.markNotificationRead("pending-read", 1); });
    expect(result.current.pending).toBe(true);
    rerender({ open: false });
    expect(result.current.pending).toBe(false);
    expect(readSignal?.aborted).toBe(true);
    await act(async () => { await readPromise; });
    rerender({ open: true });
    expect(result.current.pending).toBe(false);
  });
});
