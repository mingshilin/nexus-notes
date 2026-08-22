import {
  MAX_WORKSPACE_ATTACHMENT_BYTES,
  QueueJobSchema,
  type Attachment,
  type AttachmentListRequest,
  type KnowledgeDiagnostic,
  type KnowledgeDiagnosticsRequest,
  type QueueJob,
} from "@nexus/contracts";

interface AttachmentRow extends Omit<Attachment, "ocr_status" | "ocr_attempt_count" | "ocr_updated_at"> {
  object_key: string;
  user_id: string;
  idempotency_key: string;
  ocr_status?: Attachment["ocr_status"];
  ocr_attempt_count?: number | null;
  ocr_updated_at?: string | null;
}

interface OcrJobRow {
  id: string;
  workspace_id: string;
  attachment_id: string;
  source_revision: number;
  status: string;
  idempotency_key: string;
  attempt_count: number;
  deadline: string;
  revision: number;
}

function toAttachment(row: AttachmentRow): Attachment {
  const {
    object_key: _objectKey,
    user_id: _userId,
    idempotency_key: _idempotencyKey,
    ocr_status = null,
    ocr_attempt_count = null,
    ocr_updated_at = null,
    ...attachment
  } = row;
  return { ...attachment, ocr_status, ocr_attempt_count, ocr_updated_at };
}

function attachmentProjection(alias: string) {
  return `${alias}.id, ${alias}.workspace_id, ${alias}.user_id, ${alias}.note_id, ${alias}.object_key,
    ${alias}.filename, ${alias}.mime_type, ${alias}.size_bytes, ${alias}.status, ${alias}.idempotency_key,
    ${alias}.revision, ${alias}.created_at, ${alias}.updated_at,
    (SELECT j.status FROM beta_ocr_jobs j WHERE j.workspace_id = ${alias}.workspace_id AND j.attachment_id = ${alias}.id ORDER BY j.updated_at DESC, j.id DESC LIMIT 1) AS ocr_status,
    (SELECT j.attempt_count FROM beta_ocr_jobs j WHERE j.workspace_id = ${alias}.workspace_id AND j.attachment_id = ${alias}.id ORDER BY j.updated_at DESC, j.id DESC LIMIT 1) AS ocr_attempt_count,
    (SELECT j.updated_at FROM beta_ocr_jobs j WHERE j.workspace_id = ${alias}.workspace_id AND j.attachment_id = ${alias}.id ORDER BY j.updated_at DESC, j.id DESC LIMIT 1) AS ocr_updated_at`;
}

function encodeCursor(row: Pick<AttachmentRow, "created_at" | "id">) {
  return encodeURIComponent(`${row.created_at}\n${row.id}`);
}

function decodeCursor(cursor: string) {
  const [createdAt, id] = decodeURIComponent(cursor).split("\n", 2);
  if (!createdAt || !id) throw new Error("INVALID_ATTACHMENT_CURSOR");
  return { createdAt, id };
}

function placeholders(length: number) {
  return Array.from({ length }, () => "?").join(", ");
}

function ocrMessage(job: Pick<OcrJobRow, "id" | "workspace_id" | "attachment_id" | "source_revision" | "idempotency_key" | "attempt_count" | "deadline">): QueueJob {
  return {
    job_id: job.id,
    kind: "ocr",
    idempotency_key: job.idempotency_key,
    attempt: job.attempt_count,
    deadline: job.deadline,
    payload: {
      workspace_id: job.workspace_id,
      attachment_id: job.attachment_id,
      source_revision: job.source_revision,
    },
  };
}

function ocrOutboxId(job: Pick<OcrJobRow, "workspace_id" | "id" | "attempt_count">) {
  return `ocr-outbox:${job.workspace_id}:${job.id}:${job.attempt_count}`;
}

const MAX_OCR_ATTEMPTS = 3;
const OCR_ATTEMPT_TIMEOUT_MS = 10 * 60_000;

