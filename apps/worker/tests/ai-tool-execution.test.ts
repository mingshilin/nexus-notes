import { afterEach, describe, expect, it, vi } from "vitest";

import type { WorkspaceContext } from "@nexus/contracts";
import {
  AiToolOrchestrator,
  D1AiToolRepository,
  D1CollaborationRepository,
  D1NoteRepository,
  D1ReminderRepository,
  KnowledgeService,
  NoteServiceError,
  NoteService,
  ResendEmailSender,
  WebCryptoPasswordHasher,
} from "../src";
import { createRouteRegistry } from "../src/http/route-registry";
import { registerAiRoutes } from "../src/routes/ai";
import { AiEmailOutboxRepository } from "../src/ai/ai-email-outbox-repository";
import { createTestD1, seedTenants } from "./helpers/d1";

const disposals: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(disposals.splice(0).map((dispose) => dispose()));
});

function context(role: WorkspaceContext["role"] = "owner"): WorkspaceContext {
  return {
    workspaceId: "ws-1",
    userId: "user-1",
    role,
    capabilities: new Set(["notes.write", "reminders.write", "notifications.write", "email.write"]),
  };
}

async function setup(options: { queue?: { send: (message: unknown) => Promise<unknown> } } = {}) {
  const testD1 = await createTestD1({ through: 22 });
  disposals.push(testD1.dispose);
  await seedTenants(testD1.db);
  const currentTime = new Date("2026-08-25T00:00:00.000Z");
  await testD1.db.batch([
    testD1.db.prepare(
      "INSERT INTO workspace_members (workspace_id, user_id, role, revision, joined_at, updated_at) VALUES (?, ?, 'owner', 1, ?, ?)",
    ).bind("ws-1", "user-1", currentTime.toISOString(), currentTime.toISOString()),
  ]);

  let nextId = 1;
  const clock = () => new Date(currentTime);
  const createId = () => `action-${nextId++}`;

  const repository = new D1AiToolRepository(testD1.db);
  const noteService = new NoteService(new D1NoteRepository(testD1.db), { clock, createId });
  const reminderRepository = new D1ReminderRepository(testD1.db, createId);
  const knowledgeService = new KnowledgeService({
    search: async () => ({ items: [], nextCursor: null }),
    listSavedSearches: async () => [],
    createSavedSearch: async () => { throw new Error("not used"); },
    deleteSavedSearch: async () => undefined,
    listFolders: async () => [],
    createFolder: async () => null,
    listTags: async () => [],
    listNoteTags: async () => [],
    createTag: async () => { throw new Error("not used"); },
    setNoteTags: async () => undefined,
    setNoteLinks: async () => undefined,
    listNoteLinks: async () => [],
    listBacklinks: async () => [],
    getGraph: async () => ({ nodes: [], edges: [] }),
    listReminders: async () => [],
    listReminderPage: async () => ({ items: [], nextCursor: null }),
    createReminder: (...args: Parameters<typeof reminderRepository.createReminder>) => reminderRepository.createReminder(...args),
    updateReminder: async () => ({ reminder: null, current: null }),
    snoozeReminder: async () => ({ reminder: null, current: null }),
    deleteReminder: async () => false,
    getReminder: async () => null,
    getCalendarFeed: async () => ({ items: [] as never[] }),
  } as any, { clock });

  const collaborationRepository = new D1CollaborationRepository(testD1.db, {
    tokens: { createSessionToken: () => "token", hash: async (value: string) => `hash:${value}` },
    password: new WebCryptoPasswordHasher(),
  });
  const emailOutboxRepository = new AiEmailOutboxRepository(testD1.db, { createId, clock });
  const queue = options.queue ?? { send: vi.fn(async () => undefined) };
  const emailSender = new ResendEmailSender("resend-key", "Nexus Notes <noreply@example.com>", "https://beta.example.com", async () => new Response(null, { status: 202 }));

  const orchestrator = new AiToolOrchestrator({
    repository,
    createId,
    clock,
    assertFreshPermission: async (_context, proposal) => {
      if (_context.role === "viewer") throw Object.assign(new Error("viewer denied"), { code: "AI_ACTION_PERMISSION_DENIED" });
      if (proposal.tool === "send_email" && proposal.input.to_email.endsWith("@blocked.test")) {
        throw Object.assign(new Error("recipient mismatch"), { code: "AI_ACTION_RECIPIENT_MISMATCH" });
      }
    },
  });

  const execution = {
    noteService,
    knowledgeService,
    collaborationRepository,
    emailOutboxRepository,
    queue,
    emailSender,
    clock,
  };

  return { testD1, repository, orchestrator, execution, queue, noteService, knowledgeService, collaborationRepository, emailOutboxRepository, clock, createId };
}

