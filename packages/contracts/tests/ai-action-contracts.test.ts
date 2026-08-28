import { describe, expect, it } from "vitest";

import {
  AI_ACTION_PROPOSAL_TTL_MS,
  AiActionConfirmSchema,
  AiActionExecutionResultSchema,
  AiActionInputSchema,
  AiActionProposalSchema,
  AiActionRejectSchema,
} from "../src";

describe("AI action contracts", () => {
  it("exports the fixed proposal TTL for later orchestration", () => {
    expect(AI_ACTION_PROPOSAL_TTL_MS).toBe(10 * 60 * 1000);
  });

  it("accepts only the four side-effect tools with tool-specific inputs", () => {
    expect(AiActionProposalSchema.parse({
      action_id: "note-1",
      proposal_revision: 1,
      tool: "create_note",
      summary: "创建笔记",
      input: { title: "周会", content: "整理议程", daily_date: "2026-08-25" },
      requires_confirmation: true,
      expires_at: "2026-08-25T00:10:00.000Z",
    }).proposal_revision).toBe(1);

    expect(AiActionProposalSchema.parse({
      action_id: "reminder-1",
      tool: "create_reminder",
      summary: "创建提醒",
      input: { title: "开会", remind_at: "2026-08-25T09:00:00.000Z", timezone: "Asia/Shanghai" },
      requires_confirmation: true,
      expires_at: "2026-08-25T00:10:00.000Z",
    }).tool).toBe("create_reminder");

    expect(AiActionProposalSchema.parse({
      action_id: "notification-1",
      tool: "create_notification",
      summary: "创建通知",
      input: { title: "系统提示", body_text: "待处理事项已更新" },
      requires_confirmation: true,
      expires_at: "2026-08-25T00:10:00.000Z",
    }).tool).toBe("create_notification");

    expect(AiActionProposalSchema.parse({
      action_id: "email-1",
      tool: "send_email",
      summary: "发送邮件",
      input: { to_email: "user@example.test", subject: "主题", body_text: "正文" },
      requires_confirmation: true,
      expires_at: "2026-08-25T00:10:00.000Z",
    }).tool).toBe("send_email");
  });

  it("rejects unsupported tools and straightforward tool-specific bound violations", () => {
    expect(() => AiActionProposalSchema.parse({ tool: "execute_sql" })).toThrow();
    expect(() => AiActionProposalSchema.parse({
      action_id: "note-2",
      tool: "create_note",
      summary: "创建笔记",
      input: { title: "x".repeat(161), content: "ok" },
      requires_confirmation: true,
      expires_at: "2026-08-25T00:10:00.000Z",
    })).toThrow();
    expect(() => AiActionProposalSchema.parse({
      action_id: "reminder-2",
      tool: "create_reminder",
      summary: "创建提醒",
      input: { title: "开会", remind_at: "not-a-date", timezone: "Asia/Shanghai" },
      requires_confirmation: true,
      expires_at: "2026-08-25T00:10:00.000Z",
    })).toThrow();
    expect(() => AiActionProposalSchema.parse({
      action_id: "notification-2",
      tool: "create_notification",
      summary: "创建通知",
      input: { title: "", body_text: "待处理事项已更新" },
      requires_confirmation: true,
      expires_at: "2026-08-25T00:10:00.000Z",
    })).toThrow();
    expect(() => AiActionProposalSchema.parse({
      action_id: "email-2",
      tool: "send_email",
      summary: "发送邮件",
      input: { to_email: "invalid", subject: "主题", body_text: "正文" },
      requires_confirmation: true,
      expires_at: "2026-08-25T00:10:00.000Z",
    })).toThrow();
  });

  it("requires positive base revisions for confirm and reject commands", () => {
    expect(AiActionConfirmSchema.parse({ action_id: "a1", base_revision: 3 })).toEqual({
      action_id: "a1",
      base_revision: 3,
    });
    expect(AiActionRejectSchema.parse({ action_id: "a1", base_revision: 3, reason: "不需要执行" })).toEqual({
      action_id: "a1",
      base_revision: 3,
      reason: "不需要执行",
    });

    expect(() => AiActionConfirmSchema.parse({ action_id: "a1", base_revision: 0 })).toThrow();
    expect(() => AiActionRejectSchema.parse({ action_id: "a1", base_revision: -1 })).toThrow();
  });

  it("accepts normalized note lifecycle inputs and rejects unknown patch keys", () => {
    expect(AiActionInputSchema.parse({
      tool: "update_note",
      input: {
        target_note_id: "note-1",
        base_revision: 3,
        patch: { title: "Renamed", content: "Body" },
      },
    })).toEqual({
      tool: "update_note",
      input: {
        target_note_id: "note-1",
        base_revision: 3,
        patch: { title: "Renamed", content: "Body" },
      },
    });
    expect(AiActionProposalSchema.parse({
      action_id: "archive-1",
      tool: "archive_note",
      summary: "归档笔记",
      input: { target_note_id: "note-1", base_revision: 3, patch: { status: "archived" } },
      requires_confirmation: true,
      expires_at: "2026-08-25T00:10:00.000Z",
    }).input.patch).toEqual({ status: "archived" });
    expect(() => AiActionInputSchema.parse({
      tool: "move_note",
      input: {
        target_note_id: "note-1",
        base_revision: 3,
        patch: { folder_id: "folder-1", ignored: true },
      },
    })).toThrow();
  });

  it("rejects impossible lifecycle note dates while accepting leap-day dates", () => {
    expect(AiActionInputSchema.parse({
      tool: "update_note",
      input: {
        target_note_id: "note-1",
        base_revision: 3,
        patch: { daily_date: "2028-02-29" },
      },
    })).toBeDefined();
    for (const dailyDate of ["2026-02-29", "2026-04-31", "2026-13-01"]) {
      expect(() => AiActionInputSchema.parse({
        tool: "update_note",
        input: {
          target_note_id: "note-1",
          base_revision: 3,
          patch: { daily_date: dailyDate },
        },
      })).toThrow();
    }
    expect(() => AiActionInputSchema.parse({
      tool: "create_note",
      input: { daily_date: "2026-02-30" },
    })).toThrow();
  });

  it("allows trusted create proposals and validates execution results", () => {
    expect(AiActionProposalSchema.parse({
      action_id: "create-1",
      tool: "create_note",
      summary: "创建笔记",
      input: { title: "Trusted", content: "Body" },
      requires_confirmation: false,
      expires_at: "2026-08-25T00:10:00.000Z",
    }).requires_confirmation).toBe(false);
    expect(AiActionExecutionResultSchema.parse({
      action_id: "create-1",
      status: "executed",
      entity_id: "note-1",
      revision: 1,
    })).toEqual({
      action_id: "create-1",
      status: "executed",
      entity_id: "note-1",
      revision: 1,
    });
    expect(AiActionExecutionResultSchema.parse({
      action_id: "create-1",
      status: "failed",
      retryable: true,
      error: { code: "AI_ACTION_IN_PROGRESS", message: "仍在执行", status: 409 },
    })).toMatchObject({ retryable: true });
  });
});
