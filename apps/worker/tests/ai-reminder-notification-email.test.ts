import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AiActionInputSchema,
  AiActionToolNameSchema,
  SendEmailActionInputSchema,
  type WorkspaceContext,
} from "@nexus/contracts";
import { AiToolOrchestrator, D1AiToolRepository } from "../src";
import { applyMigration, createTestD1, seedTenants } from "./helpers/d1";

const disposals: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(disposals.splice(0).map((dispose) => dispose()));
});

function context(): WorkspaceContext {
  return {
    workspaceId: "ws-1",
    userId: "user-1",
    role: "owner",
    capabilities: new Set(["notes.write", "reminders.write", "notifications.write", "email.write"]),
  };
}

async function setup() {
  const testD1 = await createTestD1({ through: 24 });
  disposals.push(testD1.dispose);
  await seedTenants(testD1.db);

  let nextId = 1;
  const repository = new D1AiToolRepository(testD1.db);
  const checkedRecipients: string[] = [];
  const orchestrator = new AiToolOrchestrator({
    repository,
    createId: () => `action-${nextId++}`,
    clock: () => new Date("2026-08-28T00:00:00.000Z"),
    assertFreshPermission: vi.fn(),
    assertEmailRecipient: vi.fn(async (_actor, proposal) => {
      if (proposal.tool !== "send_email") return;
      checkedRecipients.push(proposal.input.recipient_scope ?? "legacy");
      if (proposal.input.recipient_scope === "self" && proposal.input.to_email !== "owner@example.test") {
        throw Object.assign(new Error("recipient mismatch"), { code: "AI_ACTION_RECIPIENT_MISMATCH", status: 403 });
      }
      if (proposal.input.recipient_scope === "workspace_member" && proposal.input.to_email !== "member@example.test") {
        throw Object.assign(new Error("recipient mismatch"), { code: "AI_ACTION_RECIPIENT_MISMATCH", status: 403 });
      }
    }),
  });

  const updateReminder = vi.fn(async (_actor: unknown, reminderId: string, input: { base_revision: number; status: string }) => ({
    id: reminderId,
    revision: input.base_revision + 1,
    status: input.status,
  }));
  const createReminder = vi.fn(async () => ({ id: "reminder-created", revision: 1 }));
  const execution = {
    noteService: { create: vi.fn(), update: vi.fn(), get: vi.fn() },
    knowledgeService: { createReminder, updateReminder },
    collaborationRepository: { createNotification: vi.fn() },
    emailOutboxRepository: { enqueue: vi.fn() },
    queue: { send: vi.fn() },
  } as never;
  return { orchestrator, execution, createReminder, updateReminder, checkedRecipients };
}

