import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Note, SyncOperation, SyncOperationResult } from "@nexus/contracts";
import { useOfflineConflictRead } from "../src/app/use-offline-conflict-read";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  return {
    promise: new Promise<T>((next, fail) => { resolve = next; reject = fail; }),
    resolve,
    reject,
  };
}

function note(workspaceId = "ws-1"): Note {
  return {
    id: "server-1",
    workspace_id: workspaceId,
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
  };
}

function operation(workspaceId = "ws-1"): SyncOperation {
  return {
    operation_id: "operation-1",
    workspace_id: workspaceId,
    entity_type: "note",
    entity_id: "draft-1",
    base_revision: 1,
    kind: "update",
    patch: { title: "Local" },
    created_at: "2026-08-24T00:00:00.000Z",
  };
}

const conflictResult: SyncOperationResult = { operation_id: "operation-1", status: "conflict" };

describe("useOfflineConflictRead", () => {
  it("ignores a late server conflict read after the workspace and draft change", async () => {
    const pending = deferred<Note>();
    const get = vi.fn(() => pending.promise);
    const activeDraftIdRef = { current: "draft-1" };
    const setConflict = vi.fn();
    const setNoteError = vi.fn();
    const oldClient = { get };
    const { result, rerender } = renderHook(
      ({ workspaceId, client }) => useOfflineConflictRead({
        notesClient: client as never,
        workspaceId,
        activeDraftId: "draft-1",
        logoutPending: false,
        activeDraftIdRef,
        draftTitleRef: { current: "Local" },
        draftContentRef: { current: "Local body" },
        setConflict,
        setNoteError,
      }),
      { initialProps: { workspaceId: "ws-1", client: oldClient } },
    );

    act(() => { result.current.onConflict(operation(), conflictResult); });
    activeDraftIdRef.current = "draft-2";
    rerender({ workspaceId: "ws-2", client: { get: vi.fn() } });
    pending.resolve(note("ws-1"));
    await act(async () => { await pending.promise; });

    expect(setConflict).not.toHaveBeenCalled();
    expect(setNoteError).not.toHaveBeenCalled();
  });

  it("publishes only a current conflict read and passes an abort signal", async () => {
    const pending = deferred<Note>();
    const get = vi.fn(() => pending.promise);
    const activeDraftIdRef = { current: "draft-1" };
    const setConflict = vi.fn();
    const setNoteError = vi.fn();
    const { result } = renderHook(() => useOfflineConflictRead({
      notesClient: { get } as never,
      workspaceId: "ws-1",
      activeDraftId: "draft-1",
      logoutPending: false,
      activeDraftIdRef,
      draftTitleRef: { current: "Local" },
      draftContentRef: { current: "Local body" },
      setConflict,
      setNoteError,
    }));

    act(() => { result.current.onConflict(operation(), conflictResult); });
    expect(get).toHaveBeenCalledWith("draft-1", expect.any(AbortSignal));
    pending.resolve(note());
    await act(async () => { await pending.promise; });

    expect(setConflict).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: "ws-1", entityId: "draft-1", server: note() }));
  });

  it("ignores mismatched operations and retained callbacks after unmount", async () => {
    const get = vi.fn(async () => note());
    const setConflict = vi.fn();
    const setNoteError = vi.fn();
    const { result, unmount } = renderHook(() => useOfflineConflictRead({
      notesClient: { get } as never,
      workspaceId: "ws-1",
      activeDraftId: "draft-1",
      logoutPending: false,
      activeDraftIdRef: { current: "draft-1" },
      draftTitleRef: { current: "Local" },
      draftContentRef: { current: "Local body" },
      setConflict,
      setNoteError,
    }));
    const onConflict = result.current.onConflict;

    act(() => { onConflict(operation("ws-2"), conflictResult); });
    unmount();
    act(() => { onConflict(operation(), conflictResult); });
    await Promise.resolve();

    expect(get).not.toHaveBeenCalled();
    expect(setConflict).not.toHaveBeenCalled();
    expect(setNoteError).not.toHaveBeenCalled();
  });

  it("does not let an old callback read a new workspace through its old client", async () => {
    const oldGet = vi.fn(async () => note("ws-2"));
    const newGet = vi.fn(async () => note("ws-2"));
    const activeDraftIdRef = { current: "draft-1" };
    const initial = {
      workspaceId: "ws-1",
      client: { get: oldGet },
      activeDraftIdRef,
      draftTitleRef: { current: "Local" },
      draftContentRef: { current: "Local body" },
      activeDraftId: "draft-1",
      logoutPending: false,
      setConflict: vi.fn(),
      setNoteError: vi.fn(),
    };
    const { result, rerender } = renderHook(
      ({ workspaceId, client }) => useOfflineConflictRead({ ...initial, workspaceId, notesClient: client as never }),
      { initialProps: { workspaceId: "ws-1", client: initial.client } },
    );
    const staleCallback = result.current.onConflict;
    rerender({ workspaceId: "ws-2", client: { get: newGet } });

    act(() => { staleCallback(operation(), conflictResult); });
    await Promise.resolve();

    expect(oldGet).not.toHaveBeenCalled();
    expect(newGet).not.toHaveBeenCalled();
  });

  it("does not publish an A-B-A late read for the old draft generation", async () => {
    const pending = deferred<Note>();
    const get = vi.fn(() => pending.promise);
    const activeDraftIdRef = { current: "draft-a" };
    const initial = {
      workspaceId: "ws-1",
      client: { get },
      activeDraftIdRef,
      activeDraftId: "draft-a",
      logoutPending: false,
      draftTitleRef: { current: "Local A" },
      draftContentRef: { current: "Local A body" },
      setConflict: vi.fn(),
      setNoteError: vi.fn(),
    };
    const { result, rerender } = renderHook(
      (props) => useOfflineConflictRead({ ...initial, ...props, notesClient: props.client as never }),
      { initialProps: { activeDraftId: "draft-a", client: initial.client } },
    );
    act(() => { result.current.onConflict(operation(), conflictResult); });
    activeDraftIdRef.current = "draft-b";
    rerender({ activeDraftId: "draft-b", client: initial.client });
    activeDraftIdRef.current = "draft-a";
    rerender({ activeDraftId: "draft-a", client: initial.client });
    pending.resolve(note());
    await act(async () => { await pending.promise; });

    expect(initial.setConflict).not.toHaveBeenCalled();
  });

  it("does not start or publish a conflict read after logout begins", async () => {
    const get = vi.fn(async () => note());
    const initial = {
      workspaceId: "ws-1",
      client: { get },
      activeDraftIdRef: { current: "draft-1" },
      activeDraftId: "draft-1",
      logoutPending: false,
      draftTitleRef: { current: "Local" },
      draftContentRef: { current: "Local body" },
      setConflict: vi.fn(),
      setNoteError: vi.fn(),
    };
    const { result, rerender } = renderHook(
      (props) => useOfflineConflictRead({ ...initial, ...props, notesClient: props.client as never }),
      { initialProps: { logoutPending: false, client: initial.client } },
    );
    const staleCallback = result.current.onConflict;
    rerender({ logoutPending: true, client: initial.client });
    act(() => { staleCallback(operation(), conflictResult); });
    await Promise.resolve();

    expect(get).not.toHaveBeenCalled();
    expect(initial.setConflict).not.toHaveBeenCalled();
    expect(initial.setNoteError).not.toHaveBeenCalled();
  });

  it("preserves operation patch values as the local conflict snapshot", async () => {
    const get = vi.fn(async () => note());
    const setConflict = vi.fn();
    const operationWithPatch = operation();
    operationWithPatch.patch = { title: "操作本地标题", content: "操作本地正文" };
    const { result } = renderHook(() => useOfflineConflictRead({
      notesClient: { get } as never,
      workspaceId: "ws-1",
      activeDraftId: "draft-1",
      logoutPending: false,
      activeDraftIdRef: { current: "draft-1" },
      draftTitleRef: { current: "编辑器标题" },
      draftContentRef: { current: "编辑器正文" },
      setConflict,
      setNoteError: vi.fn(),
    }));

    act(() => { result.current.onConflict(operationWithPatch, conflictResult); });
    await Promise.resolve();

    expect(setConflict).toHaveBeenCalledWith(expect.objectContaining({
      local: { title: "操作本地标题", content: "操作本地正文" },
    }));
  });

  it("does not start a read when the active draft state does not match the operation", async () => {
    const get = vi.fn(async () => note());
    const { result } = renderHook(() => useOfflineConflictRead({
      notesClient: { get } as never,
      workspaceId: "ws-1",
      activeDraftId: "draft-2",
      logoutPending: false,
      activeDraftIdRef: { current: "draft-1" },
      draftTitleRef: { current: "Local" },
      draftContentRef: { current: "Local body" },
      setConflict: vi.fn(),
      setNoteError: vi.fn(),
    }));

    act(() => { result.current.onConflict(operation(), conflictResult); });
    await Promise.resolve();

    expect(get).not.toHaveBeenCalled();
  });
});
