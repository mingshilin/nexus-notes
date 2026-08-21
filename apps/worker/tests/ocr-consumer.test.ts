import { describe, expect, it, vi } from "vitest";

describe("OcrConsumer", () => {
  it("mounts a queue handler on the Beta Worker", async () => {
    const worker = await import("../src");
    expect((worker.createBetaWorker() as any).queue).toBeTypeOf("function");
  });

  it("claims a tenant job once and updates the OCR search document only after extraction succeeds", async () => {
    const worker = await import("../src");
    expect(worker.OcrConsumer).toBeTypeOf("function");
    const repository = {
      claimOcrJob: vi.fn(async () => ({ id: "job-1", workspace_id: "ws-1", attachment_id: "attachment-1", attempt_count: 1, deadline: "2026-08-21T00:10:00.000Z" })),
      completeOcrJob: vi.fn(async () => undefined),
      failOcrJob: vi.fn(async () => undefined),
    };
    const files = { get: vi.fn(async () => ({ body: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode("alpha OCR")); c.close(); } }) })) };
    const extractor = { extract: vi.fn(async () => "alpha OCR") };
    const consumer = new (worker.OcrConsumer as any)(repository, files, extractor, { clock: () => new Date("2026-08-21T00:00:00.000Z") });

    await consumer.consume({ job_id: "job-1", kind: "ocr", idempotency_key: "ocr:attachment-1:2", attempt: 1, deadline: "2026-08-21T00:10:00.000Z", payload: { workspace_id: "ws-1", attachment_id: "attachment-1" } });

    expect(repository.claimOcrJob).toHaveBeenCalledWith({
      job_id: "job-1",
      kind: "ocr",
      idempotency_key: "ocr:attachment-1:2",
      attempt: 1,
      deadline: "2026-08-21T00:10:00.000Z",
      payload: { workspace_id: "ws-1", attachment_id: "attachment-1" },
    }, "2026-08-21T00:00:00.000Z");
    expect(repository.completeOcrJob).toHaveBeenCalledWith("ws-1", "job-1", "alpha OCR", "2026-08-21T00:00:00.000Z");
    expect(repository.failOcrJob).not.toHaveBeenCalled();
  });
});