describe("AI reminder, notification, and system email workflow", () => {
  it("allowlists complete_reminder and validates its revision input", () => {
    expect(AiActionToolNameSchema.safeParse("complete_reminder").success).toBe(true);
    expect(AiActionInputSchema.safeParse({
      tool: "complete_reminder",
      input: { reminder_id: "reminder-1", base_revision: 3 },
    }).success).toBe(true);
  });

  it("accepts recipient scopes while keeping the legacy email payload shape valid", () => {
    expect(SendEmailActionInputSchema.safeParse({
      to_email: "owner@example.test",
      subject: "Status",
      body_text: "Done",
      recipient_scope: "self",
    }).success).toBe(true);
    expect(SendEmailActionInputSchema.safeParse({
      to_email: "member@example.test",
      subject: "Status",
      body_text: "Done",
      recipient_scope: "workspace_member",
    }).success).toBe(true);
    expect(SendEmailActionInputSchema.safeParse({
      to_email: "external@example.test",
      subject: "Status",
      body_text: "Done",
      recipient_scope: "external",
    }).success).toBe(true);
    expect(SendEmailActionInputSchema.safeParse({
      to_email: "owner@example.test",
      subject: "Status",
      body_text: "Done",
    }).success).toBe(true);
  });

  it("preserves existing proposals and email outbox rows while expanding the action constraint", async () => {
    const testD1 = await createTestD1({ through: 23 });
    disposals.push(testD1.dispose);
    await seedTenants(testD1.db);
    await testD1.db.batch([
      testD1.db.prepare(
        `INSERT INTO ai_action_proposals
         (id, user_id, workspace_id, tool, input_json, status, idempotency_key, revision, expires_at, created_at, updated_at)
         VALUES ('legacy-action', 'user-1', 'ws-1', 'send_email', '{"to_email":"one@example.test","subject":"Keep","body_text":"Body"}', 'executed', 'ai-action:user-1:legacy-action', 2, ?, ?, ?)`,
      ).bind("2099-08-29T00:00:00.000Z", "2026-08-28T00:00:00.000Z", "2026-08-28T00:00:00.000Z"),
      testD1.db.prepare(
        `INSERT INTO ai_email_outbox
         (id, action_id, user_id, workspace_id, to_email, subject, body_text, status, attempt_count, available_at, created_at, updated_at)
         VALUES ('ai-email:legacy-action', 'legacy-action', 'user-1', 'ws-1', 'one@example.test', 'Keep', 'Body', 'sent', 1, ?, ?, ?)`,
      ).bind("2026-08-28T00:00:00.000Z", "2026-08-28T00:00:00.000Z", "2026-08-28T00:00:00.000Z"),
    ]);

    await applyMigration(testD1.db, "../../migrations/0024_ai_reminder_actions.sql");

    expect(await testD1.db.prepare(
      "SELECT tool, status, revision FROM ai_action_proposals WHERE id = 'legacy-action'",
    ).first()).toEqual({ tool: "send_email", status: "executed", revision: 2 });
    expect(await testD1.db.prepare(
      "SELECT action_id, status FROM ai_email_outbox WHERE id = 'ai-email:legacy-action'",
    ).first()).toEqual({ action_id: "legacy-action", status: "sent" });
    expect((await testD1.db.prepare("PRAGMA foreign_key_check").all()).results).toEqual([]);
  });

  it("creates reminders and completes them through revision-guarded service methods", async () => {
    const { orchestrator, execution, createReminder, updateReminder } = await setup();
    const created = await orchestrator.propose(context(), {
      name: "create_reminder",
      arguments: { title: "Follow up", remind_at: "2026-08-29T09:00:00.000Z", timezone: "Asia/Shanghai" },
    });
    await orchestrator.confirm(context(), created.action_id, 1);
    await expect(orchestrator.execute(context(), created.action_id, execution)).resolves.toMatchObject({
      status: "executed",
      entity_id: "reminder-created",
      revision: 1,
    });
    expect(createReminder).toHaveBeenCalledOnce();

    const complete = await orchestrator.propose(context(), {
      name: "complete_reminder",
      arguments: { reminder_id: "reminder-created", base_revision: 1 },
    });
    await orchestrator.confirm(context(), complete.action_id, 1);
    await expect(orchestrator.execute(context(), complete.action_id, execution)).resolves.toMatchObject({
      status: "executed",
      entity_id: "reminder-created",
      revision: 2,
    });
    expect(updateReminder).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "ws-1", userId: "user-1" }),
      "reminder-created",
      { base_revision: 1, status: "dismissed" },
    );
  });

  it("auto-runs trusted low-risk reminders and in-app notifications", async () => {
    const { orchestrator, execution, createReminder } = await setup();
    const reminder = await orchestrator.propose(context(), {
      name: "create_reminder",
      arguments: { title: "Follow up", remind_at: "2026-08-29T09:00:00.000Z" },
    }, { trusted: true });
    const notification = await orchestrator.propose(context(), {
      name: "create_notification",
      arguments: { title: "Notice", body_text: "Review this" },
    }, { trusted: true });

    expect(reminder.requires_confirmation).toBe(false);
    expect(notification.requires_confirmation).toBe(false);
    await expect(orchestrator.execute(context(), reminder.action_id, execution)).resolves.toMatchObject({ status: "executed" });
    await expect(orchestrator.execute(context(), notification.action_id, execution)).resolves.toMatchObject({ status: "executed" });
    expect(createReminder).toHaveBeenCalledOnce();
    expect(execution.collaborationRepository.createNotification).toHaveBeenCalledOnce();
  });

  it("requires confirmation for external mail and rechecks self/member recipients", async () => {
    const { orchestrator, execution, checkedRecipients } = await setup();
    const self = await orchestrator.propose(context(), {
      name: "send_email",
      arguments: { to_email: "owner@example.test", recipient_scope: "self", subject: "Self", body_text: "Body" },
    });
    await orchestrator.confirm(context(), self.action_id, 1);

    const member = await orchestrator.propose(context(), {
      name: "send_email",
      arguments: { to_email: "member@example.test", recipient_scope: "workspace_member", subject: "Member", body_text: "Body" },
    });
    await orchestrator.confirm(context(), member.action_id, 1);

    const external = await orchestrator.propose(context(), {
      name: "send_email",
      arguments: { to_email: "external@example.test", recipient_scope: "external", subject: "External", body_text: "Body" },
    });
    expect(external.requires_confirmation).toBe(true);
    await orchestrator.confirm(context(), external.action_id, 1);
    expect(checkedRecipients).toEqual(["self", "workspace_member", "external"]);

    const invalid = await orchestrator.propose(context(), {
      name: "send_email",
      arguments: { to_email: "wrong@example.test", recipient_scope: "self", subject: "Wrong", body_text: "Body" },
    });
    await expect(orchestrator.confirm(context(), invalid.action_id, 1)).rejects.toMatchObject({
      code: "AI_ACTION_RECIPIENT_MISMATCH",
      status: 403,
    });
    expect(execution).toBeDefined();
  });

  it("does not let an email action select a sender or persist an unbounded body preview", async () => {
    const { orchestrator } = await setup();
    const proposal = await orchestrator.propose(context(), {
      name: "send_email",
      arguments: {
        to_email: "external@example.test",
        recipient_scope: "external",
        subject: "Status",
        body_text: "A".repeat(8_000),
      },
    });
    expect(proposal.input).not.toHaveProperty("from_email");
    expect(proposal.input.body_text).toHaveLength(8_000);
  });

  it("returns a conflict and keeps the action recoverable when reminder CAS fails", async () => {
    const { orchestrator, execution, updateReminder } = await setup();
    const proposal = await orchestrator.propose(context(), {
      name: "complete_reminder",
      arguments: { reminder_id: "reminder-1", base_revision: 4 },
    });
    await orchestrator.confirm(context(), proposal.action_id, 1);
    updateReminder.mockRejectedValueOnce(Object.assign(new Error("changed"), {
      code: "REMINDER_CONFLICT",
      status: 409,
    }));

    await expect(orchestrator.execute(context(), proposal.action_id, execution)).resolves.toMatchObject({
      status: "conflict",
      error: { code: "AI_ACTION_REMINDER_CONFLICT", status: 409 },
    });
  });
});
