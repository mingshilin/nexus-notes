import { HttpError, jsonSuccess, parseJson } from "../http";
import { getDailyNoteByDate, getNoteById, insertNote } from "../db/queries";

function parseJsonArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function parseObject(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

async function insertActivity(db: D1Database, payload: { workspaceId: string; actorUserId: string; action: string; entityType: string; entityId: string; metadata?: unknown; audit?: boolean }) {
  const metadata = JSON.stringify(payload.metadata ?? {});
  await db
    .prepare(`INSERT INTO activity_logs (id, workspace_id, actor_user_id, action, entity_type, entity_id, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), payload.workspaceId, payload.actorUserId, payload.action, payload.entityType, payload.entityId, metadata)
    .run();
  if (payload.audit) {
    await db
      .prepare(`INSERT INTO audit_logs (id, workspace_id, actor_user_id, action, entity_type, entity_id, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), payload.workspaceId, payload.actorUserId, payload.action, payload.entityType, payload.entityId, metadata)
      .run();
  }
}

export async function handleListNotifications(db: D1Database, workspaceId: string, userId: string) {
  const result = await db
    .prepare(`SELECT id, workspace_id, user_id, type, title, body, entity_type, entity_id, read_at, created_at FROM notifications WHERE workspace_id = ? AND user_id = ? ORDER BY read_at IS NOT NULL ASC, created_at DESC LIMIT 80`)
    .bind(workspaceId, userId)
    .all();
  return jsonSuccess(result.results);
}

export async function handleMarkNotificationRead(db: D1Database, workspaceId: string, userId: string, notificationId: string) {
  await db
    .prepare(`UPDATE notifications SET read_at = COALESCE(read_at, datetime('now')) WHERE workspace_id = ? AND user_id = ? AND id = ?`)
    .bind(workspaceId, userId, notificationId)
    .run();
  return handleListNotifications(db, workspaceId, userId);
}

export async function handleMarkAllNotificationsRead(db: D1Database, workspaceId: string, userId: string) {
  await db
    .prepare(`UPDATE notifications SET read_at = COALESCE(read_at, datetime('now')) WHERE workspace_id = ? AND user_id = ? AND read_at IS NULL`)
    .bind(workspaceId, userId)
    .run();
  return handleListNotifications(db, workspaceId, userId);
}

export async function handleListAttachmentCenter(db: D1Database, workspaceId: string, request: Request) {
  const params = new URL(request.url).searchParams;
  const q = params.get("q")?.trim();
  const type = params.get("type")?.trim();
  const status = params.get("status")?.trim();
  const noteId = params.get("noteId")?.trim();
  const from = params.get("from")?.trim();
  const to = params.get("to")?.trim();
  const clauses = [`a.workspace_id = ?`];
  const bindings: unknown[] = [workspaceId];
  if (q) {
    clauses.push(`(a.file_name LIKE ? OR a.mime_type LIKE ? OR a.ocr_text LIKE ? OR n.title LIKE ?)`);
    bindings.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (type === "image") clauses.push(`a.mime_type LIKE 'image/%'`);
  if (type === "pdf") clauses.push(`a.mime_type = 'application/pdf'`);
  if (type === "other") clauses.push(`a.mime_type NOT LIKE 'image/%' AND a.mime_type <> 'application/pdf'`);
  if (status && ["pending", "processing", "ready", "failed", "unsupported"].includes(status)) {
    clauses.push(`COALESCE(a.ocr_status, 'pending') = ?`);
    bindings.push(status);
  }
  if (noteId) {
    clauses.push(`a.note_id = ?`);
    bindings.push(noteId);
  }
  if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) {
    clauses.push(`date(a.created_at) >= date(?)`);
    bindings.push(from);
  }
  if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) {
    clauses.push(`date(a.created_at) <= date(?)`);
    bindings.push(to);
  }
  const result = await db
    .prepare(
      `SELECT a.id, a.note_id, a.workspace_id, a.uploader_id, a.storage_key, a.file_name, a.mime_type, a.size, a.created_at,
              a.ocr_text, a.ocr_status, a.ocr_updated_at, n.title AS note_title
       FROM note_attachments a
       LEFT JOIN notes n ON n.id = a.note_id AND n.workspace_id = a.workspace_id
       WHERE ${clauses.join(" AND ")}
       ORDER BY a.created_at DESC
       LIMIT 200`,
    )
    .bind(...bindings)
    .all();
  return jsonSuccess(result.results);
}

