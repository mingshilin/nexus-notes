import type { AccountActivity, AccountOverview, UpdateUserPreferencesInput, UserPreferences } from "@nexus/contracts";

interface PreferencesRow {
  user_id: string;
  default_domain: UserPreferences["default_domain"];
  density: UserPreferences["density"];
  reduced_motion: number;
  week_starts_on: 0 | 1;
  date_format: UserPreferences["date_format"];
  default_snooze_minutes: number;
  email_reminders: number;
  push_reminders: number;
  in_app_reminders: number;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  show_push_title: number;
  revision: number;
  updated_at: string;
}

export class AccountRepositoryError extends Error {
  readonly retryable = false;
  constructor(readonly code: string, message: string, readonly status = 400) {
    super(message);
    this.name = "AccountRepositoryError";
  }
}

function toPreferences(row: PreferencesRow): UserPreferences {
  return {
    user_id: row.user_id,
    default_domain: row.default_domain,
    density: row.density,
    reduced_motion: Boolean(row.reduced_motion),
    week_starts_on: row.week_starts_on,
    date_format: row.date_format,
    default_snooze_minutes: row.default_snooze_minutes,
    email_reminders: Boolean(row.email_reminders),
    push_reminders: Boolean(row.push_reminders),
    in_app_reminders: Boolean(row.in_app_reminders),
    quiet_hours: row.quiet_hours_start && row.quiet_hours_end ? { start: row.quiet_hours_start, end: row.quiet_hours_end } : null,
    show_push_title: Boolean(row.show_push_title),
    revision: row.revision,
    updated_at: row.updated_at,
  };
}

const columns = `user_id,default_domain,density,reduced_motion,week_starts_on,date_format,default_snooze_minutes,
  email_reminders,push_reminders,in_app_reminders,quiet_hours_start,quiet_hours_end,show_push_title,revision,updated_at`;

export class D1AccountRepository {
  private readonly clock: () => Date;

  constructor(private readonly db: D1Database, options: { clock?: () => Date } = {}) {
    this.clock = options.clock ?? (() => new Date());
  }

  async getPreferences(userId: string) {
    const now = this.clock().toISOString();
    await this.db.prepare(
      `INSERT OR IGNORE INTO user_preferences (user_id,updated_at) SELECT id,? FROM users WHERE id=? AND status='active'`,
    ).bind(now, userId).run();
    const row = await this.db.prepare(`SELECT ${columns} FROM user_preferences WHERE user_id=?`).bind(userId).first<PreferencesRow>();
    if (!row) throw new AccountRepositoryError("ACCOUNT_NOT_FOUND", "Account was not found", 404);
    return toPreferences(row);
  }

  async updatePreferences(userId: string, input: UpdateUserPreferencesInput, requestId: string) {
    const current = await this.getPreferences(userId);
    const next = { ...current, ...input };
    const now = this.clock().toISOString();
    const quiet = input.quiet_hours === undefined ? current.quiet_hours : input.quiet_hours;
    const update = this.db.prepare(
      `UPDATE user_preferences SET default_domain=?,density=?,reduced_motion=?,week_starts_on=?,date_format=?,
         default_snooze_minutes=?,email_reminders=?,push_reminders=?,in_app_reminders=?,quiet_hours_start=?,quiet_hours_end=?,
         show_push_title=?,revision=revision+1,updated_at=? WHERE user_id=? AND revision=? RETURNING ${columns}`,
    ).bind(
      next.default_domain, next.density, next.reduced_motion ? 1 : 0, next.week_starts_on, next.date_format,
      next.default_snooze_minutes, next.email_reminders ? 1 : 0, next.push_reminders ? 1 : 0, next.in_app_reminders ? 1 : 0,
      quiet?.start ?? null, quiet?.end ?? null, next.show_push_title ? 1 : 0, now, userId, input.base_revision,
    );
    const audit = this.db.prepare(
      `INSERT INTO account_audit_logs (id,user_id,event,request_id,created_at)
       SELECT ?,?,'preferences.updated',?,? WHERE EXISTS (
         SELECT 1 FROM user_preferences WHERE user_id=? AND revision=? AND updated_at=?
       )`,
    ).bind(crypto.randomUUID(), userId, requestId, now, userId, input.base_revision + 1, now);
    const results = await this.db.batch<PreferencesRow>([update, audit]);
    const row = results[0]?.results?.[0];
    if (!row) throw new AccountRepositoryError("PREFERENCES_CONFLICT", "Preferences changed before they could be saved", 409);
    return toPreferences(row);
  }

