import type { QueueJob, ReminderChannel, ReminderRecurrence } from "@nexus/contracts";
import { nextReminderOccurrence } from "@nexus/domain";

interface DueReminderRow {
  id: string;
  workspace_id: string;
  user_id: string;
  remind_at: string;
  title: string;
  timezone: string;
  channels_json: string;
  recurrence_json: string | null;
  recurrence_anchor_local: string | null;
  occurrence_count: number;
  in_app_reminders: number;
  email_reminders: number;
  push_reminders: number;
}

const preferenceColumn: Record<ReminderChannel, keyof Pick<
  DueReminderRow,
  "in_app_reminders" | "email_reminders" | "push_reminders"
>> = {
  in_app: "in_app_reminders",
  email: "email_reminders",
  push: "push_reminders",
};

export class D1ReminderDeliveryRepository {
  private readonly createId: () => string;

  constructor(
    private readonly db: D1Database,
    options: { createId?: () => string } = {},
  ) {
    this.createId = options.createId ?? (() => crypto.randomUUID());
  }

  async prepareDue(now: string, limit: number) {
    const candidates = await this.db.prepare(
      `SELECT r.id, r.workspace_id, r.user_id, r.remind_at, r.title, r.timezone,
              r.channels_json, r.recurrence_json, r.recurrence_anchor_local,
              r.occurrence_count,
              COALESCE(p.in_app_reminders, 1) AS in_app_reminders,
              COALESCE(p.email_reminders, 0) AS email_reminders,
              COALESCE(p.push_reminders, 0) AS push_reminders
       FROM reminders r
       LEFT JOIN user_preferences p ON p.user_id = r.user_id
       WHERE r.status = 'pending' AND r.deleted_at IS NULL
         AND r.delivery_enabled_at IS NOT NULL AND r.remind_at <= ?
         AND (r.dispatch_claim_expires_at IS NULL OR r.dispatch_claim_expires_at <= ?)
       ORDER BY r.remind_at, r.id
       LIMIT ?`,
    ).bind(now, now, limit).all<DueReminderRow>();

    let claimed = 0;
    let deliveries = 0;
    for (const reminder of candidates.results ?? []) {
      const claimToken = crypto.randomUUID();
      const claimExpiresAt = new Date(Date.parse(now) + 5 * 60_000).toISOString();
      const claim = await this.db.prepare(
        `UPDATE reminders
         SET dispatch_claim_token = ?, dispatch_claim_expires_at = ?
         WHERE id = ? AND status = 'pending' AND deleted_at IS NULL
           AND delivery_enabled_at IS NOT NULL AND remind_at <= ?
           AND (dispatch_claim_expires_at IS NULL OR dispatch_claim_expires_at <= ?)`,
      ).bind(claimToken, claimExpiresAt, reminder.id, now, now).run();
      if ((claim.meta.changes ?? 0) !== 1) continue;
      claimed += 1;

      const requestedChannels = JSON.parse(reminder.channels_json) as ReminderChannel[];
      for (const channel of requestedChannels) {
        if (reminder[preferenceColumn[channel]] !== 1) continue;
        if (await this.ensureDelivery(reminder, channel, now)) deliveries += 1;
      }

      await this.advanceReminder(reminder, claimToken, now);
    }
    return { claimed, deliveries };
  }

  async listPendingOutbox(now: string, limit: number) {
    const result = await this.db.prepare(
      `SELECT id, delivery_id, payload_json, attempt_count
       FROM reminder_delivery_outbox
       WHERE dispatched_at IS NULL AND available_at <= ?
       ORDER BY available_at, id LIMIT ?`,
    ).bind(now, limit).all<{ id: string; delivery_id: string; payload_json: string; attempt_count: number }>();
    return (result.results ?? []).map((row) => ({
      id: row.id,
      attempt: row.attempt_count,
      message: {
        job_id: row.delivery_id,
        kind: "notification",
        idempotency_key: `reminder-delivery:${row.delivery_id}`,
        attempt: row.attempt_count + 1,
        deadline: new Date(Date.parse(now) + 15 * 60_000).toISOString(),
        payload: JSON.parse(row.payload_json) as Record<string, unknown>,
      } satisfies QueueJob,
    }));
  }

  async markOutboxDispatched(outboxId: string, now: string) {
    await this.db.prepare(
      `UPDATE reminder_delivery_outbox SET dispatched_at = ?, updated_at = ? WHERE id = ? AND dispatched_at IS NULL`,
    ).bind(now, now, outboxId).run();
  }

  async recordOutboxFailure(outboxId: string, now: string, retryAt: string) {
    await this.db.prepare(
      `UPDATE reminder_delivery_outbox
       SET attempt_count = attempt_count + 1, available_at = ?, updated_at = ?
       WHERE id = ? AND dispatched_at IS NULL`,
    ).bind(retryAt, now, outboxId).run();
  }

