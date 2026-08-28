import type { AiChatResponse, AiProviderPreference, AiUserConfigSummary, DeleteAiUserConfigInput, TestAiUserConfigInput, UpdateAiProviderPreferenceInput, UpsertAiUserConfigInput } from "@nexus/contracts";
import type { UserSecretBox } from "../security/user-secret-box";
import { AiChatService } from "./ai-chat-service";
import type { AiProviderSource, D1AiConfigRepository, StoredAiConfig } from "./d1-ai-config-repository";

export class UserAiConfigError extends Error {
  readonly retryable = false;
  constructor(readonly code: string, message: string, readonly status = 400) {
    super(message);
    this.name = "UserAiConfigError";
  }
}

function isIpLiteral(hostname: string) {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/u.test(hostname) || hostname.includes(":");
}

export function normalizeAiEndpoint(value: string) {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new UserAiConfigError("AI_URL_INVALID", "AI provider URL is invalid");
  }
  const hostname = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || (url.port && url.port !== "443")) {
    throw new UserAiConfigError("AI_URL_INVALID", "AI provider must use a public HTTPS URL on port 443");
  }
  if (isIpLiteral(hostname) || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname.endsWith(".internal")) {
    throw new UserAiConfigError("AI_URL_FORBIDDEN", "Private AI provider targets are not allowed");
  }
  const path = url.pathname.replace(/\/+$/u, "");
  url.pathname = path.endsWith("/chat/completions") ? path : `${path}/chat/completions`;
  return url.toString();
}

async function fingerprint(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].slice(0, 8).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function summary(row: StoredAiConfig): AiUserConfigSummary {
  return {
    configured: true,
    source: "personal",
    base_url: row.base_url,
    model: row.model,
    key_hint: `••••${row.key_fingerprint.slice(-4)}`,
    verified_at: row.verified_at,
    revision: row.revision,
  };
}

export class UserAiConfigService {
  private readonly clock: () => Date;

  constructor(
    private readonly repository: D1AiConfigRepository,
    private readonly secrets: UserSecretBox,
    options: { clock?: () => Date } = {},
  ) {
    this.clock = options.clock ?? (() => new Date());
  }

  async status(userId: string): Promise<AiUserConfigSummary> {
    const row = await this.repository.get(userId);
    return row ? summary(row) : { configured: false, source: "unconfigured" };
  }

  async getProviderPreference(userId: string): Promise<AiProviderPreference> {
    const preference = await this.repository.getProviderPreference(userId);
    return { source: preference.source, revision: preference.revision };
  }

  async updateProviderPreference(userId: string, input: UpdateAiProviderPreferenceInput) {
    const updated = await this.repository.updateProviderPreference(
      userId,
      input.source as AiProviderSource,
      input.base_revision,
      this.clock().toISOString(),
    );
    if (!updated) throw new UserAiConfigError("AI_PROVIDER_CONFLICT", "AI provider selection changed before it could be saved", 409);
    return { source: updated.source, revision: updated.revision };
  }

  async save(userId: string, input: UpsertAiUserConfigInput) {
    const existing = await this.repository.get(userId);
    if (existing && input.base_revision !== existing.revision) {
      throw new UserAiConfigError("AI_CONFIG_CONFLICT", "AI configuration changed before it could be saved", 409);
    }
    if (!existing && input.base_revision != null) {
      throw new UserAiConfigError("AI_CONFIG_CONFLICT", "AI configuration does not exist", 409);
    }
    if (!existing && !input.api_key) {
      throw new UserAiConfigError("AI_KEY_REQUIRED", "An API key is required for the first configuration");
    }
    const encrypted = input.api_key
      ? await this.secrets.encrypt(userId, "ai-config", input.api_key)
      : { ciphertext: existing!.api_key_ciphertext, iv: existing!.encryption_iv, keyVersion: existing!.key_version };
    const keyFingerprint = input.api_key ? await fingerprint(input.api_key) : existing!.key_fingerprint;
    const saved = await this.repository.save({
      user_id: userId,
      base_url: normalizeAiEndpoint(input.base_url),
      model: input.model.trim(),
      api_key_ciphertext: encrypted.ciphertext,
      encryption_iv: encrypted.iv,
      key_fingerprint: keyFingerprint,
      key_version: encrypted.keyVersion,
      baseRevision: existing?.revision ?? null,
      now: this.clock().toISOString(),
    });
    if (!saved) throw new UserAiConfigError("AI_CONFIG_CONFLICT", "AI configuration changed before it could be saved", 409);
    return summary(saved);
  }

  async resolve(userId: string) {
    const row = await this.repository.get(userId);
    if (!row) return null;
    return {
      apiUrl: row.base_url,
      model: row.model,
      apiKey: await this.secrets.decrypt(userId, "ai-config", {
        ciphertext: row.api_key_ciphertext,
        iv: row.encryption_iv,
        keyVersion: row.key_version,
      }),
      revision: row.revision,
    };
  }

  getConfig(userId: string) {
    return this.status(userId);
  }

  async saveConfig(userId: string, input: UpsertAiUserConfigInput, requestId: string) {
    const saved = await this.save(userId, input);
    await this.repository.audit(userId, "ai.config_updated", requestId, this.clock().toISOString());
    return saved;
  }

  async testConfig(
    userId: string,
    input: TestAiUserConfigInput,
    signal: AbortSignal,
    requestId: string,
    fetchImpl: typeof fetch = fetch,
  ) {
    const stored = await this.resolve(userId);
    const apiUrl = input.base_url ? normalizeAiEndpoint(input.base_url) : stored?.apiUrl;
    const model = input.model?.trim() || stored?.model;
    const apiKey = input.api_key || stored?.apiKey;
    if (!apiUrl || !model || !apiKey) throw new UserAiConfigError("AI_NOT_CONFIGURED", "AI configuration is incomplete", 503);
    const started = Date.now();
    let response: AiChatResponse;
    try {
      response = await new AiChatService({ apiUrl, model, apiKey, fetchImpl, timeoutMs: 15_000 })
        .chat({ messages: [{ role: "user", content: "Reply with OK." }] }, signal);
    } catch (error) {
      if (stored && !input.base_url && !input.model && !input.api_key) {
        await this.repository.markVerified(userId, stored.revision, this.clock().toISOString(), "AI_TEST_FAILED");
      }
      throw error;
    }
    if (stored && !input.base_url && !input.model && !input.api_key) {
      await this.repository.markVerified(userId, stored.revision, this.clock().toISOString(), null);
    }
    await this.repository.audit(userId, "ai.config_tested", requestId, this.clock().toISOString());
    return { ok: true as const, model: response.model, latency_ms: Math.max(0, Date.now() - started) };
  }

  async deleteConfig(userId: string, input: DeleteAiUserConfigInput, requestId: string) {
    if (!await this.repository.delete(userId, input.base_revision)) {
      throw new UserAiConfigError("AI_CONFIG_CONFLICT", "AI configuration changed before it could be deleted", 409);
    }
    await this.repository.audit(userId, "ai.config_deleted", requestId, this.clock().toISOString());
    return { deleted: true as const };
  }
}
