import { afterEach, describe, expect, it, vi } from "vitest";

import { createBetaWorker } from "../src/bootstrap";
import { SecureTokenService } from "../src/auth/crypto";
import { createTestD1, seedTenants } from "./helpers/d1";

const now = "2026-08-28T00:00:00.000Z";
const sessionToken = "provider-selection-session";
const rateLimitSecret = "rate-limit-secret-that-is-at-least-32-characters";

const baseEnv = {
  APP_BASE_URL: "https://beta.test",
  RATE_LIMIT_SECRET: rateLimitSecret,
  TURNSTILE_SECRET_KEY: "turnstile-secret",
  RESEND_API_KEY: "resend-secret",
  EMAIL_FROM: "Nexus Notes <notes@beta.test>",
  USER_SECRETS_ENCRYPTION_KEY: "user-secret-encryption-key-that-is-long-enough",
};

const disposals: Array<() => Promise<void>> = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(disposals.splice(0).map((dispose) => dispose()));
});

async function setup() {
  const test = await createTestD1();
  disposals.push(test.dispose);
  await seedTenants(test.db);
  const tokenHash = await new SecureTokenService(`auth:${rateLimitSecret}`).hash(sessionToken);
  await test.db.prepare(
    "INSERT INTO sessions (id,user_id,token_hash,expires_at,last_seen_at,created_at) VALUES ('session-1','user-1',?,?,?,?)",
  ).bind(tokenHash, "2099-01-01T00:00:00.000Z", now, now).run();
  await test.db.prepare(
    "INSERT INTO workspace_members (workspace_id,user_id,role,revision,joined_at,updated_at) VALUES ('ws-1','user-1','owner',1,?,?)",
  ).bind(now, now).run();
  return test;
}