export async function handleRunAttachmentOcr(db: D1Database, workspaceId: string, attachmentId: string, request: Request) {
  const body = await parseJson<{ text?: string; status?: string; error?: string }>(request);
  const attachment = await db
    .prepare(`SELECT id, file_name, mime_type FROM note_attachments WHERE workspace_id = ? AND id = ?`)
    .bind(workspaceId, attachmentId)
    .first<{ id: string; file_name: string; mime_type: string }>();
  if (!attachment) throw new HttpError(404, "NOT_FOUND", "attachment not found");
  const supported = attachment.mime_type.startsWith("image/") || attachment.mime_type === "application/pdf";
  const requestedStatus = body.status;
  const text = (body.text ?? "").trim();
  const error = (body.error ?? "").trim();
  const nextStatus = !supported
    ? "unsupported"
    : requestedStatus === "processing"
      ? "processing"
      : requestedStatus === "failed"
        ? "failed"
        : "ready";
  const nextText = nextStatus === "failed" ? error || text || `OCR failed: ${attachment.file_name}` : text || (nextStatus === "processing" ? "" : `OCR queued: ${attachment.file_name}`);
  await db
    .prepare(`UPDATE note_attachments SET ocr_status = ?, ocr_text = ?, ocr_updated_at = datetime('now') WHERE workspace_id = ? AND id = ?`)
    .bind(nextStatus, nextText, workspaceId, attachmentId)
    .run();
  const row = await db
    .prepare(`SELECT id, note_id, workspace_id, uploader_id, storage_key, file_name, mime_type, size, created_at, ocr_text, ocr_status, ocr_updated_at FROM note_attachments WHERE workspace_id = ? AND id = ?`)
    .bind(workspaceId, attachmentId)
    .first();
  return jsonSuccess(row);
}

export async function handleClipperCapture(db: D1Database, userId: string, workspaceId: string, request: Request) {
  const body = await parseJson<{ title?: string; url?: string; content?: string; target?: "inbox" | "daily" | "database"; database_id?: string | null }>(request);
  const title = (body.title ?? body.url ?? "Web Clip").trim().slice(0, 180);
  const source = body.url?.trim();
  const content = [source ? `Source: ${source}` : "", body.content ?? ""].filter(Boolean).join("\n\n");

  if (body.target === "daily") {
    const date = new Date().toISOString().slice(0, 10);
    const daily = await getDailyNoteByDate(db, userId, workspaceId, date);
    if (daily) {
      await db.prepare(`UPDATE notes SET content = content || ?, updated_at = datetime('now') WHERE workspace_id = ? AND id = ?`).bind(`\n\n## ${title}\n\n${content}`, workspaceId, daily.id).run();
      const updated = await getNoteById(db, userId, workspaceId, daily.id);
      if (!updated) throw new HttpError(500, "INTERNAL_ERROR", "failed to update daily note");
      await insertActivity(db, { workspaceId, actorUserId: userId, action: "clipper.capture", entityType: "note", entityId: updated.id, metadata: { target: "daily", url: source } });
      return jsonSuccess(updated, { status: 201 });
    }
  }

  const noteId = crypto.randomUUID();
  await insertNote(db, userId, workspaceId, {
    id: noteId,
    title,
    content,
    isFavorite: false,
    folderId: null,
    databaseId: body.target === "database" ? body.database_id ?? null : null,
  });
  await insertActivity(db, { workspaceId, actorUserId: userId, action: "clipper.capture", entityType: "note", entityId: noteId, metadata: { target: body.target ?? "inbox", url: source } });
  const note = await getNoteById(db, userId, workspaceId, noteId);
  if (!note) throw new HttpError(500, "INTERNAL_ERROR", "failed to create clip");
  return jsonSuccess(note, { status: 201 });
}

export async function handleImportMarkdown(db: D1Database, userId: string, workspaceId: string, request: Request) {
  const body = await parseJson<{ items?: Array<{ title?: string; content?: string }> }>(request);
  const items = (body.items ?? []).slice(0, 100);
  if (items.length === 0) throw new HttpError(400, "VALIDATION_ERROR", "items are required");
  const notes = [];
  const warnings: string[] = [];
  for (const item of items) {
    const title = (item.title ?? "Imported note").trim().slice(0, 180) || "Imported note";
    const existing = await db
      .prepare(`SELECT id FROM notes WHERE workspace_id = ? AND deleted_at IS NULL AND lower(title) = lower(?) LIMIT 1`)
      .bind(workspaceId, title)
      .first<{ id: string }>();
    if (existing) warnings.push(`duplicate title: ${title}`);
    const noteId = crypto.randomUUID();
    await insertNote(db, userId, workspaceId, {
      id: noteId,
      title,
      content: item.content ?? "",
      isFavorite: false,
      folderId: null,
    });
    const note = await getNoteById(db, userId, workspaceId, noteId);
    if (note) notes.push(note);
  }
  const jobId = crypto.randomUUID();
  await db
    .prepare(`INSERT INTO import_jobs (id, workspace_id, created_by_user_id, source_type, status, imported_count, warning_json) VALUES (?, ?, ?, 'markdown', 'completed', ?, ?)`)
    .bind(jobId, workspaceId, userId, notes.length, JSON.stringify(warnings))
    .run();
  await insertActivity(db, { workspaceId, actorUserId: userId, action: "import.markdown", entityType: "import_job", entityId: jobId, metadata: { imported_count: notes.length }, audit: true });
  const job = await getImportJob(db, workspaceId, jobId);
  return jsonSuccess({ job, notes }, { status: 201 });
}

