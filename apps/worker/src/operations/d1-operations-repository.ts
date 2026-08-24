import {
  FeedbackSchema,
  JobSchema,
  QueueJobSchema,
  type CreateJobInput,
  type CancelJobInput,
  type Feedback,
  type FeedbackInput,
  type Job,
  type Usage,
  type WorkspaceContext,
} from "@nexus/contracts";
import { D1NoteRepository } from "../notes/d1-note-repository";

interface JobRow extends Job {
  user_id: string;
  idempotency_key: string;
  payload_json: string;
  result_key: string | null;
}

interface FeedbackRow extends Feedback {
  body: string;
}

function toJob(row: JobRow): Job {
  return JobSchema.parse({
    id: row.id,
    workspace_id: row.workspace_id,
    kind: row.kind,
    status: row.status,
    revision: row.revision,
    error_code: row.error_code,
    created_at: row.created_at,
    updated_at: row.updated_at,
  });
}

function toFeedback(row: FeedbackRow): Feedback {
  return FeedbackSchema.parse({
    id: row.id,
    workspace_id: row.workspace_id,
    user_id: row.user_id,
    category: row.category,
    body: row.body,
    status: row.status,
    request_id: row.request_id,
    revision: row.revision,
    created_at: row.created_at,
    updated_at: row.updated_at,
  });
}

function jobRowQuery() {
  return `SELECT id, workspace_id, user_id, kind, idempotency_key, status, payload_json,
    error_code, result_key, revision, created_at, updated_at FROM beta_jobs`;
}

export class D1OperationsRepository {
  private readonly notes: Pick<D1NoteRepository, "listNotes">;

  constructor(
    private readonly db: D1Database,
    private readonly createId: () => string = () => crypto.randomUUID(),
    notes: Pick<D1NoteRepository, "listNotes"> = new D1NoteRepository(db),
  ) {
    this.notes = notes;
  }

  async createJob(context: Pick<WorkspaceContext, "workspaceId" | "userId">, input: CreateJobInput, now: string) {
    const existing = await this.db.prepare(
      `${jobRowQuery()} WHERE workspace_id = ? AND idempotency_key = ?`,
    ).bind(context.workspaceId, input.idempotency_key).first<JobRow>();
    if (existing) return toJob(existing);

    const id = this.createId();
    const deadline = new Date(Date.parse(now) + 15 * 60_000).toISOString();
    const queueIdempotencyKey = `operations:${context.workspaceId}:${input.idempotency_key}`;
    const message = QueueJobSchema.parse({
      job_id: id,
      kind: input.kind,
      idempotency_key: queueIdempotencyKey,
      attempt: 1,
      deadline,
      payload: { workspace_id: context.workspaceId, user_id: context.userId, ...input.payload },
    });

    await this.db.prepare(
      `INSERT INTO beta_jobs
       (id, workspace_id, user_id, kind, idempotency_key, status, payload_json, revision, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'queued', ?, 1, ?, ?)
       ON CONFLICT(workspace_id, idempotency_key) DO NOTHING`,
    ).bind(id, context.workspaceId, context.userId, input.kind, input.idempotency_key, JSON.stringify(input.payload), now, now).run();

    const row = await this.db.prepare(
      `${jobRowQuery()} WHERE workspace_id = ? AND idempotency_key = ?`,
    ).bind(context.workspaceId, input.idempotency_key).first<JobRow>();
    if (!row) throw new Error("JOB_CREATE_FAILED");

    await this.db.prepare(
      `INSERT INTO queue_outbox (id, workspace_id, job_kind, idempotency_key, payload_json, available_at, published_at, attempt, created_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, 0, ?)
       ON CONFLICT(idempotency_key) DO NOTHING`,
    ).bind(`job-outbox:${context.workspaceId}:${row.id}`, context.workspaceId, input.kind, message.idempotency_key, JSON.stringify({ ...message, job_id: row.id }), now, now).run();
    return toJob(row);
  }

