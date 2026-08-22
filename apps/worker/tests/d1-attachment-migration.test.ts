import { afterEach, describe, expect, it } from "vitest";

import { applyMigration, createTestD1, seedTenants } from "./helpers/d1";

const now = "2026-08-21T00:00:00.000Z";
const disposals: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(disposals.splice(0).map((dispose) => dispose()));
});

describe("attachment consistency migration", () => {
  it("upgrades old 0003 rows without losing state, revisions, or timestamps", async () => {
    const testD1 = await createTestD1({ through: 3 });
    disposals.push(testD1.dispose);
    await seedTenants(testD1.db);
    await testD1.db.batch([
      testD1.db.prepare(
        `INSERT INTO beta_attachments
         (id, workspace_id, user_id, note_id, object_key, filename, mime_type, size_bytes, status, idempotency_key, revision, created_at, updated_at)
         VALUES (?, 'ws-1', 'user-1', NULL, ?, ?, 'application/pdf', 5, 'ready', ?, ?, ?, ?)`,
      ).bind("attachment-1", "ws-1/attachments/attachment-1", "one.pdf", "upload-1", 7, now, now),
      testD1.db.prepare(
        `INSERT INTO beta_attachments
         (id, workspace_id, user_id, note_id, object_key, filename, mime_type, size_bytes, status, idempotency_key, revision, created_at, updated_at)
         VALUES (?, 'ws-1', 'user-1', NULL, ?, ?, 'application/pdf', 5, 'ready', ?, ?, ?, ?)`,
      ).bind("attachment-2", "ws-1/attachments/attachment-2", "two.pdf", "upload-2", 4, now, now),
      testD1.db.prepare(
        `INSERT INTO beta_attachments
         (id, workspace_id, user_id, note_id, object_key, filename, mime_type, size_bytes, status, idempotency_key, revision, created_at, updated_at)
         VALUES ('a_b', 'ws-1', 'user-1', NULL, 'ws-1/attachments/a_b', 'wildcard.pdf', 'application/pdf', 5, 'ready', 'upload-3', 6, ?, ?)`,
      ).bind(now, now),
      testD1.db.prepare(
        `INSERT INTO beta_ocr_jobs
         (id, workspace_id, user_id, attachment_id, status, idempotency_key, attempt_count, deadline, last_error_code, revision, created_at, updated_at)
         VALUES ('job-pending', 'ws-1', 'user-1', 'attachment-1', 'pending', 'ocr:attachment-1:7', 2, ?, 'DELAYED', 5, ?, ?)`,
      ).bind("2026-08-21T00:10:00.000Z", "2026-08-20T23:00:00.000Z", "2026-08-20T23:05:00.000Z"),
      testD1.db.prepare(
        `INSERT INTO beta_ocr_jobs
         (id, workspace_id, user_id, attachment_id, status, idempotency_key, attempt_count, deadline, last_error_code, revision, created_at, updated_at)
         VALUES ('job-completed', 'ws-1', 'user-1', 'attachment-2', 'completed', 'legacy-key', 3, ?, NULL, 9, ?, ?)`,
      ).bind("2026-08-21T00:20:00.000Z", "2026-08-20T22:00:00.000Z", "2026-08-20T22:30:00.000Z"),
      testD1.db.prepare(
        `INSERT INTO beta_ocr_jobs
         (id, workspace_id, user_id, attachment_id, status, idempotency_key, attempt_count, deadline, last_error_code, revision, created_at, updated_at)
         VALUES ('job-duplicate', 'ws-1', 'user-2', 'attachment-1', 'failed', 'ocr:attachment-1:7', 1, ?, 'FAILED', 4, ?, ?)`,
      ).bind("2026-08-21T00:09:00.000Z", "2026-08-20T23:01:00.000Z", "2026-08-20T23:04:00.000Z"),
      testD1.db.prepare(
        `INSERT INTO beta_ocr_jobs
         (id, workspace_id, user_id, attachment_id, status, idempotency_key, attempt_count, deadline, last_error_code, revision, created_at, updated_at)
         VALUES ('job-wildcard', 'ws-1', 'user-1', 'a_b', 'failed', 'ocr:axb:9', 1, ?, 'FAILED', 2, ?, ?)`,
      ).bind("2026-08-21T00:08:00.000Z", "2026-08-20T21:00:00.000Z", "2026-08-20T21:30:00.000Z"),
    ]);

    await applyMigration(testD1.db, "../../migrations/0004_attachment_consistency.sql");

    const rows = (await testD1.db.prepare(
      `SELECT id, user_id, attachment_id, source_revision, status, idempotency_key, attempt_count,
       deadline, last_error_code, revision, created_at, updated_at
       FROM beta_ocr_jobs ORDER BY id`,
    ).all()).results;
    expect(rows).toEqual([
      {
        id: "job-completed", user_id: "user-1", attachment_id: "attachment-2", source_revision: 4,
        status: "completed", idempotency_key: "legacy-key", attempt_count: 3,
        deadline: "2026-08-21T00:20:00.000Z", last_error_code: null, revision: 9,
        created_at: "2026-08-20T22:00:00.000Z", updated_at: "2026-08-20T22:30:00.000Z",
      },
      {
        id: "job-pending", user_id: "user-1", attachment_id: "attachment-1", source_revision: 7,
        status: "pending", idempotency_key: "ocr:attachment-1:7", attempt_count: 2,
        deadline: "2026-08-21T00:10:00.000Z", last_error_code: "DELAYED", revision: 5,
        created_at: "2026-08-20T23:00:00.000Z", updated_at: "2026-08-20T23:05:00.000Z",
      },
      {
        id: "job-wildcard", user_id: "user-1", attachment_id: "a_b", source_revision: 6,
        status: "failed", idempotency_key: "ocr:axb:9", attempt_count: 1,
        deadline: "2026-08-21T00:08:00.000Z", last_error_code: "FAILED", revision: 2,
        created_at: "2026-08-20T21:00:00.000Z", updated_at: "2026-08-20T21:30:00.000Z",
      },
    ]);
    expect(await testD1.db.prepare(
      `SELECT id, status, revision, created_at, updated_at, archived_reason
       FROM beta_ocr_jobs_0003_duplicates WHERE id = 'job-duplicate'`,
    ).first()).toEqual({
      id: "job-duplicate",
      status: "failed",
      revision: 4,
      created_at: "2026-08-20T23:01:00.000Z",
      updated_at: "2026-08-20T23:04:00.000Z",
      archived_reason: "duplicate_workspace_attachment_source_revision",
    });
    await expect(testD1.db.prepare(
      `INSERT INTO beta_ocr_jobs
       (id, workspace_id, user_id, attachment_id, source_revision, status, idempotency_key, attempt_count, deadline, revision, created_at, updated_at)
       VALUES ('duplicate', 'ws-1', 'user-2', 'attachment-1', 7, 'pending', 'duplicate-key', 1, ?, 1, ?, ?)`,
    ).bind("2026-08-21T00:30:00.000Z", now, now).run()).rejects.toThrow();
    expect(await testD1.db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'queue_outbox'",
    ).first()).toEqual({ name: "queue_outbox" });
  });
});