  async getDelivery(deliveryId: string) {
    return this.db.prepare(
      `SELECT d.id, d.workspace_id, d.reminder_id, d.user_id, d.channel,
              r.title, COALESCE(p.show_push_title, 0) AS show_push_title,
              u.email
       FROM reminder_deliveries d
       JOIN reminders r ON r.id = d.reminder_id AND r.workspace_id = d.workspace_id
       JOIN users u ON u.id = d.user_id
       LEFT JOIN user_preferences p ON p.user_id = d.user_id
       WHERE d.id = ? AND d.status IN ('queued', 'failed')`,
    ).bind(deliveryId).first<{
      id: string;
      workspace_id: string;
      reminder_id: string;
      user_id: string;
      channel: ReminderChannel;
      title: string;
      show_push_title: number;
      email: string;
    }>();
  }

  async markDeliverySent(deliveryId: string, now: string) {
    await this.db.prepare(
      `UPDATE reminder_deliveries
       SET status = 'sent', attempt_count = attempt_count + 1, last_error_code = NULL, updated_at = ?
       WHERE id = ? AND status IN ('queued', 'failed')`,
    ).bind(now, deliveryId).run();
  }

  async markDeliveryFailed(deliveryId: string, now: string, errorCode: string) {
    await this.db.prepare(
      `UPDATE reminder_deliveries
       SET status = 'failed', attempt_count = attempt_count + 1, last_error_code = ?, updated_at = ?
       WHERE id = ? AND status IN ('queued', 'failed')`,
    ).bind(errorCode, now, deliveryId).run();
  }

  async createInAppNotification(delivery: {
    id: string;
    workspace_id: string;
    reminder_id: string;
    user_id: string;
    title: string;
  }, now: string) {
    await this.db.prepare(
      `INSERT INTO notifications (id, workspace_id, user_id, type, payload_json, revision, created_at)
       VALUES (?, ?, ?, 'reminder', ?, 1, ?)
       ON CONFLICT(id) DO NOTHING`,
    ).bind(
      `reminder:${delivery.id}`,
      delivery.workspace_id,
      delivery.user_id,
      JSON.stringify({ reminder_id: delivery.reminder_id, title: delivery.title }),
      now,
    ).run();
  }

  private async ensureDelivery(reminder: DueReminderRow, channel: ReminderChannel, now: string) {
    const deliveryId = this.createId();
    const insert = await this.db.prepare(
      `INSERT INTO reminder_deliveries (
         id, workspace_id, reminder_id, user_id, occurrence_at, channel,
         status, attempt_count, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, 'queued', 0, ?, ?)
       ON CONFLICT(reminder_id, occurrence_at, channel) DO NOTHING
       RETURNING id`,
    ).bind(
      deliveryId,
      reminder.workspace_id,
      reminder.id,
      reminder.user_id,
      reminder.remind_at,
      channel,
      now,
      now,
    ).first<{ id: string }>();
    const persistedId = insert?.id ?? await this.db.prepare(
      `SELECT id FROM reminder_deliveries
       WHERE reminder_id = ? AND occurrence_at = ? AND channel = ?`,
    ).bind(reminder.id, reminder.remind_at, channel).first<string>("id");
    if (!persistedId) return false;

    const outbox = await this.db.prepare(
      `INSERT INTO reminder_delivery_outbox (
         id, delivery_id, payload_json, available_at, attempt_count, created_at, updated_at
       ) VALUES (?, ?, ?, ?, 0, ?, ?)
       ON CONFLICT(delivery_id) DO NOTHING`,
    ).bind(
      `outbox:${persistedId}`,
      persistedId,
      JSON.stringify({
        kind: "reminder_delivery",
        delivery_id: persistedId,
        workspace_id: reminder.workspace_id,
        reminder_id: reminder.id,
        user_id: reminder.user_id,
        occurrence_at: reminder.remind_at,
        channel,
      }),
      now,
      now,
      now,
    ).run();
    return (outbox.meta.changes ?? 0) === 1;
  }

  private async advanceReminder(reminder: DueReminderRow, claimToken: string, now: string) {
    const occurrenceCount = reminder.occurrence_count + 1;
    const recurrence = reminder.recurrence_json
      ? JSON.parse(reminder.recurrence_json) as ReminderRecurrence
      : null;
    const nextAt = recurrence && reminder.recurrence_anchor_local
      ? nextReminderOccurrence({
          anchorLocal: reminder.recurrence_anchor_local,
          currentAt: reminder.remind_at,
          timezone: reminder.timezone,
          occurrenceCount,
          recurrence,
        })
      : null;
    await this.db.prepare(
      `UPDATE reminders
       SET remind_at = COALESCE(?, remind_at), status = ?, occurrence_count = ?,
           snoozed_until = NULL, last_delivered_at = ?, revision = revision + 1,
           dispatch_claim_token = NULL, dispatch_claim_expires_at = NULL, updated_at = ?
       WHERE id = ? AND dispatch_claim_token = ?`,
    ).bind(
      nextAt,
      nextAt ? "pending" : "sent",
      occurrenceCount,
      reminder.remind_at,
      now,
      reminder.id,
      claimToken,
    ).run();
  }
}
