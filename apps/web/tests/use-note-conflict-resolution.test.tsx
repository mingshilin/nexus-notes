import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Note, WorkspaceRoleContract } from "@nexus/contracts";
import { useNoteConflictResolution, type NoteConflictState } from "../src/app/use-note-conflict-resolution";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  return {
    promise: new Promise<T>((next, fail) => { resolve = next; reject = fail; }),
    resolve,
    reject,
  };
}

const note = (overrides: Partial<Note> = {}): Note => ({
  id: "server-1",
  workspace_id: "ws-1",
  folder_id: null,
  database_id: null,
  created_by: "user-1",
  updated_by: "user-1",
  title: "Server",
  content: "Server body",
  status: "active",
  is_favorite: false,
  is_pinned: false,
  daily_date: null,
  revision: 2,
  created_at: "2026-08-24T00:00:00.000Z",
  updated_at: "2026-08-24T00:00:01.000Z",
  ...overrides,
});

const conflict = (overrides: Partial<NoteConflictState> = {}): NoteConflictState => ({
  workspaceId: "ws-1",
  entityId: "draft-1",
  local: { title: "Local", content: "Local body" },
  server: note(),
  ...overrides,
});

describe("useNoteConflictResolution", () => {
  it("does not let an old editor callback start after the role becomes viewer", async () => {
    const resolveConflict = vi.fn(async () => null);
    const activeDraftIdRef = { current: "draft-1" };
    const shared = {
      draftController: { resolveConflict } as never,
      workspaceId: "ws-1",
      logoutPending: false,
      activeDraftId: "draft-1",
      activeDraftIdRef,
      conflict: conflict(),
      setConflict: vi.fn(),
      setResolving: vi.fn(),
      setServerRetryVersion: vi.fn(),
      setDraftTitle: vi.fn(),
      setDraftContent: vi.fn(),
      setDraftFolderId: vi.fn(),
      setDraftDatabaseId: vi.fn(),
      draftTitleRef: { current: "Local" },
      draftContentRef: { current: "Local body" },
      setNoteMessage: vi.fn(),
      setNoteError: vi.fn(),
    };
    const initialProps = { role: "editor" as WorkspaceRoleContract };
    const { result, rerender } = renderHook(
      (props: typeof initialProps) => useNoteConflictResolution({ ...shared, ...props }),
      { initialProps },
    );
    const staleResolve = result.current.resolve;

    rerender({ role: "viewer" });
    await act(async () => { await staleResolve("server"); });

    expect(resolveConflict).not.toHaveBeenCalled();
  });

  it("does not start a conflict mutation from a callback retained after unmount", async () => {
    const resolveConflict = vi.fn(async () => null);
    const activeDraftIdRef = { current: "draft-1" };
    const { result, unmount } = renderHook(() => useNoteConflictResolution({
      draftController: { resolveConflict } as never,
      workspaceId: "ws-1",
      role: "editor",
      logoutPending: false,
      activeDraftId: "draft-1",
      activeDraftIdRef,
      conflict: conflict(),
      setConflict: vi.fn(),
      setResolving: vi.fn(),
      setServerRetryVersion: vi.fn(),
      setDraftTitle: vi.fn(),
      setDraftContent: vi.fn(),
      setDraftFolderId: vi.fn(),
      setDraftDatabaseId: vi.fn(),
      draftTitleRef: { current: "Local" },
      draftContentRef: { current: "Local body" },
      setNoteMessage: vi.fn(),
      setNoteError: vi.fn(),
    }));
    const staleResolve = result.current.resolve;
    unmount();

    await act(async () => { await staleResolve("server"); });

    expect(resolveConflict).not.toHaveBeenCalled();
  });

  it("does not publish an old failure after the active conflict changes", async () => {
    const first = deferred<unknown>();
    const resolveConflict = vi.fn(() => first.promise);
    const activeDraftIdRef = { current: "draft-1" };
    const setConflict = vi.fn();
    const setNoteError = vi.fn();
    const shared = {
      draftController: { resolveConflict } as never,
      workspaceId: "ws-1",
      role: "editor" as WorkspaceRoleContract,
      logoutPending: false,
      activeDraftIdRef,
      setConflict,
      setResolving: vi.fn(),
      setServerRetryVersion: vi.fn(),
      setDraftTitle: vi.fn(),
      setDraftContent: vi.fn(),
      setDraftFolderId: vi.fn(),
      setDraftDatabaseId: vi.fn(),
      draftTitleRef: { current: "Local" },
      draftContentRef: { current: "Local body" },
      setNoteMessage: vi.fn(),
      setNoteError,
    };
    const firstConflict = conflict();
    const initialProps = { activeDraftId: "draft-1", conflict: firstConflict };
    const { result, rerender } = renderHook(
      (props: typeof initialProps) => useNoteConflictResolution({ ...shared, ...props }),
      { initialProps },
    );
    let pending!: Promise<void>;
    act(() => { pending = result.current.resolve("server"); });

    activeDraftIdRef.current = "draft-2";
    rerender({
      activeDraftId: "draft-2",
      conflict: conflict({ entityId: "draft-2", server: note({ id: "server-2" }) }),
    });
    await act(async () => {
      first.reject(new Error("old conflict failure"));
      await pending;
    });

    expect(setConflict).not.toHaveBeenCalled();
    expect(setNoteError).not.toHaveBeenCalledWith("冲突恢复失败，本地和服务器版本均已保留。请重试。");
  });

  it("does not let an A-B-A old finally unlock the new conflict request", async () => {
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    const resolveConflict = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const activeDraftIdRef = { current: "draft-a" };
    const setConflict = vi.fn();
    const setResolving = vi.fn();
    const shared = {
      draftController: { resolveConflict } as never,
      workspaceId: "ws-1",
      role: "editor" as WorkspaceRoleContract,
      logoutPending: false,
      activeDraftIdRef,
      setConflict,
      setResolving,
      setServerRetryVersion: vi.fn(),
      setDraftTitle: vi.fn(),
      setDraftContent: vi.fn(),
      setDraftFolderId: vi.fn(),
      setDraftDatabaseId: vi.fn(),
      draftTitleRef: { current: "Local" },
      draftContentRef: { current: "Local body" },
      setNoteMessage: vi.fn(),
      setNoteError: vi.fn(),
    };
    const conflictA = conflict({ entityId: "draft-a" });
    const initialProps = { activeDraftId: "draft-a", conflict: conflictA };
    const { result, rerender } = renderHook(
      (props: typeof initialProps) => useNoteConflictResolution({ ...shared, ...props }),
      { initialProps },
    );
    let oldRequest!: Promise<void>;
    act(() => { oldRequest = result.current.resolve("server"); });

    activeDraftIdRef.current = "draft-b";
    rerender({ activeDraftId: "draft-b", conflict: conflict({ entityId: "draft-b", server: note({ id: "server-b" }) }) });
    activeDraftIdRef.current = "draft-a";
    rerender({ activeDraftId: "draft-a", conflict: conflict({ entityId: "draft-a", server: note({ id: "server-a-new" }) }) });
    let newRequest!: Promise<void>;
    act(() => { newRequest = result.current.resolve("local"); });

    await act(async () => {
      first.resolve({});
      await oldRequest;
    });
    expect(setResolving.mock.calls.at(-1)?.[0]).toBe(true);
    expect(setConflict).not.toHaveBeenCalled();

    await act(async () => {
      second.resolve({});
      await newRequest;
    });
    expect(setConflict).toHaveBeenCalledWith(null);
    expect(setResolving.mock.calls.at(-1)?.[0]).toBe(false);
  });
});
