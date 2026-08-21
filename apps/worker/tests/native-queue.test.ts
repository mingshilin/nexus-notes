import { afterEach, describe, expect, it, vi } from "vitest";

import type { QueueJob } from "@nexus/contracts";

import { createTestD1, seedTenants } from "./helpers/d1";

const disposals: Array<() => Promise<void>> = [];

class FakeNativeMessage {
  readonly id = crypto.randomUUID();
  readonly timestamp = new Date();
  readonly ack = vi.fn();
  readonly retry = vi.fn();

  constructor(readonly body: unknown, readonly attempts = 1) {}
}

function fakeBatch(messages: FakeNativeMessage[]) {
  return {
    messages,
    queue: "nexus-test-jobs",
    metadata: { metrics: { backlogCount: messages.length, backlogBytes: 0 } },
    retryAll: vi.fn(),
    ackAll: vi.fn(),
  };
}

function pdfObject() {
  return {
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]));
        controller.close();
      },
    }),
    size: 5,
  };
}

async function fixture() {
  const testD1 = await createTestD1();
  disposals.push(testD1.dispose);
  await seedTenants(testD1.db);
  const worker = await import("../src");
  let nextId = 0;
  const repository = new worker.D1AttachmentRepository(testD1.db, () => `id-${++nextId}`);
  const now = new Date().toISOString();
  const attachment = await repository.reserveUpload({
    workspaceId: "ws-1",
    userId: "user-1",
    input: { filename: "scan.pdf", mime_type: "application/pdf", size_bytes: 5, idempotency_key: "upload-1" },
    now,
  });
  await repository.markUploaded("ws-1", attachment.id, now);
  const job = await repository.ensureOcrJob("ws-1", "user-1", attachment.id, now);
  if (!job) throw new Error("Expected OCR job");
  const row = await testD1.db.prepare("SELECT payload_json FROM queue_outbox WHERE id = ?")
    .bind(job.outbox_id).first<{ payload_json: string }>();
  if (!row) throw new Error("Expected OCR queue message");
  return { ...worker, db: testD1.db, job: JSON.parse(row.payload_json) as QueueJob };
}

function queueEnv(db: D1Database, options: { ai?: { toMarkdown: ReturnType<typeof vi.fn> }; files?: { get: ReturnType<typeof vi.fn> } } = {}) {
  return {
    DB: db,
    FILES: options.files ?? { get: vi.fn(async () => pdfObject()) },
    AI: options.ai ?? { toMarkdown: vi.fn(async () => ({ format: "markdown", data: "# Private OCR" })) },
  };
}

afterEach(async () => {
  await Promise.all(disposals.splice(0).map((dispose) => dispose()));
});

