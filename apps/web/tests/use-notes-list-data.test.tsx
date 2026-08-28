import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Note } from "@nexus/contracts";
import { useNotesListData } from "../src/app/use-notes-list-data";

const note = (id: string, title: string, workspaceId = "ws-1"): Note => ({
  id,
  workspace_id: workspaceId,
  folder_id: null,
  database_id: null,
  created_by: "user-1",
  updated_by: "user-1",
  title,
  content: `${title} body`,
  status: "active",
  is_favorite: false,
  is_pinned: false,
  daily_date: null,
  revision: 1,
  created_at: "2026-08-28T00:00:00.000Z",
  updated_at: "2026-08-28T00:00:00.000Z",
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

describe("useNotesListData", () => {
  it("loads the first page and appends a cursor page with the active filters", async () => {
    const first = note("note-1", "First");
    const second = note("note-2", "Second");
    const list = vi.fn((options: { cursor?: string }) => Promise.resolve(options.cursor
      ? { items: [second], next_cursor: null }
      : { items: [first], next_cursor: "cursor-2" }));
    const notesClient = { list };
    const selectedNoteId = { current: null as string | null };
    const setSelectedNoteId = vi.fn((value: string | null) => { selectedNoteId.current = value; });
    const setCreatingNote = vi.fn();
    const refs = {
      installedNotesRef: { current: new Map<string, Note>() },
      activeDraftIdRef: { current: null as string | null },
      activationInFlight: { current: false },
      userSelectedNote: { current: false },
    };
    const { result } = renderHook(() => useNotesListData({
      notesClient,
      workspaceId: "ws-1",
      noteListView: "all",
      noteFolderFilter: null,
      debouncedNoteSearchQuery: "",
      refreshVersion: 0,
      ...refs,
      setSelectedNoteId,
      setCreatingNote,
    }));

    await waitFor(() => expect(result.current.notes).toEqual([first]));
    expect(setSelectedNoteId).toHaveBeenCalledWith("note-1");
    expect(result.current.notesNextCursor).toBe("cursor-2");

    act(() => result.current.loadMoreNotes());
    await waitFor(() => expect(result.current.notes).toEqual([first, second]));
    expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: "cursor-2", status: "active", limit: 50, signal: expect.any(AbortSignal) }));
    expect(result.current.notesNextCursor).toBeNull();
  });

  it("ignores a late response from a superseded filter request", async () => {
    const oldRequest = deferred<{ items: Note[]; next_cursor: null }>();
    const current = note("note-current", "Current");
    const list = vi.fn((options: { query?: string }) => options.query === "old"
      ? oldRequest.promise
      : Promise.resolve({ items: [current], next_cursor: null }));
    const notesClient = { list };
    const installedNotesRef = { current: new Map<string, Note>() };
    const activeDraftIdRef = { current: null as string | null };
    const activationInFlight = { current: false };
    const userSelectedNote = { current: false };
    const setSelectedNoteId = vi.fn();
    const setCreatingNote = vi.fn();
    const { result, rerender } = renderHook(
      ({ query }) => useNotesListData({
        notesClient,
        workspaceId: "ws-1",
        noteListView: "all",
        noteFolderFilter: null,
        debouncedNoteSearchQuery: query,
        refreshVersion: 0,
        installedNotesRef,
        activeDraftIdRef,
        activationInFlight,
        userSelectedNote,
        setSelectedNoteId,
        setCreatingNote,
      }),
      { initialProps: { query: "old" } },
    );

    rerender({ query: "current" });
    await waitFor(() => expect(result.current.notes).toEqual([current]));
    oldRequest.resolve({ items: [note("late", "Late")], next_cursor: null });
    await act(async () => { await oldRequest.promise; });
    expect(result.current.notes).toEqual([current]);
  });

  it("clears old workspace notes immediately and ignores a late refresh before loading the new workspace", async () => {
    const oldRefresh = deferred<{ items: Note[]; next_cursor: string | null }>();
    const newWorkspace = deferred<{ items: Note[]; next_cursor: string | null }>();
    const oldNote = note("note-old", "Old workspace", "ws-old");
    const lateOldNote = note("note-late", "Late old workspace", "ws-old");
    const newNote = note("note-new", "New workspace", "ws-new");
    const list = vi.fn()
      .mockResolvedValueOnce({ items: [oldNote], next_cursor: "old-next" })
      .mockReturnValueOnce(oldRefresh.promise)
      .mockReturnValueOnce(newWorkspace.promise);
    const notesClient = { list };
    const installedNotesRef = { current: new Map<string, Note>() };
    const activeDraftIdRef = { current: null as string | null };
    const activationInFlight = { current: false };
    const userSelectedNote = { current: false };
    const setSelectedNoteId = vi.fn();
    const setCreatingNote = vi.fn();
    const { result, rerender } = renderHook(
      ({ workspaceId, refreshVersion }) => useNotesListData({
        notesClient,
        workspaceId,
        noteListView: "all",
        noteFolderFilter: null,
        debouncedNoteSearchQuery: "",
        refreshVersion,
        installedNotesRef,
        activeDraftIdRef,
        activationInFlight,
        userSelectedNote,
        setSelectedNoteId,
        setCreatingNote,
      }),
      { initialProps: { workspaceId: "ws-old", refreshVersion: 0 } },
    );

    await waitFor(() => expect(result.current.notes).toEqual([oldNote]));
    rerender({ workspaceId: "ws-old", refreshVersion: 1 });
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));

    rerender({ workspaceId: "ws-new", refreshVersion: 1 });

    await waitFor(() => expect(result.current.notes).toEqual([]));
    expect(setSelectedNoteId).toHaveBeenLastCalledWith(null);
    expect(setCreatingNote).toHaveBeenLastCalledWith(false);

    oldRefresh.resolve({ items: [lateOldNote], next_cursor: "late-old-next" });
    await act(async () => { await oldRefresh.promise; });
    expect(result.current.notes).toEqual([]);
    expect(result.current.notesNextCursor).toBeNull();

    newWorkspace.resolve({ items: [newNote], next_cursor: "new-next" });
    await waitFor(() => expect(result.current.notes).toEqual([newNote]));
    expect(result.current.notesNextCursor).toBe("new-next");
    expect(setSelectedNoteId).toHaveBeenLastCalledWith("note-new");
  });

  it("keeps visible notes while a same-workspace refresh is pending", async () => {
    const refreshed = deferred<{ items: Note[]; next_cursor: null }>();
    const first = note("note-visible", "Visible before refresh");
    const next = note("note-refreshed", "Refreshed content");
    const list = vi.fn()
      .mockResolvedValueOnce({ items: [first], next_cursor: "next-before-refresh" })
      .mockReturnValueOnce(refreshed.promise);
    const notesClient = { list };
    const installedNotesRef = { current: new Map<string, Note>() };
    const activeDraftIdRef = { current: "draft-1" };
    const activationInFlight = { current: false };
    const userSelectedNote = { current: true };
    const setSelectedNoteId = vi.fn();
    const setCreatingNote = vi.fn();
    const { result, rerender } = renderHook(
      ({ refreshVersion }) => useNotesListData({
        notesClient,
        workspaceId: "ws-1",
        noteListView: "all",
        noteFolderFilter: null,
        debouncedNoteSearchQuery: "",
        refreshVersion,
        installedNotesRef,
        activeDraftIdRef,
        activationInFlight,
        userSelectedNote,
        setSelectedNoteId,
        setCreatingNote,
      }),
      { initialProps: { refreshVersion: 0 } },
    );

    await waitFor(() => expect(result.current.notes).toEqual([first]));
    rerender({ refreshVersion: 1 });
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));

    expect(result.current.notes).toEqual([first]);
    expect(result.current.notesLoading).toBe(true);
    expect(setSelectedNoteId).not.toHaveBeenCalledWith(null);
    expect(setCreatingNote).not.toHaveBeenCalledWith(false);

    refreshed.resolve({ items: [next], next_cursor: null });
    await waitFor(() => expect(result.current.notes).toEqual([next]));
    expect(result.current.notesLoading).toBe(false);
  });

  it("does not surface an old workspace rejection after switching", async () => {
    const oldRequest = deferred<{ items: Note[]; next_cursor: null }>();
    const newRequest = deferred<{ items: Note[]; next_cursor: null }>();
    const list = vi.fn()
      .mockReturnValueOnce(oldRequest.promise)
      .mockReturnValueOnce(newRequest.promise);
    const notesClient = { list };
    const refs = {
      installedNotesRef: { current: new Map<string, Note>() },
      activeDraftIdRef: { current: null as string | null },
      activationInFlight: { current: false },
      userSelectedNote: { current: false },
    };
    const setSelectedNoteId = vi.fn();
    const setCreatingNote = vi.fn();
    const { result, rerender } = renderHook(
      ({ workspaceId }) => useNotesListData({
        notesClient,
        workspaceId,
        noteListView: "all",
        noteFolderFilter: null,
        debouncedNoteSearchQuery: "",
        refreshVersion: 0,
        ...refs,
        setSelectedNoteId,
        setCreatingNote,
      }),
      { initialProps: { workspaceId: "ws-old" } },
    );

    rerender({ workspaceId: "ws-new" });
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    oldRequest.reject(new Error("old workspace failed"));
    await act(async () => {
      await expect(oldRequest.promise).rejects.toThrow("old workspace failed");
    });

    expect(result.current.notesError).toBeNull();
    expect(result.current.notesLoading).toBe(true);
    expect(result.current.notes).toEqual([]);

    newRequest.resolve({ items: [note("new-note", "New", "ws-new")], next_cursor: null });
    await waitFor(() => expect(result.current.notes).toHaveLength(1));
  });
});
