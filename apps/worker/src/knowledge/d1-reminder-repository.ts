import type { CreateReminderInput, Reminder, ReminderListQuery, UpdateReminderInput } from "@nexus/contracts";
import { reminderLocalAnchor } from "@nexus/domain";

type ReminderRow = Omit<Reminder, "channels" | "recurrence"> & {
  channels_json: string;
  recurrence_json: string | null;
};

const reminderColumns = `
  id, workspace_id, note_id, user_id, remind_at, title, timezone,
  channels_json, recurrence_json, recurrence_anchor_local, occurrence_count,
  delivery_enabled_at, snoozed_until, last_delivered_at, status, revision,
  created_at, updated_at`;

const qualifiedReminderColumns = `
  r.id, r.workspace_id, r.note_id, r.user_id, r.remind_at, r.title, r.timezone,
  r.channels_json, r.recurrence_json, r.recurrence_anchor_local, r.occurrence_count,
  r.delivery_enabled_at, r.snoozed_until, r.last_delivered_at, r.status, r.revision,
  r.created_at, r.updated_at`;

function toReminder(row: ReminderRow): Reminder {
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    note_id: row.note_id,
    user_id: row.user_id,
    remind_at: row.remind_at,
    title: row.title,
    timezone: row.timezone,
    channels: JSON.parse(row.channels_json) as Reminder["channels"],
    recurrence: row.recurrence_json
      ? JSON.parse(row.recurrence_json) as Reminder["recurrence"]
      : null,
    recurrence_anchor_local: row.recurrence_anchor_local,
    occurrence_count: row.occurrence_count,
    delivery_enabled_at: row.delivery_enabled_at,
    snoozed_until: row.snoozed_until,
    last_delivered_at: row.last_delivered_at,
    status: row.status,
    revision: row.revision,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function firstReminder(result: D1Result<ReminderRow> | undefined) {
  const row = result?.results?.[0];
  return row ? toReminder(row) : null;
}

function isSameCreate(input: {
  workspaceId: string;
  userId: string;
  input: CreateReminderInput;
}, existing: Reminder) {
  return existing.workspace_id === input.workspaceId
    && existing.user_id === input.userId
    && existing.note_id === (input.input.note_id ?? null)
    && existing.remind_at === input.input.remind_at
    && existing.title === input.input.title
    && existing.timezone === input.input.timezone
    && JSON.stringify(existing.channels) === JSON.stringify(input.input.channels)
    && JSON.stringify(existing.recurrence) === JSON.stringify(input.input.recurrence);
}

function encodeCursor(reminder: Reminder) {
  return encodeURIComponent(`${reminder.remind_at}|${reminder.id}`);
}

function decodeCursor(cursor: string | undefined) {
  if (!cursor) return null;
  try {
    const [remindAt, id, ...rest] = decodeURIComponent(cursor).split("|");
    if (remindAt && id && rest.length === 0) return { remindAt, id };
  } catch {
    // Convert malformed percent-encoding into the same stable cursor error.
  }
  const error = Object.assign(new Error("INVALID_REMINDER_CURSOR"), {
    code: "INVALID_REMINDER_CURSOR",
    status: 400,
  });
  throw error;
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, "\\$&");
}

export class D1ReminderRepository {
  constructor(
    private readonly db: D1Database,
    private readonly createId: () => string = () => crypto.randomUUID(),
  ) {}

  async createReminder(input: {
    id?: string;
    idempotencyKey?: string;
    workspaceId: string;
    userId: string;
    input: CreateReminderInput;
    now: string;
  }) {
    const id = input.id ?? this.createId();
    if (input.idempotencyKey) {
      const existing = await this.getReminder(input.workspaceId, input.userId, id);
      if (existing) {
        if (isSameCreate(input, existing)) return existing;
        throw new Error("REMINDER_IDEMPOTENCY_CONFLICT");
      }
    }
    const reminder: Reminder = {
      id,
      workspace_id: input.workspaceId,
      note_id: input.input.note_id ?? null,
      user_id: input.userId,
      remind_at: input.input.remind_at,
      title: input.input.title,
      timezone: input.input.timezone,
      channels: input.input.channels,
      recurrence: input.input.recurrence,
      recurrence_anchor_local: input.input.recurrence
        ? reminderLocalAnchor(input.input.remind_at, input.input.timezone)
        : null,
      occurrence_count: 0,
      delivery_enabled_at: input.input.delivery_enabled ? input.now : null,
      snoozed_until: null,
      last_delivered_at: null,
      status: "pending",
      revision: 1,
      created_at: input.now,
      updated_at: input.now,
    };
    const insert = this.db.prepare(
      `INSERT INTO reminders (
         id, workspace_id, note_id, user_id, remind_at, title, timezone,
         channels_json, recurrence_json, recurrence_anchor_local, occurrence_count,
         delivery_enabled_at, snoozed_until, last_delivered_at, status, revision,
         created_at, updated_at
       )
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, NULL, NULL, 'pending', 1, ?, ?
       WHERE ? IS NULL OR EXISTS (
         SELECT 1 FROM notes WHERE workspace_id = ? AND id = ? AND deleted_at IS NULL
       )
       RETURNING ${reminderColumns}`,
    ).bind(
      reminder.id,
      reminder.workspace_id,
      reminder.note_id,
      reminder.user_id,
      reminder.remind_at,
      reminder.title,
      reminder.timezone,
      JSON.stringify(reminder.channels),
      reminder.recurrence ? JSON.stringify(reminder.recurrence) : null,
      reminder.recurrence_anchor_local,
      reminder.delivery_enabled_at,
      reminder.created_at,
      reminder.updated_at,
      reminder.note_id,
      reminder.workspace_id,
      reminder.note_id,
    );
    const sync = this.syncStatement(reminder, "create", input.now);
    try {
      const results = await this.db.batch<ReminderRow>([insert, sync]);
      return firstReminder(results[0]);
    } catch (error) {
      if (input.idempotencyKey) {
        const replay = await this.getReminder(input.workspaceId, input.userId, id);
        if (replay && isSameCreate(input, replay)) return replay;
      }
      throw error;
    }
  }

