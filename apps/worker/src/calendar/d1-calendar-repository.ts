import type {
  CalendarConnectionSummary,
  CalendarEvent,
  CalendarProvider,
} from "@nexus/contracts";

import type {
  CalendarConnectionRepository,
  StoredCalendarConnection,
} from "./calendar-service";

interface ConnectionRow {
  id: string;
  user_id: string;
  provider: CalendarProvider;
  provider_account_id: string;
  status: CalendarConnectionSummary["status"];
  refresh_token_ciphertext: string;
  refresh_token_iv: string;
  refresh_token_key_version: number;
  sync_cursor: string | null;
  last_synced_at: string | null;
  last_error_code: string | null;
  created_at: string;
  updated_at: string;
}

interface EventRow {
  id: string;
  connection_id: string;
  provider: CalendarProvider;
  provider_event_id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  timezone: string;
  all_day: number;
  status: CalendarEvent["status"];
  updated_at: string;
}

function summary(row: Pick<ConnectionRow, "id" | "provider" | "status" | "last_synced_at" | "last_error_code">): CalendarConnectionSummary {
  return {
    id: row.id,
    provider: row.provider,
    status: row.status,
    last_synced_at: row.last_synced_at,
    last_error_code: row.last_error_code,
  };
}

function stored(row: ConnectionRow): StoredCalendarConnection {
  return {
    id: row.id,
    userId: row.user_id,
    provider: row.provider,
    providerAccountId: row.provider_account_id,
    status: row.status,
    refreshTokenCiphertext: row.refresh_token_ciphertext,
    refreshTokenIv: row.refresh_token_iv,
    refreshTokenKeyVersion: row.refresh_token_key_version,
    syncCursor: row.sync_cursor,
    lastSyncedAt: row.last_synced_at,
    lastErrorCode: row.last_error_code,
  };
}

function event(row: EventRow, connectionId: string, userId: string): CalendarEvent {
  return {
    id: row.id,
    connection_id: connectionId,
    provider: row.provider,
    provider_event_id: row.provider_event_id,
    title: row.title,
    starts_at: row.starts_at,
    ends_at: row.ends_at,
    timezone: row.timezone,
    all_day: Boolean(row.all_day),
    status: row.status,
    updated_at: row.updated_at,
  };
}

export class D1CalendarRepository implements CalendarConnectionRepository {
  constructor(
    private readonly db: D1Database,
    private readonly options: { createId?: () => string } = {},
  ) {}