  async getJob(workspaceId: string, jobId: string) {
    const row = await this.db.prepare(`${jobRowQuery()} WHERE workspace_id = ? AND id = ?`).bind(workspaceId, jobId).first<JobRow>();
    return row ? toJob(row) : null;
  }

  async cancelJob(context: Pick<WorkspaceContext, "workspaceId">, jobId: string, input: CancelJobInput, now: string) {
    const result = await this.db.prepare(
      `UPDATE beta_jobs
       SET status = 'cancelled', revision = revision + 1, updated_at = ?
       WHERE workspace_id = ? AND id = ? AND status = 'queued' AND revision = ?`,
    ).bind(now, context.workspaceId, jobId, input.base_revision).run();
    if (Number(result.meta?.changes ?? 0) === 0) return null;
    return this.getJob(context.workspaceId, jobId);
  }

  async claimJob(job: import("@nexus/contracts").QueueJob, now: string, _nativeAttempts: number) {
    const workspaceId = typeof job.payload.workspace_id === "string" ? job.payload.workspace_id : null;
    if (!workspaceId || job.kind === "ocr") return null;
    const row = await this.db.prepare(
      `UPDATE beta_jobs
       SET status = 'running', revision = revision + 1, updated_at = ?
       WHERE id = ? AND workspace_id = ? AND kind = ? AND status = 'queued'
       RETURNING id, workspace_id, user_id, kind`,
    ).bind(now, job.job_id, workspaceId, job.kind).first<{
      id: string;
      workspace_id: string;
      user_id: string;
      kind: "index" | "import" | "export" | "email";
    }>();
    return row ?? null;
  }

  async completeJob(workspaceId: string, jobId: string, resultKey: string | null, now: string) {
    const result = await this.db.prepare(
      `UPDATE beta_jobs
       SET status = 'complete', result_key = ?, error_code = NULL, revision = revision + 1, updated_at = ?
       WHERE workspace_id = ? AND id = ? AND status = 'running'`,
    ).bind(resultKey, now, workspaceId, jobId).run();
    return Number(result.meta?.changes ?? 0) > 0;
  }

  async failJob(workspaceId: string, jobId: string, code: string, now: string) {
    const result = await this.db.prepare(
      `UPDATE beta_jobs
       SET status = 'failed', result_key = NULL, error_code = ?, revision = revision + 1, updated_at = ?
       WHERE workspace_id = ? AND id = ? AND status = 'running'`,
    ).bind(code.slice(0, 128), now, workspaceId, jobId).run();
    return Number(result.meta?.changes ?? 0) > 0;
  }

  async getJobFile(workspaceId: string, jobId: string) {
    const row = await this.db.prepare(
      `SELECT result_key FROM beta_jobs
       WHERE workspace_id = ? AND id = ? AND kind = 'export' AND status = 'complete' AND result_key IS NOT NULL
       LIMIT 1`,
    ).bind(workspaceId, jobId).first<{ result_key: string }>();
    return row?.result_key ?? null;
  }

  listNotes(input: { workspaceId: string; cursor?: string; limit: number }) {
    return this.notes.listNotes(input);
  }

  async listJobs(workspaceId: string, limit = 50) {
    const rows = (await this.db.prepare(
      `${jobRowQuery()} WHERE workspace_id = ? ORDER BY updated_at DESC, id DESC LIMIT ?`,
    ).bind(workspaceId, Math.min(Math.max(limit, 1), 100)).all<JobRow>()).results ?? [];
    return rows.map(toJob);
  }

