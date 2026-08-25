import type { PushSubscriptionInput, PushSubscriptionSummary } from "@nexus/contracts";
import type { UserSecretBox } from "../security/user-secret-box";

interface PushSubscriptionRow {
  id: string;
  user_id: string;
  subscription_ciphertext: string;
  encryption_iv: string;
  key_version: number;
  device_name: string;
  status: "active" | "disabled";
  last_success_at: string | null;
  created_at: string;
}

function summary(row: PushSubscriptionRow): PushSubscriptionSummary {
  return {
    id: row.id,
    device_name: row.device_name,
    status: row.status,
    last_success_at: row.last_success_at,
    created_at: row.created_at,
  };
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export class D1PushSubscriptionRepository {
  private readonly clock: () => Date;
  private readonly createId: () => string;

  constructor(
    private readonly db: D1Database,
    private readonly secretBox: UserSecretBox,
    options: { clock?: () => Date; createId?: () => string } = {},
  ) {
    this.clock = options.clock ?? (() => new Date());
    this.createId = options.createId ?? (() => crypto.randomUUID());
  }

  async upsert(userId: string, input: PushSubscriptionInput, requestId: string) {
    const now = this.clock().toISOString();
    const endpointHash = await sha256(input.endpoint);
    const existing = await this.db.prepare(
      "SELECT id FROM push_subscriptions WHERE user_id = ? AND endpoint_hash = ?",
    ).bind(userId, endpointHash).first<string>("id");
    const id = existing ?? this.createId();
    const encrypted = await this.secretBox.encrypt(userId, "push-subscription", JSON.stringify(input));
    await this.db.batch([
      this.db.prepare(
        `INSERT INTO push_subscriptions (
           id, user_id, endpoint_hash, subscription_ciphertext, encryption_iv, key_version,
           device_name, status, revision, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', 1, ?, ?)
         ON CONFLICT(user_id, endpoint_hash) DO UPDATE SET
           subscription_ciphertext = excluded.subscription_ciphertext,
           encryption_iv = excluded.encryption_iv,
           key_version = excluded.key_version,
           device_name = excluded.device_name,
           status = 'active',
           revision = push_subscriptions.revision + 1,
           updated_at = excluded.updated_at`,
      ).bind(
        id,
        userId,
        endpointHash,
        encrypted.ciphertext,
        encrypted.iv,
        encrypted.keyVersion,
        input.device_name,
        now,
        now,
      ),
      this.auditStatement(userId, "push.subscription_added", requestId, now),
    ]);
    const row = await this.getOwned(userId, id);
    if (!row) throw new Error("Push subscription was not persisted");
    return summary(row);
  }

  async list(userId: string) {
    const result = await this.db.prepare(
      `SELECT id, user_id, subscription_ciphertext, encryption_iv, key_version,
              device_name, status, last_success_at, created_at
       FROM push_subscriptions WHERE user_id = ? ORDER BY updated_at DESC, id`,
    ).bind(userId).all<PushSubscriptionRow>();
    return (result.results ?? []).map(summary);
  }

  async listActive(userId: string) {
    const result = await this.db.prepare(
      `SELECT id, user_id, subscription_ciphertext, encryption_iv, key_version,
              device_name, status, last_success_at, created_at
       FROM push_subscriptions WHERE user_id = ? AND status = 'active' ORDER BY id`,
    ).bind(userId).all<PushSubscriptionRow>();
    return Promise.all((result.results ?? []).map(async (row) => ({
      id: row.id,
      subscription: JSON.parse(await this.secretBox.decrypt(userId, "push-subscription", {
        ciphertext: row.subscription_ciphertext,
        iv: row.encryption_iv,
        keyVersion: row.key_version,
      })) as PushSubscriptionInput,
    })));
  }

  async disable(userId: string, subscriptionId: string, requestId: string) {
    const now = this.clock().toISOString();
    const results = await this.db.batch([
      this.db.prepare(
        `UPDATE push_subscriptions
         SET status = 'disabled', revision = revision + 1, updated_at = ?
         WHERE user_id = ? AND id = ? AND status = 'active'`,
      ).bind(now, userId, subscriptionId),
      this.db.prepare(
        `INSERT INTO account_audit_logs (id, user_id, event, request_id, created_at)
         SELECT ?, ?, 'push.subscription_deleted', ?, ?
         WHERE changes() > 0`,
      ).bind(crypto.randomUUID(), userId, requestId, now),
    ]);
    return (results[0]?.meta.changes ?? 0) === 1;
  }

  async markSuccess(subscriptionId: string, now: string) {
    await this.db.prepare(
      `UPDATE push_subscriptions SET last_success_at = ?, last_failure_at = NULL, updated_at = ? WHERE id = ?`,
    ).bind(now, now, subscriptionId).run();
  }

  async markFailure(subscriptionId: string, now: string, permanent: boolean) {
    await this.db.prepare(
      `UPDATE push_subscriptions
       SET last_failure_at = ?, status = CASE WHEN ? THEN 'disabled' ELSE status END,
           revision = revision + CASE WHEN ? THEN 1 ELSE 0 END, updated_at = ?
       WHERE id = ?`,
    ).bind(now, permanent ? 1 : 0, permanent ? 1 : 0, now, subscriptionId).run();
  }

  private getOwned(userId: string, id: string) {
    return this.db.prepare(
      `SELECT id, user_id, subscription_ciphertext, encryption_iv, key_version,
              device_name, status, last_success_at, created_at
       FROM push_subscriptions WHERE user_id = ? AND id = ?`,
    ).bind(userId, id).first<PushSubscriptionRow>();
  }

  private auditStatement(userId: string, event: string, requestId: string, now: string) {
    return this.db.prepare(
      "INSERT INTO account_audit_logs (id, user_id, event, request_id, created_at) VALUES (?, ?, ?, ?, ?)",
    ).bind(crypto.randomUUID(), userId, event, requestId, now);
  }
}
