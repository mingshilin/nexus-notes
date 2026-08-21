import { afterEach, describe, expect, it, vi } from "vitest";

import type { QueueJob } from "@nexus/contracts";

import type { OcrAiBinding } from "../src/attachments/ocr-extractor";
import type { BetaWorkerEnv } from "../src/routes/health";
import { createTestD1, seedTenants } from "./helpers/d1";

const disposals: Array<() => Promise<void>> = [];
const executionContext: ExecutionContext = {
  waitUntil() {},
  passThroughOnException() {},
  props: undefined,
};

class FakeNativeMessage<T> implements Message<T> {
  readonly id = crypto.randomUUID();
  readonly timestamp = new Date();
  readonly retryCalls: Array<QueueRetryOptions | undefined> = [];
  ackCalls = 0;

  constructor(
    readonly body: T,
    readonly attempts = 1,
    private readonly retryFailure?: Error,
  ) {}

  ack() {
    this.ackCalls += 1;
  }

  retry(options?: QueueRetryOptions) {
    if (this.retryFailure) throw this.retryFailure;
    this.retryCalls.push(options);
  }
}

class FakeNativeBatch<T> implements MessageBatch<T> {
  readonly queue = "nexus-test-jobs";
  readonly metadata: MessageBatchMetadata;
  readonly retryAllCalls: Array<QueueRetryOptions | undefined> = [];
  ackAllCalls = 0;

  constructor(readonly messages: readonly Message<T>[]) {
    this.metadata = { metrics: { backlogCount: messages.length, backlogBytes: 0 } };
  }

  retryAll(options?: QueueRetryOptions) {
    this.retryAllCalls.push(options);
  }

  ackAll() {
    this.ackAllCalls += 1;
  }
}

const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);

class FakeR2Object implements R2Object {
  readonly version = "version";
  readonly size: number;
  readonly etag = "etag";
  readonly httpEtag = '"etag"';
  readonly checksums: R2Checksums = { toJSON: () => ({}) };
  readonly uploaded = new Date(0);
  readonly storageClass = "Standard";

  constructor(readonly key: string, bytes = pdfBytes) {
    this.size = bytes.byteLength;
  }

  writeHttpMetadata(_headers: Headers) {}
}

class FakeR2ObjectBody extends FakeR2Object implements R2ObjectBody {
  get body() {
    return new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(pdfBytes);
        controller.close();
      },
    });
  }

  get bodyUsed() { return false; }
  async arrayBuffer() { return pdfBytes.buffer.slice(0); }
  async bytes() { return pdfBytes; }
  async text() { return new TextDecoder().decode(pdfBytes); }
  async json<T>(): Promise<T> { throw new Error(`No JSON body for ${this.key}`); }
  async blob() { return new Blob([pdfBytes], { type: "application/pdf" }); }
}

class FakeR2MultipartUpload implements R2MultipartUpload {
  constructor(readonly key: string, readonly uploadId: string) {}
  async uploadPart(partNumber: number) { return { partNumber, etag: `etag-${partNumber}` }; }
  async abort() {}
  async complete() { return new FakeR2Object(this.key); }
}

class FakeR2Bucket implements R2Bucket {
  async head(_key: string) { return null; }
  async get(key: string, _options?: R2GetOptions) { return new FakeR2ObjectBody(key); }
  async put(key: string, _value: ReadableStream | ArrayBuffer | ArrayBufferView | string | null | Blob, _options?: R2PutOptions) {
    return new FakeR2Object(key);
  }
  async createMultipartUpload(key: string) { return new FakeR2MultipartUpload(key, "upload"); }
  resumeMultipartUpload(key: string, uploadId: string) { return new FakeR2MultipartUpload(key, uploadId); }
  async delete(_keys: string | string[]) {}
  async list(_options?: R2ListOptions): Promise<R2Objects> { return { objects: [], delimitedPrefixes: [], truncated: false }; }
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
    workspaceId: "ws-1", userId: "user-1",
    input: { filename: "scan.pdf", mime_type: "application/pdf", size_bytes: 5, idempotency_key: "upload-1" }, now,
  });
  await repository.markUploaded("ws-1", attachment.id, now);
  const created = await repository.ensureOcrJob("ws-1", "user-1", attachment.id, now);
  if (!created) throw new Error("Expected OCR job");
  const row = await testD1.db.prepare("SELECT payload_json FROM queue_outbox WHERE id = ?")
    .bind(created.outbox_id).first<{ payload_json: string }>();
  if (!row) throw new Error("Expected OCR queue message");
  return { ...worker, db: testD1.db, job: JSON.parse(row.payload_json) as QueueJob };
}