  async listReminders(workspaceId: string, userId: string, includeCompleted = false) {
    const result = await this.db.prepare(
      `SELECT ${reminderColumns}
       FROM reminders
       WHERE workspace_id = ? AND user_id = ? AND deleted_at IS NULL
         ${includeCompleted ? "" : "AND status = 'pending'"}
       ORDER BY remind_at, id`,
    ).bind(workspaceId, userId).all<ReminderRow>();
    return (result.results ?? []).map(toReminder);
  }

  async listReminderPage(
    workspaceId: string,
    userId: string,
    query: ReminderListQuery,
    now: string,
  ) {
    const conditions = ["r.workspace_id = ?", "r.user_id = ?", "r.deleted_at IS NULL"];
    const bindings: unknown[] = [workspaceId, userId];
    if (query.status === "pending") conditions.push("r.status = 'pending'");
    if (query.status === "completed") conditions.push("r.status IN ('sent', 'dismissed')");
    if (query.status === "overdue") {
      conditions.push("r.status = 'pending'", "r.remind_at < ?");
      bindings.push(now);
    }
    if (query.status === "today") {
      conditions.push("r.status = 'pending'", "date(r.remind_at) = date(?)");
      bindings.push(now);
    }
    if (query.status === "upcoming") {
      conditions.push("r.status = 'pending'", "date(r.remind_at) > date(?)");
      bindings.push(now);
    }
    if (query.query) {
      const pattern = `%${escapeLike(query.query.toLowerCase())}%`;
      conditions.push(`(
        lower(r.title) LIKE ? ESCAPE '\\'
        OR EXISTS (
          SELECT 1 FROM notes n
          WHERE n.workspace_id = r.workspace_id AND n.id = r.note_id
            AND n.deleted_at IS NULL AND lower(n.title) LIKE ? ESCAPE '\\'
        )
      )`);
      bindings.push(pattern, pattern);
    }
    const cursor = decodeCursor(query.cursor);
    if (cursor) {
      conditions.push("(r.remind_at > ? OR (r.remind_at = ? AND r.id > ?))");
      bindings.push(cursor.remindAt, cursor.remindAt, cursor.id);
    }
    const result = await this.db.prepare(
      `SELECT ${qualifiedReminderColumns}
       FROM reminders r
       WHERE ${conditions.join(" AND ")}
       ORDER BY r.remind_at, r.id
       LIMIT ?`,
    ).bind(...bindings, query.limit + 1).all<ReminderRow>();
    const reminders = (result.results ?? []).map(toReminder);
    const items = reminders.slice(0, query.limit);
    return {
      items,
      nextCursor: reminders.length > query.limit && items.length > 0
        ? encodeCursor(items[items.length - 1]!)
        : null,
    };
  }

