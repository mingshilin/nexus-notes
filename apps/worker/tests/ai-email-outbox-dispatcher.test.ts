import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AiEmailConsumer,
  AiEmailOutboxDispatcher,
  AiEmailOutboxRepository,
  AiToolOrchestrator,
  D1AiToolRepository,
} from "../src";
import { createTestD1, seedTenants } from "./helpers/d1";

const disposals: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(disposals.splice(0).map((dispose) => dispose()));
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((next) => { resolve = next; });
  return { promise, resolve };
}

async function setup() {
  const testD1 = await createTestD1({ through: 22 });
  disposals.push(testD1.dispose);
  await seedTenants(testD1.db);
  const now = new Date("2026-08-25T00:00:00.000Z");
  await testD1.db.batch([
    testD1.db.prepare(
      "INSERT INTO workspace_members (workspace_id, user_id, role, revision, joined_at, updated_at) VALUES (?, ?, 'owner', 1, ?, ?)",
    ).bind("ws-1", "user-1", now.toISOString(), now.toISOString()),
  ]);

  let currentTime = now;
  const clock = () => new Date(currentTime);
  const repository = new D1AiToolRepository(testD1.db);
  const outbox = new AiEmailOutboxRepository(testD1.db, { clock });
  const orchestrator = new AiToolOrchestrator({
    repository,
    clock,
    assertFreshPermission: async () => undefined,
  });
  return {
    testD1,
    repository,
    outbox,
    orchestrator,
    clock,
    advance(ms: number) {
      currentTime = new Date(currentTime.getTime() + ms);
    },
  };
}

