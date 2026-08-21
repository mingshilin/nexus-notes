import { afterEach, describe, expect, it } from "vitest";

import { MAX_WORKSPACE_ATTACHMENT_BYTES } from "@nexus/contracts";

import { createTestD1, seedTenants } from "./helpers/d1";

const now = "2026-08-21T00:00:00.000Z";
const disposals: Array<() => Promise<void>> = [];

async function fixture() {
  const testD1 = await createTestD1();
  disposals.push(testD1.dispose);
  await seedTenants(testD1.db);
  const { D1AttachmentRepository } = await import("../src");
  let nextId = 0;
  return {
    db: testD1.db,
    repository: new D1AttachmentRepository(testD1.db, () => `generated-${++nextId}`),
  };
}

function upload(workspaceId: string, userId: string, idempotencyKey: string, sizeBytes: number) {
  return {
    workspaceId,
    userId,
    input: {
      filename: `${idempotencyKey}.pdf`,
      mime_type: "application/pdf" as const,
      size_bytes: sizeBytes,
      idempotency_key: idempotencyKey,
    },
    now,
  };
}

afterEach(async () => {
  await Promise.all(disposals.splice(0).map((dispose) => dispose()));
});

describe("D1AttachmentRepository attachment quota", () => {
  it("atomically admits only one concurrent reservation at the remaining workspace capacity", async () => {
    const { db, repository } = await fixture();
    for (let index = 0; index < 40; index += 1) {
      await repository.reserveUpload(upload("ws-1", "user-1", `seed-${index}`, 25 * 1024 * 1024));
    }
    await repository.reserveUpload(upload("ws-1", "user-1", "seed-tail", 23 * 1024 * 1024));

    const results = await Promise.allSettled([
      repository.reserveUpload(upload("ws-1", "user-1", "concurrent-a", 1024 * 1024)),
      repository.reserveUpload(upload("ws-1", "user-1", "concurrent-b", 1024 * 1024)),
    ]);
    const usage = await db.prepare(
      "SELECT SUM(size_bytes) value FROM beta_attachments WHERE workspace_id = ? AND status != 'deleted'",
    ).bind("ws-1").first<{ value: number }>();

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(Number(usage?.value)).toBe(MAX_WORKSPACE_ATTACHMENT_BYTES);
  });

  it("releases a reservation exactly once and never mutates another workspace", async () => {
    const { db, repository } = await fixture();
    const first = await repository.reserveUpload(upload("ws-1", "user-1", "first", 1024));
    const other = await repository.reserveUpload(upload("ws-2", "user-2", "other", 2048));

    await repository.deleteAttachment("ws-2", first.id, now);
    expect(await repository.getAttachment("ws-1", first.id, false)).not.toBeNull();
    await repository.deleteAttachment("ws-1", first.id, now);
    await repository.deleteAttachment("ws-1", first.id, now);

    const rows = (await db.prepare(
      "SELECT workspace_id, SUM(size_bytes) value FROM beta_attachments WHERE status != 'deleted' GROUP BY workspace_id ORDER BY workspace_id",
    ).all<{ workspace_id: string; value: number }>()).results;
    expect(rows).toEqual([{ workspace_id: "ws-2", value: 2048 }]);
    expect(await repository.getAttachment("ws-2", other.id, false)).not.toBeNull();
  });
});
