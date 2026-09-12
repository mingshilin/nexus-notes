import { act, renderHook, waitFor } from "@testing-library/react";
import type { Note, NoteRevision } from "@nexus/contracts";
import { describe, expect, it, vi } from "vitest";

import { useNoteRevisionRestore } from "../src/app/use-note-revision-restore";

function note(overrides: Partial<Note> = {}): Note {
  return {
    id: "note-1",
    workspace_id: "ws-1",
    folder_id: null,
    database_id: null,
    created_by: "user-1",
    updated_by: "user-1",
    title: "Current title",
    content: "Current content",
    status: "active",
    is_favorite: false,
    is_pinned: false,
    daily_date: null,
    revision: 2,
    created_at: "2026-08-31T00:00:00.000Z",
    updated_at: "2026-08-31T00:00:00.000Z",
    ...overrides,
  };
}

const revision: NoteRevision = {
  id: "revision-1",
  workspace_id: "ws-1",
  note_id: "note-1",
  revision: 1,
  title: "Old title",
  content: "Old content",
  source: "manual",
  created_by: "user-1",
  created_at: "2026-08-30T00:00:00.000Z",
};

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
  const selectedNote = (overrides.selectedNote as Note | null | undefined) ?? note();
  return {
    notesClient: { restore: vi.fn(async () => note({ title: "Old title", content: "Old content", revision: 3 })) },
    workspaceId: "ws-1",
    role: "editor",
    logoutPending: false,
    selectedNote,
    installNote: vi.fn(),
    resetHistory: vi.fn(),
    setHistoryError: vi.fn(),
    setNoteMessage: vi.fn(),
    ...overrides,
  };
}

describe("useNoteRevisionRestore", () => {
  it("restores the selected revision and installs it only in the current scope", async () => {
    const input = props();
    const { result } = renderHook(() => useNoteRevisionRestore(input as never));

    await act(async () => { await result.current.restoreRevision(revision); });

    expect(input.notesClient.restore).toHaveBeenCalledWith("note-1", 1, { base_revision: 2 }, expect.any(AbortSignal));
    expect(input.installNote).toHaveBeenCalledOnce();
    expect(input.resetHistory).toHaveBeenCalledOnce();
    expect(input.setNoteMessage).toHaveBeenCalledWith("已恢复版本 1");
    expect(result.current.restoringRevision).toBeNull();
  });

  it("ignores a late success after the selected note changes", async () => {
    const request = deferred<Note>();
    const input = props({ notesClient: { restore: vi.fn(() => request.promise) } });
    const { result, rerender } = renderHook((value) => useNoteRevisionRestore(value as never), { initialProps: input });
    let pending!: Promise<void>;

    act(() => { pending = result.current.restoreRevision(revision); });
    await waitFor(() => expect(input.notesClient.restore).toHaveBeenCalledOnce());
    rerender({ ...input, selectedNote: note({ id: "note-2", title: "Second", revision: 1 }) });
    await act(async () => {
      request.resolve(note({ title: "Old title", content: "Old content", revision: 3 }));
      await pending;
    });

    expect(input.installNote).not.toHaveBeenCalled();
    expect(input.resetHistory).not.toHaveBeenCalled();
    expect(input.setNoteMessage).not.toHaveBeenCalled();
  });

  it("does not publish a late error after logout begins", async () => {
    const request = deferred<Note>();
    const input = props({ notesClient: { restore: vi.fn(() => request.promise) } });
    const { result, rerender } = renderHook((value) => useNoteRevisionRestore(value as never), { initialProps: input });
    let pending!: Promise<void>;

    act(() => { pending = result.current.restoreRevision(revision); });
    await waitFor(() => expect(input.notesClient.restore).toHaveBeenCalledOnce());
    rerender({ ...input, logoutPending: true });
    await act(async () => {
      request.reject(new Error("network"));
      await pending;
    });

    expect(input.setHistoryError).not.toHaveBeenCalledWith(expect.stringContaining("失败"));
    expect(result.current.restoringRevision).toBeNull();
  });

  it("prevents duplicate restore requests while one is pending", async () => {
    const request = deferred<Note>();
    const input = props({ notesClient: { restore: vi.fn(() => request.promise) } });
    const { result } = renderHook(() => useNoteRevisionRestore(input as never));

    let first!: Promise<void>;
    let duplicate!: Promise<void>;
    act(() => {
      first = result.current.restoreRevision(revision);
      duplicate = result.current.restoreRevision(revision);
    });

    expect(input.notesClient.restore).toHaveBeenCalledOnce();
    await act(async () => {
      request.resolve(note({ revision: 3 }));
      await Promise.all([first, duplicate]);
    });
    expect(input.installNote).toHaveBeenCalledOnce();
  });

  it("aborts the active request when unmounted", async () => {
    let requestSignal: AbortSignal | undefined;
    const input = props({ notesClient: { restore: vi.fn((_id, _revision, _body, signal) => {
      requestSignal = signal;
      return new Promise<Note>(() => undefined);
    }) } });
    const { result, unmount } = renderHook(() => useNoteRevisionRestore(input as never));

    act(() => { void result.current.restoreRevision(revision); });
    await waitFor(() => expect(requestSignal).toBeInstanceOf(AbortSignal));
    unmount();

    expect(requestSignal?.aborted).toBe(true);
  });
});