describe("AI email outbox dispatcher", () => {
  it("claims the outbox before sending so concurrent dispatchers only publish once", async () => {
    const { repository, outbox, clock } = await setup();
    await repository.insertProposal({
      actionId: "action-concurrent-dispatch",
      userId: "user-1",
      workspaceId: "ws-1",
      tool: "send_email",
      input: { to_email: "user@example.test", subject: "Status", body_text: "Done" },
      expiresAt: "2026-08-25T00:10:00.000Z",
      now: "2026-08-25T00:00:00.000Z",
    });
    await outbox.enqueue({
      actionId: "action-concurrent-dispatch",
      userId: "user-1",
      workspaceId: "ws-1",
      toEmail: "user@example.test",
      subject: "Status",
      bodyText: "Done",
      now: "2026-08-25T00:00:00.000Z",
    });

    const started = deferred();
    const release = deferred();
    const queue = {
      send: vi.fn(async () => {
        started.resolve();
        await release.promise;
      }),
    };
    const firstDispatcher = new AiEmailOutboxDispatcher(outbox, queue, { clock });
    const secondDispatcher = new AiEmailOutboxDispatcher(outbox, queue, { clock });

    const first = firstDispatcher.dispatch();
    await started.promise;
    const second = secondDispatcher.dispatch();
    await second;
    release.resolve();
    await expect(first).resolves.toEqual({ dispatched: 1, failed: 0 });
    await expect(second).resolves.toEqual({ dispatched: 0, failed: 0 });
    expect(queue.send).toHaveBeenCalledTimes(1);
  });

  it("rolls back only the active dispatch lease after a queue failure", async () => {
    const { testD1, repository, outbox } = await setup();
    await repository.insertProposal({
      actionId: "action-lease-failure",
      userId: "user-1",
      workspaceId: "ws-1",
      tool: "send_email",
      input: { to_email: "user@example.test", subject: "Status", body_text: "Done" },
      expiresAt: "2026-08-25T00:10:00.000Z",
      now: "2026-08-25T00:00:00.000Z",
    });
    const row = await outbox.enqueue({
      actionId: "action-lease-failure",
      userId: "user-1",
      workspaceId: "ws-1",
      toEmail: "user@example.test",
      subject: "Status",
      bodyText: "Done",
      now: "2026-08-25T00:00:00.000Z",
    });

    const lease1 = "2026-08-25T00:00:00.000Z";
    const retryAt1 = "2026-08-25T00:05:00.000Z";
    await testD1.db.prepare(
      "UPDATE ai_email_outbox SET status = 'sending', updated_at = ?, available_at = ?, dispatch_lease_until = ?, dispatch_claim_token = ? WHERE id = ?",
    ).bind(lease1, lease1, lease1, lease1, row.id).run();

    await expect(outbox.releaseDispatch(
      row.id,
      lease1,
      lease1,
      retryAt1,
      "AI_EMAIL_QUEUE_FAILED",
    )).resolves.toBe(true);

    const failed = await testD1.db.prepare(
      "SELECT status, available_at, last_error_code, updated_at FROM ai_email_outbox WHERE id = ?",
    ).bind(row.id).first<{ status: string; available_at: string; last_error_code: string | null; updated_at: string }>();
    expect(failed).toEqual({
      status: "failed",
      available_at: retryAt1,
      last_error_code: "AI_EMAIL_QUEUE_FAILED",
      updated_at: lease1,
    });

    const lease2 = "2026-08-25T00:01:00.000Z";
    const retryAt2 = "2026-08-25T00:10:00.000Z";
    await testD1.db.prepare(
      "UPDATE ai_email_outbox SET status = 'sending', updated_at = ?, available_at = ?, dispatch_lease_until = ?, dispatch_claim_token = ? WHERE id = ?",
    ).bind(lease2, lease2, lease2, "lease-2", row.id).run();

    await expect(outbox.releaseDispatch(
      row.id,
      lease1,
      lease1,
      retryAt2,
      "AI_EMAIL_QUEUE_FAILED",
    )).resolves.toBe(false);

    const current = await testD1.db.prepare(
      "SELECT status, available_at, last_error_code, updated_at FROM ai_email_outbox WHERE id = ?",
    ).bind(row.id).first<{ status: string; available_at: string; last_error_code: string | null; updated_at: string }>();
    expect(current).toEqual({
      status: "sending",
      available_at: lease2,
      last_error_code: "AI_EMAIL_QUEUE_FAILED",
      updated_at: lease2,
    });
  });

  it("recovers a delivery lease after a consumer crash without reusing the consumer lease", async () => {
    const { repository, outbox, clock, advance } = await setup();
    await repository.insertProposal({
      actionId: "action-delivery-crash",
      userId: "user-1",
      workspaceId: "ws-1",
      tool: "send_email",
      input: { to_email: "user@example.test", subject: "Status", body_text: "Done" },
      expiresAt: "2026-08-25T00:10:00.000Z",
      now: "2026-08-25T00:00:00.000Z",
    });
    const row = await outbox.enqueue({
      actionId: "action-delivery-crash",
      userId: "user-1",
      workspaceId: "ws-1",
      toEmail: "user@example.test",
      subject: "Status",
      bodyText: "Done",
      now: "2026-08-25T00:00:00.000Z",
    });
    const dispatched = await outbox.claimForDispatch(row.id, clock().toISOString());
    expect(dispatched?.dispatch_claim_token).toBeTruthy();
    const delivered = await outbox.claimForDelivery(row.id, clock().toISOString(), dispatched!.dispatch_claim_token!);
    expect(delivered?.delivery_claim_token).toBeTruthy();

    advance(5 * 60 * 1000 + 1);
    const recoverable = await outbox.listPendingOutbox(clock().toISOString(), 50);
    expect(recoverable.map((item) => item.id)).toContain(row.id);
    const redelivered = await outbox.claimForDispatch(row.id, clock().toISOString());
    expect(redelivered?.dispatch_claim_token).toBeTruthy();
    expect(redelivered?.dispatch_claim_token).not.toBe(dispatched?.dispatch_claim_token);
    expect(redelivered?.delivery_claim_token).toBeNull();
  });

  it("rejects a stale queue message after dispatch lease recovery", async () => {
    const { repository, outbox, clock, advance } = await setup();
    await repository.insertProposal({
      actionId: "action-stale-queue",
      userId: "user-1",
      workspaceId: "ws-1",
      tool: "send_email",
      input: { to_email: "user@example.test", subject: "Status", body_text: "Done" },
      expiresAt: "2026-08-25T00:10:00.000Z",
      now: "2026-08-25T00:00:00.000Z",
    });
    const row = await outbox.enqueue({
      actionId: "action-stale-queue",
      userId: "user-1",
      workspaceId: "ws-1",
      toEmail: "user@example.test",
      subject: "Status",
      bodyText: "Done",
      now: "2026-08-25T00:00:00.000Z",
    });
    const messages: unknown[] = [];
    const queue = { send: vi.fn(async (message) => { messages.push(message); }) };
    await new AiEmailOutboxDispatcher(outbox, queue, { clock }).dispatch();
    advance(5 * 60 * 1000 + 1);
    await new AiEmailOutboxDispatcher(outbox, queue, { clock }).dispatch();
    expect(messages).toHaveLength(2);

    const sender = { send: vi.fn(async () => undefined) };
    const consumer = new AiEmailConsumer(outbox, sender, { clock });
    await expect(consumer.consume(messages[0])).resolves.toEqual({ outcome: "ack" });
    expect(sender.send).not.toHaveBeenCalled();
    await expect(consumer.consume(messages[1])).resolves.toEqual({ outcome: "ack" });
    expect(sender.send).toHaveBeenCalledOnce();
    expect(row.id).toBe("ai-email:action-stale-queue");
  });

  it("keeps the action executed when queue publication fails and recovers on retry", async () => {
    const { testD1, repository, outbox, orchestrator, clock, advance } = await setup();
    const proposal = await orchestrator.propose({
      workspaceId: "ws-1",
      userId: "user-1",
      role: "owner",
      capabilities: new Set(["email.write"]),
    }, {
      name: "send_email",
      arguments: { to_email: "user@example.test", subject: "Status", body_text: "Done" },
    });
    await orchestrator.confirm({
      workspaceId: "ws-1",
      userId: "user-1",
      role: "owner",
      capabilities: new Set(["email.write"]),
    }, proposal.action_id, 1);
    await expect(orchestrator.execute({
      workspaceId: "ws-1",
      userId: "user-1",
      role: "owner",
      capabilities: new Set(["email.write"]),
    }, proposal.action_id, {
      emailOutboxRepository: outbox,
      queue: { send: vi.fn(async () => undefined) },
      noteService: { create: vi.fn(async () => undefined) },
      knowledgeService: { createReminder: vi.fn(async () => undefined) },
      collaborationRepository: { createNotification: vi.fn(async () => undefined) },
    })).resolves.toMatchObject({ status: "executed" });

    const initial = await testD1.db.prepare(
      "SELECT status FROM ai_action_proposals WHERE id = ?",
    ).bind(proposal.action_id).first<{ status: string }>();
    expect(initial?.status).toBe("executed");

    const failingQueue = { send: vi.fn(async () => { throw new Error("queue down"); }) };
    const dispatcher = new AiEmailOutboxDispatcher(outbox, failingQueue, { clock });
    await expect(dispatcher.dispatch()).resolves.toEqual({ dispatched: 0, failed: 1 });

    const failed = await testD1.db.prepare(
      "SELECT status, available_at FROM ai_email_outbox WHERE id = ?",
    ).bind(`ai-email:${proposal.action_id}`).first<{ status: string; available_at: string }>();
    expect(failed?.status).toBe("failed");
    advance(6_000);

    const sentMessages: unknown[] = [];
    const queue = { send: vi.fn(async (message) => { sentMessages.push(message); }) };
    const successDispatcher = new AiEmailOutboxDispatcher(outbox, queue, { clock });
    await expect(successDispatcher.dispatch()).resolves.toEqual({ dispatched: 1, failed: 0 });

    const consumer = new AiEmailConsumer(outbox, { send: vi.fn(async () => undefined) }, { clock });
    await expect(consumer.consume(sentMessages[0])).resolves.toEqual({ outcome: "ack" });

    const row = await testD1.db.prepare(
      "SELECT status FROM ai_email_outbox WHERE id = ?",
    ).bind(`ai-email:${proposal.action_id}`).first<{ status: string }>();
    expect(row?.status).toBe("sent");
  });
});