export class D1AttachmentRepositoryError extends Error {
  constructor(readonly code: "ATTACHMENT_NOTE_NOT_FOUND" | "ATTACHMENT_QUOTA_EXCEEDED") {
    super(code);
    this.name = "D1AttachmentRepositoryError";
  }
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
       WHERE (? IS NULL OR EXISTS (SELECT 1 FROM notes WHERE workspace_id = ? AND id = ? AND deleted_at IS NULL))
       AND COALESCE((SELECT SUM(size_bytes) FROM beta_attachments WHERE workspace_id = ? AND status != 'deleted'), 0) + ? <= ?
       ON CONFLICT(workspace_id, user_id, idempotency_key) DO NOTHING`,
    ).bind(id, input.workspaceId, input.userId, input.input.note_id ?? null, objectKey, input.input.filename, input.input.mime_type,
      input.input.size_bytes, input.input.idempotency_key, input.now, input.now, input.input.note_id ?? null, input.workspaceId,
      input.input.note_id ?? null, input.workspaceId, input.input.size_bytes, MAX_WORKSPACE_ATTACHMENT_BYTES).run();
    const row = await this.db.prepare(
      `SELECT id, workspace_id, user_id, note_id, object_key, filename, mime_type, size_bytes, status, idempotency_key, revision, created_at, updated_at
       FROM beta_attachments WHERE workspace_id = ? AND user_id = ? AND idempotency_key = ?`,
    ).bind(input.workspaceId, input.userId, input.input.idempotency_key).first<AttachmentRow>();
    if (!row && input.input.note_id) {
      const note = await this.db.prepare(
        "SELECT 1 found FROM notes WHERE workspace_id = ? AND id = ? AND deleted_at IS NULL",
      ).bind(input.workspaceId, input.input.note_id).first<{ found: number }>();
      if (!note) throw new D1AttachmentRepositoryError("ATTACHMENT_NOTE_NOT_FOUND");
    }
    if (!row) throw new D1AttachmentRepositoryError("ATTACHMENT_QUOTA_EXCEEDED");
    return toAttachment(row);
  }

  async getAttachment(workspaceId: string, attachmentId: string, includeDeleted: boolean) {
    const row = await this.db.prepare(
      `SELECT ${attachmentProjection("a")}
       FROM beta_attachments a WHERE a.workspace_id = ? AND a.id = ? ${includeDeleted ? "" : "AND a.status != 'deleted'"}`,
    ).bind(workspaceId, attachmentId).first<AttachmentRow>();
    return row ? toAttachment(row) : null;
  }

  async listAttachments(workspaceId: string, request: AttachmentListRequest) {
    const conditions = ["a.workspace_id = ?", "a.status != 'deleted'"];
    const values: unknown[] = [workspaceId];
    if (request.mime_type) { conditions.push("a.mime_type = ?"); values.push(request.mime_type); }
    if (request.note_id) { conditions.push("a.note_id = ?"); values.push(request.note_id); }
    if (request.status) { conditions.push("a.status = ?"); values.push(request.status); }
    if (request.ocr_status) {
      conditions.push("(SELECT j.status FROM beta_ocr_jobs j WHERE j.workspace_id = a.workspace_id AND j.attachment_id = a.id ORDER BY j.updated_at DESC, j.id DESC LIMIT 1) = ?");
      values.push(request.ocr_status);
    }
    if (request.cursor) {
      const cursor = decodeCursor(request.cursor);
      conditions.push("(a.created_at < ? OR (a.created_at = ? AND a.id < ?))");
      values.push(cursor.createdAt, cursor.createdAt, cursor.id);
    }
    const rows = (await this.db.prepare(
      `SELECT ${attachmentProjection("a")}
       FROM beta_attachments a WHERE ${conditions.join(" AND ")} ORDER BY a.created_at DESC, a.id DESC LIMIT ?`,
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
    const idempotencyKey = `ocr:${workspaceId}:${attachmentId}:${attachment.revision}`;
    const id = this.createId();
    const deadline = new Date(Date.parse(now) + OCR_ATTEMPT_TIMEOUT_MS).toISOString();
    const candidate: OcrJobRow = {
      id,
      workspace_id: workspaceId,
      attachment_id: attachmentId,
      source_revision: attachment.revision,
      status: "pending",
      idempotency_key: idempotencyKey,
      attempt_count: 1,
      deadline,
      revision: 1,
    };
    const outboxId = ocrOutboxId(candidate);
    const results = await this.db.batch([
      this.db.prepare(
        `INSERT INTO beta_ocr_jobs (id, workspace_id, user_id, attachment_id, source_revision, status, idempotency_key, attempt_count, deadline, revision, created_at, updated_at)
         SELECT ?, a.workspace_id, ?, a.id, a.revision, 'pending', ?, 1, ?, 1, ?, ?
         FROM beta_attachments a
         WHERE a.workspace_id = ? AND a.id = ? AND a.status = 'ready' AND a.revision = ?
         ON CONFLICT(workspace_id, attachment_id, source_revision) DO NOTHING`,
      ).bind(id, userId, idempotencyKey, deadline, now, now, workspaceId, attachmentId, attachment.revision),
      this.db.prepare(
        `INSERT INTO queue_outbox (id, workspace_id, job_kind, idempotency_key, payload_json, available_at, published_at, attempt, created_at)
         SELECT ?, workspace_id, 'ocr', ?, ?, ?, NULL, 0, ? FROM beta_ocr_jobs WHERE id = ?
         ON CONFLICT(idempotency_key) DO NOTHING`,
      ).bind(outboxId, outboxId, JSON.stringify(ocrMessage(candidate)), now, now, id),
    ]);
    const created = Number(results[0]?.meta.changes ?? 0) > 0;
    const job = await this.db.prepare(
      `SELECT id, workspace_id, attachment_id, source_revision, status, idempotency_key, attempt_count, deadline, revision
       FROM beta_ocr_jobs WHERE workspace_id = ? AND attachment_id = ? AND source_revision = ?`,
    ).bind(workspaceId, attachmentId, attachment.revision).first<OcrJobRow>();
    if (!job) return null;
    return {
      created,
      job_id: job.id,
      source_revision: job.source_revision,
      attempt: job.attempt_count,
      deadline: job.deadline,
      idempotency_key: job.idempotency_key,
      outbox_id: ocrOutboxId(job),
    };
  }

  async claimOcrJob(message: QueueJob, now: string, nativeAttempts = 1) {
    const parsed = QueueJobSchema.safeParse(message);
    if (!parsed.success) return null;
    const job = parsed.data;
    const workspaceId = job.payload.workspace_id;
    const attachmentId = job.payload.attachment_id;
    const sourceRevision = job.payload.source_revision;
    if (job.kind !== "ocr" || typeof workspaceId !== "string" || typeof attachmentId !== "string"
      || !Number.isInteger(sourceRevision) || Number(sourceRevision) <= 0) return null;
    const deliveryAttempts = Math.max(1, Math.floor(nativeAttempts));
    const boundedAttempts = Math.min(deliveryAttempts, MAX_OCR_ATTEMPTS);
    const exhausted = deliveryAttempts > MAX_OCR_ATTEMPTS;
    await this.db.prepare(
      `UPDATE beta_ocr_jobs SET attempt_count = CASE WHEN attempt_count < ? THEN ? ELSE attempt_count END,
       status = CASE WHEN ? THEN 'dead_letter' ELSE status END,
       last_error_code = CASE WHEN ? THEN 'OCR_ATTEMPTS_EXHAUSTED' ELSE last_error_code END,
       revision = revision + 1, updated_at = ?
       WHERE workspace_id = ? AND id = ? AND attachment_id = ? AND source_revision = ?
       AND status = 'pending' AND idempotency_key = ? AND attempt_count >= ? AND deadline = ?
       AND (attempt_count < ? OR ?)
       AND EXISTS (
         SELECT 1 FROM beta_attachments a
         WHERE a.workspace_id = beta_ocr_jobs.workspace_id AND a.id = beta_ocr_jobs.attachment_id
         AND a.status = 'ready' AND a.revision = beta_ocr_jobs.source_revision
       )`,
    ).bind(boundedAttempts, boundedAttempts, exhausted ? 1 : 0, exhausted ? 1 : 0, now,
      workspaceId, job.job_id, attachmentId, sourceRevision, job.idempotency_key, job.attempt, job.deadline,
      boundedAttempts, exhausted ? 1 : 0).run();
    return this.db.prepare(
      `UPDATE beta_ocr_jobs SET status = 'processing', revision = revision + 1, updated_at = ?
       WHERE workspace_id = ? AND id = ? AND attachment_id = ? AND source_revision = ?
       AND status = 'pending' AND idempotency_key = ? AND attempt_count >= ? AND deadline = ? AND deadline > ?
       AND EXISTS (
         SELECT 1 FROM beta_attachments a
         WHERE a.workspace_id = beta_ocr_jobs.workspace_id AND a.id = beta_ocr_jobs.attachment_id
         AND a.status = 'ready' AND a.revision = beta_ocr_jobs.source_revision
       )
       RETURNING id, workspace_id, attachment_id, source_revision, attempt_count, deadline,
         (SELECT object_key FROM beta_attachments a WHERE a.workspace_id = beta_ocr_jobs.workspace_id AND a.id = beta_ocr_jobs.attachment_id) AS object_key,
         (SELECT filename FROM beta_attachments a WHERE a.workspace_id = beta_ocr_jobs.workspace_id AND a.id = beta_ocr_jobs.attachment_id) AS filename,
         (SELECT mime_type FROM beta_attachments a WHERE a.workspace_id = beta_ocr_jobs.workspace_id AND a.id = beta_ocr_jobs.attachment_id) AS mime_type,
         (SELECT size_bytes FROM beta_attachments a WHERE a.workspace_id = beta_ocr_jobs.workspace_id AND a.id = beta_ocr_jobs.attachment_id) AS size_bytes`,
    ).bind(now, workspaceId, job.job_id, attachmentId, sourceRevision, job.idempotency_key,
      job.attempt, job.deadline, now).first<{
        id: string;
        workspace_id: string;
        attachment_id: string;
        source_revision: number;
        attempt_count: number;
        deadline: string;
        object_key: string;
        filename: string;
        mime_type: string;
        size_bytes: number;
      }>();
  }

  async completeOcrJob(workspaceId: string, jobId: string, text: string, now: string) {
    const results = await this.db.batch([
      this.db.prepare(
        `UPDATE beta_ocr_jobs SET status = 'completed', last_error_code = NULL, revision = revision + 1, updated_at = ?
         WHERE workspace_id = ? AND id = ? AND status = 'processing'
         AND EXISTS (
           SELECT 1 FROM beta_attachments a
           WHERE a.workspace_id = beta_ocr_jobs.workspace_id AND a.id = beta_ocr_jobs.attachment_id
           AND a.status = 'ready' AND a.revision = beta_ocr_jobs.source_revision
         )`,
      ).bind(now, workspaceId, jobId),
      this.db.prepare(
        `INSERT INTO search_documents (id, workspace_id, entity_type, entity_id, title, ocr_text, revision, updated_at)
         SELECT 'attachment:' || a.id, a.workspace_id, 'attachment', a.id, a.filename, ?, a.revision, ?
         FROM beta_ocr_jobs j JOIN beta_attachments a ON a.workspace_id = j.workspace_id AND a.id = j.attachment_id
         WHERE j.workspace_id = ? AND j.id = ? AND j.status = 'completed' AND j.updated_at = ?
         AND a.status = 'ready' AND a.revision = j.source_revision
         ON CONFLICT(workspace_id, entity_type, entity_id) DO UPDATE SET
         ocr_text = excluded.ocr_text, revision = excluded.revision, updated_at = excluded.updated_at`,
      ).bind(text, now, workspaceId, jobId, now),
    ]);
    return Number(results[0]?.meta.changes ?? 0) > 0;
  }

  async retryOcrJob(workspaceId: string, jobId: string, code: string, now: string) {
    const result = await this.db.prepare(
      `UPDATE beta_ocr_jobs SET status = 'pending', last_error_code = ?, revision = revision + 1, updated_at = ?
       WHERE workspace_id = ? AND id = ? AND status = 'processing' AND deadline > ?`,
    ).bind(code, now, workspaceId, jobId, now).run();
    return Number(result.meta.changes ?? 0) > 0;
  }

  async failOcrJob(workspaceId: string, jobId: string, code: string, now: string, options: { deadLetter?: boolean } = {}) {
    const result = await this.db.prepare(
      `UPDATE beta_ocr_jobs SET status = CASE WHEN ? OR attempt_count >= ? THEN 'dead_letter' ELSE 'failed' END,
       last_error_code = ?, revision = revision + 1, updated_at = ?
       WHERE workspace_id = ? AND id = ? AND status = 'processing'`,
    ).bind(options.deadLetter ? 1 : 0, MAX_OCR_ATTEMPTS, code, now, workspaceId, jobId).run();
    return Number(result.meta.changes ?? 0) > 0;
  }

  async recoverStaleOcrJobs(now: string, limit: number) {
    const jobs = (await this.db.prepare(
      `SELECT j.id, j.workspace_id, j.attachment_id, j.source_revision, j.status, j.idempotency_key,
       j.attempt_count, j.deadline, j.revision
       FROM beta_ocr_jobs j
       JOIN beta_attachments a ON a.workspace_id = j.workspace_id AND a.id = j.attachment_id
       WHERE j.status IN ('pending', 'processing') AND j.deadline <= ?
       AND a.status = 'ready' AND a.revision = j.source_revision
       ORDER BY j.deadline, j.id LIMIT ?`,
    ).bind(now, limit).all<OcrJobRow>()).results ?? [];
    let requeued = 0;
    let deadLettered = 0;
    for (const job of jobs) {
      if (job.attempt_count >= MAX_OCR_ATTEMPTS) {
        const results = await this.db.batch([
          this.db.prepare(
            `UPDATE beta_ocr_jobs SET status = 'dead_letter', last_error_code = 'OCR_ATTEMPTS_EXHAUSTED',
             revision = revision + 1, updated_at = ?
             WHERE workspace_id = ? AND id = ? AND source_revision = ? AND status = ? AND revision = ? AND deadline = ?`,
          ).bind(now, job.workspace_id, job.id, job.source_revision, job.status, job.revision, job.deadline),
          this.db.prepare(
            `DELETE FROM queue_outbox WHERE job_kind = 'ocr' AND published_at IS NULL
             AND json_extract(payload_json, '$.job_id') = ? AND json_extract(payload_json, '$.attempt') = ?`,
          ).bind(job.id, job.attempt_count),
        ]);
        if (Number(results[0]?.meta.changes ?? 0) > 0) deadLettered += 1;
        continue;
      }

      const candidate: OcrJobRow = {
        ...job,
        status: "pending",
        attempt_count: job.attempt_count + 1,
        deadline: new Date(Date.parse(now) + OCR_ATTEMPT_TIMEOUT_MS).toISOString(),
        revision: job.revision + 1,
      };
      const outboxId = ocrOutboxId(candidate);
      const results = await this.db.batch([
        this.db.prepare(
          `UPDATE beta_ocr_jobs SET status = 'pending', attempt_count = ?, deadline = ?, last_error_code = NULL,
           revision = revision + 1, updated_at = ?
           WHERE workspace_id = ? AND id = ? AND source_revision = ? AND status = ? AND revision = ? AND deadline = ?`,
        ).bind(candidate.attempt_count, candidate.deadline, now, job.workspace_id, job.id, job.source_revision,
          job.status, job.revision, job.deadline),
        this.db.prepare(
          `DELETE FROM queue_outbox WHERE job_kind = 'ocr' AND published_at IS NULL
           AND json_extract(payload_json, '$.job_id') = ? AND json_extract(payload_json, '$.attempt') = ?`,
        ).bind(job.id, job.attempt_count),
        this.db.prepare(
          `INSERT INTO queue_outbox (id, workspace_id, job_kind, idempotency_key, payload_json, available_at, published_at, attempt, created_at)
           SELECT ?, workspace_id, 'ocr', ?, ?, ?, NULL, 0, ? FROM beta_ocr_jobs
           WHERE workspace_id = ? AND id = ? AND source_revision = ? AND status = 'pending'
           AND revision = ? AND attempt_count = ? AND deadline = ?
           ON CONFLICT(idempotency_key) DO NOTHING`,
        ).bind(outboxId, outboxId, JSON.stringify(ocrMessage(candidate)), now, now, job.workspace_id, job.id,
          job.source_revision, candidate.revision, candidate.attempt_count, candidate.deadline),
      ]);
      if (Number(results[0]?.meta.changes ?? 0) > 0) requeued += 1;
    }
    return { requeued, dead_lettered: deadLettered };
  }

  async deleteAttachment(workspaceId: string, attachmentId: string, now: string) {
    await this.db.batch([
      this.db.prepare(
        `DELETE FROM queue_outbox WHERE job_kind = 'ocr'
         AND json_extract(payload_json, '$.payload.workspace_id') = ?
         AND json_extract(payload_json, '$.payload.attachment_id') = ?`,
      ).bind(workspaceId, attachmentId),
      this.db.prepare("UPDATE beta_attachments SET status = 'deleted', deleted_at = ?, revision = revision + 1, updated_at = ? WHERE workspace_id = ? AND id = ? AND status != 'deleted'").bind(now, now, workspaceId, attachmentId),
      this.db.prepare("DELETE FROM beta_ocr_jobs WHERE workspace_id = ? AND attachment_id = ?").bind(workspaceId, attachmentId),
      this.db.prepare("DELETE FROM search_documents WHERE workspace_id = ? AND entity_type = 'attachment' AND entity_id = ?").bind(workspaceId, attachmentId),
    ]);
  }

  async retryOcr(workspaceId: string, _userId: string, attachmentIds: string[], now: string) {
    const queued: string[] = []; const ineligible: string[] = []; const duplicate: string[] = []; const outboxIds: string[] = [];
    for (const attachmentId of attachmentIds) {
      const job = await this.db.prepare(
        `SELECT j.id, j.workspace_id, j.attachment_id, j.source_revision, j.status, j.idempotency_key,
         j.attempt_count, j.deadline, j.revision
         FROM beta_ocr_jobs j
         JOIN beta_attachments a ON a.workspace_id = j.workspace_id AND a.id = j.attachment_id
         WHERE j.workspace_id = ? AND j.attachment_id = ? AND a.status = 'ready' AND a.revision = j.source_revision
         ORDER BY j.updated_at DESC, j.id DESC LIMIT 1`,
      ).bind(workspaceId, attachmentId).first<OcrJobRow>();
      if (!job || job.status === "completed") { ineligible.push(attachmentId); continue; }
      if (job.status === "pending" || job.status === "processing") { duplicate.push(attachmentId); continue; }
      const candidate: OcrJobRow = {
        ...job,
        status: "pending",
        attempt_count: job.attempt_count + 1,
        deadline: new Date(Date.parse(now) + OCR_ATTEMPT_TIMEOUT_MS).toISOString(),
        revision: job.revision + 1,
      };
      const outboxId = ocrOutboxId(candidate);
      const results = await this.db.batch([
        this.db.prepare(
          `UPDATE beta_ocr_jobs SET status = 'pending', attempt_count = ?, deadline = ?, revision = revision + 1,
           last_error_code = NULL, updated_at = ?
           WHERE workspace_id = ? AND id = ? AND source_revision = ? AND revision = ? AND status IN ('failed', 'dead_letter')`,
        ).bind(candidate.attempt_count, candidate.deadline, now, workspaceId, job.id, job.source_revision, job.revision),
        this.db.prepare(
          `INSERT INTO queue_outbox (id, workspace_id, job_kind, idempotency_key, payload_json, available_at, published_at, attempt, created_at)
           SELECT ?, workspace_id, 'ocr', ?, ?, ?, NULL, 0, ? FROM beta_ocr_jobs
           WHERE workspace_id = ? AND id = ? AND source_revision = ? AND revision = ? AND status = 'pending' AND attempt_count = ?
           ON CONFLICT(idempotency_key) DO NOTHING`,
        ).bind(outboxId, outboxId, JSON.stringify(ocrMessage(candidate)), now, now, workspaceId, job.id,
          job.source_revision, candidate.revision, candidate.attempt_count),
      ]);
      if (Number(results[0]?.meta.changes ?? 0) > 0) {
        queued.push(attachmentId);
        outboxIds.push(outboxId);
      } else {
        duplicate.push(attachmentId);
      }
    }
    return { queued, ineligible, duplicate, outbox_ids: outboxIds };
  }

  async listPendingOcrOutbox(now: string, limit: number, ids?: string[]) {
    if (ids?.length === 0) return [];
    const idCondition = ids ? `AND id IN (${placeholders(ids.length)})` : "";
    const values: unknown[] = [now];
    if (ids) values.push(...ids);
    values.push(limit);
    const rows = (await this.db.prepare(
      `SELECT id, payload_json FROM queue_outbox
       WHERE job_kind = 'ocr' AND published_at IS NULL AND available_at <= ? ${idCondition}
       ORDER BY created_at, id LIMIT ?`,
    ).bind(...values).all<{ id: string; payload_json: string }>()).results ?? [];
    return rows.map((row) => ({ id: row.id, message: QueueJobSchema.parse(JSON.parse(row.payload_json)) }));
  }

  async markOcrOutboxDispatched(outboxId: string, now: string) {
    await this.db.prepare(
      "UPDATE queue_outbox SET published_at = ?, attempt = attempt + 1 WHERE id = ? AND job_kind = 'ocr' AND published_at IS NULL",
    ).bind(now, outboxId).run();
  }

  async recordOcrOutboxFailure(outboxId: string, now: string) {
    await this.db.prepare(
      "UPDATE queue_outbox SET available_at = ?, attempt = attempt + 1 WHERE id = ? AND job_kind = 'ocr' AND published_at IS NULL",
    ).bind(now, outboxId).run();
  }

  async diagnostics(workspaceId: string, request: KnowledgeDiagnosticsRequest) {
    const cursor = request.cursor ?? "";
    const rows = (await this.db.prepare(
      `SELECT kind, entity_id, title, count, failure_count, ocr_status, latest_error, diagnostic_key FROM (
         SELECT 'unfiled_note' kind, id entity_id, title, 1 count, NULL failure_count, NULL ocr_status, NULL latest_error, 'unfiled_note:' || id diagnostic_key FROM notes WHERE workspace_id = ? AND deleted_at IS NULL AND folder_id IS NULL
         UNION ALL SELECT 'orphan_note', n.id, n.title, 1, NULL, NULL, NULL, 'orphan_note:' || n.id FROM notes n LEFT JOIN folders f ON f.workspace_id = n.workspace_id AND f.id = n.folder_id WHERE n.workspace_id = ? AND n.deleted_at IS NULL AND n.folder_id IS NOT NULL AND f.id IS NULL
         UNION ALL SELECT 'duplicate_title', MIN(id), title, COUNT(*), NULL, NULL, NULL, 'duplicate_title:' || lower(trim(title)) FROM notes WHERE workspace_id = ? AND deleted_at IS NULL AND trim(title) != '' GROUP BY lower(trim(title)) HAVING COUNT(*) > 1
         UNION ALL SELECT 'broken_link', l.id, COALESCE(s.title, ''), 1, NULL, NULL, NULL, 'broken_link:' || l.id FROM note_links l LEFT JOIN notes s ON s.workspace_id = l.workspace_id AND s.id = l.source_note_id LEFT JOIN notes t ON t.workspace_id = l.workspace_id AND t.id = l.target_note_id WHERE l.workspace_id = ? AND (t.id IS NULL OR t.deleted_at IS NOT NULL)
         UNION ALL
         SELECT 'failed_ocr', a.id, a.filename, COUNT(j.id), COUNT(j.id),
           (SELECT latest.status FROM beta_ocr_jobs latest WHERE latest.workspace_id = a.workspace_id AND latest.attachment_id = a.id AND latest.status IN ('failed', 'dead_letter') ORDER BY latest.updated_at DESC, latest.id DESC LIMIT 1),
           CASE (SELECT latest.status FROM beta_ocr_jobs latest WHERE latest.workspace_id = a.workspace_id AND latest.attachment_id = a.id AND latest.status IN ('failed', 'dead_letter') ORDER BY latest.updated_at DESC, latest.id DESC LIMIT 1)
             WHEN 'dead_letter' THEN 'ocr_attempts_exhausted' ELSE 'ocr_failed' END,
           'failed_ocr:' || a.id
         FROM beta_ocr_jobs j JOIN beta_attachments a ON a.workspace_id = j.workspace_id AND a.id = j.attachment_id
         WHERE j.workspace_id = ? AND j.status IN ('failed', 'dead_letter') AND a.status != 'deleted'
         GROUP BY a.workspace_id, a.id, a.filename
       ) WHERE diagnostic_key > ? ORDER BY diagnostic_key LIMIT ?`,
    ).bind(workspaceId, workspaceId, workspaceId, workspaceId, workspaceId, cursor, request.limit + 1).all<{
      kind: "unfiled_note" | "orphan_note" | "duplicate_title" | "broken_link" | "failed_ocr";
      entity_id: string;
      title: string;
      count: number;
      failure_count: number | null;
      ocr_status: "failed" | "dead_letter" | null;
      latest_error: "ocr_failed" | "ocr_attempts_exhausted" | null;
      diagnostic_key: string;
    }>()).results ?? [];
    const page = rows.slice(0, request.limit);
    return {
      items: page.map(({ diagnostic_key: _key, failure_count, ocr_status, latest_error, ...item }) => ({
        ...item,
        ...(item.kind === "failed_ocr" ? { failure_count: failure_count!, ocr_status, latest_error } : {}),
      })) as KnowledgeDiagnostic[],
      nextCursor: rows.length > request.limit ? page.at(-1)?.diagnostic_key ?? null : null,
    };
  }
}