  async createFeedback(context: Pick<WorkspaceContext, "workspaceId" | "userId">, input: FeedbackInput, requestId: string, now: string) {
    const id = this.createId();
    await this.db.prepare(
      `INSERT INTO feedback_items
       (id, workspace_id, user_id, category, body, status, request_id, revision, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'open', ?, 1, ?, ?)`,
    ).bind(id, context.workspaceId, context.userId, input.category, input.body, requestId, now, now).run();
    const row = await this.db.prepare(
      `SELECT id, workspace_id, user_id, category, body, status, request_id, revision, created_at, updated_at
       FROM feedback_items WHERE workspace_id = ? AND id = ?`,
    ).bind(context.workspaceId, id).first<FeedbackRow>();
    if (!row) throw new Error("FEEDBACK_CREATE_FAILED");
    return toFeedback(row);
  }

  async getFeedback(workspaceId: string, feedbackId: string) {
    const row = await this.db.prepare(
      `SELECT id, workspace_id, user_id, category, body, status, request_id, revision, created_at, updated_at
       FROM feedback_items WHERE workspace_id = ? AND id = ?`,
    ).bind(workspaceId, feedbackId).first<FeedbackRow>();
    return row ? toFeedback(row) : null;
  }

  async listFeedback(workspaceId: string, limit = 50) {
    const rows = (await this.db.prepare(
      `SELECT id, workspace_id, user_id, category, body, status, request_id, revision, created_at, updated_at
       FROM feedback_items WHERE workspace_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`,
    ).bind(workspaceId, Math.min(Math.max(limit, 1), 100)).all<FeedbackRow>()).results ?? [];
    return rows.map(toFeedback);
  }

  async getUsage(workspaceId: string): Promise<Usage> {
    const results = await this.db.batch([
      this.db.prepare("SELECT COUNT(*) AS value FROM notes WHERE workspace_id = ? AND deleted_at IS NULL").bind(workspaceId),
      this.db.prepare("SELECT COUNT(*) AS value FROM databases WHERE workspace_id = ?").bind(workspaceId),
      this.db.prepare("SELECT COALESCE(SUM(size_bytes), 0) AS value FROM beta_attachments WHERE workspace_id = ? AND status != 'deleted'").bind(workspaceId),
      this.db.prepare("SELECT COUNT(*) AS value FROM beta_jobs WHERE workspace_id = ? AND status IN ('queued', 'running')").bind(workspaceId),
    ]);
    return {
      notes: Number((results[0]?.results?.[0] as { value?: number } | undefined)?.value ?? 0),
      databases: Number((results[1]?.results?.[0] as { value?: number } | undefined)?.value ?? 0),
      attachment_bytes: Number((results[2]?.results?.[0] as { value?: number } | undefined)?.value ?? 0),
      queued_jobs: Number((results[3]?.results?.[0] as { value?: number } | undefined)?.value ?? 0),
    };
  }

  async listPendingOutbox(now: string, limit: number) {
    const rows = (await this.db.prepare(
      `SELECT id, payload_json, attempt FROM queue_outbox
       WHERE job_kind IN ('index', 'import', 'export', 'email') AND published_at IS NULL AND available_at <= ?
       ORDER BY created_at, id LIMIT ?`,
    ).bind(now, Math.min(Math.max(limit, 1), 100)).all<{ id: string; payload_json: string; attempt: number }>()).results ?? [];
    return rows.map((row) => ({ id: row.id, attempt: row.attempt, message: QueueJobSchema.parse(JSON.parse(row.payload_json)) }));
  }

  async markOutboxDispatched(outboxId: string, now: string) {
    await this.db.prepare(
      "UPDATE queue_outbox SET published_at = ?, attempt = attempt + 1 WHERE id = ? AND job_kind IN ('index', 'import', 'export', 'email') AND published_at IS NULL",
    ).bind(now, outboxId).run();
  }

  async recordOutboxFailure(outboxId: string, _now: string, retryAt: string) {
    await this.db.prepare(
      "UPDATE queue_outbox SET available_at = ?, attempt = attempt + 1 WHERE id = ? AND job_kind IN ('index', 'import', 'export', 'email') AND published_at IS NULL",
    ).bind(retryAt, outboxId).run();
  }
}
