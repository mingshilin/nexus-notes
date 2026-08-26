import { describe, expect, it } from "vitest";

import {
  AI_ACTION_PROPOSAL_TTL_MS,
  AiActionConfirmSchema,
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
      tool: "create_note",
      summary: "创建笔记",
      input: { title: "周会", content: "整理议程", daily_date: "2026-08-25" },
      requires_confirmation: true,
      expires_at: "2026-08-25T00:10:00.000Z",
    }).tool).toBe("create_note");

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
});
