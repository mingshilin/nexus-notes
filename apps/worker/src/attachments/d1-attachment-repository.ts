import type { Attachment, AttachmentListRequest, KnowledgeDiagnosticsRequest } from "@nexus/contracts";

interface AttachmentRow extends Attachment { object_key: string; user_id: string; idempotency_key: string; }

function toAttachment(row: AttachmentRow): Attachment {
  const { object_key: _objectKey, user_id: _userId, idempotency_key: _idempotencyKey, ...attachment } = row;
  return attachment;
}

function encodeCursor(row: Pick<AttachmentRow, "created_at" | "id">) {
  return encodeURIComponent(`${row.created_at}\n${row.id}`);
}

function decodeCursor(cursor: string) {
  const [createdAt, id] = decodeURIComponent(cursor).split("\n", 2);
  if (!createdAt || !id) throw new Error("INVALID_ATTACHMENT_CURSOR");
  return { createdAt, id };
}

export class D1AttachmentRepository {
  constructor(private readonly db: D1Database, private readonly createId: () => string = () => crypto.randomUUID()) {}

  async getAttachmentUsage(workspaceId: string) {
    const row = await this.db.prepare(
      "SELECT COALESCE(SUM(size_bytes), 0) AS value FROM beta_attachments WHERE workspace_id = ? AND status != 'deleted'",
    ).bind(workspaceId).first<{ value: number }>();
    return Number(row?.value ?? 0);
  }

  async reserveUpload(input: { workspaceId: string; userId: string; input: { filename: string; mime_type: Attachment["mime_type"]; size_bytes: number; note_id?: string | null; idempotency_key: string }; now: string }) {
    const id = this.createId();
    const objectKey = `${input.workspaceId}/attachments/${id}`;
    await this.db.prepare(
      `INSERT INTO beta_attachments (id, workspace_id, user_id, note_id, object_key, filename, mime_type, size_bytes, status, idempotency_key, revision, created_at, updated_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, 'uploading', ?, 1, ?, ?
       WHERE ? IS NULL OR EXISTS (SELECT 1 FROM notes WHERE workspace_id = ? AND id = ? AND deleted_at IS NULL)
       ON CONFLICT(workspace_id, user_id, idempotency_key) DO NOTHING`,
    ).bind(id, input.workspaceId, input.userId, input.input.note_id ?? null, objectKey, input.input.filename, input.input.mime_type,
      input.input.size_bytes, input.input.idempotency_key, input.now, input.now, input.input.note_id ?? null, input.workspaceId, input.input.note_id ?? null).run();
    const row = await this.db.prepare(
      `SELECT id, workspace_id, user_id, note_id, object_key, filename, mime_type, size_bytes, status, idempotency_key, revision, created_at, updated_at
       FROM beta_attachments WHERE workspace_id = ? AND user_id = ? AND idempotency_key = ?`,
    ).bind(input.workspaceId, input.userId, input.input.idempotency_key).first<AttachmentRow>();
    if (!row) throw new Error("ATTACHMENT_NOTE_NOT_FOUND");
    return toAttachment(row);
  }

  async getAttachment(workspaceId: string, attachmentId: string, includeDeleted: boolean) {
    const row = await this.db.prepare(
      `SELECT id, workspace_id, user_id, note_id, object_key, filename, mime_type, size_bytes, status, idempotency_key, revision, created_at, updated_at
       FROM beta_attachments WHERE workspace_id = ? AND id = ? ${includeDeleted ? "" : "AND status != 'deleted'"}`,
    ).bind(workspaceId, attachmentId).first<AttachmentRow>();
    return row ? toAttachment(row) : null;
  }

  async listAttachments(workspaceId: string, request: AttachmentListRequest) {
    const conditions = ["workspace_id = ?", "status != 'deleted'"];
    const values: unknown[] = [workspaceId];
    if (request.mime_type) { conditions.push("mime_type = ?"); values.push(request.mime_type); }
    if (request.note_id) { conditions.push("note_id = ?"); values.push(request.note_id); }
    if (request.status) { conditions.push("status = ?"); values.push(request.status); }
    if (request.cursor) {
      const cursor = decodeCursor(request.cursor);
      conditions.push("(created_at < ? OR (created_at = ? AND id < ?))");
      values.push(cursor.createdAt, cursor.createdAt, cursor.id);
    }
    const rows = (await this.db.prepare(
      `SELECT id, workspace_id, user_id, note_id, object_key, filename, mime_type, size_bytes, status, idempotency_key, revision, created_at, updated_at
       FROM beta_attachments WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC, id DESC LIMIT ?`,
    ).bind(...values, request.limit + 1).all<AttachmentRow>()).results ?? [];
    const items = rows.slice(0, request.limit).map(toAttachment);
    return { items, next_cursor: rows.length > request.limit && rows[request.limit - 1] ? encodeCursor(rows[request.limit - 1]!) : null };
  }

  async markUploaded(workspaceId: string, attachmentId: string, now: string) {
    await this.db.prepare(
      "UPDATE beta_attachments SET status = 'ready', revision = revision + 1, updated_at = ? WHERE workspace_id = ? AND id = ? AND status = 'uploading'",
    ).bind(now, workspaceId, attachmentId).run();
  }

