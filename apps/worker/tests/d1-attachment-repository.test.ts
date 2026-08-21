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

  it("groups historical failed OCR by attachment with stable unique diagnostic cursors and safe summaries", async () => {
    const { db, repository } = await fixture();
    const first = await repository.reserveUpload(upload("ws-1", "user-1", "first-failure", 1024));
    const second = await repository.reserveUpload(upload("ws-1", "user-1", "second-failure", 1024));
    const other = await repository.reserveUpload(upload("ws-2", "user-2", "other-failure", 1024));
    await repository.markUploaded("ws-1", first.id, now);
    await repository.markUploaded("ws-1", second.id, now);
    await repository.markUploaded("ws-2", other.id, now);
    await db.batch([
      db.prepare(
        `INSERT INTO beta_ocr_jobs (id, workspace_id, user_id, attachment_id, source_revision, status, idempotency_key, attempt_count, deadline, last_error_code, revision, created_at, updated_at)
         VALUES (?, 'ws-1', 'user-1', ?, ?, ?, ?, 1, ?, ?, 1, ?, ?)`,
      ).bind("first-old", first.id, 1, "failed", "ocr:first-old", now, "OCR_INTERNAL_STACK_TRACE", "2026-08-20T00:00:00.000Z", "2026-08-20T00:00:00.000Z"),
      db.prepare(
        `INSERT INTO beta_ocr_jobs (id, workspace_id, user_id, attachment_id, source_revision, status, idempotency_key, attempt_count, deadline, last_error_code, revision, created_at, updated_at)
         VALUES (?, 'ws-1', 'user-1', ?, ?, ?, ?, 3, ?, ?, 1, ?, ?)`,
      ).bind("first-latest", first.id, 2, "dead_letter", "ocr:first-latest", now, "OCR_ATTEMPTS_EXHAUSTED", "2026-08-21T00:00:00.000Z", "2026-08-21T00:00:00.000Z"),
      db.prepare(
        `INSERT INTO beta_ocr_jobs (id, workspace_id, user_id, attachment_id, source_revision, status, idempotency_key, attempt_count, deadline, last_error_code, revision, created_at, updated_at)
         VALUES (?, 'ws-1', 'user-1', ?, ?, ?, ?, 1, ?, ?, 1, ?, ?)`,
      ).bind("second-only", second.id, 2, "failed", "ocr:second-only", now, "OCR_PROVIDER_TIMEOUT", "2026-08-21T00:00:00.000Z", "2026-08-21T00:00:00.000Z"),
      db.prepare(
        `INSERT INTO beta_ocr_jobs (id, workspace_id, user_id, attachment_id, source_revision, status, idempotency_key, attempt_count, deadline, last_error_code, revision, created_at, updated_at)
         VALUES ('other-tenant', 'ws-2', 'user-2', ?, 2, 'failed', 'ocr:other', 1, ?, 'OCR_PROVIDER_TIMEOUT', 1, ?, ?)`,
      ).bind(other.id, now, now, now),
    ]);

    const pageOne = await repository.diagnostics("ws-1", { limit: 1 });
    const pageTwo = await repository.diagnostics("ws-1", { limit: 1, cursor: pageOne.nextCursor! });
    const diagnostics = [...pageOne.items, ...pageTwo.items].filter((item) => item.kind === "failed_ocr");

    expect(diagnostics).toHaveLength(2);
    expect(new Set(diagnostics.map((item) => item.entity_id)).size).toBe(2);
    expect(diagnostics.find((item) => item.entity_id === first.id)).toMatchObject({
      count: 2, failure_count: 2, ocr_status: "dead_letter", latest_error: "ocr_attempts_exhausted",
    });
    expect(JSON.stringify(diagnostics)).not.toContain("OCR_INTERNAL_STACK_TRACE");
    expect(JSON.stringify(diagnostics)).not.toContain("OCR_PROVIDER_TIMEOUT");
  });
});