function queueEnv(
  db: D1Database,
  options: { ai?: OcrAiBinding; files?: R2Bucket } = {},
): BetaWorkerEnv {
  return {
    DB: db,
    FILES: options.files ?? new FakeR2Bucket(),
    AI: options.ai ?? { async toMarkdown() { return { format: "markdown", data: "# Private OCR" }; } },
    APP_BASE_URL: "https://beta.test",
    RATE_LIMIT_SECRET: "rate-limit-secret-at-least-32-characters",
    TURNSTILE_SECRET_KEY: "turnstile-secret",
    RESEND_API_KEY: "resend-secret",
    EMAIL_FROM: "Nexus Notes <notes@beta.test>",
  };
}

afterEach(async () => {
  await Promise.all(disposals.splice(0).map((dispose) => dispose()));
});

describe("native Cloudflare OCR queue wiring", () => {
  it("preserves native ack receivers and acknowledges successful and duplicate deliveries exactly once", async () => {
    const { createBetaWorker, db, job } = await fixture();
    const first = new FakeNativeMessage<unknown>({ ...job, payload: { ...job.payload, object_key: "attacker-controlled" } });
    const duplicate = new FakeNativeMessage<unknown>(job);

    await createBetaWorker().queue(new FakeNativeBatch([first, duplicate]), queueEnv(db), executionContext);

    expect(first.ackCalls).toBe(1);
    expect(duplicate.ackCalls).toBe(1);
    expect(first.retryCalls).toEqual([]);
    expect(duplicate.retryCalls).toEqual([]);
    expect(await db.prepare("SELECT status FROM beta_ocr_jobs WHERE id = ?").bind(job.job_id).first())
      .toEqual({ status: "completed" });
    expect(await db.prepare("SELECT ocr_text FROM search_documents WHERE workspace_id = 'ws-1' AND entity_type = 'attachment'").first())
      .toEqual({ ocr_text: "# Private OCR" });
  });

  it("retries only the retryable native delivery and safely acknowledges its malformed peer", async () => {
    const { createBetaWorker, db, job } = await fixture();
    const ai: OcrAiBinding = { async toMarkdown() { throw Object.assign(new Error("OCR_TIMEOUT"), { retryable: true }); } };
    const malformed = new FakeNativeMessage<unknown>(null);
    const retryable = new FakeNativeMessage<unknown>(job);
    const audit = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    try {
      await createBetaWorker().queue(new FakeNativeBatch([malformed, retryable]), queueEnv(db, { ai }), executionContext);
      expect(malformed.ackCalls).toBe(1);
      expect(malformed.retryCalls).toEqual([]);
      expect(retryable.ackCalls).toBe(0);
      expect(retryable.retryCalls).toEqual([{ delaySeconds: 1 }]);
      expect(audit).toHaveBeenCalledWith("OCR_QUEUE_MESSAGE_INVALID");
    } finally {
      audit.mockRestore();
    }
  });

  it("propagates a native retry failure so Cloudflare retries the batch", async () => {
    const { createBetaWorker, db, job } = await fixture();
    const ai: OcrAiBinding = { async toMarkdown() { throw Object.assign(new Error("OCR_TIMEOUT"), { retryable: true }); } };
    const message = new FakeNativeMessage<unknown>(job, 1, new Error("native retry failed"));

    await expect(createBetaWorker().queue(new FakeNativeBatch([message]), queueEnv(db, { ai }), executionContext))
      .rejects.toThrow("native retry failed");
    expect(message.ackCalls).toBe(0);
    expect(await db.prepare("SELECT status FROM beta_ocr_jobs WHERE id = ?").bind(job.job_id).first())
      .toEqual({ status: "pending" });
  });

  it("acknowledges stale delivery and dead-letters a terminal native delivery without retrying either", async () => {
    const { createBetaWorker, db, job } = await fixture();
    const ai: OcrAiBinding = { async toMarkdown() { throw Object.assign(new Error("OCR_TIMEOUT"), { retryable: true }); } };
    const sourceRevision = job.payload.source_revision;
    if (typeof sourceRevision !== "number") throw new Error("Expected numeric source revision");
    const stale = new FakeNativeMessage<unknown>({ ...job, payload: { ...job.payload, source_revision: sourceRevision + 1 } });
    const terminal = new FakeNativeMessage<unknown>(job, 3);

    await createBetaWorker().queue(new FakeNativeBatch([stale, terminal]), queueEnv(db, { ai }), executionContext);

    expect(stale.ackCalls).toBe(1);
    expect(stale.retryCalls).toEqual([]);
    expect(terminal.ackCalls).toBe(1);
    expect(terminal.retryCalls).toEqual([]);
    expect(await db.prepare("SELECT status, attempt_count, last_error_code FROM beta_ocr_jobs WHERE id = ?").bind(job.job_id).first())
      .toEqual({ status: "dead_letter", attempt_count: 3, last_error_code: "OCR_ATTEMPTS_EXHAUSTED" });
  });

  it("persists a native attempt greater than the queue body's attempt before retrying", async () => {
    const { createBetaWorker, db, job } = await fixture();
    const ai: OcrAiBinding = { async toMarkdown() { throw Object.assign(new Error("OCR_TIMEOUT"), { retryable: true }); } };
    const redelivery = new FakeNativeMessage<unknown>(job, 2);

    await createBetaWorker().queue(new FakeNativeBatch([redelivery]), queueEnv(db, { ai }), executionContext);

    expect(redelivery.retryCalls).toEqual([{ delaySeconds: 2 }]);
    expect(await db.prepare("SELECT status, attempt_count FROM beta_ocr_jobs WHERE id = ?").bind(job.job_id).first())
      .toEqual({ status: "pending", attempt_count: 2 });
  });

  it("keeps persisted attempts monotonic through native redelivery and scheduled recovery", async () => {
    const { D1AttachmentRepository, createBetaWorker, db, job } = await fixture();
    const expired = "2000-01-01T00:00:00.000Z";
    await db.prepare("UPDATE beta_ocr_jobs SET deadline = ? WHERE id = ?").bind(expired, job.job_id).run();
    const native = new FakeNativeMessage<unknown>({ ...job, deadline: expired }, 3);
    const repository = new D1AttachmentRepository(db);

    await Promise.all([
      createBetaWorker().queue(new FakeNativeBatch([native]), queueEnv(db), executionContext),
      repository.recoverStaleOcrJobs(new Date().toISOString(), 50),
    ]);

    expect(await db.prepare("SELECT attempt_count FROM beta_ocr_jobs WHERE id = ?").bind(job.job_id).first())
      .toEqual({ attempt_count: 3 });
    expect(await db.prepare("SELECT 1 found FROM queue_outbox WHERE json_extract(payload_json, '$.attempt') > 3").first())
      .toBeNull();
  });

  it.each(["AI", "FILES"] as const)("safely acknowledges an OCR-only missing %s binding", async (binding) => {
    const { createBetaWorker, db, job } = await fixture();
    const env = queueEnv(db);
    if (binding === "AI") env.AI = undefined;
    else env.FILES = undefined;
    const message = new FakeNativeMessage<unknown>(job);

    await createBetaWorker().queue(new FakeNativeBatch([message]), env, executionContext);

    expect(message.ackCalls).toBe(1);
    expect(message.retryCalls).toEqual([]);
  });
});
