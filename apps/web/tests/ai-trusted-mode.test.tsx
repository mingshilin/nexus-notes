import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AIActionHistoryPanel } from "../src/ai/AIActionHistoryPanel";
import { AITrustedModePanel } from "../src/ai/AITrustedModePanel";

function modeClient() {
  return {
    getAiTrustedMode: vi.fn(async (workspaceId: string) => ({
      workspace_id: workspaceId,
      enabled: true,
      expires_at: "2099-08-29T00:00:00.000Z",
      revision: 3,
    })),
    updateAiTrustedMode: vi.fn(async (workspaceId: string, input: unknown) => ({
      workspace_id: workspaceId,
      enabled: (input as { enabled: boolean }).enabled,
      expires_at: (input as { expires_at: string | null }).expires_at,
      revision: 4,
    })),
  };
}

describe("AI trusted mode panel", () => {
  it("shows the active workspace, expiry, and a one-click disable action", async () => {
    const client = modeClient();
    render(<AITrustedModePanel client={client as never} workspaceId="ws-1" />);

    expect(await screen.findByText("当前工作区：ws-1")).toBeInTheDocument();
    expect(screen.getByText("AI 自动执行已开启")).toBeInTheDocument();
    expect(screen.getByText(/到期时间/)).toBeInTheDocument();
    const disable = screen.getByRole("button", { name: "关闭 AI 自动执行" });
    disable.focus();
    expect(disable).toHaveFocus();
    fireEvent.click(disable);

    await waitFor(() => expect(client.updateAiTrustedMode).toHaveBeenCalledWith("ws-1", {
      enabled: false,
      expires_at: null,
      base_revision: 3,
    }));
    expect(await screen.findByText("AI 自动执行已关闭")).toBeInTheDocument();
  });

  it("resets workspace-scoped state and ignores a late response after switching workspaces", async () => {
    let resolveFirst!: (value: unknown) => void;
    const client = {
      getAiTrustedMode: vi.fn((workspaceId: string) => workspaceId === "ws-1"
        ? new Promise((resolve) => { resolveFirst = resolve; })
        : Promise.resolve({ workspace_id: "ws-2", enabled: false, expires_at: null, revision: 1 })),
      updateAiTrustedMode: vi.fn(),
    };
    const view = render(<AITrustedModePanel client={client as never} workspaceId="ws-1" />);
    view.rerender(<AITrustedModePanel client={client as never} workspaceId="ws-2" />);

    expect(await screen.findByText("当前工作区：ws-2")).toBeInTheDocument();
    expect(screen.getByText("AI 自动执行已关闭")).toBeInTheDocument();
    resolveFirst({ workspace_id: "ws-1", enabled: true, expires_at: "2099-08-29T00:00:00.000Z", revision: 9 });
    await Promise.resolve();
    expect(screen.queryByText("AI 自动执行已开启")).not.toBeInTheDocument();
  });
});

describe("AI action history panel", () => {
  it("filters safe history metadata without rendering prompt, body, key, or token fields", async () => {
    const client = {
      listAiActionHistory: vi.fn(async () => [
        { action_id: "action-1", tool: "create_note", risk: "safe_write", status: "executed", created_at: "2026-08-28T00:00:00.000Z", updated_at: "2026-08-28T00:00:01.000Z" },
        { action_id: "action-2", tool: "send_email", risk: "external_or_destructive", status: "failed", error_code: "AI_EMAIL_RETRYABLE_FAILURE", created_at: "2026-08-28T00:01:00.000Z", updated_at: "2026-08-28T00:01:01.000Z" },
      ]),
    };
    render(<AIActionHistoryPanel client={client as never} workspaceId="ws-1" />);

    expect(await screen.findByText("action-1")).toBeInTheDocument();
    expect(screen.getByText("action-2")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("筛选状态"), { target: { value: "failed" } });
    expect(screen.queryByText("action-1")).not.toBeInTheDocument();
    expect(screen.getByText("AI_EMAIL_RETRYABLE_FAILURE")).toBeInTheDocument();
    expect(screen.queryByText(/prompt|body|api_key|token|secret/iu)).not.toBeInTheDocument();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
});