  async listActivity(userId: string, options: { limit: number; cursor?: string }) {
    const limit = Math.max(1, Math.min(100, Math.floor(options.limit)));
    const result = await this.db.prepare(
      `SELECT id,event,request_id,created_at FROM account_audit_logs
       WHERE user_id=? AND (? IS NULL OR created_at < ?)
       ORDER BY created_at DESC,id DESC LIMIT ?`,
    ).bind(userId, options.cursor ?? null, options.cursor ?? null, limit + 1).all<AccountActivity>();
    const rows = result.results ?? [];
    return { items: rows.slice(0, limit), next_cursor: rows.length > limit ? rows[limit - 1]!.created_at : null };
  }

  async revokeOtherSessions(userId: string, currentSessionId: string, requestId: string) {
    const now = this.clock().toISOString();
    const remove = this.db.prepare("DELETE FROM sessions WHERE user_id=? AND id<>?").bind(userId, currentSessionId);
    const audit = this.db.prepare(
      "INSERT INTO account_audit_logs (id,user_id,event,request_id,created_at) VALUES (?,?,'sessions.revoked_all',?,?)",
    ).bind(crypto.randomUUID(), userId, requestId, now);
    const results = await this.db.batch([remove, audit]);
    return { revoked: results[0]?.meta.changes ?? 0 };
  }

  async getOverview(userId: string): Promise<AccountOverview> {
    const now = this.clock().toISOString();
    const [counts, profile, ai, activity] = await Promise.all([
      this.db.prepare(
        `SELECT
          (SELECT COUNT(*) FROM workspace_members WHERE user_id=?) AS workspaces,
          (SELECT COUNT(*) FROM sessions WHERE user_id=? AND expires_at>?) AS sessions,
          (SELECT COUNT(*) FROM notes WHERE created_by=? AND deleted_at IS NULL) AS notes,
          (SELECT COUNT(*) FROM databases WHERE created_by=?) AS databases,
          (SELECT COUNT(*) FROM reminders WHERE user_id=? AND status='pending' AND deleted_at IS NULL AND remind_at>=?) AS upcoming_reminders`,
      ).bind(userId, userId, now, userId, userId, userId, now).first<Record<string, number>>(),
      this.db.prepare("SELECT display_name,biography,locale,timezone FROM users WHERE id=? AND status='active'").bind(userId)
        .first<{ display_name: string; biography: string; locale: string; timezone: string }>(),
      this.db.prepare("SELECT 1 AS configured FROM user_ai_configs WHERE user_id=?").bind(userId).first<{ configured: number }>(),
      this.listActivity(userId, { limit: 5 }),
    ]);
    if (!counts || !profile) throw new AccountRepositoryError("ACCOUNT_NOT_FOUND", "Account was not found", 404);
    return {
      counts: {
        workspaces: Number(counts.workspaces ?? 0),
        sessions: Number(counts.sessions ?? 0),
        notes: Number(counts.notes ?? 0),
        databases: Number(counts.databases ?? 0),
        upcoming_reminders: Number(counts.upcoming_reminders ?? 0),
      },
      profile_complete: Boolean(profile.display_name.trim() && profile.locale && profile.timezone && profile.biography.trim()),
      ai_configured: Boolean(ai?.configured),
      recent_activity: activity.items,
    };
  }
}
