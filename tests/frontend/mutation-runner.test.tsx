import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { useMutationRunner } from "@/hooks/useMutationRunner";

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe("useMutationRunner", () => {
  it("sets and clears pending state around successful mutations", async () => {
    const setPendingMutation = vi.fn();
    const { result } = renderHook(() => useMutationRunner({ pendingMutations: [], setPendingMutation }));

    await act(async () => {
      await result.current.runMutation("note:create", async () => "ok", { successMessage: "已完成" });
    });

    expect(setPendingMutation).toHaveBeenNthCalledWith(1, "note:create", true);
    expect(setPendingMutation).toHaveBeenLastCalledWith("note:create", false);
    expect(toast.success).toHaveBeenCalledWith("已完成", expect.objectContaining({
      className: expect.stringContaining("nexus-toast-success"),
    }));
  });

  it("blocks duplicate pending mutations before running the task", async () => {
    const setPendingMutation = vi.fn();
    const task = vi.fn(async () => "ok");
    const { result } = renderHook(() => useMutationRunner({ pendingMutations: ["note:create"], setPendingMutation }));

    await expect(result.current.runMutation("note:create", task)).rejects.toThrow("操作正在处理中，请稍候");

    expect(task).not.toHaveBeenCalled();
    expect(setPendingMutation).not.toHaveBeenCalled();
  });

  it("runs rollback and maps errors through toast", async () => {
    const setPendingMutation = vi.fn();
    const rollback = vi.fn();
    const error = new Error("network down");
    const { result } = renderHook(() => useMutationRunner({ pendingMutations: [], setPendingMutation }));

    await expect(result.current.runMutation("note:delete", async () => {
      throw error;
    }, { errorMessage: "删除失败", rollback })).rejects.toThrow(error);

    expect(rollback).toHaveBeenCalledWith(error);
    expect(toast.error).toHaveBeenCalledWith("network down", expect.objectContaining({
      className: expect.stringContaining("nexus-toast-network"),
    }));
    expect(setPendingMutation).toHaveBeenLastCalledWith("note:delete", false);
  });

  it("can suppress error toast for mutations that handle their own error UI", async () => {
    const setPendingMutation = vi.fn();
    const { result } = renderHook(() => useMutationRunner({ pendingMutations: [], setPendingMutation }));

    await expect(result.current.runMutation("note:batch-delete", async () => {
      throw new Error("handled");
    }, { showErrorToast: false })).rejects.toThrow("handled");

    expect(toast.error).not.toHaveBeenCalled();
    expect(setPendingMutation).toHaveBeenLastCalledWith("note:batch-delete", false);
  });
});
