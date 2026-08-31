import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { WorkspaceRoleContract } from "@nexus/contracts";
import { useNoteDraftInput } from "../src/app/use-note-draft-input";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  return {
    promise: new Promise<T>((next, fail) => { resolve = next; reject = fail; }),
    resolve,
    reject,
  };
}

function params(overrides: Record<string, unknown> = {}) {
  const activeDraftIdRef = { current: "draft-a" };
  const save = vi.fn(async () => undefined);
  return {
    draftController: { save } as never,
    workspaceId: "ws-1",
    role: "editor" as WorkspaceRoleContract,
    logoutPending: false,
    selectedNoteId: null,
    creatingNote: true,
    activeDraftId: "draft-a",
    activeDraftIdRef,
    draftTitleRef: { current: "" },
    draftContentRef: { current: "" },
    mountedRef: { current: true },
    setDraftTitle: vi.fn(),
    setDraftContent: vi.fn(),
    setNoteMessage: vi.fn(),
    setNoteError: vi.fn(),
    ...overrides,
  };
}

describe("useNoteDraftInput", () => {
  it("publishes a current draft save failure for retry", async () => {
    const pending = deferred<void>();
    const base = params({ draftController: { save: vi.fn(() => pending.promise) } as never });
    const { result } = renderHook(() => useNoteDraftInput(base));

    act(() => { result.current.updateActiveDraftInput("标题", "正文"); });
    await act(async () => {
      pending.reject(new Error("offline"));
      await pending.promise.catch(() => undefined);
    });

    expect(base.setNoteError).toHaveBeenCalledWith("本地草稿保存失败，当前内容仍保留在编辑器中。请重试。");
  });

  it("does not publish an old save failure after the draft scope changes", async () => {
    const pending = deferred<void>();
    const base = params({ draftController: { save: vi.fn(() => pending.promise) } as never });
    const initialProps = { ...base, activeDraftId: "draft-a", selectedNoteId: null };
    const { result, rerender } = renderHook((props) => useNoteDraftInput(props), { initialProps });
    act(() => { result.current.updateActiveDraftInput("旧标题", "旧正文"); });

    base.activeDraftIdRef.current = "draft-b";
    rerender({ ...initialProps, activeDraftId: "draft-b", selectedNoteId: "note-b", creatingNote: false });
    await act(async () => {
      pending.reject(new Error("old save failed"));
      await pending.promise.catch(() => undefined);
    });

    expect(base.setNoteError).not.toHaveBeenCalledWith("本地草稿保存失败，当前内容仍保留在编辑器中。请重试。");
  });

  it("does not start a save from a callback retained after unmount", async () => {
    const base = params();
    const { result, unmount } = renderHook(() => useNoteDraftInput(base));
    const staleUpdate = result.current.updateActiveDraftInput;
    unmount();

    await act(async () => { staleUpdate("旧标题", "旧正文"); });

    expect((base.draftController as { save: ReturnType<typeof vi.fn> }).save).not.toHaveBeenCalled();
  });
});
