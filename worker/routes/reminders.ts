import { HttpError, jsonSuccess, okMessage, parseJson } from "../http";
import {
  deleteReminderById,
  getReminderById,
  getUserById,
  insertReminder,
  listDueRemindersForNotification,
  listReminders,
  updateReminderById,
} from "../db/queries";
import { sendEmailByResend } from "../mail";

interface ReminderBody {
  note_id?: string | null;
  title?: string;
  description?: string;
  due_at?: string;
}

function normalizeReminder(row: Awaited<ReturnType<typeof getReminderById>>) {
  if (!row) return null;
  return {
    id: row.id,
    user_id: row.user_id,
    workspace_id: row.workspace_id,
    note_id: row.note_id,
    note_title: row.note_title ?? null,
    title: row.title,
    description: row.description,
    due_at: row.due_at,
    completed_at: row.completed_at,
    notified_at: row.notified_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function validateDueAt(dueAt: string | undefined) {
  if (!dueAt) throw new HttpError(400, "VALIDATION_ERROR", "due_at is required");
  const parsed = new Date(dueAt);
  if (Number.isNaN(parsed.getTime())) throw new HttpError(400, "VALIDATION_ERROR", "due_at is invalid");
  return parsed.toISOString();
}

export async function handleListReminders(db: D1Database, userId: string, workspaceId: string, request: Request) {
  const url = new URL(request.url);
  const dueOnly = url.searchParams.get("due") === "true";
  const includeCompleted = url.searchParams.get("includeCompleted") === "true";
  const reminders = await listReminders(db, userId, workspaceId, { dueOnly, includeCompleted });
  return jsonSuccess(reminders.map((row) => normalizeReminder(row)));
}

export async function handleCreateReminder(db: D1Database, userId: string, workspaceId: string, request: Request) {
  const body = await parseJson<ReminderBody>(request);
  const title = body.title?.trim();
  const description = body.description?.trim() ?? "";
  if (!title) throw new HttpError(400, "VALIDATION_ERROR", "title is required");
  if (title.length > 160) throw new HttpError(400, "VALIDATION_ERROR", "title length must be <= 160");
  if (description.length > 500) throw new HttpError(400, "VALIDATION_ERROR", "description length must be <= 500");
  const dueAt = validateDueAt(body.due_at);
  const reminderId = crypto.randomUUID();
  await insertReminder(db, {
    id: reminderId,
    userId,
    workspaceId,
    noteId: body.note_id ?? null,
    title,
    description,
    dueAt,
  });
  const created = await getReminderById(db, userId, workspaceId, reminderId);
  if (!created) throw new HttpError(500, "INTERNAL_ERROR", "failed to create reminder");
  return jsonSuccess(normalizeReminder(created), { status: 201 });
}

export async function handleUpdateReminder(
  db: D1Database,
  userId: string,
  workspaceId: string,
  reminderId: string,
  request: Request,
) {
  const existing = await getReminderById(db, userId, workspaceId, reminderId);
  if (!existing) throw new HttpError(404, "NOT_FOUND", "reminder not found");
  const body = await parseJson<ReminderBody>(request);
  const title = body.title === undefined ? undefined : body.title.trim();
  const description = body.description === undefined ? undefined : body.description.trim();
  if (title !== undefined && title.length === 0) throw new HttpError(400, "VALIDATION_ERROR", "title is required");
  if (title !== undefined && title.length > 160) throw new HttpError(400, "VALIDATION_ERROR", "title length must be <= 160");
  if (description !== undefined && description.length > 500) throw new HttpError(400, "VALIDATION_ERROR", "description length must be <= 500");
  await updateReminderById(db, userId, workspaceId, reminderId, {
    noteId: body.note_id,
    title,
    description,
    dueAt: body.due_at === undefined ? undefined : validateDueAt(body.due_at),
    notifiedAt: null,
  });
  const updated = await getReminderById(db, userId, workspaceId, reminderId);
  if (!updated) throw new HttpError(404, "NOT_FOUND", "reminder not found");
  return jsonSuccess(normalizeReminder(updated));
}

export async function handleDeleteReminder(db: D1Database, userId: string, workspaceId: string, reminderId: string) {
  const existing = await getReminderById(db, userId, workspaceId, reminderId);
  if (!existing) throw new HttpError(404, "NOT_FOUND", "reminder not found");
  await deleteReminderById(db, userId, workspaceId, reminderId);
  return okMessage(reminderId);
}

export async function handleCompleteReminder(db: D1Database, userId: string, workspaceId: string, reminderId: string) {
  const existing = await getReminderById(db, userId, workspaceId, reminderId);
  if (!existing) throw new HttpError(404, "NOT_FOUND", "reminder not found");
  await updateReminderById(db, userId, workspaceId, reminderId, {
    completedAt: existing.completed_at ? null : new Date().toISOString(),
  });
  const updated = await getReminderById(db, userId, workspaceId, reminderId);
  if (!updated) throw new HttpError(404, "NOT_FOUND", "reminder not found");
  return jsonSuccess(normalizeReminder(updated));
}

export async function handleSendDueReminderEmails(
  db: D1Database,
  env: { RESEND_API_KEY?: string; EMAIL_FROM?: string; APP_BASE_URL?: string },
) {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) return;
  const dueReminders = await listDueRemindersForNotification(db);
  for (const reminder of dueReminders) {
    const user = await getUserById(db, reminder.user_id);
    if (!user?.email) continue;
    const noteLabel = reminder.note_title ? `<p>关联笔记：${reminder.note_title}</p>` : "";
    const appLink = env.APP_BASE_URL ? `<p><a href="${env.APP_BASE_URL}">打开 Nexus Notes</a></p>` : "";
    await sendEmailByResend({
      apiKey: env.RESEND_API_KEY,
      from: env.EMAIL_FROM,
      to: user.email,
      subject: `Nexus Notes 提醒：${reminder.title}`,
      html: `
        <h2>你的提醒已到期</h2>
        <p><strong>${reminder.title}</strong></p>
        <p>${reminder.description || "没有补充说明"}</p>
        <p>到期时间：${reminder.due_at}</p>
        ${noteLabel}
        ${appLink}
      `,
    });
    await updateReminderById(db, reminder.user_id, reminder.workspace_id, reminder.id, {
      notifiedAt: new Date().toISOString(),
    });
  }
}
