import { afterEach, describe, expect, it, vi } from "vitest";

import type { QueueJob } from "@nexus/contracts";

import { createTestD1, seedTenants } from "./helpers/d1";

const now = "2026-08-21T00:00:00.000Z";
const disposals: Array<() => Promise<void>> = [];

class FakeMessage {
  readonly ack = vi.fn();
  readonly retry = vi.fn();

  constructor(readonly body: unknown, readonly attempts = 1) {}
}

async function fixture() {
  const testD1 = await createTestD1();
  disposals.push(testD1.dispose);
  await seedTenants(testD1.db);
  const worker = await import("../src");
  let nextId = 0;
  const repository = new worker.D1AttachmentRepository(testD1.db, () => `id-${++nextId}`);
  const attachment = await repository.reserveUpload({
    workspaceId: "ws-1", userId: "user-1",
    input: { filename: "scan.pdf", mime_type: "application/pdf", size_bytes: 5, idempotency_key: "upload-1" },
    now,
  });
  await repository.markUploaded("ws-1", attachment.id, now);
  const created = await repository.ensureOcrJob("ws-1", "user-1", attachment.id, now);
  if (!created) throw new Error("Expected OCR job");
  const persisted = await testD1.db.prepare("SELECT payload_json FROM queue_outbox WHERE id = ?")
    .bind(created.outbox_id).first<{ payload_json: string }>();
  const source = await testD1.db.prepare(
    "SELECT object_key, filename, mime_type, size_bytes FROM beta_attachments WHERE workspace_id = ? AND id = ?",
  ).bind("ws-1", attachment.id).first<{ object_key: string; filename: string; mime_type: string; size_bytes: number }>();
  if (!persisted || !source) throw new Error("Expected persisted OCR source");
  return { ...worker, db: testD1.db, repository, attachment, job: JSON.parse(persisted.payload_json) as QueueJob, source };
}

function consumer(WorkerConsumer: unknown, repository: unknown, extractor: { extract: ReturnType<typeof vi.fn> }) {
  return new (WorkerConsumer as any)(repository, extractor, { clock: () => new Date(now) });
}

afterEach(async () => {
  await Promise.all(disposals.splice(0).map((dispose) => dispose()));
});

