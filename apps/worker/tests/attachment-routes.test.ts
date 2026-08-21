import { describe, expect, it, vi } from "vitest";

import { MAX_UPLOAD_BYTES } from "@nexus/contracts";

import { createTestD1, seedTenants } from "./helpers/d1";

type WorkerExports = Record<string, unknown>;

async function loadWorker() {
  return (await import("../src")) as WorkerExports;
}

const workspace = { workspaceId: "ws-1", userId: "user-1", role: "editor", capabilities: new Set<string>() };

function request(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("x-workspace-id", "ws-1");
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  return new Request(`https://beta.test${path}`, { ...init, headers });
}

function workspaceRequest(workspaceId: string, path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("x-workspace-id", workspaceId);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  return new Request(`https://beta.test${path}`, { ...init, headers });
}

describe("v2 attachment routes", () => {
  it("uses workspace authorization for metadata, OCR retry, diagnostics, and private download", async () => {
    const worker = await loadWorker();
    expect(worker.registerAttachmentRoutes).toBeTypeOf("function");
    const attachment = {
      id: "attachment-1", workspace_id: "ws-1", note_id: null, filename: "scan.pdf", mime_type: "application/pdf",
      size_bytes: 5, status: "ready", revision: 1, created_at: "2026-08-21T00:00:00.000Z", updated_at: "2026-08-21T00:00:00.000Z",
    };
    const service = {
      listAttachments: vi.fn(async () => ({ items: [attachment], next_cursor: null })),
      getAttachment: vi.fn(async () => attachment),
      createUpload: vi.fn(async () => attachment),
      uploadContent: vi.fn(async () => attachment),
      deleteAttachment: vi.fn(async () => undefined),
      retryOcr: vi.fn(async () => ({ queued: ["attachment-1"], ineligible: [], duplicate: [] })),
      diagnostics: vi.fn(async () => ({ items: [], next_cursor: null })),
      download: vi.fn(async () => ({ body: new Uint8Array([1, 2, 3]), mime_type: "application/pdf", filename: "scan.pdf" })),
    };
    const registry = (worker.createRouteRegistry as any)({
      requestId: () => "req-attachment",
      authenticate: vi.fn(async () => ({ userId: "user-1" })),
      authorizeWorkspace: vi.fn(async () => workspace),
    });
    (worker.registerAttachmentRoutes as any)(registry, () => service);

    const download = await registry.fetch(request("/api/v2/attachments/attachment-1/file"), {});
    const responses = await Promise.all([
      registry.fetch(request("/api/v2/attachments?mime_type=application%2Fpdf&limit=10"), {}),
      registry.fetch(request("/api/v2/attachments/attachment-1"), {}),
      registry.fetch(request("/api/v2/attachments/uploads", { method: "POST", body: JSON.stringify({ filename: "scan.pdf", mime_type: "application/pdf", size_bytes: 5, idempotency_key: "upload-1" }) }), {}),
      registry.fetch(request("/api/v2/attachments/attachment-1/ocr/retry", { method: "POST", body: JSON.stringify({ attachment_ids: ["attachment-1"] }) }), {}),
      registry.fetch(request("/api/v2/knowledge/diagnostics?limit=25"), {}),
      registry.fetch(request("/api/v2/attachments/attachment-1", { method: "DELETE" }), {}),
    ]);

    expect(responses.map((response: Response) => response.status)).toEqual([200, 200, 201, 200, 200, 200]);
    expect(service.listAttachments).toHaveBeenCalledWith(workspace, expect.objectContaining({ mime_type: "application/pdf", limit: 10 }));
    expect(service.retryOcr).toHaveBeenCalledWith(workspace, { attachment_ids: ["attachment-1"] });
    expect(service.diagnostics).toHaveBeenCalledWith(workspace, { limit: 25 });
    expect(download.status).toBe(200);
    expect(download.headers.get("cache-control")).toBe("private, no-store");
    expect(download.headers.get("x-content-type-options")).toBe("nosniff");
    expect(download.headers.get("content-disposition")).toContain("attachment");
  });

  it("rejects a single-retry body that names a different attachment", async () => {
    const worker = await loadWorker();
    const registry = (worker.createRouteRegistry as any)({ requestId: () => "req", authenticate: vi.fn(async () => ({ userId: "user-1" })), authorizeWorkspace: vi.fn(async () => workspace) });
    (worker.registerAttachmentRoutes as any)(registry, () => ({ retryOcr: vi.fn() }));
    const response = await registry.fetch(request("/api/v2/attachments/attachment-1/ocr/retry", { method: "POST", body: JSON.stringify({ attachment_ids: ["attachment-2"] }) }), {});
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("OCR_RETRY_PATH_MISMATCH");
  });

  it.each([
    ["not-a-number", 400, "ATTACHMENT_CONTENT_LENGTH_INVALID"],
    [String(MAX_UPLOAD_BYTES + 1), 413, "ATTACHMENT_FILE_TOO_LARGE"],
  ])("rejects Content-Length %s before calling the upload service", async (contentLength, status, code) => {
    const worker = await loadWorker();
    const uploadContent = vi.fn();
    const registry = (worker.createRouteRegistry as any)({
      requestId: () => "req-length",
      authenticate: vi.fn(async () => ({ userId: "user-1" })),
      authorizeWorkspace: vi.fn(async () => workspace),
    });
    (worker.registerAttachmentRoutes as any)(registry, () => ({ uploadContent }));
    const response = await registry.fetch(request("/api/v2/attachments/attachment-1/content", {
      method: "PUT",
      headers: { "content-length": contentLength, "content-type": "application/octet-stream" },
    }), {});

    expect(response.status).toBe(status);
    expect((await response.json()).error.code).toBe(code);
    expect(uploadContent).not.toHaveBeenCalled();
  });

  it("cancels an oversized streaming body before calling the upload service", async () => {
    const worker = await loadWorker();
    const uploadContent = vi.fn();
    const cancel = vi.fn();
    const chunk = new Uint8Array(1024 * 1024);
    let emitted = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(chunk);
        emitted += chunk.byteLength;
      },
      cancel,
    });
    const registry = (worker.createRouteRegistry as any)({
      requestId: () => "req-stream",
      authenticate: vi.fn(async () => ({ userId: "user-1" })),
      authorizeWorkspace: vi.fn(async () => workspace),
    });
    (worker.registerAttachmentRoutes as any)(registry, () => ({ uploadContent }));
    const streamRequest = new Request("https://beta.test/api/v2/attachments/attachment-1/content", {
      method: "PUT",
      headers: { "content-type": "application/octet-stream", "x-workspace-id": "ws-1" },
      body,
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    const response = await registry.fetch(streamRequest, {});

    expect(response.status).toBe(413);
    expect((await response.json()).error.code).toBe("ATTACHMENT_FILE_TOO_LARGE");
    expect(cancel).toHaveBeenCalledOnce();
    expect(uploadContent).not.toHaveBeenCalled();
  });

  it("denies metadata and file routes after real D1 deletion removes fake R2 content", async () => {
    const testD1 = await createTestD1();
    try {
      await seedTenants(testD1.db);
      const worker = await loadWorker();
      const objects = new Map<string, Uint8Array>();
      const files = {
        async put(key: string, value: ArrayBuffer | ArrayBufferView) {
          const bytes = value instanceof ArrayBuffer
            ? new Uint8Array(value)
            : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
          objects.set(key, bytes.slice());
        },
        async get(key: string) {
          const bytes = objects.get(key);
          return bytes ? { body: new Response(bytes).body! } : null;
        },
        async delete(key: string) { objects.delete(key); },
      };
      const repository = new (worker.D1AttachmentRepository as any)(testD1.db, () => "attachment-real");
      const service = new (worker.AttachmentService as any)(repository, files, { clock: () => new Date("2026-08-21T00:00:00.000Z") });
      const attachment = await service.createUpload({ workspaceId: "ws-1", userId: "user-1" }, {
        filename: "real.pdf",
        mime_type: "application/pdf",
        size_bytes: 5,
        idempotency_key: "real-upload",
      });
      await service.uploadContent(
        { workspaceId: "ws-1", userId: "user-1" },
        attachment.id,
        new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]),
      );
      const registry = (worker.createRouteRegistry as any)({
        requestId: () => "req-real-delete",
        authenticate: vi.fn(async () => ({ userId: "user-1" })),
        authorizeWorkspace: vi.fn(async () => workspace),
      });
      (worker.registerAttachmentRoutes as any)(registry, () => service);
      const metadataPath = `/api/v2/attachments/${attachment.id}`;
      const filePath = `${metadataPath}/file`;

      expect((await registry.fetch(request(metadataPath), {})).status).toBe(200);
      expect((await registry.fetch(request(filePath), {})).status).toBe(200);
      expect((await registry.fetch(request(metadataPath, { method: "DELETE" }), {})).status).toBe(200);

      const metadata = await registry.fetch(request(metadataPath), {});
      const file = await registry.fetch(request(filePath), {});
      expect([metadata.status, file.status]).toEqual([404, 404]);
      expect((await metadata.json()).error.code).toBe("ATTACHMENT_NOT_FOUND");
      expect((await file.json()).error.code).toBe("ATTACHMENT_NOT_FOUND");
      expect(objects).toHaveProperty("size", 0);
    } finally {
      await testD1.dispose();
    }
  });

  it("keeps the real D1 and fake private R2 lifecycle tenant-scoped, filtered, and cleanup-safe", async () => {
    const testD1 = await createTestD1();
    try {
      await seedTenants(testD1.db);
      const worker = await loadWorker();
      const objects = new Map<string, Uint8Array>();
      const files = {
        async put(key: string, value: ArrayBuffer | ArrayBufferView) {
          const bytes = value instanceof ArrayBuffer
            ? new Uint8Array(value)
            : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
          objects.set(key, bytes.slice());
        },
        async get(key: string) {
          const bytes = objects.get(key);
          return bytes ? { body: new Response(bytes).body! } : null;
        },
        async delete(key: string) { objects.delete(key); },
      };
      let nextId = 0;
      const repository = new (worker.D1AttachmentRepository as any)(testD1.db, () => `attachment-${++nextId}`);
      const service = new (worker.AttachmentService as any)(repository, files, { clock: () => new Date("2026-08-21T00:00:00.000Z") });
      const context = { workspaceId: "ws-1", userId: "user-1" };
      const signatures = [
        ["application/pdf", "scan.pdf", [0x25, 0x50, 0x44, 0x46, 0x2d]],
        ["image/jpeg", "photo.jpg", [0xff, 0xd8, 0xff, 0x00]],
        ["image/png", "image.png", [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
        ["image/webp", "image.webp", [0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]],
        ["text/plain", "notes.txt", [0x68, 0x65, 0x6c, 0x6c, 0x6f]],
      ] as const;
      const attachments: any[] = [];
      for (const [mimeType, filename, bytes] of signatures) {
        const attachment = await service.createUpload(context, {
          filename,
          mime_type: mimeType,
          size_bytes: bytes.length,
          idempotency_key: `upload-${filename}`,
        });
        attachments.push(await service.uploadContent(context, attachment.id, new Uint8Array(bytes)));
      }
      const invalid = await service.createUpload(context, {
        filename: "bad.pdf", mime_type: "application/pdf", size_bytes: 5, idempotency_key: "bad-pdf",
      });
      await expect(service.uploadContent(context, invalid.id, new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x00]))).rejects.toMatchObject({
        code: "ATTACHMENT_SIGNATURE_MISMATCH",
      });
      expect(objects).toHaveProperty("size", signatures.length);

      const pdf = attachments[0]!;
      const job = await repository.ensureOcrJob("ws-1", "user-1", pdf.id, "2026-08-21T00:00:00.000Z");
      const pending = await repository.listPendingOcrOutbox("2026-08-21T00:00:00.000Z", 1, [job.outbox_id]);
      await repository.claimOcrJob(pending[0].message, "2026-08-21T00:00:00.000Z");
      await repository.failOcrJob("ws-1", job.job_id, "OCR_PROVIDER_TIMEOUT", "2026-08-21T00:00:00.000Z");
      await testD1.db.prepare(
        "INSERT INTO search_documents (id, workspace_id, entity_type, entity_id, title, ocr_text, revision, updated_at) VALUES (?, 'ws-1', 'attachment', ?, 'scan.pdf', 'private OCR text', 2, ?)",
      ).bind(`attachment:${pdf.id}`, pdf.id, "2026-08-21T00:00:00.000Z").run();

      const list = await service.listAttachments(context, { mime_type: "application/pdf", ocr_status: "failed", limit: 10 });
      expect(list.items).toMatchObject([{ id: pdf.id, ocr_status: "failed", ocr_attempt_count: 1 }]);
      expect(JSON.stringify(list.items)).not.toContain("private OCR text");
      expect(JSON.stringify(list.items)).not.toContain(`/attachments/${pdf.id}`);
      await expect(service.getAttachment({ workspaceId: "ws-2", userId: "user-2" }, pdf.id)).rejects.toMatchObject({ code: "ATTACHMENT_NOT_FOUND" });
      await expect(service.download({ workspaceId: "ws-2", userId: "user-2" }, pdf.id)).rejects.toMatchObject({ code: "ATTACHMENT_NOT_FOUND" });
      await expect(service.retryOcr({ workspaceId: "ws-2", userId: "user-2" }, { attachment_ids: [pdf.id] })).resolves.toMatchObject({ queued: [] });

      const registry = (worker.createRouteRegistry as any)({
        requestId: () => "req-real-lifecycle",
        authenticate: vi.fn(async ({ request }: { request: Request }) => ({ userId: request.headers.get("x-workspace-id") === "ws-2" ? "user-2" : "user-1" })),
        authorizeWorkspace: vi.fn(async (_principal: unknown, workspaceId: string) => workspaceId === "ws-1"
          ? workspace
          : { workspaceId: "ws-2", userId: "user-2", role: "editor", capabilities: new Set<string>() }),
      });
      (worker.registerAttachmentRoutes as any)(registry, () => service);
      const metadataPath = `/api/v2/attachments/${pdf.id}`;
      expect((await registry.fetch(workspaceRequest("ws-2", metadataPath), {})).status).toBe(404);
      expect((await registry.fetch(workspaceRequest("ws-2", `${metadataPath}/file`), {})).status).toBe(404);
      expect((await registry.fetch(workspaceRequest("ws-2", metadataPath, { method: "DELETE" }), {})).status).toBe(404);
      expect((await registry.fetch(workspaceRequest("ws-2", `${metadataPath}/ocr/retry`, {
        method: "POST", body: JSON.stringify({ attachment_ids: [pdf.id] }),
      }), {})).status).toBe(200);
      expect((await registry.fetch(workspaceRequest("ws-1", metadataPath, { method: "DELETE" }), {})).status).toBe(200);

      expect(objects.has(`ws-1/attachments/${pdf.id}`)).toBe(false);
      expect(await testD1.db.prepare("SELECT 1 FROM beta_ocr_jobs WHERE workspace_id = 'ws-1' AND attachment_id = ?").bind(pdf.id).first()).toBeNull();
      expect(await testD1.db.prepare("SELECT 1 FROM search_documents WHERE workspace_id = 'ws-1' AND entity_id = ?").bind(pdf.id).first()).toBeNull();
      const diagnostics = await service.diagnostics(context, { limit: 20 });
      expect(diagnostics.items.some((item: { entity_id: string }) => item.entity_id === pdf.id)).toBe(false);
    } finally {
      await testD1.dispose();
    }
  });
});
