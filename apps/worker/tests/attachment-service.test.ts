import { describe, expect, it, vi } from "vitest";

type WorkerExports = Record<string, unknown>;

async function loadWorker() {
  return (await import("../src")) as WorkerExports;
}

const context = { workspaceId: "ws-1", userId: "user-1" };
const now = "2026-08-21T00:00:00.000Z";

function configuredFiles(put = vi.fn(async () => undefined)) {
  return { get: vi.fn(async () => null), put, delete: vi.fn(async () => undefined) };
}

describe("AttachmentService", () => {
  it("rejects unsupported MIME types and files exceeding the 25 MB limit before reserving storage", async () => {
    const worker = await loadWorker();
    expect(worker.AttachmentService).toBeTypeOf("function");
    const repository = { reserveUpload: vi.fn() };
    const service = new (worker.AttachmentService as new (...args: any[]) => any)(repository, configuredFiles(), { clock: () => new Date(now) });

    await expect(service.createUpload(context, {
      filename: "unsafe.svg", mime_type: "image/svg+xml", size_bytes: 16, idempotency_key: "upload-1",
    })).rejects.toMatchObject({ code: "UNSUPPORTED_ATTACHMENT_TYPE", status: 400 });
    await expect(service.createUpload(context, {
      filename: "large.pdf", mime_type: "application/pdf", size_bytes: 25 * 1024 * 1024 + 1, idempotency_key: "upload-2",
    })).rejects.toMatchObject({ code: "ATTACHMENT_FILE_TOO_LARGE", status: 413 });
    expect(repository.reserveUpload).not.toHaveBeenCalled();
  });

  it("maps an atomic D1 reservation rejection to the workspace quota error", async () => {
    const worker = await loadWorker();
    const repository = {
      reserveUpload: vi.fn(async () => {
        throw Object.assign(new Error("Workspace attachment quota exceeded"), { code: "ATTACHMENT_QUOTA_EXCEEDED" });
      }),
    };
    const service = new (worker.AttachmentService as new (...args: any[]) => any)(repository, configuredFiles(), { clock: () => new Date(now) });

    await expect(service.createUpload(context, {
      filename: "scan.pdf", mime_type: "application/pdf", size_bytes: 5, idempotency_key: "upload-over-quota",
    })).rejects.toMatchObject({ code: "ATTACHMENT_QUOTA_EXCEEDED", status: 403 });
    expect(repository.reserveUpload).toHaveBeenCalledOnce();
  });

  it("keeps content and metadata in the caller workspace and rejects mismatched byte signatures", async () => {
    const worker = await loadWorker();
    expect(worker.AttachmentService).toBeTypeOf("function");
    const attachment = {
      id: "attachment-1", workspace_id: "ws-1", note_id: null, filename: "scan.pdf", mime_type: "application/pdf",
      size_bytes: 4, status: "uploading", revision: 1, created_at: now, updated_at: now,
    };
    const repository = { getAttachment: vi.fn(async () => attachment), markUploaded: vi.fn() };
    const files = configuredFiles(vi.fn());
    const service = new (worker.AttachmentService as new (...args: any[]) => any)(repository, files, { clock: () => new Date(now) });

    await expect(service.uploadContent(context, "attachment-1", new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).rejects.toMatchObject({
      code: "ATTACHMENT_SIGNATURE_MISMATCH", status: 400,
    });

    expect(repository.getAttachment).toHaveBeenCalledWith("ws-1", "attachment-1", false);
    expect(files.put).not.toHaveBeenCalled();
  });

  it.each([
    ["application/pdf", [0x25, 0x50, 0x44, 0x46, 0x2d]],
    ["image/jpeg", [0xff, 0xd8, 0xff]],
    ["image/png", [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
    ["image/webp", [0x52, 0x49, 0x46, 0x46, 0x01, 0x02, 0x03, 0x04, 0x57, 0x45, 0x42, 0x50]],
    ["text/plain", [0x68, 0x65, 0x6c, 0x6c, 0x6f]],
  ] as const)("accepts a valid %s signature and returns refreshed ready metadata", async (mimeType, signature) => {
    const worker = await loadWorker();
    const uploading = {
      id: "attachment-1", workspace_id: "ws-1", note_id: null, filename: "file", mime_type: mimeType,
      size_bytes: signature.length, status: "uploading", revision: 1, created_at: now, updated_at: now,
    };
    const ready = { ...uploading, status: "ready", revision: 2 };
    const repository = {
      getAttachment: vi.fn().mockResolvedValueOnce(uploading).mockResolvedValueOnce(ready),
      markUploaded: vi.fn(async () => undefined),
    };
    const files = configuredFiles(vi.fn(async () => undefined));
    const service = new (worker.AttachmentService as new (...args: any[]) => any)(repository, files, { clock: () => new Date(now) });

    await expect(service.uploadContent(context, "attachment-1", new Uint8Array(signature))).resolves.toEqual(ready);
    expect(repository.getAttachment).toHaveBeenNthCalledWith(2, "ws-1", "attachment-1", false);
  });

  it.each([
    ["application/pdf", [0x25, 0x50, 0x44, 0x00, 0x2d]],
    ["image/jpeg", [0xff, 0xd7, 0xff]],
    ["image/png", [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x00]],
    ["image/webp", [0x52, 0x49, 0x46, 0x46, 0x01, 0x02, 0x03, 0x04, 0x57, 0x45, 0x42, 0x00]],
    ["text/plain", [0x68, 0x00, 0x69]],
  ] as const)("rejects an invalid %s signature", async (mimeType, signature) => {
    const worker = await loadWorker();
    const attachment = {
      id: "attachment-1", workspace_id: "ws-1", note_id: null, filename: "file", mime_type: mimeType,
      size_bytes: signature.length, status: "uploading", revision: 1, created_at: now, updated_at: now,
    };
    const repository = { getAttachment: vi.fn(async () => attachment), markUploaded: vi.fn() };
    const files = configuredFiles(vi.fn());
    const service = new (worker.AttachmentService as new (...args: any[]) => any)(repository, files, { clock: () => new Date(now) });

    await expect(service.uploadContent(context, "attachment-1", new Uint8Array(signature))).rejects.toMatchObject({
      code: "ATTACHMENT_SIGNATURE_MISMATCH",
    });
    expect(files.put).not.toHaveBeenCalled();
  });

  it("completes only a ready workspace upload and creates one idempotent OCR job", async () => {
    const worker = await loadWorker();
    const attachment = { id: "attachment-1", workspace_id: "ws-1", note_id: null, filename: "scan.pdf", mime_type: "application/pdf", size_bytes: 5, status: "ready", revision: 2, created_at: now, updated_at: now };
    const repository = {
      getAttachment: vi.fn(async () => attachment),
      ensureOcrJob: vi.fn(async () => ({
        created: true,
        job_id: "job-1",
        source_revision: 2,
        attempt: 1,
        deadline: "2026-08-21T00:10:00.000Z",
        idempotency_key: "ocr:ws-1:attachment-1:2",
        outbox_id: "outbox-1",
      })),
    };
    const outbox = { dispatch: vi.fn(async () => ({ dispatched: 1, failed: 0 })) };
    const service = new (worker.AttachmentService as new (...args: any[]) => any)(repository, {}, { clock: () => new Date(now), outbox });

    await expect(service.completeUpload(context, "attachment-1", { upload_id: "attachment-1", signature: "25504446" })).resolves.toEqual(attachment);
    expect(repository.getAttachment).toHaveBeenCalledWith("ws-1", "attachment-1", false);
    expect(repository.ensureOcrJob).toHaveBeenCalledWith("ws-1", "user-1", "attachment-1", now);
    expect(outbox.dispatch).toHaveBeenCalledWith(["outbox-1"]);
  });

  it("retries only failed OCR jobs and reports deterministic workspace diagnostics", async () => {
    const worker = await loadWorker();
    expect(worker.AttachmentService).toBeTypeOf("function");
    const repository = {
      retryOcr: vi.fn(async () => ({ queued: ["attachment-1"], ineligible: ["attachment-2"], duplicate: [], outbox_ids: ["outbox-2"] })),
      diagnostics: vi.fn(async () => ({ items: [{ kind: "failed_ocr", entity_id: "attachment-1", title: "scan.pdf", count: 1 }], nextCursor: null })),
    };
    const outbox = { dispatch: vi.fn(async () => ({ dispatched: 1, failed: 0 })) };
    const service = new (worker.AttachmentService as new (...args: any[]) => any)(repository, {}, { clock: () => new Date(now), outbox });

    await expect(service.retryOcr(context, { attachment_ids: ["attachment-1", "attachment-2"] })).resolves.toEqual({
      queued: ["attachment-1"], ineligible: ["attachment-2"], duplicate: [],
    });
    await expect(service.diagnostics(context, { limit: 25 })).resolves.toEqual({
      items: [{ kind: "failed_ocr", entity_id: "attachment-1", title: "scan.pdf", count: 1 }], next_cursor: null,
    });
    expect(repository.retryOcr).toHaveBeenCalledWith("ws-1", "user-1", ["attachment-1", "attachment-2"], now);
    expect(repository.diagnostics).toHaveBeenCalledWith("ws-1", { limit: 25 });
    expect(outbox.dispatch).toHaveBeenCalledWith(["outbox-2"]);
  });
});
