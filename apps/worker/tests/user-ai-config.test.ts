import { describe, expect, it } from "vitest";
import { D1AiConfigRepository } from "../src/ai/d1-ai-config-repository";
import { UserAiConfigService, normalizeAiEndpoint } from "../src/ai/user-ai-config-service";
import { UserSecretBox } from "../src/security/user-secret-box";
import { createTestD1 } from "./helpers/d1";

const now = "2026-08-25T00:00:00.000Z";

describe("personal AI configuration", () => {
  it("normalizes public HTTPS OpenAI-compatible endpoints and rejects SSRF targets", () => {
    expect(normalizeAiEndpoint("https://api.deepseek.com/v1")).toBe("https://api.deepseek.com/v1/chat/completions");
    expect(normalizeAiEndpoint("https://openrouter.ai/api/v1/chat/completions")).toBe("https://openrouter.ai/api/v1/chat/completions");
    for (const value of [
      "http://api.example.com/v1", "https://127.0.0.1/v1", "https://localhost/v1",
      "https://metadata.internal/v1", "https://user:pass@example.com/v1", "https://example.com:8443/v1",
      "https://example.com/v1?token=secret",
    ]) expect(() => normalizeAiEndpoint(value)).toThrow();
  });

  it("stores only ciphertext and returns a masked user-global summary", async () => {
    const test = await createTestD1();
    try {
      await test.db.prepare(
        "INSERT INTO users (id,email,password_hash,display_name,status,created_at,updated_at) VALUES ('user-1','one@example.test','hash','One','active',?,?)",
      ).bind(now, now).run();
      const repository = new D1AiConfigRepository(test.db);
      const service = new UserAiConfigService(repository, new UserSecretBox("c".repeat(64)), { clock: () => new Date(now) });

      const summary = await service.save("user-1", {
        base_url: "https://api.deepseek.com/v1",
        model: "deepseek-chat",
        api_key: "sk-personal-secret-key",
        base_revision: null,
      });
      expect(summary).toMatchObject({ configured: true, source: "personal", model: "deepseek-chat", revision: 1 });
      expect(summary).not.toHaveProperty("api_key");
      const raw = await test.db.prepare("SELECT api_key_ciphertext, base_url FROM user_ai_configs WHERE user_id='user-1'").first<{ api_key_ciphertext: string; base_url: string }>();
      expect(raw?.api_key_ciphertext).not.toContain("sk-personal-secret-key");
      expect(raw?.base_url).toBe("https://api.deepseek.com/v1/chat/completions");
      await expect(service.resolve("user-1")).resolves.toMatchObject({ apiKey: "sk-personal-secret-key", model: "deepseek-chat" });
      await expect(service.status("user-2")).resolves.toEqual({ configured: false, source: "unconfigured" });
    } finally {
      await test.dispose();
    }
  });
});
