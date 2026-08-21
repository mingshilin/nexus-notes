import { afterEach, describe, expect, it } from "vitest";

import { AttachmentService, D1AttachmentRepository } from "../src";
import { createTestD1, seedTenants } from "./helpers/d1";

const now = "2026-08-21T00:00:00.000Z";
const context = { workspaceId: "ws-1", userId: "user-1" };
const disposals: Array<() => Promise<void>> = [];

async function fixture() {
  const testD1 = await createTestD1();
  disposals.push(testD1.dispose);
  await seedTenants(testD1.db);
  const repository = new D1AttachmentRepository(testD1.db, (() => {
    let id = 0;
    return () => `id-${++id}`;
  })());
  const ready = await repository.reserveUpload({
    workspaceId: "ws-1", userId: "user-1",
    input: { filename: "ready.pdf", mime_type: "application/pdf", size_bytes: 5, idempotency_key: "ready" }, now,
  });
  await repository.markUploaded("ws-1", ready.id, now);
  const uploading = await repository.reserveUpload({
    workspaceId: "ws-1", userId: "user-1",
    input: { filename: "uploading.pdf", mime_type: "application/pdf", size_bytes: 5, idempotency_key: "uploading" }, now,
  });
  return { db: testD1.db, repository, ready, uploading };
}

afterEach(async () => {
  await Promise.all(disposals.splice(0).map((dispose) => dispose()));
});

describe("AttachmentService storage capability", () => {
  it("returns CAPABILITY_UNAVAILABLE without mutating D1 when FILES is missing or incomplete", async () => {
    const { db, repository, ready, uploading } = await fixture();
    const service = new AttachmentService(repository, {}, { clock: () => new Date(now) });
    const before = (await db.prepare("SELECT id, status FROM beta_attachments ORDER BY id").all()).results;

    await expect(service.createUpload(context, {
      filename: "new.pdf", mime_type: "application/pdf", size_bytes: 5, idempotency_key: "new",
    })).rejects.toMatchObject({ code: "ATTACHMENT_CAPABILITY_UNAVAILABLE", status: 503 });
    await expect(service.uploadContent(context, uploading.id, new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])))
      .rejects.toMatchObject({ code: "ATTACHMENT_CAPABILITY_UNAVAILABLE", status: 503 });
    await expect(service.download(context, ready.id))
      .rejects.toMatchObject({ code: "ATTACHMENT_CAPABILITY_UNAVAILABLE", status: 503 });
    await expect(service.deleteAttachment(context, ready.id))
      .rejects.toMatchObject({ code: "ATTACHMENT_CAPABILITY_UNAVAILABLE", status: 503 });

    expect((await db.prepare("SELECT id, status FROM beta_attachments ORDER BY id").all()).results).toEqual(before);
  });

  it("leaves D1 metadata intact when a configured object delete fails", async () => {
    const { db, repository, ready } = await fixture();
    const service = new AttachmentService(repository, {
      async get() { return null; },
      async put() {},
      async delete() { throw new Error("R2 unavailable"); },
    }, { clock: () => new Date(now) });

    await expect(service.deleteAttachment(context, ready.id)).rejects.toThrow("R2 unavailable");
    expect(await db.prepare("SELECT status FROM beta_attachments WHERE id = ?").bind(ready.id).first())
      .toEqual({ status: "ready" });
  });
});
