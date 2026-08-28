import { afterEach, describe, expect, it, vi } from "vitest";

import { D1AiToolRepository } from "../src";
import { AiEmailConsumer } from "../src/ai/ai-email-consumer";
import { AiEmailOutboxRepository } from "../src/ai/ai-email-outbox-repository";
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

  let currentTime = new Date("2026-08-25T00:00:00.000Z");
  let nextId = 1;
  const clock = () => new Date(currentTime);
  const createId = () => `email-${nextId++}`;
  const proposals = new D1AiToolRepository(testD1.db);
  const repository = new AiEmailOutboxRepository(testD1.db, { clock, createId });
  const sender = { send: vi.fn(async () => undefined) };
  const consumer = new AiEmailConsumer(repository, sender, { clock });
  return { testD1, proposals, repository, sender, consumer, clock };
}

describe("AiEmailConsumer", () => {
  it("sends pending mail once and marks it sent", async () => {
    const { testD1, proposals, repository, sender, consumer } = await setup();
    await proposals.insertProposal({
      actionId: "action-1",
      userId: "user-1",
      workspaceId: "ws-1",
      tool: "send_email",
      input: { to_email: "user@example.test", subject: "Status", body_text: "Done" },
      expiresAt: "2026-08-25T00:10:00.000Z",
      now: "2026-08-25T00:00:00.000Z",
    });
    const outbox = await repository.enqueue({
      actionId: "action-1",
      userId: "user-1",
      workspaceId: "ws-1",
      toEmail: "user@example.test",
      subject: "Status",
      bodyText: "Done",
      now: "2026-08-25T00:00:00.000Z",
    });
    await repository.markOutboxDispatched(outbox.id, "2026-08-25T00:00:00.000Z");

    await expect(consumer.consume({
      body: {
        job_id: "job-1",
        kind: "notification",
        idempotency_key: "ai-email:action-1",
        attempt: 1,
        deadline: "2026-08-25T00:15:00.000Z",
        payload: { outbox_id: outbox.id, to_email: "user@example.test" },
      },
      attempts: 1,
    })).resolves.toEqual({ outcome: "ack" });

    expect(sender.send).toHaveBeenCalledWith({
      to: "user@example.test",
      subject: "Status",
      text: "Done",
    });

    const row = await testD1.db.prepare("SELECT status, sent_at FROM ai_email_outbox WHERE id = ?").bind(outbox.id).first<{ status: string; sent_at: string | null }>();
    expect(row).toEqual({ status: "sent", sent_at: "2026-08-25T00:00:00.000Z" });
  });

  it("retries temporary send failures", async () => {
    const { proposals, repository } = await setup();
    await proposals.insertProposal({
      actionId: "action-2",
      userId: "user-1",
      workspaceId: "ws-1",
      tool: "send_email",
      input: { to_email: "user@example.test", subject: "Status", body_text: "Done" },
      expiresAt: "2026-08-25T00:10:00.000Z",
      now: "2026-08-25T00:00:00.000Z",
    });
    const outbox = await repository.enqueue({
      actionId: "action-2",
      userId: "user-1",
      workspaceId: "ws-1",
      toEmail: "user@example.test",
      subject: "Status",
      bodyText: "Done",
      now: "2026-08-25T00:00:00.000Z",
    });
    await repository.markOutboxDispatched(outbox.id, "2026-08-25T00:00:00.000Z");
    const sender = {
      send: vi.fn(async () => { throw Object.assign(new Error("Email delivery failed with status 500"), { code: "RESEND_FAILURE" }); }),
    };
    const retrying = new AiEmailConsumer(repository, sender, { clock: () => new Date("2026-08-25T00:00:00.000Z") });

    await expect(retrying.consume({
      body: {
        job_id: "job-2",
        kind: "notification",
        idempotency_key: "ai-email:action-2",
        attempt: 1,
        deadline: "2026-08-25T00:15:00.000Z",
        payload: { outbox_id: outbox.id, to_email: "user@example.test" },
      },
      attempts: 1,
    })).resolves.toEqual({ outcome: "retry", delaySeconds: 30 });
  });

  it("treats missing Resend configuration as a permanent failure", async () => {
    const { proposals, repository } = await setup();
    await proposals.insertProposal({
      actionId: "action-3",
      userId: "user-1",
      workspaceId: "ws-1",
      tool: "send_email",
      input: { to_email: "user@example.test", subject: "Status", body_text: "Done" },
      expiresAt: "2026-08-25T00:10:00.000Z",
      now: "2026-08-25T00:00:00.000Z",
    });
    const outbox = await repository.enqueue({
      actionId: "action-3",
      userId: "user-1",
      workspaceId: "ws-1",
      toEmail: "user@example.test",
      subject: "Status",
      bodyText: "Done",
      now: "2026-08-25T00:00:00.000Z",
    });
    await repository.markOutboxDispatched(outbox.id, "2026-08-25T00:00:00.000Z");
    const sender = {
      send: vi.fn(async () => { throw new Error("RESEND_API_KEY is not configured"); }),
    };
    const consumer = new AiEmailConsumer(repository, sender, { clock: () => new Date("2026-08-25T00:00:00.000Z") });

    await expect(consumer.consume({
      body: {
        job_id: "job-3",
        kind: "notification",
        idempotency_key: "ai-email:action-3",
        attempt: 1,
        deadline: "2026-08-25T00:15:00.000Z",
        payload: { outbox_id: outbox.id, to_email: "user@example.test" },
      },
      attempts: 1,
    })).resolves.toEqual({ outcome: "ack" });
  });

  it.each([408, 429, 500])("retries transient Resend status %s failures", async (status) => {
    const { proposals, repository } = await setup();
    await proposals.insertProposal({
      actionId: `action-retry-${status}`,
      userId: "user-1",
      workspaceId: "ws-1",
      tool: "send_email",
      input: { to_email: "user@example.test", subject: "Status", body_text: "Done" },
      expiresAt: "2026-08-25T00:10:00.000Z",
      now: "2026-08-25T00:00:00.000Z",
    });
    const outbox = await repository.enqueue({
      actionId: `action-retry-${status}`,
      userId: "user-1",
      workspaceId: "ws-1",
      toEmail: "user@example.test",
      subject: "Status",
      bodyText: "Done",
      now: "2026-08-25T00:00:00.000Z",
    });
    await repository.markOutboxDispatched(outbox.id, "2026-08-25T00:00:00.000Z");
    const sender = {
      send: vi.fn(async () => { throw new Error(`Email delivery failed with status ${status}`); }),
    };
    const consumer = new AiEmailConsumer(repository, sender, { clock: () => new Date("2026-08-25T00:00:00.000Z") });

    await expect(consumer.consume({
      body: {
        job_id: `job-retry-${status}`,
        kind: "notification",
        idempotency_key: `ai-email:action-retry-${status}`,
        attempt: 1,
        deadline: "2026-08-25T00:15:00.000Z",
        payload: { outbox_id: outbox.id, to_email: "user@example.test" },
      },
      attempts: 1,
    })).resolves.toEqual({ outcome: "retry", delaySeconds: 30 });
  });

  it("caps retryable email delivery attempts", async () => {
    const { testD1, proposals, repository } = await setup();
    await proposals.insertProposal({
      actionId: "action-max-retry",
      userId: "user-1",
      workspaceId: "ws-1",
      tool: "send_email",
      input: { to_email: "user@example.test", subject: "Status", body_text: "Done" },
      expiresAt: "2026-08-25T00:10:00.000Z",
      now: "2026-08-25T00:00:00.000Z",
    });
    const outbox = await repository.enqueue({
      actionId: "action-max-retry",
      userId: "user-1",
      workspaceId: "ws-1",
      toEmail: "user@example.test",
      subject: "Status",
      bodyText: "Done",
      now: "2026-08-25T00:00:00.000Z",
    });
    await testD1.db.prepare(
      "UPDATE ai_email_outbox SET status = 'sending', attempt_count = 5, updated_at = ? WHERE id = ?",
    ).bind("2026-08-25T00:00:00.000Z", outbox.id).run();

    const sender = {
      send: vi.fn(async () => { throw new Error("Email delivery failed with status 500"); }),
    };
    const consumer = new AiEmailConsumer(repository, sender, { clock: () => new Date("2026-08-25T00:00:00.000Z") });

    await expect(consumer.consume({
      body: {
        job_id: "job-max-retry",
        kind: "notification",
        idempotency_key: "ai-email:action-max-retry",
        attempt: 6,
        deadline: "2026-08-25T00:15:00.000Z",
        payload: { outbox_id: outbox.id, to_email: "user@example.test" },
      },
      attempts: 6,
    })).resolves.toEqual({ outcome: "ack" });
  });

  it("rejects a recipient mismatch before sending", async () => {
    const { proposals, repository, sender } = await setup();
    await proposals.insertProposal({
      actionId: "action-4",
      userId: "user-1",
      workspaceId: "ws-1",
      tool: "send_email",
      input: { to_email: "user@example.test", subject: "Status", body_text: "Done" },
      expiresAt: "2026-08-25T00:10:00.000Z",
      now: "2026-08-25T00:00:00.000Z",
    });
    const outbox = await repository.enqueue({
      actionId: "action-4",
      userId: "user-1",
      workspaceId: "ws-1",
      toEmail: "user@example.test",
      subject: "Status",
      bodyText: "Done",
      now: "2026-08-25T00:00:00.000Z",
    });
    await repository.markOutboxDispatched(outbox.id, "2026-08-25T00:00:00.000Z");
    const consumer = new AiEmailConsumer(repository, sender, { clock: () => new Date("2026-08-25T00:00:00.000Z") });

    await expect(consumer.consume({
      body: {
        job_id: "job-4",
        kind: "notification",
        idempotency_key: "ai-email:action-4",
        attempt: 1,
        deadline: "2026-08-25T00:15:00.000Z",
        payload: { outbox_id: outbox.id, to_email: "other@example.test" },
      },
      attempts: 1,
    })).resolves.toEqual({ outcome: "ack" });
    expect(sender.send).not.toHaveBeenCalled();
  });

  it("skips already sent outbox rows on replay", async () => {
    const { testD1, proposals, repository, sender, consumer } = await setup();
    await proposals.insertProposal({
      actionId: "action-5",
      userId: "user-1",
      workspaceId: "ws-1",
      tool: "send_email",
      input: { to_email: "user@example.test", subject: "Status", body_text: "Done" },
      expiresAt: "2026-08-25T00:10:00.000Z",
      now: "2026-08-25T00:00:00.000Z",
    });
    const outbox = await repository.enqueue({
      actionId: "action-5",
      userId: "user-1",
      workspaceId: "ws-1",
      toEmail: "user@example.test",
      subject: "Status",
      bodyText: "Done",
      now: "2026-08-25T00:00:00.000Z",
    });
    await repository.markOutboxDispatched(outbox.id, "2026-08-25T00:00:00.000Z");
    await testD1.db.prepare(
      "UPDATE ai_email_outbox SET status = 'sent', sent_at = ?, updated_at = ? WHERE id = ?",
    ).bind("2026-08-25T00:00:00.000Z", "2026-08-25T00:00:00.000Z", outbox.id).run();

    await expect(consumer.consume({
      body: {
        job_id: "job-5",
        kind: "notification",
        idempotency_key: "ai-email:action-5",
        attempt: 2,
        deadline: "2026-08-25T00:15:00.000Z",
        payload: { outbox_id: outbox.id, to_email: "user@example.test" },
      },
      attempts: 2,
    })).resolves.toEqual({ outcome: "ack" });
    expect(sender.send).not.toHaveBeenCalled();
  });

  it("claims an outbox row so concurrent consumers send only once", async () => {
    const { proposals, repository } = await setup();
    await proposals.insertProposal({
      actionId: "action-concurrent",
      userId: "user-1",
      workspaceId: "ws-1",
      tool: "send_email",
      input: { to_email: "user@example.test", subject: "Status", body_text: "Done" },
      expiresAt: "2026-08-25T00:10:00.000Z",
      now: "2026-08-25T00:00:00.000Z",
    });
    const outbox = await repository.enqueue({
      actionId: "action-concurrent",
      userId: "user-1",
      workspaceId: "ws-1",
      toEmail: "user@example.test",
      subject: "Status",
      bodyText: "Done",
      now: "2026-08-25T00:00:00.000Z",
    });
    const started = deferred();
    const release = deferred();
    const sender = {
      send: vi.fn(async () => {
        started.resolve();
        await release.promise;
      }),
    };
    const firstConsumer = new AiEmailConsumer(repository, sender, { clock: () => new Date("2026-08-25T00:00:00.000Z") });
    const secondConsumer = new AiEmailConsumer(repository, sender, { clock: () => new Date("2026-08-25T00:00:00.000Z") });
    const message = {
      body: {
        job_id: "job-concurrent",
        kind: "notification",
        idempotency_key: "ai-email:action-concurrent",
        attempt: 1,
        deadline: "2026-08-25T00:15:00.000Z",
        payload: { outbox_id: outbox.id, to_email: "user@example.test" },
      },
      attempts: 1,
    };

    await repository.markOutboxDispatched(outbox.id, "2026-08-25T00:00:00.000Z");
    const claim = await repository.claimForDelivery(outbox.id, "2026-08-25T00:00:00.000Z");
    expect(claim?.status).toBe("sending");
    await expect(secondConsumer.consume(message)).resolves.toEqual({ outcome: "ack" });
    expect(sender.send).not.toHaveBeenCalled();
  });
});
