export interface StoredAiConfig {
  user_id: string;
  base_url: string;
  model: string;
  api_key_ciphertext: string;
  encryption_iv: string;
  key_fingerprint: string;
  key_version: number;
  verified_at: string | null;
  last_error_code: string | null;
  revision: number;
  created_at: string;
  updated_at: string;
}

export type AiProviderSource = "system" | "personal";

export interface StoredAiProviderPreference {
  user_id: string;
  source: AiProviderSource;
  revision: number;
  updated_at: string;
}

export class D1AiConfigRepository {
  constructor(private readonly db: D1Database) {}

  get(userId: string) {
    return this.db.prepare(
      `SELECT user_id,base_url,model,api_key_ciphertext,encryption_iv,key_fingerprint,key_version,
              verified_at,last_error_code,revision,created_at,updated_at
       FROM user_ai_configs WHERE user_id = ? LIMIT 1`,
    ).bind(userId).first<StoredAiConfig>();
  }

  async getProviderPreference(userId: string): Promise<StoredAiProviderPreference> {
    const row = await this.db.prepare(
      "SELECT user_id,source,revision,updated_at FROM ai_provider_preferences WHERE user_id=? LIMIT 1",
    ).bind(userId).first<StoredAiProviderPreference>();
    return row ?? { user_id: userId, source: "system", revision: 1, updated_at: "" };
  }

  async updateProviderPreference(userId: string, source: AiProviderSource, baseRevision: number, now: string) {
    const current = await this.db.prepare(
      "SELECT revision FROM ai_provider_preferences WHERE user_id=? LIMIT 1",
    ).bind(userId).first<{ revision: number }>();

    if (!current) {
      if (baseRevision !== 1) return null;
      try {
        await this.db.prepare(
          "INSERT INTO ai_provider_preferences (user_id,source,revision,updated_at) VALUES (?,?,1,?)",
        ).bind(userId, source, now).run();
      } catch (error) {
        if (error instanceof Error && /UNIQUE constraint failed: ai_provider_preferences\.user_id/iu.test(error.message)) return null;
        throw error;
      }
    } else {
      const result = await this.db.prepare(
        "UPDATE ai_provider_preferences SET source=?,revision=revision+1,updated_at=? WHERE user_id=? AND revision=?",
      ).bind(source, now, userId, baseRevision).run();
      if ((result.meta.changes ?? 0) !== 1) return null;
    }
    return this.getProviderPreference(userId);
  }

  async save(input: Omit<StoredAiConfig, "created_at" | "updated_at" | "revision" | "verified_at" | "last_error_code"> & {
    baseRevision: number | null;
    now: string;
  }) {
    if (input.baseRevision === null) {
      await this.db.prepare(
        `INSERT INTO user_ai_configs (
           user_id,base_url,model,api_key_ciphertext,encryption_iv,key_fingerprint,key_version,
           verified_at,last_error_code,revision,created_at,updated_at
         ) VALUES (?,?,?,?,?,?,?,NULL,NULL,1,?,?)`,
      ).bind(
        input.user_id, input.base_url, input.model, input.api_key_ciphertext, input.encryption_iv,
        input.key_fingerprint, input.key_version, input.now, input.now,
      ).run();
    } else {
      const result = await this.db.prepare(
        `UPDATE user_ai_configs
         SET base_url=?, model=?, api_key_ciphertext=?, encryption_iv=?, key_fingerprint=?, key_version=?,
             verified_at=NULL, last_error_code=NULL, revision=revision+1, updated_at=?
         WHERE user_id=? AND revision=?`,
      ).bind(
        input.base_url, input.model, input.api_key_ciphertext, input.encryption_iv,
        input.key_fingerprint, input.key_version, input.now, input.user_id, input.baseRevision,
      ).run();
      if ((result.meta.changes ?? 0) !== 1) return null;
    }
    return this.get(input.user_id);
  }

  async markVerified(userId: string, revision: number, now: string, errorCode: string | null) {
    await this.db.prepare(
      `UPDATE user_ai_configs SET verified_at=?, last_error_code=?, revision=revision+1, updated_at=?
       WHERE user_id=? AND revision=?`,
    ).bind(errorCode ? null : now, errorCode, now, userId, revision).run();
    return this.get(userId);
  }

  async delete(userId: string, revision: number) {
    const result = await this.db.prepare("DELETE FROM user_ai_configs WHERE user_id=? AND revision=?")
      .bind(userId, revision).run();
    return (result.meta.changes ?? 0) === 1;
  }

  async audit(userId: string, event: "ai.config_updated" | "ai.config_deleted" | "ai.config_tested", requestId: string, now: string) {
    await this.db.prepare(
      "INSERT INTO account_audit_logs (id,user_id,event,request_id,created_at) VALUES (?,?,?,?,?)",
    ).bind(crypto.randomUUID(), userId, event, requestId, now).run();
  }
}
