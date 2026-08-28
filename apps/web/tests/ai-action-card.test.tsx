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
      recipient_scope: "external",
    },
    requires_confirmation: true,
    expires_at: "2099-08-25T01:00:00.000Z",
    ...overrides,
  } as AiActionProposal;
}

function updateNoteProposal(overrides: Partial<AiActionProposal> = {}): AiActionProposal {
  return {
    action_id: "action-note-update-1",
    tool: "update_note",
    summary: "更新复盘笔记",
    input: {
      target_note_id: "note-1",
      base_revision: 3,
      patch: {
        title: "复盘 v2",
      },
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
    expect(screen.getByText("外部收件人")).toBeInTheDocument();
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

  it("shows an expired state without confirmation actions and allows reissue", () => {
    const onRegenerate = vi.fn();
    render(
      <AIActionCard
        proposal={emailProposal({ expires_at: "2026-08-24T23:59:59.000Z" })}
        status="expired"
        onConfirm={vi.fn()}
        onReject={vi.fn()}
        onRegenerate={onRegenerate}
      />,
    );

    expect(screen.getByText("已过期")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "确认执行" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重新发起" }));
    expect(onRegenerate).toHaveBeenCalledOnce();
  });

  it("does not offer a second confirmation for a persisted failed action", () => {
    const onConfirm = vi.fn();
    const onRegenerate = vi.fn();

    render(
      <AIActionCard
        proposal={emailProposal()}
        status="failed"
        error="AI 操作暂时失败，请重试。"
        onConfirm={onConfirm}
        onReject={vi.fn()}
        onRegenerate={onRegenerate}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("AI 操作暂时失败，请重试。");
    expect(screen.queryByRole("button", { name: "重试确认" })).not.toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "重新发起" }));
    expect(onRegenerate).toHaveBeenCalledOnce();
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

  it("renders an update note proposal", () => {
    render(
      <AIActionCard
        proposal={updateNoteProposal()}
        status="proposed"
        onConfirm={vi.fn()}
        onReject={vi.fn()}
      />,
    );

    expect(screen.getByText("更新复盘笔记")).toBeInTheDocument();
    expect(screen.getByText("更新笔记")).toBeInTheDocument();
    expect(screen.getByText("目标笔记")).toBeInTheDocument();
  });

  it("renders bounded database action scope without serializing field values", () => {
    render(
      <AIActionCard
        proposal={{
          action_id: "action-db-1",
          tool: "create_database_record",
          summary: "创建数据库记录待确认",
          input: { database_id: "db-1", base_revision: 2, values: { "prop-title": "private value" } },
          requires_confirmation: true,
          expires_at: "2099-08-25T01:00:00.000Z",
        }}
        status="proposed"
        onConfirm={vi.fn()}
        onReject={vi.fn()}
      />,
    );

    expect(screen.getByText("创建数据库记录")).toBeInTheDocument();
    expect(screen.getByText("db-1")).toBeInTheDocument();
    expect(screen.getByText("prop-title")).toBeInTheDocument();
    expect(screen.queryByText("private value")).not.toBeInTheDocument();
  });
});