describe("AI tool execution", () => {
  it("registers confirm and reject routes", () => {
    const routes: Array<{ method: string; path: string }> = [];
    registerAiRoutes({ register(definition) { routes.push({ method: definition.method, path: definition.path }); } }, () => ({
      status: async () => ({ configured: true, source: "server_default" as const }),
      chat: async () => ({ message: "ok", model: "m" }),
      confirmAction: async () => ({} as never),
      rejectAction: async () => ({ rejected: true as const }),
    } as any));

    expect(routes).toContainEqual({ method: "POST", path: "/api/v2/ai/actions/:actionId/confirm" });
    expect(routes).toContainEqual({ method: "POST", path: "/api/v2/ai/actions/:actionId/reject" });
  });

  it("executes note, reminder, notification, and email actions once", async () => {
    const { testD1, orchestrator, execution, queue } = await setup();

    const noteProposal = await orchestrator.propose(context(), { name: "create_note", arguments: { title: "Roadmap", content: "Outline" } });
    await orchestrator.confirm(context(), noteProposal.action_id, 1);
    await expect(orchestrator.execute(context(), noteProposal.action_id, execution)).resolves.toMatchObject({ status: "executed" });

    const reminderNote = await execution.noteService.create(context(), { title: "Reminder note", content: "Body" });
    const reminderProposal = await orchestrator.propose(context(), {
      name: "create_reminder",
      arguments: { note_id: reminderNote.id, title: "Follow up", remind_at: "2026-08-25T09:00:00.000Z", timezone: "Asia/Shanghai" },
    });
    await orchestrator.confirm(context(), reminderProposal.action_id, 1);
    await expect(orchestrator.execute(context(), reminderProposal.action_id, execution)).resolves.toMatchObject({ status: "executed" });

    const notificationProposal = await orchestrator.propose(context(), {
      name: "create_notification",
      arguments: { title: "System", body_text: "Action finished" },
    });
    await orchestrator.confirm(context(), notificationProposal.action_id, 1);
    await expect(orchestrator.execute(context(), notificationProposal.action_id, execution)).resolves.toMatchObject({ status: "executed" });

    const emailProposal = await orchestrator.propose(context(), {
      name: "send_email",
      arguments: { to_email: "user@example.test", subject: "Status", body_text: "Done" },
    });
    await orchestrator.confirm(context(), emailProposal.action_id, 1);
    await expect(orchestrator.execute(context(), emailProposal.action_id, execution)).resolves.toMatchObject({ status: "executed" });

    const noteCount = await testD1.db.prepare("SELECT COUNT(*) AS count FROM notes").first<{ count: number }>();
    const reminderCount = await testD1.db.prepare("SELECT COUNT(*) AS count FROM reminders").first<{ count: number }>();
    const notificationCount = await testD1.db.prepare("SELECT COUNT(*) AS count FROM notifications").first<{ count: number }>();
    const outbox = await testD1.db.prepare(
      "SELECT status FROM ai_email_outbox WHERE id = ?",
    ).bind(`ai-email:${emailProposal.action_id}`).first<{ status: string }>();
    const proposal = await testD1.db.prepare(
      "SELECT status FROM ai_action_proposals WHERE id = ?",
    ).bind(emailProposal.action_id).first<{ status: string }>();

    expect(noteCount?.count).toBe(2);
    expect(reminderCount?.count).toBe(1);
    expect(notificationCount?.count).toBe(1);
    expect(outbox?.status).toBe("pending");
    expect(proposal?.status).toBe("executed");
    expect(queue.send).not.toHaveBeenCalled();
  });

  it("marks a confirmed note action conflicted when the service raises an idempotency conflict", async () => {
    const { testD1, orchestrator, execution } = await setup();
    const proposal = await orchestrator.propose(context(), { name: "create_note", arguments: { title: "Roadmap", content: "Outline" } });
    await orchestrator.confirm(context(), proposal.action_id, 1);

    const conflict = new NoteServiceError("NOTE_IDEMPOTENCY_CONFLICT", "Note idempotency conflict", 409);
    await expect(orchestrator.execute(context(), proposal.action_id, {
      ...execution,
      noteService: {
        create: async () => { throw conflict; },
      } as any,
    })).resolves.toMatchObject({
      action_id: proposal.action_id,
      status: "conflict",
      error: { code: "AI_ACTION_NOTE_CONFLICT", status: 409 },
    });

    const stored = await testD1.db.prepare("SELECT status FROM ai_action_proposals WHERE id = ?").bind(proposal.action_id).first<{ status: string }>();
    expect(stored?.status).toBe("conflict");
  });

  it("denies execution for a viewer before writing side effects", async () => {
    const { testD1, orchestrator, execution } = await setup();
    const proposal = await orchestrator.propose(context(), { name: "create_note", arguments: { title: "Roadmap", content: "Outline" } });

    await expect(orchestrator.confirm(context("viewer"), proposal.action_id, 1)).rejects.toMatchObject({ code: "AI_ACTION_PERMISSION_DENIED" });
    const count = await testD1.db.prepare("SELECT COUNT(*) AS count FROM notes").first<{ count: number }>();
    expect(count?.count).toBe(0);
  });

  it("surfaces missing note and invalid recurrence errors from reminder execution", async () => {
    const { orchestrator, execution } = await setup();

    const missingNote = await orchestrator.propose(context(), {
      name: "create_reminder",
      arguments: { note_id: "missing-note", title: "Follow up", remind_at: "2026-08-25T09:00:00.000Z", timezone: "Asia/Shanghai" },
    });
    await orchestrator.confirm(context(), missingNote.action_id, 1);
    await expect(orchestrator.execute(context(), missingNote.action_id, execution)).resolves.toMatchObject({
      action_id: missingNote.action_id,
      status: "failed",
      error: { code: "REMINDER_NOTE_NOT_FOUND" },
    });

    const invalidRecurrence = await orchestrator.propose(context(), {
      name: "create_reminder",
      arguments: { title: "Recurrence", remind_at: "2026-08-25T10:00:00.000Z", timezone: "Asia/Shanghai" },
    });
    await orchestrator.confirm(context(), invalidRecurrence.action_id, 1);
    await expect(orchestrator.execute(context(), invalidRecurrence.action_id, {
      ...execution,
      knowledgeService: {
        createReminder: async () => { throw Object.assign(new Error("invalid recurrence"), { code: "REMINDER_RECURRENCE_INVALID" }); },
      } as any,
    })).resolves.toMatchObject({
      action_id: invalidRecurrence.action_id,
      status: "failed",
      error: { code: "REMINDER_RECURRENCE_INVALID" },
    });
  });

  it("replays an executed action without creating duplicates", async () => {
    const { testD1, orchestrator, execution, queue } = await setup();
    const proposal = await orchestrator.propose(context(), { name: "create_notification", arguments: { title: "System", body_text: "Action finished" } });

    await orchestrator.confirm(context(), proposal.action_id, 1);
    await orchestrator.execute(context(), proposal.action_id, execution);
    await orchestrator.execute(context(), proposal.action_id, execution);

    const count = await testD1.db.prepare("SELECT COUNT(*) AS count FROM notifications").first<{ count: number }>();
    expect(count?.count).toBe(1);
    expect(queue.send).not.toHaveBeenCalled();
  });

  it("does not create duplicate entities when one confirmed action is executed concurrently", async () => {
    const { testD1, orchestrator, execution, noteService } = await setup();
    const reminderNote = await noteService.create(context(), { title: "Reminder note", content: "Body" });
    const proposals = await Promise.all([
      orchestrator.propose(context(), { name: "create_note", arguments: { title: "Concurrent note", content: "Body" } }),
      orchestrator.propose(context(), {
        name: "create_reminder",
        arguments: { note_id: reminderNote.id, title: "Concurrent reminder", remind_at: "2026-08-25T09:00:00.000Z", timezone: "Asia/Shanghai" },
      }),
      orchestrator.propose(context(), { name: "create_notification", arguments: { title: "Concurrent notification", body_text: "Body" } }),
    ]);
    await Promise.all(proposals.map((proposal) => orchestrator.confirm(context(), proposal.action_id, 1)));

    const results = await Promise.allSettled(proposals.flatMap((proposal) => [
      orchestrator.execute(context(), proposal.action_id, execution),
      orchestrator.execute(context(), proposal.action_id, execution),
    ]));
    expect(results.filter((result) => result.status === "fulfilled").length).toBe(6);

    const noteCount = await testD1.db.prepare("SELECT COUNT(*) AS count FROM notes WHERE title = ?").bind("Concurrent note").first<{ count: number }>();
    const reminderCount = await testD1.db.prepare("SELECT COUNT(*) AS count FROM reminders WHERE title = ?").bind("Concurrent reminder").first<{ count: number }>();
    const notificationCount = await testD1.db.prepare("SELECT COUNT(*) AS count FROM notifications WHERE payload_json LIKE ?").bind("%Concurrent notification%").first<{ count: number }>();
    expect(noteCount?.count).toBe(1);
    expect(reminderCount?.count).toBe(1);
    expect(notificationCount?.count).toBe(1);
  });

  it("fails send_email confirmation when the queue is unavailable and leaves the action unexecuted", async () => {
    const { testD1, orchestrator, execution } = await setup({ queue: undefined });
    const proposal = await orchestrator.propose(context(), {
      name: "send_email",
      arguments: { to_email: "user@example.test", subject: "Status", body_text: "Done" },
    });

    await orchestrator.confirm(context(), proposal.action_id, 1);
    await expect(orchestrator.execute(context(), proposal.action_id, { ...execution, queue: undefined })).resolves.toMatchObject({
      action_id: proposal.action_id,
      status: "failed",
      error: { code: "AI_ACTION_QUEUE_UNAVAILABLE" },
    });

    const stored = await testD1.db.prepare("SELECT status FROM ai_action_proposals WHERE id = ?").bind(proposal.action_id).first<{ status: string }>();
    const outboxCount = await testD1.db.prepare("SELECT COUNT(*) AS count FROM ai_email_outbox").first<{ count: number }>();
    expect(stored?.status).toBe("failed");
    expect(outboxCount?.count).toBe(0);
  });
});
