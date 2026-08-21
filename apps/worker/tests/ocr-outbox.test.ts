import { afterEach, describe, expect, it, vi } from "vitest";

import type { QueueJob } from "@nexus/contracts";

import { createTestD1, seedTenants } from "./helpers/d1";

const now = "2026-08-21T00:00:00.000Z";
const disposals: Array<() => Promise<void>> = [];

async function fixture() {
  const testD1 = await createTestD1();
  disposals.push(testD1.dispose);
  await seedTenants(testD1.db);
  const worker = await import("../src");
  let nextId = 0;
  const repository = new worker.D1AttachmentRepository(testD1.db, () => `id-${++nextId}`);
  const attachment = await repository.reserveUpload({
    workspaceId: "ws-1",
    userId: "user-1",
    input: {
      filename: "scan.pdf",
      mime_type: "application/pdf",
      size_bytes: 5,
      idempotency_key: "upload-1",
    },
    now,
  });
  await repository.markUploaded("ws-1", attachment.id, now);
  return { ...worker, db: testD1.db, repository, attachmentId: attachment.id };
}

async function persistedMessage(db: D1Database, outboxId?: string) {
  const row = await db.prepare(
    `SELECT id, payload_json FROM queue_outbox
     WHERE job_kind = 'ocr' AND (? IS NULL OR id = ?) ORDER BY created_at, id LIMIT 1`,
  ).bind(outboxId ?? null, outboxId ?? null).first<{ id: string; payload_json: string }>();
  if (!row) throw new Error("OCR outbox message was not persisted");
  return { id: row.id, message: JSON.parse(row.payload_json) as QueueJob };
}

afterEach(async () => {
  await Promise.all(disposals.splice(0).map((dispose) => dispose()));
});