  async ensureOcrJob(workspaceId: string, userId: string, attachmentId: string, now: string) {
    const attachment = await this.db.prepare(
      "SELECT mime_type, revision FROM beta_attachments WHERE workspace_id = ? AND id = ? AND status = 'ready'",
    ).bind(workspaceId, attachmentId).first<{ mime_type: string; revision: number }>();
    if (!attachment || attachment.mime_type === "text/plain") return null;
    const idempotencyKey = `ocr:${attachmentId}:${attachment.revision}`;
    const id = this.createId();
    const result = await this.db.prepare(
      `INSERT INTO beta_ocr_jobs (id, workspace_id, user_id, attachment_id, status, idempotency_key, attempt_count, deadline, revision, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'pending', ?, 0, ?, 1, ?, ?) ON CONFLICT(workspace_id, user_id, idempotency_key) DO NOTHING`,
    ).bind(id, workspaceId, userId, attachmentId, idempotencyKey, new Date(Date.parse(now) + 10 * 60_000).toISOString(), now, now).run();
    return { created: Number(result.meta.changes ?? 0) > 0, idempotency_key: idempotencyKey };
  }

  async deleteAttachment(workspaceId: string, attachmentId: string, now: string) {
    await this.db.batch([
      this.db.prepare("UPDATE beta_attachments SET status = 'deleted', deleted_at = ?, revision = revision + 1, updated_at = ? WHERE workspace_id = ? AND id = ? AND status != 'deleted'").bind(now, now, workspaceId, attachmentId),
      this.db.prepare("DELETE FROM beta_ocr_jobs WHERE workspace_id = ? AND attachment_id = ?").bind(workspaceId, attachmentId),
      this.db.prepare("DELETE FROM search_documents WHERE workspace_id = ? AND entity_type = 'attachment' AND entity_id = ?").bind(workspaceId, attachmentId),
    ]);
  }

  async retryOcr(workspaceId: string, userId: string, attachmentIds: string[], now: string) {
    const queued: string[] = []; const ineligible: string[] = []; const duplicate: string[] = [];
    for (const attachmentId of attachmentIds) {
      const job = await this.db.prepare(
        "SELECT id, status FROM beta_ocr_jobs WHERE workspace_id = ? AND user_id = ? AND attachment_id = ? ORDER BY updated_at DESC LIMIT 1",
      ).bind(workspaceId, userId, attachmentId).first<{ id: string; status: string }>();
      if (!job || job.status === "completed") { ineligible.push(attachmentId); continue; }
      if (job.status === "pending" || job.status === "processing") { duplicate.push(attachmentId); continue; }
      await this.db.prepare(
        "UPDATE beta_ocr_jobs SET status = 'pending', attempt_count = attempt_count + 1, revision = revision + 1, last_error_code = NULL, updated_at = ? WHERE workspace_id = ? AND user_id = ? AND id = ? AND status IN ('failed', 'dead_letter')",
      ).bind(now, workspaceId, userId, job.id).run();
      queued.push(attachmentId);
    }
    return { queued, ineligible, duplicate };
  }

  async diagnostics(workspaceId: string, request: KnowledgeDiagnosticsRequest) {
    const cursor = request.cursor ?? "";
    const rows = (await this.db.prepare(
      `SELECT kind, entity_id, title, count, diagnostic_key FROM (
         SELECT 'unfiled_note' kind, id entity_id, title, 1 count, 'unfiled_note:' || id diagnostic_key FROM notes WHERE workspace_id = ? AND deleted_at IS NULL AND folder_id IS NULL
         UNION ALL SELECT 'orphan_note', n.id, n.title, 1, 'orphan_note:' || n.id FROM notes n LEFT JOIN folders f ON f.workspace_id = n.workspace_id AND f.id = n.folder_id WHERE n.workspace_id = ? AND n.deleted_at IS NULL AND n.folder_id IS NOT NULL AND f.id IS NULL
         UNION ALL SELECT 'duplicate_title', MIN(id), title, COUNT(*), 'duplicate_title:' || lower(trim(title)) FROM notes WHERE workspace_id = ? AND deleted_at IS NULL AND trim(title) != '' GROUP BY lower(trim(title)) HAVING COUNT(*) > 1
         UNION ALL SELECT 'broken_link', l.id, COALESCE(s.title, ''), 1, 'broken_link:' || l.id FROM note_links l LEFT JOIN notes s ON s.workspace_id = l.workspace_id AND s.id = l.source_note_id LEFT JOIN notes t ON t.workspace_id = l.workspace_id AND t.id = l.target_note_id WHERE l.workspace_id = ? AND (t.id IS NULL OR t.deleted_at IS NOT NULL)
         UNION ALL SELECT 'failed_ocr', a.id, a.filename, 1, 'failed_ocr:' || a.id FROM beta_ocr_jobs j JOIN beta_attachments a ON a.workspace_id = j.workspace_id AND a.id = j.attachment_id WHERE j.workspace_id = ? AND j.status IN ('failed', 'dead_letter') AND a.status != 'deleted'
       ) WHERE diagnostic_key > ? ORDER BY diagnostic_key LIMIT ?`,
    ).bind(workspaceId, workspaceId, workspaceId, workspaceId, workspaceId, cursor, request.limit + 1).all<{ kind: "unfiled_note" | "orphan_note" | "duplicate_title" | "broken_link" | "failed_ocr"; entity_id: string; title: string; count: number; diagnostic_key: string }>()).results ?? [];
    const page = rows.slice(0, request.limit);
    return { items: page.map(({ diagnostic_key: _key, ...item }) => item), nextCursor: rows.length > request.limit ? page.at(-1)?.diagnostic_key ?? null : null };
  }
}
