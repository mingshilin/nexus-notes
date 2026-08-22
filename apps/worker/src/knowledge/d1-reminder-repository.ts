import type { CreateReminderInput, Reminder, UpdateReminderInput } from "@nexus/contracts";

function firstRow(result: D1Result<Reminder> | undefined) {
  return result?.results?.[0] ?? null;
}

export class D1ReminderRepository {
  constructor(
    private readonly db: D1Database,
    private readonly createId: () => string = () => crypto.randomUUID(),
  ) {}

  async createReminder(input: {
    workspaceId: string;
    userId: string;
    input: CreateReminderInput;
    now: string;
  }) {
    const reminder: Reminder = {
      id: this.createId(),
      workspace_id: input.workspaceId,
      note_id: input.input.note_id ?? null,
      user_id: input.userId,
      remind_at: input.input.remind_at,
      status: "pending",
      revision: 1,
      created_at: input.now,
      updated_at: input.now,
    };
    const insert = this.db.prepare(
      `INSERT INTO reminders (
         id, workspace_id, note_id, user_id, remind_at, status, revision, created_at, updated_at
       )
       SELECT ?, ?, ?, ?, ?, 'pending', 1, ?, ?
       WHERE ? IS NULL OR EXISTS (
         SELECT 1 FROM notes WHERE workspace_id = ? AND id = ? AND deleted_at IS NULL
       )
       RETURNING id, workspace_id, note_id, user_id, remind_at, status, revision, created_at, updated_at`,
    ).bind(
      reminder.id,
      reminder.workspace_id,
      reminder.note_id,
      reminder.user_id,
      reminder.remind_at,
      reminder.created_at,
      reminder.updated_at,
      reminder.note_id,
      reminder.workspace_id,
      reminder.note_id,
    );
    const sync = this.db.prepare(
      `INSERT INTO sync_changes (
         workspace_id, entity_type, entity_id, revision, kind, payload_json, created_at
       )
       SELECT workspace_id, 'reminder', id, revision, 'create', ?, ?
       FROM reminders WHERE workspace_id = ? AND user_id = ? AND id = ?`,
    ).bind(JSON.stringify(reminder), input.now, input.workspaceId, input.userId, reminder.id);
    const results = await this.db.batch<Reminder>([insert, sync]);
    return firstRow(results[0]);
  }

  async listReminders(workspaceId: string, userId: string, includeCompleted = false) {
    const result = await this.db.prepare(
      `SELECT id, workspace_id, note_id, user_id, remind_at, status, revision, created_at, updated_at
       FROM reminders
       WHERE workspace_id = ? AND user_id = ? ${includeCompleted ? "" : "AND status = 'pending'"}
       ORDER BY remind_at, id`,
    ).bind(workspaceId, userId).all<Reminder>();
    return result.results ?? [];
  }

  async updateReminder(input: {
    workspaceId: string;
    userId: string;
    reminderId: string;
    baseRevision: number;
    patch: Omit<UpdateReminderInput, "base_revision">;
    now: string;
  }) {
    const assignments: string[] = [];
    const bindings: unknown[] = [];
    if (input.patch.remind_at !== undefined) {
      assignments.push("remind_at = ?");
      bindings.push(input.patch.remind_at);
    }
    if (input.patch.status !== undefined) {
      assignments.push("status = ?");
      bindings.push(input.patch.status);
    }
    const nextRevision = input.baseRevision + 1;
    const update = this.db.prepare(
      `UPDATE reminders
       SET ${assignments.join(", ")}, revision = revision + 1, updated_at = ?
       WHERE workspace_id = ? AND user_id = ? AND id = ? AND revision = ?
       RETURNING id, workspace_id, note_id, user_id, remind_at, status, revision, created_at, updated_at`,
    ).bind(...bindings, input.now, input.workspaceId, input.userId, input.reminderId, input.baseRevision);
    const sync = this.db.prepare(
      `INSERT INTO sync_changes (
         workspace_id, entity_type, entity_id, revision, kind, payload_json, created_at
       )
       SELECT workspace_id, 'reminder', id, revision, 'update', ?, ?
       FROM reminders
       WHERE workspace_id = ? AND user_id = ? AND id = ? AND revision = ? AND updated_at = ?`,
    ).bind(
      JSON.stringify(input.patch),
      input.now,
      input.workspaceId,
      input.userId,
      input.reminderId,
      nextRevision,
      input.now,
    );
    const results = await this.db.batch<Reminder>([update, sync]);
    const reminder = firstRow(results[0]);
    if (reminder) return { reminder, current: null };
    const current = await this.db.prepare(
      `SELECT id, workspace_id, note_id, user_id, remind_at, status, revision, created_at, updated_at
       FROM reminders
       WHERE workspace_id = ? AND user_id = ? AND id = ?
       LIMIT 1`,
    ).bind(input.workspaceId, input.userId, input.reminderId).first<Reminder>();
    return { reminder: null, current: current ?? null };
  }
}