  async createOAuthState(input: {
    id: string;
    userId: string;
    provider: CalendarProvider;
    stateHash: string;
    expiresAt: string;
    createdAt: string;
  }) {
    await this.db.prepare(
      `INSERT INTO calendar_oauth_states (id, user_id, provider, state_hash, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(input.id, input.userId, input.provider, input.stateHash, input.expiresAt, input.createdAt).run();
  }

  async consumeOAuthState(stateHash: string, provider: CalendarProvider, now: string) {
    const row = await this.db.prepare(
      `UPDATE calendar_oauth_states
       SET consumed_at = ?
       WHERE state_hash = ? AND provider = ? AND consumed_at IS NULL AND expires_at > ?
       RETURNING id, user_id`,
    ).bind(now, stateHash, provider, now).first<{ id: string; user_id: string }>();
    return row ? { id: row.id, userId: row.user_id } : null;
  }

  async upsertConnection(input: {
    id: string;
    userId: string;
    provider: CalendarProvider;
    providerAccountId: string;
    encryptedRefreshToken: { ciphertext: string; iv: string; keyVersion: number };
    now: string;
  }) {
    const row = await this.db.prepare(
      `INSERT INTO calendar_connections (
         id, user_id, provider, provider_account_id, status,
         refresh_token_ciphertext, refresh_token_iv, refresh_token_key_version,
         sync_cursor, last_synced_at, last_error_code, created_at, updated_at
       ) VALUES (?, ?, ?, ?, 'active', ?, ?, ?, NULL, NULL, NULL, ?, ?)
       ON CONFLICT(user_id, provider, provider_account_id) DO UPDATE SET
         status = 'active',
         refresh_token_ciphertext = excluded.refresh_token_ciphertext,
         refresh_token_iv = excluded.refresh_token_iv,
         refresh_token_key_version = excluded.refresh_token_key_version,
         sync_cursor = NULL,
         last_synced_at = NULL,
         last_error_code = NULL,
         updated_at = excluded.updated_at
       RETURNING id, provider, status, last_synced_at, last_error_code`,
    ).bind(
      input.id,
      input.userId,
      input.provider,
      input.providerAccountId,
      input.encryptedRefreshToken.ciphertext,
      input.encryptedRefreshToken.iv,
      input.encryptedRefreshToken.keyVersion,
      input.now,
      input.now,
    ).first<Pick<ConnectionRow, "id" | "provider" | "status" | "last_synced_at" | "last_error_code">>();
    if (!row) throw new Error("CALENDAR_CONNECTION_WRITE_FAILED");
    return summary(row);
  }

  async listConnections(userId: string) {
    const result = await this.db.prepare(
      `SELECT id, provider, status, last_synced_at, last_error_code
       FROM calendar_connections WHERE user_id = ? ORDER BY provider, id`,
    ).bind(userId).all<Pick<ConnectionRow, "id" | "provider" | "status" | "last_synced_at" | "last_error_code">>();
    return (result.results ?? []).map(summary);
  }

  async getConnection(userId: string, connectionId: string) {
    const row = await this.db.prepare(
      `SELECT id, user_id, provider, provider_account_id, status,
              refresh_token_ciphertext, refresh_token_iv, refresh_token_key_version,
              sync_cursor, last_synced_at, last_error_code, created_at, updated_at
       FROM calendar_connections WHERE user_id = ? AND id = ? LIMIT 1`,
    ).bind(userId, connectionId).first<ConnectionRow>();
    return row ? stored(row) : null;
  }

  async markSync(userId: string, connectionId: string, input: {
    status: "active" | "error";
    syncCursor: string | null;
    lastSyncedAt: string | null;
    lastErrorCode: string | null;
    now: string;
  }) {
    const row = await this.db.prepare(
      `UPDATE calendar_connections
       SET status = ?, sync_cursor = ?, last_synced_at = ?, last_error_code = ?, updated_at = ?
       WHERE user_id = ? AND id = ?
       RETURNING id, provider, status, last_synced_at, last_error_code`,
    ).bind(
      input.status,
      input.syncCursor,
      input.lastSyncedAt,
      input.lastErrorCode,
      input.now,
      userId,
      connectionId,
    ).first<Pick<ConnectionRow, "id" | "provider" | "status" | "last_synced_at" | "last_error_code">>();
    return row ? summary(row) : null;
  }

  async updateRefreshToken(userId: string, connectionId: string, encryptedRefreshToken: { ciphertext: string; iv: string; keyVersion: number }, now: string) {
    await this.db.prepare(
      `UPDATE calendar_connections
       SET refresh_token_ciphertext = ?, refresh_token_iv = ?, refresh_token_key_version = ?, updated_at = ?
       WHERE user_id = ? AND id = ? AND status <> 'revoked'`,
    ).bind(
      encryptedRefreshToken.ciphertext,
      encryptedRefreshToken.iv,
      encryptedRefreshToken.keyVersion,
      now,
      userId,
      connectionId,
    ).run();
  }

  async upsertEvents(userId: string, connectionId: string, events: CalendarEvent[]) {
    const connection = await this.db.prepare(
      "SELECT provider FROM calendar_connections WHERE id = ? AND user_id = ? LIMIT 1",
    ).bind(connectionId, userId).first<{ provider: CalendarProvider }>();
    if (!connection) throw new Error("CALENDAR_CONNECTION_NOT_FOUND");
    const rows = events.slice(0, 500);
    for (let offset = 0; offset < rows.length; offset += 100) {
      const statements = rows.slice(offset, offset + 100).map((item) => this.db.prepare(
        `INSERT INTO calendar_events (
           id, connection_id, user_id, provider, provider_event_id, title,
           starts_at, ends_at, timezone, all_day, status, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(connection_id, provider_event_id) DO UPDATE SET
           title = excluded.title,
           starts_at = excluded.starts_at,
           ends_at = excluded.ends_at,
           timezone = excluded.timezone,
           all_day = excluded.all_day,
           status = excluded.status,
           updated_at = excluded.updated_at`,
      ).bind(
        item.id,
        connectionId,
        userId,
        connection.provider,
        item.provider_event_id,
        item.title,
        item.starts_at,
        item.ends_at,
        item.timezone,
        item.all_day ? 1 : 0,
        item.status,
        item.updated_at,
      ));
      if (statements.length > 0) await this.db.batch(statements);
    }
  }

  async listEvents(userId: string, query: { from: string; to: string; connection_id?: string }) {
    const conditions = [
      "e.user_id = ?",
      "substr(e.starts_at, 1, 10) <= ?",
      "substr(e.ends_at, 1, 10) >= ?",
    ];
    const bindings: unknown[] = [userId, query.to, query.from];
    if (query.connection_id) {
      conditions.push("e.connection_id = ?");
      bindings.push(query.connection_id);
    }
    const result = await this.db.prepare(
      `SELECT e.id, e.connection_id, e.provider, e.provider_event_id, e.title,
              e.starts_at, e.ends_at, e.timezone, e.all_day, e.status, e.updated_at
       FROM calendar_events e
       JOIN calendar_connections c ON c.id = e.connection_id AND c.user_id = e.user_id AND c.status = 'active'
       WHERE ${conditions.join(" AND ")}
       ORDER BY e.starts_at, e.id LIMIT 500`,
    ).bind(...bindings).all<EventRow>();
    return (result.results ?? []).map((row) => event(row, row.connection_id, userId));
  }

  async revokeConnection(userId: string, connectionId: string, now: string) {
    const result = await this.db.batch([
      this.db.prepare(
        `UPDATE calendar_connections
         SET status = 'revoked', refresh_token_ciphertext = '', refresh_token_iv = '', sync_cursor = NULL,
             last_error_code = NULL, updated_at = ?
         WHERE user_id = ? AND id = ?`,
      ).bind(now, userId, connectionId),
      this.db.prepare("DELETE FROM calendar_events WHERE user_id = ? AND connection_id = ?").bind(userId, connectionId),
    ]);
    return (result[0]?.meta.changes ?? 0) === 1;
  }
}
