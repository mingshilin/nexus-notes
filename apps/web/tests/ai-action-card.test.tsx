import type { AiActionProposal } from "@nexus/contracts";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AIActionCard } from "../src/ai/AIActionCard";

function emailProposal(overrides: Partial<AiActionProposal> = {}): AiActionProposal {
  return {
    action_id: "action-email-1",
    tool: "send_email",
    summary: "发送邮件待确认",
    input: {
      to_email: "user@example.test",
      subject: "项目更新",
      body_text: "这里是邮件正文。",
    },
    requires_confirmation: true,
    expires_at: "2099-08-25T01:00:00.000Z",
    ...overrides,
  } as AiActionProposal;
}

describe("AIActionCard", () => {
  it("renders an email preview and moves keyboard focus to the confirm button", () => {
    const onConfirm = vi.fn();
    const onReject = vi.fn();

    render(
      <AIActionCard
        proposal={emailProposal()}
        status="proposed"
        autoFocus
        onConfirm={onConfirm}
        onReject={onReject}
      />,
    );

    expect(screen.getByText("发送邮件待确认")).toBeInTheDocument();
    expect(screen.getByText("user@example.test")).toBeInTheDocument();
    expect(screen.getByText("项目更新")).toBeInTheDocument();
    expect(screen.getByText("这里是邮件正文。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "确认执行" })).toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: "拒绝" }));
    expect(onReject).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("shows a rejected state without interactive actions", () => {
    render(
      <AIActionCard
        proposal={emailProposal()}
        status="rejected"
        onConfirm={vi.fn()}
        onReject={vi.fn()}
      />,
    );

    expect(screen.getByText("已拒绝")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "确认执行" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "拒绝" })).not.toBeInTheDocument();
  });

  it("shows an expired state without interactive actions", () => {
    render(
      <AIActionCard
        proposal={emailProposal({ expires_at: "2026-08-24T23:59:59.000Z" })}
        status="expired"
        onConfirm={vi.fn()}
        onReject={vi.fn()}
      />,
    );

    expect(screen.getByText("已过期")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "确认执行" })).not.toBeInTheDocument();
  });

  it("keeps a retryable error state on the card after a server failure", () => {
    const onConfirm = vi.fn();

    render(
      <AIActionCard
        proposal={emailProposal()}
        status="failed"
        error="AI 操作暂时失败，请重试。"
        onConfirm={onConfirm}
        onReject={vi.fn()}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("AI 操作暂时失败，请重试。");
    fireEvent.click(screen.getByRole("button", { name: "重试确认" }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("shows only a bounded preview for long email bodies without leaking the full content", () => {
    const longBody = `首行摘要\n${"A".repeat(420)}\nUNIQUE_SECRET_SUFFIX`;
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      render(
        <AIActionCard
          proposal={emailProposal({
            input: {
              to_email: "user@example.test",
              subject: "项目更新",
              body_text: longBody,
            },
          })}
          status="proposed"
          onConfirm={vi.fn()}
          onReject={vi.fn()}
        />,
      );

      const bodyPreview = screen.getByText((_, node) => node?.tagName === "DD" && node.textContent?.startsWith("首行摘要") === true);
      expect(bodyPreview.textContent?.length ?? 0).toBeLessThan(longBody.length);
      expect(bodyPreview).toHaveTextContent("…");
      expect(screen.queryByText(longBody)).not.toBeInTheDocument();
      expect(screen.queryByText(/UNIQUE_SECRET_SUFFIX/u)).not.toBeInTheDocument();
      expect(localStorage.length).toBe(0);
      expect(sessionStorage.length).toBe(0);
      expect(JSON.stringify(infoSpy.mock.calls)).not.toContain("UNIQUE_SECRET_SUFFIX");
      expect(JSON.stringify(logSpy.mock.calls)).not.toContain("UNIQUE_SECRET_SUFFIX");
      expect(JSON.stringify(warnSpy.mock.calls)).not.toContain("UNIQUE_SECRET_SUFFIX");
      expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("UNIQUE_SECRET_SUFFIX");
    } finally {
      infoSpy.mockRestore();
      logSpy.mockRestore();
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });
});