  async updateReminder(input: {
    workspaceId: string;
    userId: string;
    reminderId: string;
    baseRevision: number;
    patch: Omit<UpdateReminderInput, "base_revision">;
    now: string;
  }) {
    const current = await this.getReminder(input.workspaceId, input.userId, input.reminderId);
    if (!current || current.revision !== input.baseRevision) {
      return { reminder: null, current };
    }

    const next: Reminder = {
      ...current,
      ...input.patch,
      note_id: input.patch.note_id === undefined ? current.note_id : input.patch.note_id,
      recurrence: input.patch.recurrence === undefined ? current.recurrence : input.patch.recurrence,
      channels: input.patch.channels ?? current.channels,
      delivery_enabled_at: input.patch.delivery_enabled === undefined
        ? current.delivery_enabled_at
        : input.patch.delivery_enabled ? input.now : null,
      revision: current.revision + 1,
      updated_at: input.now,
    };
    if (input.patch.recurrence !== undefined || input.patch.remind_at !== undefined || input.patch.timezone !== undefined) {
      next.recurrence_anchor_local = next.recurrence
        ? reminderLocalAnchor(next.remind_at, next.timezone)
        : null;
      next.occurrence_count = 0;
    }

    const update = this.db.prepare(
      `UPDATE reminders
       SET note_id = ?, remind_at = ?, title = ?, timezone = ?, channels_json = ?,
           recurrence_json = ?, recurrence_anchor_local = ?, occurrence_count = ?,
           delivery_enabled_at = ?, status = ?, revision = revision + 1, updated_at = ?
       WHERE workspace_id = ? AND user_id = ? AND id = ? AND revision = ? AND deleted_at IS NULL
         AND (? IS NULL OR EXISTS (
           SELECT 1 FROM notes WHERE workspace_id = ? AND id = ? AND deleted_at IS NULL
         ))
       RETURNING ${reminderColumns}`,
    ).bind(
      next.note_id,
      next.remind_at,
      next.title,
      next.timezone,
      JSON.stringify(next.channels),
      next.recurrence ? JSON.stringify(next.recurrence) : null,
      next.recurrence_anchor_local,
      next.occurrence_count,
      next.delivery_enabled_at,
      next.status,
      next.updated_at,
      next.workspace_id,
      next.user_id,
      next.id,
      current.revision,
      next.note_id,
      next.workspace_id,
      next.note_id,
    );
    const results = await this.db.batch<ReminderRow>([
      update,
      this.syncStatement(next, "update", input.now),
    ]);
    const reminder = firstReminder(results[0]);
    if (reminder) return { reminder, current: null };
    return {
      reminder: null,
      current: await this.getReminder(input.workspaceId, input.userId, input.reminderId),
    };
  }

  async snoozeReminder(input: {
    workspaceId: string;
    userId: string;
    reminderId: string;
    baseRevision: number;
    minutes: number;
    now: string;
  }) {
    const snoozedUntil = new Date(Date.parse(input.now) + input.minutes * 60_000).toISOString();
    const update = this.db.prepare(
      `UPDATE reminders
       SET remind_at = ?, snoozed_until = ?, status = 'pending', revision = revision + 1, updated_at = ?
       WHERE workspace_id = ? AND user_id = ? AND id = ? AND revision = ? AND deleted_at IS NULL
       RETURNING ${reminderColumns}`,
    ).bind(
      snoozedUntil,
      snoozedUntil,
      input.now,
      input.workspaceId,
      input.userId,
      input.reminderId,
      input.baseRevision,
    );
    const results = await this.db.batch<ReminderRow>([update]);
    const reminder = firstReminder(results[0]);
    if (reminder) return { reminder, current: null };
    return {
      reminder: null,
      current: await this.getReminder(input.workspaceId, input.userId, input.reminderId),
    };
  }

  async deleteReminder(input: {
    workspaceId: string;
    userId: string;
    reminderId: string;
    baseRevision: number;
    now: string;
  }) {
    const result = await this.db.prepare(
      `UPDATE reminders
       SET deleted_at = ?, revision = revision + 1, updated_at = ?
       WHERE workspace_id = ? AND user_id = ? AND id = ? AND revision = ? AND deleted_at IS NULL`,
    ).bind(
      input.now,
      input.now,
      input.workspaceId,
      input.userId,
      input.reminderId,
      input.baseRevision,
    ).run();
    return (result.meta.changes ?? 0) === 1;
  }

  async getReminder(workspaceId: string, userId: string, reminderId: string) {
    const row = await this.db.prepare(
      `SELECT ${reminderColumns}
       FROM reminders
       WHERE workspace_id = ? AND user_id = ? AND id = ? AND deleted_at IS NULL
       LIMIT 1`,
    ).bind(workspaceId, userId, reminderId).first<ReminderRow>();
    return row ? toReminder(row) : null;
  }

  private syncStatement(reminder: Reminder, kind: "create" | "update", now: string) {
    return this.db.prepare(
      `INSERT INTO sync_changes (
         workspace_id, entity_type, entity_id, revision, kind, payload_json, created_at
       )
       SELECT workspace_id, 'reminder', id, revision, ?, ?, ?
       FROM reminders
       WHERE workspace_id = ? AND user_id = ? AND id = ? AND revision = ? AND updated_at = ?`,
    ).bind(
      kind,
      JSON.stringify(reminder),
      now,
      reminder.workspace_id,
      reminder.user_id,
      reminder.id,
      reminder.revision,
      reminder.updated_at,
    );
  }
}
