import { act, renderHook, waitFor } from "@testing-library/react";
import type { Note } from "@nexus/contracts";
import { describe, expect, it, vi } from "vitest";

import { useDailyNoteOpen } from "../src/app/use-daily-note-open";
import { localDateKey } from "../src/app/use-notes-list-data";

function note(overrides: Partial<Note> = {}): Note {
  return {
    id: "note-1",
    workspace_id: "ws-1",
    folder_id: null,
    database_id: null,
    created_by: "user-1",
    updated_by: "user-1",
    title: "Current note",
    content: "Current content",
    status: "active",
    is_favorite: false,
    is_pinned: false,
    daily_date: null,
    revision: 1,
    created_at: "2026-08-31T00:00:00.000Z",
    updated_at: "2026-08-31T00:00:00.000Z",
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function props(overrides: Record<string, unknown> = {}) {
  return {
    notesClient: { openOrCreateDaily: vi.fn(async (dailyDate: string) => note({ id: "daily-1", title: "Daily", daily_date: dailyDate })) },
    workspaceId: "ws-1",
    logoutPending: false,
    selectedNoteId: null,
    noteListView: "today",
    activeDraftId: null,
    creatingNote: false,
    notes: [] as Note[],
    openNote: vi.fn(),
    setNoteError: vi.fn(),
    ...overrides,
  };
}

describe("useDailyNoteOpen", () => {
  it("opens an existing daily note without issuing a create request", async () => {
    const existing = note({ id: "daily-existing", daily_date: localDateKey(), title: "Existing daily" });
    const input = props({ notes: [existing] });
    const { result } = renderHook(() => useDailyNoteOpen(input as never));

    await act(async () => { await result.current.openTodayNote(); });

    expect(input.notesClient.openOrCreateDaily).not.toHaveBeenCalled();
    expect(input.openNote).toHaveBeenCalledWith(existing, false);
    expect(result.current.dailyNoteOpening).toBe(false);
  });

  it("installs a remotely opened daily note in the current scope", async () => {
    const input = props();
    const { result } = renderHook(() => useDailyNoteOpen(input as never));

    await act(async () => { await result.current.openTodayNote(); });

    expect(input.notesClient.openOrCreateDaily).toHaveBeenCalledWith(localDateKey(), expect.any(AbortSignal));
    expect(input.openNote).toHaveBeenCalledWith(expect.objectContaining({ id: "daily-1" }), true);
    expect(result.current.dailyNoteOpening).toBe(false);
  });

  it("ignores a late Daily success after the selected note changes", async () => {
    const request = deferred<Note>();
    const input = props({ notesClient: { openOrCreateDaily: vi.fn(() => request.promise) } });
    const { result, rerender } = renderHook((value) => useDailyNoteOpen(value as never), { initialProps: input });
    let pending!: Promise<unknown>;

    act(() => { pending = result.current.openTodayNote(); });
    await waitFor(() => expect(input.notesClient.openOrCreateDaily).toHaveBeenCalledOnce());
    rerender({ ...input, selectedNoteId: "note-2" });
    let outcome: unknown;
    await act(async () => {
      request.resolve(note({ id: "daily-late", daily_date: localDateKey() }));
      outcome = await pending;
    });

    expect(input.openNote).not.toHaveBeenCalled();
    expect(input.setNoteError).not.toHaveBeenCalledWith(expect.stringContaining("暂时无法"));
    expect(outcome).toBeUndefined();
    expect(result.current.dailyNoteOpening).toBe(false);
  });

  it("ignores a late Daily success after the user leaves the Today view", async () => {
    const request = deferred<Note>();
    const input = props({ notesClient: { openOrCreateDaily: vi.fn(() => request.promise) } });
    const { result, rerender } = renderHook((value) => useDailyNoteOpen(value as never), { initialProps: input });
    let pending!: Promise<unknown>;

    act(() => { pending = result.current.openTodayNote(); });
    await waitFor(() => expect(input.notesClient.openOrCreateDaily).toHaveBeenCalledOnce());
    rerender({ ...input, noteListView: "all" });
    await act(async () => {
      request.resolve(note({ id: "daily-after-view-change", daily_date: localDateKey() }));
      await pending;
    });

    expect(input.openNote).not.toHaveBeenCalled();
    expect(result.current.dailyNoteOpening).toBe(false);
  });

  it("prevents duplicate Daily requests while one is pending", async () => {
    const request = deferred<Note>();
    const input = props({ notesClient: { openOrCreateDaily: vi.fn(() => request.promise) } });
    const { result } = renderHook(() => useDailyNoteOpen(input as never));

    let first!: Promise<unknown>;
    let duplicate!: Promise<unknown>;
    act(() => {
      first = result.current.openTodayNote();
      duplicate = result.current.openTodayNote();
    });

    expect(input.notesClient.openOrCreateDaily).toHaveBeenCalledOnce();
    await act(async () => {
      request.resolve(note({ id: "daily-1", daily_date: localDateKey() }));
      await Promise.all([first, duplicate]);
    });
    expect(input.openNote).toHaveBeenCalledOnce();
  });

  it("keeps the current selection and exposes a retryable error after failure", async () => {
    const input = props({
      selectedNoteId: "note-1",
      notesClient: { openOrCreateDaily: vi.fn(async () => { throw new Error("offline"); }) },
    });
    const { result } = renderHook(() => useDailyNoteOpen(input as never));

    const outcome = await act(async () => result.current.openTodayNote());

    expect(outcome).toEqual({ status: "rejected", message: "今日笔记暂时无法打开，可重试。当前选择和草稿内容已保留。" });
    expect(input.openNote).not.toHaveBeenCalled();
    expect(input.setNoteError).toHaveBeenCalledWith("今日笔记暂时无法打开，可重试。当前选择和草稿内容已保留。");
  });

  it("aborts the active request when unmounted", async () => {
    let requestSignal: AbortSignal | undefined;
    const input = props({ notesClient: { openOrCreateDaily: vi.fn((_date, signal) => {
      requestSignal = signal;
      return new Promise<Note>(() => undefined);
    }) } });
    const { result, unmount } = renderHook(() => useDailyNoteOpen(input as never));

    act(() => { void result.current.openTodayNote(); });
    await waitFor(() => expect(requestSignal).toBeInstanceOf(AbortSignal));
    unmount();

    expect(requestSignal?.aborted).toBe(true);
  });
});