async function getImportJob(db: D1Database, workspaceId: string, jobId: string) {
  const row = await db.prepare(`SELECT * FROM import_jobs WHERE workspace_id = ? AND id = ?`).bind(workspaceId, jobId).first<Record<string, unknown> & { warning_json?: string }>();
  return row ? { ...row, warnings: parseJsonArray(row.warning_json ?? null) } : null;
}

export async function handleListImportJobs(db: D1Database, workspaceId: string) {
  const result = await db.prepare(`SELECT * FROM import_jobs WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 50`).bind(workspaceId).all<Record<string, unknown> & { warning_json?: string }>();
  return jsonSuccess(result.results.map((row) => ({ ...row, warnings: parseJsonArray(row.warning_json ?? null) })));
}

export async function handleListOfflineDrafts(db: D1Database, workspaceId: string, userId: string) {
  const result = await db.prepare(`SELECT * FROM offline_drafts WHERE workspace_id = ? AND user_id = ? ORDER BY updated_at DESC LIMIT 100`).bind(workspaceId, userId).all();
  return jsonSuccess(result.results);
}

export async function handleSaveOfflineDraft(db: D1Database, workspaceId: string, userId: string, request: Request) {
  const body = await parseJson<{ id?: string; note_id?: string | null; title?: string; content?: string }>(request);
  const id = body.id?.trim() || crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO offline_drafts (id, workspace_id, user_id, note_id, title, content, status)
       VALUES (?, ?, ?, ?, ?, ?, 'pending')
       ON CONFLICT(id) DO UPDATE SET note_id = excluded.note_id, title = excluded.title, content = excluded.content, status = 'pending', updated_at = datetime('now')`,
    )
    .bind(id, workspaceId, userId, body.note_id ?? null, (body.title ?? "").slice(0, 180), body.content ?? "")
    .run();
  return handleListOfflineDrafts(db, workspaceId, userId);
}

export async function handleSyncOfflineDraft(db: D1Database, workspaceId: string, userId: string, draftId: string) {
  const draft = await db.prepare(`SELECT * FROM offline_drafts WHERE workspace_id = ? AND user_id = ? AND id = ?`).bind(workspaceId, userId, draftId).first<{ note_id: string | null; title: string; content: string; updated_at: string }>();
  if (!draft) throw new HttpError(404, "NOT_FOUND", "draft not found");
  let noteId = draft.note_id;
  if (noteId) {
    const target = await getNoteById(db, userId, workspaceId, noteId, true);
    if (!target) throw new HttpError(404, "NOT_FOUND", "target note not found");
    if (new Date(target.updated_at).getTime() > new Date(draft.updated_at).getTime()) {
      throw new HttpError(409, "CONFLICT", "target note changed after this draft was saved");
    }
    await db.prepare(`UPDATE notes SET title = ?, content = ?, updated_at = datetime('now') WHERE workspace_id = ? AND id = ?`).bind(draft.title, draft.content, workspaceId, noteId).run();
  } else {
    noteId = crypto.randomUUID();
    await insertNote(db, userId, workspaceId, { id: noteId, title: draft.title || "Offline draft", content: draft.content, isFavorite: false, folderId: null });
  }
  await db.prepare(`UPDATE offline_drafts SET status = 'synced', note_id = ?, synced_at = datetime('now'), updated_at = datetime('now') WHERE workspace_id = ? AND user_id = ? AND id = ?`).bind(noteId, workspaceId, userId, draftId).run();
  const note = await getNoteById(db, userId, workspaceId, noteId);
  if (!note) throw new HttpError(500, "INTERNAL_ERROR", "failed to sync draft");
  return jsonSuccess(note);
}

export async function handleCalendarFeed(db: D1Database, userId: string, workspaceId: string) {
  const reminders = await db.prepare(`SELECT id, note_id, title, due_at FROM reminders WHERE workspace_id = ? AND completed_at IS NULL ORDER BY due_at ASC LIMIT 100`).bind(workspaceId).all();
  const daily = await db.prepare(`SELECT id, title, daily_date FROM notes WHERE workspace_id = ? AND is_daily = 1 AND deleted_at IS NULL ORDER BY daily_date DESC LIMIT 100`).bind(workspaceId).all();
  const databaseDates = await db
    .prepare(
      `SELECT n.id, n.title, npv.value_date AS date
       FROM note_property_values npv
       JOIN database_properties dp ON dp.id = npv.property_id AND dp.type = 'date'
       JOIN notes n ON n.id = npv.note_id AND n.workspace_id = ?
       WHERE npv.value_date IS NOT NULL AND n.deleted_at IS NULL
       ORDER BY npv.value_date ASC
       LIMIT 120`,
    )
    .bind(workspaceId)
    .all();
  return jsonSuccess({
    reminders: reminders.results,
    daily: daily.results,
    database_dates: databaseDates.results,
    user_id: userId,
  });
}