function request(path: string, init: RequestInit = {}) {
  return new Request(`https://beta.test${path}`, {
    ...init,
    headers: {
      cookie: `nexus_session=${sessionToken}`,
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
  });
}

describe("AI provider selection", () => {
  it("uses the Workers AI binding as the default system provider without an API key", async () => {
    const test = await setup();
    const run = vi.fn(async () => ({ response: "来自系统 Workers AI" }));
    const externalFetch = vi.fn();
    vi.stubGlobal("fetch", externalFetch);

    const chat = await createBetaWorker().fetch(request("/api/v2/ai/chat", {
      method: "POST",
      headers: { "x-workspace-id": "ws-1" },
      body: JSON.stringify({ messages: [{ role: "user", content: "你好" }] }),
    }), {
      DB: test.db,
      ...baseEnv,
      AI_ENABLED: "true",
      AI: { run, toMarkdown: vi.fn() },
    });

    const body = await chat.text();
    expect(chat.status, body).toBe(200);
    expect(JSON.parse(body)).toMatchObject({ data: { message: "来自系统 Workers AI" } });
    expect(run).toHaveBeenCalledWith(
      "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
      expect.objectContaining({ messages: [{ role: "user", content: "你好" }], stream: false }),
    );
    expect(externalFetch).not.toHaveBeenCalled();
  });

  it("uses a personal provider while the system AI is disabled", async () => {
    const test = await setup();
    const provider = vi.fn(async () => Response.json({ choices: [{ message: { content: "来自个人 AI" } }] }));
    vi.stubGlobal("fetch", provider);
    const env = { ...baseEnv, AI_ENABLED: "false", AI_CHAT_API_URL: "https://system.example/v1/chat/completions", AI_CHAT_API_KEY: "system-key", AI_CHAT_MODEL: "system-model" };

    const save = await createBetaWorker().fetch(request("/api/v2/ai/config", {
      method: "PUT",
      body: JSON.stringify({ base_url: "https://personal.example/v1", model: "personal-model", api_key: "personal-key-123456", base_revision: null }),
    }), { DB: test.db, ...env });
    expect(save.status).toBe(200);

    const select = await createBetaWorker().fetch(request("/api/v2/ai/provider", {
      method: "PATCH",
      body: JSON.stringify({ source: "personal", base_revision: 1 }),
    }), { DB: test.db, ...env });
    expect(select.status).toBe(200);

    const chat = await createBetaWorker().fetch(request("/api/v2/ai/chat", {
      method: "POST",
      headers: { "x-workspace-id": "ws-1" },
      body: JSON.stringify({ messages: [{ role: "user", content: "你好" }] }),
    }), { DB: test.db, ...env });

    const chatBody = await chat.text();
    expect(chat.status, chatBody).toBe(200);
    expect(JSON.parse(chatBody)).toMatchObject({ data: { message: "来自个人 AI" } });
    expect(provider).toHaveBeenCalledWith("https://personal.example/v1/chat/completions", expect.anything());
  });

  it("falls back to the system provider when the selected personal provider is absent", async () => {
    const test = await setup();
    const provider = vi.fn(async () => Response.json({ choices: [{ message: { content: "来自系统 AI" } }] }));
    vi.stubGlobal("fetch", provider);
    const env = { ...baseEnv, AI_ENABLED: "true", AI_CHAT_API_URL: "https://system.example/v1/chat/completions", AI_CHAT_API_KEY: "system-key", AI_CHAT_MODEL: "system-model" };

    const select = await createBetaWorker().fetch(request("/api/v2/ai/provider", {
      method: "PATCH",
      body: JSON.stringify({ source: "personal", base_revision: 1 }),
    }), { DB: test.db, ...env });
    expect(select.status).toBe(200);

    const chat = await createBetaWorker().fetch(request("/api/v2/ai/chat", {
      method: "POST",
      headers: { "x-workspace-id": "ws-1" },
      body: JSON.stringify({ messages: [{ role: "user", content: "你好" }] }),
    }), { DB: test.db, ...env });

    const chatBody = await chat.text();
    expect(chat.status, chatBody).toBe(200);
    expect(JSON.parse(chatBody)).toMatchObject({ data: { message: "来自系统 AI" } });
    expect(provider).toHaveBeenCalledWith("https://system.example/v1/chat/completions", expect.anything());
  });

  it("keeps provider selection isolated by user", async () => {
    const test = await setup();
    const userTwoToken = "provider-selection-user-two";
    const userTwoHash = await new SecureTokenService(`auth:${rateLimitSecret}`).hash(userTwoToken);
    await test.db.prepare(
      "INSERT INTO sessions (id,user_id,token_hash,expires_at,last_seen_at,created_at) VALUES ('session-2','user-2',?,?,?,?)",
    ).bind(userTwoHash, "2099-01-01T00:00:00.000Z", now, now).run();
    const env = { ...baseEnv, AI_ENABLED: "true", AI_CHAT_API_URL: "https://system.example/v1/chat/completions", AI_CHAT_API_KEY: "system-key", AI_CHAT_MODEL: "system-model" };

    const selectOne = await createBetaWorker().fetch(request("/api/v2/ai/provider", {
      method: "PATCH",
      body: JSON.stringify({ source: "personal", base_revision: 1 }),
    }), { DB: test.db, ...env });
    expect(selectOne.status).toBe(200);

    const selectTwo = await createBetaWorker().fetch(new Request("https://beta.test/api/v2/ai/provider", {
      method: "PATCH",
      headers: { cookie: `nexus_session=${userTwoToken}`, "content-type": "application/json" },
      body: JSON.stringify({ source: "system", base_revision: 1 }),
    }), { DB: test.db, ...env });
    expect(selectTwo.status).toBe(200);

    const first = await createBetaWorker().fetch(request("/api/v2/ai/provider"), { DB: test.db, ...env });
    const second = await createBetaWorker().fetch(new Request("https://beta.test/api/v2/ai/provider", {
      headers: { cookie: `nexus_session=${userTwoToken}` },
    }), { DB: test.db, ...env });
    await expect(first.json()).resolves.toMatchObject({ data: { source: "personal" } });
    await expect(second.json()).resolves.toMatchObject({ data: { source: "system" } });
  });
});