describe("native Cloudflare OCR queue wiring", () => {
  it("uses the repository-authorized object through native bindings, completes once, and acks duplicate delivery", async () => {
    const { createBetaWorker, db, job } = await fixture();
    const ai = { toMarkdown: vi.fn(async () => ({ format: "markdown", data: "# Private OCR" })) };
    const first = new FakeNativeMessage({ ...job, payload: { ...job.payload, object_key: "attacker-controlled" } });
    const duplicate = new FakeNativeMessage(job);

    await (createBetaWorker() as any).queue(fakeBatch([first, duplicate]), queueEnv(db, { ai }), {});

    expect(first.ack).toHaveBeenCalledOnce();
    expect(duplicate.ack).toHaveBeenCalledOnce();
    expect(first.retry).not.toHaveBeenCalled();
    expect(duplicate.retry).not.toHaveBeenCalled();
    expect(ai.toMarkdown).toHaveBeenCalledOnce();
    expect(await db.prepare("SELECT status FROM beta_ocr_jobs WHERE id = ?").bind(job.job_id).first())
      .toEqual({ status: "completed" });
    expect(await db.prepare("SELECT ocr_text FROM search_documents WHERE workspace_id = 'ws-1' AND entity_type = 'attachment'").first())
      .toEqual({ ocr_text: "# Private OCR" });
  });

  it("retries only the retryable native message and safely acks its malformed batch peer", async () => {
    const { createBetaWorker, db, job } = await fixture();
    const ai = { toMarkdown: vi.fn(async () => { throw Object.assign(new Error("OCR_TIMEOUT"), { retryable: true }); }) };
    const malformed = new FakeNativeMessage(null);
    const retryable = new FakeNativeMessage(job);
    const audit = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    try {
      await (createBetaWorker() as any).queue(fakeBatch([malformed, retryable]), queueEnv(db, { ai }), {});

      expect(malformed.ack).toHaveBeenCalledOnce();
      expect(malformed.retry).not.toHaveBeenCalled();
      expect(retryable.ack).not.toHaveBeenCalled();
      expect(retryable.retry).toHaveBeenCalledWith({ delaySeconds: 1 });
      expect(audit).toHaveBeenCalledWith("OCR_QUEUE_MESSAGE_INVALID");
    } finally {
      audit.mockRestore();
    }
    expect(await db.prepare("SELECT status, last_error_code FROM beta_ocr_jobs WHERE id = ?").bind(job.job_id).first())
      .toEqual({ status: "pending", last_error_code: "OCR_AI_REQUEST_FAILED" });
  });

  it("acks stale and terminal native deliveries without retrying them", async () => {
    const { createBetaWorker, db, job } = await fixture();
    const ai = { toMarkdown: vi.fn(async () => { throw Object.assign(new Error("OCR_TIMEOUT"), { retryable: true }); }) };
    const stale = new FakeNativeMessage({ ...job, payload: { ...job.payload, source_revision: job.payload.source_revision + 1 } });
    const exhausted = new FakeNativeMessage(job, 3);

    await (createBetaWorker() as any).queue(fakeBatch([stale, exhausted]), queueEnv(db, { ai }), {});

    expect(stale.ack).toHaveBeenCalledOnce();
    expect(stale.retry).not.toHaveBeenCalled();
    expect(exhausted.ack).toHaveBeenCalledOnce();
    expect(exhausted.retry).not.toHaveBeenCalled();
    expect(await db.prepare("SELECT status, last_error_code FROM beta_ocr_jobs WHERE id = ?").bind(job.job_id).first())
      .toEqual({ status: "dead_letter", last_error_code: "OCR_ATTEMPTS_EXHAUSTED" });
  });

  it("uses the stricter persisted attempt when a native delivery is redelivered", async () => {
    const { createBetaWorker, db, job } = await fixture();
    const ai = { toMarkdown: vi.fn(async () => { throw Object.assign(new Error("OCR_TIMEOUT"), { retryable: true }); }) };
    const redelivery = new FakeNativeMessage(job, 2);

    await (createBetaWorker() as any).queue(fakeBatch([redelivery]), queueEnv(db, { ai }), {});

    expect(redelivery.ack).not.toHaveBeenCalled();
    expect(redelivery.retry).toHaveBeenCalledWith({ delaySeconds: 2 });
    expect(await db.prepare("SELECT status, attempt_count FROM beta_ocr_jobs WHERE id = ?").bind(job.job_id).first())
      .toEqual({ status: "pending", attempt_count: 2 });
  });

  it("persists native delivery attempts before deadline recovery and advances only to attempt three", async () => {
    const { D1AttachmentRepository, createBetaWorker, db, job } = await fixture();
    const expired = "2000-01-01T00:00:00.000Z";
    await db.prepare("UPDATE beta_ocr_jobs SET deadline = ? WHERE id = ?").bind(expired, job.job_id).run();
    const delivery = new FakeNativeMessage({ ...job, deadline: expired }, 2);

    await (createBetaWorker() as any).queue(fakeBatch([delivery]), queueEnv(db), {});

    expect(delivery.ack).toHaveBeenCalledOnce();
    expect(await db.prepare("SELECT status, attempt_count FROM beta_ocr_jobs WHERE id = ?").bind(job.job_id).first())
      .toEqual({ status: "pending", attempt_count: 2 });
    const repository = new (D1AttachmentRepository as any)(db);
    await expect(repository.recoverStaleOcrJobs(new Date().toISOString(), 50)).resolves.toEqual({ requeued: 1, dead_lettered: 0 });
    expect(await db.prepare("SELECT status, attempt_count FROM beta_ocr_jobs WHERE id = ?").bind(job.job_id).first())
      .toEqual({ status: "pending", attempt_count: 3 });
  });

  it("caps an over-limit native delivery at the persisted attempt ceiling before dead-lettering", async () => {
    const { createBetaWorker, db, job } = await fixture();
    const ai = { toMarkdown: vi.fn(async () => { throw Object.assign(new Error("OCR_TIMEOUT"), { retryable: true }); }) };
    const delivery = new FakeNativeMessage(job, 4);

    await (createBetaWorker() as any).queue(fakeBatch([delivery]), queueEnv(db, { ai }), {});

    expect(delivery.ack).toHaveBeenCalledOnce();
    expect(delivery.retry).not.toHaveBeenCalled();
    expect(await db.prepare("SELECT status, attempt_count, last_error_code FROM beta_ocr_jobs WHERE id = ?").bind(job.job_id).first())
      .toEqual({ status: "dead_letter", attempt_count: 3, last_error_code: "OCR_ATTEMPTS_EXHAUSTED" });
  });

  it.each(["AI", "FILES"] as const)("treats a missing %s binding as an OCR-only terminal degradation", async (binding) => {
    const { createBetaWorker, db, job } = await fixture();
    const message = new FakeNativeMessage(job);
    const env = queueEnv(db);
    delete (env as Record<string, unknown>)[binding];

    await (createBetaWorker() as any).queue(fakeBatch([message]), env, {});

    expect(message.ack).toHaveBeenCalledOnce();
    expect(message.retry).not.toHaveBeenCalled();
    expect(await db.prepare("SELECT status, last_error_code FROM beta_ocr_jobs WHERE id = ?").bind(job.job_id).first())
      .toEqual({ status: "failed", last_error_code: binding === "AI" ? "OCR_AI_UNAVAILABLE" : "OCR_STORAGE_UNAVAILABLE" });
  });
});