describe("OcrConsumer outcomes", () => {
  it("extracts only repository-authorized attachment input, atomically completes search, and acks success", async () => {
    const { OcrConsumer, db, repository, job, source } = await fixture();
    const extractor = { extract: vi.fn(async () => "# Private OCR") };
    const message = new FakeMessage({ ...job, payload: { ...job.payload, object_key: "attacker-controlled" } } as QueueJob);

    await expect(consumer(OcrConsumer, repository, extractor).consume(message)).resolves.toEqual({ outcome: "ack" });

    expect(extractor.extract).toHaveBeenCalledWith({
      objectKey: source.object_key, filename: source.filename, mimeType: source.mime_type, sizeBytes: source.size_bytes,
      deadline: new Date(job.deadline),
    });
    expect(message.ack).toHaveBeenCalledOnce();
    expect(message.retry).not.toHaveBeenCalled();
    expect(await db.prepare("SELECT status, last_error_code FROM beta_ocr_jobs WHERE id = ?").bind(job.job_id).first())
      .toEqual({ status: "completed", last_error_code: null });
    expect(await db.prepare(
      "SELECT workspace_id, entity_id, ocr_text FROM search_documents WHERE entity_type = 'attachment'",
    ).first()).toEqual({ workspace_id: "ws-1", entity_id: job.payload.attachment_id, ocr_text: "# Private OCR" });
  });

  it("acks cross-workspace, source-stale, and deleted messages before extraction", async () => {
    const { OcrConsumer, db, repository, attachment, job } = await fixture();
    const extractor = { extract: vi.fn(async () => "unexpected") };
    const instance = consumer(OcrConsumer, repository, extractor);
    const crossWorkspace = new FakeMessage({ ...job, payload: { ...job.payload, workspace_id: "ws-2" } });
    const stale = new FakeMessage({ ...job, payload: { ...job.payload, source_revision: job.payload.source_revision + 1 } });

    await instance.consume(crossWorkspace);
    await instance.consume(stale);
    await repository.deleteAttachment("ws-1", attachment.id, now);
    const deleted = new FakeMessage(job);
    await instance.consume(deleted);

    expect([crossWorkspace, stale, deleted].every((message) => message.ack.mock.calls.length === 1)).toBe(true);
    expect(extractor.extract).not.toHaveBeenCalled();
    expect(await db.prepare("SELECT 1 found FROM search_documents WHERE entity_type = 'attachment'").first()).toBeNull();
  });

  it.each([null, 42, "ocr", [], { kind: "ocr" }, { kind: "other" }, { kind: "ocr", payload: null }])(
    "acks poison queue body %# before it can reach the repository or extractor",
    async (body) => {
    const { OcrConsumer, repository } = await fixture();
    const extractor = { extract: vi.fn(async () => "unexpected") };
      const message = new FakeMessage(body);

      await expect(consumer(OcrConsumer, repository, extractor).consume(message)).resolves.toEqual({ outcome: "ack" });

      expect(message.ack).toHaveBeenCalledOnce();
      expect(extractor.extract).not.toHaveBeenCalled();
    },
  );

  it("persists a retryable attempt-two failure, returns its bounded delay, and re-claims the same persisted message", async () => {
    const { OcrConsumer, db, repository, job } = await fixture();
    const extractor = { extract: vi.fn(async () => { throw Object.assign(new Error("OCR_TIMEOUT"), { retryable: true }); }) };
    const message = new FakeMessage(job, 2);

    await expect(consumer(OcrConsumer, repository, extractor).consume(message)).resolves.toEqual({ outcome: "retry", delaySeconds: 2 });

    expect(message.retry).not.toHaveBeenCalled();
    expect(message.ack).not.toHaveBeenCalled();
    expect(await db.prepare("SELECT status, last_error_code FROM beta_ocr_jobs WHERE id = ?").bind(job.job_id).first())
      .toEqual({ status: "pending", last_error_code: "OCR_TIMEOUT" });

    const reclaimer = new FakeMessage(job, 2);
    const recovered = { extract: vi.fn(async () => "# Reclaimed") };
    await expect(consumer(OcrConsumer, repository, recovered).consume(reclaimer)).resolves.toEqual({ outcome: "ack" });
    expect(reclaimer.ack).toHaveBeenCalledOnce();
    expect(await db.prepare("SELECT status FROM beta_ocr_jobs WHERE id = ?").bind(job.job_id).first()).toEqual({ status: "completed" });
  });

  it("maps unknown extractor details to the generic persisted OCR error", async () => {
    const { OcrConsumer, db, repository, job } = await fixture();
    const extractor = { extract: vi.fn(async () => { throw Object.assign(new Error("INTERNAL_PROVIDER_SECRET"), { code: "INTERNAL_PROVIDER_SECRET" }); }) };
    const message = new FakeMessage(job);

    await expect(consumer(OcrConsumer, repository, extractor).consume(message)).resolves.toEqual({ outcome: "ack" });

    expect(message.ack).toHaveBeenCalledOnce();
    expect(await db.prepare("SELECT status, last_error_code FROM beta_ocr_jobs WHERE id = ?").bind(job.job_id).first())
      .toEqual({ status: "failed", last_error_code: "OCR_EXTRACTION_FAILED" });
  });

  it("acks terminal failures and dead-letters an exhausted retryable delivery", async () => {
    const terminalFixture = await fixture();
    const terminal = new FakeMessage(terminalFixture.job);
    const terminalExtractor = { extract: vi.fn(async () => { throw new Error("OCR_AI_UNAVAILABLE"); }) };

    await expect(consumer(terminalFixture.OcrConsumer, terminalFixture.repository, terminalExtractor).consume(terminal)).resolves.toEqual({ outcome: "ack" });
    expect(terminal.ack).toHaveBeenCalledOnce();
    expect(await terminalFixture.db.prepare("SELECT status, last_error_code FROM beta_ocr_jobs WHERE id = ?").bind(terminalFixture.job.job_id).first())
      .toEqual({ status: "failed", last_error_code: "OCR_AI_UNAVAILABLE" });

    const exhaustedFixture = await fixture();
    const exhausted = new FakeMessage(exhaustedFixture.job, 3);
    const retryableExtractor = { extract: vi.fn(async () => { throw Object.assign(new Error("OCR_TIMEOUT"), { retryable: true }); }) };

    await expect(consumer(exhaustedFixture.OcrConsumer, exhaustedFixture.repository, retryableExtractor).consume(exhausted))
      .resolves.toEqual({ outcome: "ack" });
    expect(exhausted.ack).toHaveBeenCalledOnce();
    expect(await exhaustedFixture.db.prepare("SELECT status, last_error_code FROM beta_ocr_jobs WHERE id = ?").bind(exhaustedFixture.job.job_id).first())
      .toEqual({ status: "dead_letter", last_error_code: "OCR_ATTEMPTS_EXHAUSTED" });
  });

  it("acks duplicate delivery and isolates partial outcomes in one message batch", async () => {
    const { OcrConsumer, db, repository, job } = await fixture();
    const extractor = { extract: vi.fn(async () => "# OCR") };
    const instance = consumer(OcrConsumer, repository, extractor);
    const valid = new FakeMessage(job);
    const duplicate = new FakeMessage(job);

    await expect(instance.consumeBatch([valid, duplicate])).resolves.toEqual([{ outcome: "ack" }, { outcome: "ack" }]);

    expect(valid.ack).toHaveBeenCalledOnce();
    expect(duplicate.ack).toHaveBeenCalledOnce();
    expect(extractor.extract).toHaveBeenCalledOnce();
    expect(await db.prepare("SELECT status FROM beta_ocr_jobs WHERE id = ?").bind(job.job_id).first()).toEqual({ status: "completed" });
  });

  it("isolates safe ack and retry outcomes in the same real-D1 batch", async () => {
    const { OcrConsumer, db, repository, job } = await fixture();
    const extractor = { extract: vi.fn(async () => { throw Object.assign(new Error("OCR_TIMEOUT"), { retryable: true }); }) };
    const invalid = new FakeMessage(null);
    const retryable = new FakeMessage(job);

    await expect(consumer(OcrConsumer, repository, extractor).consumeBatch([invalid, retryable]))
      .resolves.toEqual([{ outcome: "ack" }, { outcome: "retry", delaySeconds: 1 }]);

    expect(invalid.ack).toHaveBeenCalledOnce();
    expect(retryable.ack).not.toHaveBeenCalled();
    expect(await db.prepare("SELECT status, last_error_code FROM beta_ocr_jobs WHERE id = ?").bind(job.job_id).first())
      .toEqual({ status: "pending", last_error_code: "OCR_TIMEOUT" });
  });

  it("isolates claim and persistence exceptions from a successful batch peer", async () => {
    const { OcrConsumer } = await fixture();
    const deadline = "2026-08-21T00:10:00.000Z";
    const queueJob = (jobId: string): QueueJob => ({
      job_id: jobId, kind: "ocr", idempotency_key: `ocr:${jobId}`, attempt: 1, deadline,
      payload: { workspace_id: "ws-1", attachment_id: `${jobId}-attachment`, source_revision: 1 },
    });
    const repository = {
      claimOcrJob: async (job: QueueJob) => {
        if (job.job_id === "claim-throws") throw new Error("D1_UNAVAILABLE");
        return {
          id: job.job_id, workspace_id: "ws-1", attachment_id: job.payload.attachment_id,
          attempt_count: 1, deadline, object_key: job.job_id, filename: "scan.pdf", mime_type: "application/pdf", size_bytes: 5,
        };
      },
      completeOcrJob: async (_workspaceId: string, jobId: string) => {
        if (jobId === "persist-throws") throw new Error("D1_WRITE_FAILED");
        return true;
      },
      retryOcrJob: async () => { throw new Error("D1_RETRY_WRITE_FAILED"); },
      failOcrJob: async () => { throw new Error("D1_FAILURE_WRITE_FAILED"); },
    };
    const extractor = {
      extract: async (input: { objectKey: string }) => {
        if (input.objectKey === "persist-throws") throw Object.assign(new Error("OCR_TIMEOUT"), { retryable: true });
        return "# OCR";
      },
    };
    const claimFailure = new FakeMessage(queueJob("claim-throws"));
    const persistenceFailure = new FakeMessage(queueJob("persist-throws"));
    const success = new FakeMessage(queueJob("success"));

    await expect(consumer(OcrConsumer, repository, extractor as any).consumeBatch([claimFailure, persistenceFailure, success]))
      .resolves.toEqual([
        { outcome: "retry", delaySeconds: 1 },
        { outcome: "retry", delaySeconds: 1 },
        { outcome: "ack" },
      ]);

    expect(success.ack).toHaveBeenCalledOnce();
    expect(claimFailure.ack).not.toHaveBeenCalled();
    expect(persistenceFailure.ack).not.toHaveBeenCalled();
  });
});
