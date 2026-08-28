import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Note } from "@nexus/contracts";
import { useNotesListData } from "../src/app/use-notes-list-data";

const note = (id: string, title: string): Note => ({
  id,
  workspace_id: "ws-1",
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
  const promise = new Promise<T>((nextResolve) => { resolve = nextResolve; });
  return { promise, resolve };
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
});