describe("D1 OCR source revision and outbox", () => {
  it("atomically creates one job and one persisted message per workspace attachment source revision", async () => {
    const { db, repository, attachmentId } = await fixture();

    const creations = await Promise.all([
      repository.ensureOcrJob("ws-1", "user-1", attachmentId, now),
      repository.ensureOcrJob("ws-1", "user-2", attachmentId, now),
    ]);
    const jobs = (await db.prepare(
      "SELECT id, user_id, source_revision, attempt_count, deadline, idempotency_key FROM beta_ocr_jobs",
    ).all<{
      id: string;
      user_id: string;
      source_revision: number;
      attempt_count: number;
      deadline: string;
      idempotency_key: string;
    }>()).results;
    const outbox = (await db.prepare(
      "SELECT id, workspace_id, idempotency_key, payload_json, published_at FROM queue_outbox WHERE job_kind = 'ocr'",
    ).all<{ id: string; workspace_id: string; idempotency_key: string; payload_json: string; published_at: string | null }>()).results;

    expect(creations.filter((creation) => creation?.created)).toHaveLength(1);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ source_revision: 2, attempt_count: 1 });
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({ workspace_id: "ws-1", published_at: null });
    expect(JSON.parse(outbox[0]!.payload_json)).toEqual({
      job_id: jobs[0]!.id,
      kind: "ocr",
      idempotency_key: jobs[0]!.idempotency_key,
      attempt: jobs[0]!.attempt_count,
      deadline: jobs[0]!.deadline,
      payload: { workspace_id: "ws-1", attachment_id: attachmentId, source_revision: 2 },
    });
  });

  it("claims exactly once only when every persisted message value still matches live tenant state", async () => {
    const { db, repository, attachmentId } = await fixture();
    const created = await repository.ensureOcrJob("ws-1", "user-1", attachmentId, now);
    const { message } = await persistedMessage(db, created?.outbox_id);

    const invalidMessages: QueueJob[] = [
      { ...message, payload: { ...message.payload, workspace_id: "ws-2" } },
      { ...message, payload: { ...message.payload, attachment_id: "other-attachment" } },
      { ...message, payload: { ...message.payload, source_revision: 3 } },
      { ...message, idempotency_key: `${message.idempotency_key}:stale` },
      { ...message, attempt: message.attempt + 1 },
      { ...message, deadline: "2026-08-21T00:11:00.000Z" },
    ];
    for (const invalid of invalidMessages) {
      await expect(repository.claimOcrJob(invalid, now)).resolves.toBeNull();
    }

    const claims = await Promise.all([
      repository.claimOcrJob(message, now),
      repository.claimOcrJob(message, now),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);

    const other = await repository.reserveUpload({
      workspaceId: "ws-1",
      userId: "user-1",
      input: { filename: "deleted.pdf", mime_type: "application/pdf", size_bytes: 5, idempotency_key: "deleted" },
      now,
    });
    await repository.markUploaded("ws-1", other.id, now);
    const deletedJob = await repository.ensureOcrJob("ws-1", "user-1", other.id, now);
    const deletedMessage = await persistedMessage(db, deletedJob?.outbox_id);
    await repository.deleteAttachment("ws-1", other.id, now);
    await expect(repository.claimOcrJob(deletedMessage.message, now)).resolves.toBeNull();
  });

  it("uses retry CAS so concurrent callers create one next-attempt outbox message regardless of user", async () => {
    const { db, repository, attachmentId } = await fixture();
    const created = await repository.ensureOcrJob("ws-1", "user-1", attachmentId, now);
    const { message } = await persistedMessage(db, created?.outbox_id);
    const claimed = await repository.claimOcrJob(message, now);
    expect(claimed).not.toBeNull();
    await repository.failOcrJob("ws-1", message.job_id, "OCR_EXTRACTION_FAILED", now);

    const retries = await Promise.all([
      repository.retryOcr("ws-1", "user-1", [attachmentId], now),
      repository.retryOcr("ws-1", "user-2", [attachmentId], now),
    ]);
    const rows = (await db.prepare(
      "SELECT payload_json FROM queue_outbox WHERE job_kind = 'ocr' ORDER BY created_at, id",
    ).all<{ payload_json: string }>()).results;
    const retryMessages = rows.map((row) => JSON.parse(row.payload_json) as QueueJob)
      .filter((job) => job.attempt === 2);

    expect(retries.flatMap((retry) => retry.queued)).toEqual([attachmentId]);
    expect(retries.flatMap((retry) => retry.duplicate)).toEqual([attachmentId]);
    expect(retryMessages).toHaveLength(1);
    expect(retryMessages[0]).toMatchObject({
      job_id: message.job_id,
      idempotency_key: message.idempotency_key,
      attempt: 2,
      payload: { workspace_id: "ws-1", attachment_id: attachmentId, source_revision: 2 },
    });
  });

  it("leaves a failed send recoverable and marks a later successful dispatch exactly once", async () => {
    const { db, repository, attachmentId, OcrOutboxDispatcher } = await fixture();
    const created = await repository.ensureOcrJob("ws-1", "user-1", attachmentId, now);
    const firstQueue = { send: vi.fn(async () => { throw new Error("queue unavailable"); }) };
    const firstDispatcher = new OcrOutboxDispatcher(repository, firstQueue, { clock: () => new Date(now) });

    await expect(firstDispatcher.dispatch([created!.outbox_id])).resolves.toEqual({ dispatched: 0, failed: 1 });
    const failedRow = await db.prepare(
      "SELECT published_at, attempt FROM queue_outbox WHERE id = ?",
    ).bind(created!.outbox_id).first<{ published_at: string | null; attempt: number }>();
    expect(failedRow).toEqual({ published_at: null, attempt: 1 });

    const recoveredQueue = { send: vi.fn(async () => undefined) };
    const recoveredDispatcher = new OcrOutboxDispatcher(repository, recoveredQueue, { clock: () => new Date(now) });
    await expect(recoveredDispatcher.dispatch()).resolves.toEqual({ dispatched: 1, failed: 0 });
    await expect(recoveredDispatcher.dispatch()).resolves.toEqual({ dispatched: 0, failed: 0 });
    expect(recoveredQueue.send).toHaveBeenCalledOnce();
    expect(recoveredQueue.send).toHaveBeenCalledWith((await persistedMessage(db, created!.outbox_id)).message);
    expect(await db.prepare(
      "SELECT published_at, attempt FROM queue_outbox WHERE id = ?",
    ).bind(created!.outbox_id).first()).toEqual({ published_at: now, attempt: 2 });
  });

  it("recovers delayed expired pending delivery once into a new claimable attempt", async () => {
    const { db, repository, attachmentId } = await fixture();
    const created = await repository.ensureOcrJob("ws-1", "user-1", attachmentId, now);
    const original = await persistedMessage(db, created?.outbox_id);
    await repository.markOcrOutboxDispatched(original.id, now);
    const late = "2026-08-21T00:11:00.000Z";

    await expect(repository.claimOcrJob(original.message, late)).resolves.toBeNull();
    const recoveries = await Promise.all([
      repository.recoverStaleOcrJobs(late, 50),
      repository.recoverStaleOcrJobs(late, 50),
    ]);
    expect(recoveries.reduce((count, result) => count + result.requeued, 0)).toBe(1);
    expect(recoveries.reduce((count, result) => count + result.dead_lettered, 0)).toBe(0);

    const row = await db.prepare(
      "SELECT status, attempt_count, deadline, revision FROM beta_ocr_jobs WHERE id = ?",
    ).bind(original.message.job_id).first();
    expect(row).toEqual({ status: "pending", attempt_count: 2, deadline: "2026-08-21T00:21:00.000Z", revision: 2 });
    const next = (await db.prepare(
      "SELECT payload_json FROM queue_outbox WHERE job_kind = 'ocr' AND published_at IS NULL",
    ).all<{ payload_json: string }>()).results.map((item) => JSON.parse(item.payload_json) as QueueJob);
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({ job_id: original.message.job_id, attempt: 2, deadline: "2026-08-21T00:21:00.000Z" });
    await expect(repository.claimOcrJob(next[0]!, late)).resolves.toMatchObject({ attempt_count: 2 });
  });

  it("recovers an abandoned processing claim and terminates an exhausted stale claim", async () => {
    const { db, repository, attachmentId } = await fixture();
    const created = await repository.ensureOcrJob("ws-1", "user-1", attachmentId, now);
    const original = await persistedMessage(db, created?.outbox_id);
    await repository.markOcrOutboxDispatched(original.id, now);
    await expect(repository.claimOcrJob(original.message, now)).resolves.not.toBeNull();
    const late = "2026-08-21T00:11:00.000Z";

    await expect(repository.recoverStaleOcrJobs(late, 50)).resolves.toMatchObject({ requeued: 1, dead_lettered: 0 });
    const recovered = await db.prepare(
      "SELECT status, attempt_count, revision FROM beta_ocr_jobs WHERE id = ?",
    ).bind(original.message.job_id).first();
    expect(recovered).toEqual({ status: "pending", attempt_count: 2, revision: 3 });

    await db.prepare(
      "UPDATE beta_ocr_jobs SET status = 'processing', attempt_count = 3, deadline = ?, revision = revision + 1 WHERE id = ?",
    ).bind("2026-08-21T00:12:00.000Z", original.message.job_id).run();
    await expect(repository.recoverStaleOcrJobs("2026-08-21T00:13:00.000Z", 50)).resolves.toMatchObject({
      requeued: 0,
      dead_lettered: 1,
    });
    expect(await db.prepare(
      "SELECT status, attempt_count, last_error_code FROM beta_ocr_jobs WHERE id = ?",
    ).bind(original.message.job_id).first()).toEqual({
      status: "dead_letter",
      attempt_count: 3,
      last_error_code: "OCR_ATTEMPTS_EXHAUSTED",
    });
    const attemptFour = await db.prepare(
      "SELECT 1 found FROM queue_outbox WHERE json_extract(payload_json, '$.attempt') = 4",
    ).first();
    expect(attemptFour).toBeNull();
  });

  it("rolls back completed state when the OCR search upsert fails", async () => {
    const { db, repository, attachmentId } = await fixture();
    const created = await repository.ensureOcrJob("ws-1", "user-1", attachmentId, now);
    const original = await persistedMessage(db, created?.outbox_id);
    await expect(repository.claimOcrJob(original.message, now)).resolves.not.toBeNull();
    await db.prepare(
      `CREATE TRIGGER force_attachment_search_failure
       BEFORE INSERT ON search_documents
       WHEN NEW.entity_type = 'attachment'
       BEGIN
         SELECT RAISE(ABORT, 'forced attachment search failure');
       END`,
    ).run();

    await expect(repository.completeOcrJob("ws-1", original.message.job_id, "alpha OCR", now)).rejects.toThrow(
      /forced attachment search failure/i,
    );
    expect(await db.prepare(
      "SELECT status, revision FROM beta_ocr_jobs WHERE id = ?",
    ).bind(original.message.job_id).first()).toEqual({ status: "processing", revision: 2 });
    expect(await db.prepare(
      "SELECT 1 found FROM search_documents WHERE workspace_id = 'ws-1' AND entity_type = 'attachment' AND entity_id = ?",
    ).bind(attachmentId).first()).toBeNull();
  });
});
