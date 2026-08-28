import { afterEach, describe, expect, it, vi } from "vitest";

import { D1AiToolRepository, D1NoteRepository, NoteService } from "../src";
import { createBetaWorker } from "../src/bootstrap";
import { aiActionTargetId } from "../src/ai/ai-tool-model";
import { SecureTokenService } from "../src/auth/crypto";
import { createTestD1, seedTenants } from "./helpers/d1";

const disposals: Array<() => Promise<void>> = [];
const now = "2026-08-28T00:00:00.000Z";
const sessionToken = "session-token-for-trusted-chat";
const rateLimitSecret = "rate-limit-secret-that-is-at-least-32-characters";

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(disposals.splice(0).map((dispose) => dispose()));
});

describe("AI trusted chat route", () => {
  it("executes a trusted create_note action without returning a confirmation proposal", async () => {
    const test = await createTestD1({ through: 22 });
    disposals.push(test.dispose);
    await seedTenants(test.db);
    const tokenHash = await new SecureTokenService(`auth:${rateLimitSecret}`).hash(sessionToken);
    await test.db.batch([
      test.db.prepare(
        "INSERT INTO sessions (id, user_id, token_hash, expires_at, last_seen_at, created_at) VALUES ('session-1', 'user-1', ?, ?, ?, ?)",
      ).bind(tokenHash, "2099-01-01T00:00:00.000Z", now, now),
      test.db.prepare(
        "INSERT INTO workspace_members (workspace_id, user_id, role, revision, joined_at, updated_at) VALUES ('ws-1', 'user-1', 'owner', 1, ?, ?)",
      ).bind(now, now),
      test.db.prepare(
        "INSERT INTO ai_trusted_modes (workspace_id, enabled, expires_at, revision) VALUES ('ws-1', 1, '2099-01-01T00:00:00.000Z', 1)",
      ),
    ]);

    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      choices: [{ message: {
        content: "已创建路线图笔记。",
        tool_calls: [{
          id: "call-create-note",
          type: "function",
          function: { name: "create_note", arguments: JSON.stringify({ title: "路线图", content: "第一步" }) },
        }],
      } }],
    })));

    const response = await createBetaWorker().fetch(new Request("https://beta.test/api/v2/ai/chat", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `nexus_session=${sessionToken}`,
        "x-workspace-id": "ws-1",
      },
      body: JSON.stringify({ messages: [{ role: "user", content: "创建路线图笔记" }] }),
    }), {
      DB: test.db,
      APP_BASE_URL: "https://beta.test",
      RATE_LIMIT_SECRET: rateLimitSecret,
      TURNSTILE_SECRET_KEY: "turnstile-secret",
      RESEND_API_KEY: "resend-secret",
      EMAIL_FROM: "Nexus Notes <notes@beta.test>",
      AI_ENABLED: "true",
      AI_CHAT_API_URL: "https://ai.example.test/v1/chat/completions",
      AI_CHAT_API_KEY: "server-only-key",
      AI_CHAT_MODEL: "beta-model",
      USER_SECRETS_ENCRYPTION_KEY: "user-secret-encryption-key-that-is-long-enough",
    });

    expect(response.status).toBe(200);
    const body = await response.json() as { data: { message: string; action_proposals?: unknown[]; action_results?: Array<{ status: string }> } };
    expect(body.data.message).toBe("已创建路线图笔记。");
    expect(body.data.action_proposals).toBeUndefined();
    expect(body.data.action_results).toEqual([expect.objectContaining({ status: "executed" })]);
    await expect(test.db.prepare(
      "SELECT title, content FROM notes WHERE workspace_id = 'ws-1'",
    ).first()).resolves.toEqual({ title: "路线图", content: "第一步" });
  });

  it("keeps AI disabled when the Worker explicitly sets AI_ENABLED=false", async () => {
    const test = await createTestD1({ through: 22 });
    disposals.push(test.dispose);
    await seedTenants(test.db);
    const tokenHash = await new SecureTokenService(`auth:${rateLimitSecret}`).hash(sessionToken);
    await test.db.batch([
      test.db.prepare(
        "INSERT INTO sessions (id, user_id, token_hash, expires_at, last_seen_at, created_at) VALUES ('session-disabled', 'user-1', ?, ?, ?, ?)",
      ).bind(tokenHash, "2099-01-01T00:00:00.000Z", now, now),
      test.db.prepare(
        "INSERT INTO workspace_members (workspace_id, user_id, role, revision, joined_at, updated_at) VALUES ('ws-1', 'user-1', 'owner', 1, ?, ?)",
      ).bind(now, now),
    ]);
    const provider = vi.fn(async () => Response.json({ choices: [{ message: { content: "should not run" } }] }));
    vi.stubGlobal("fetch", provider);
    const env = {
      DB: test.db,
      APP_BASE_URL: "https://beta.test",
      RATE_LIMIT_SECRET: rateLimitSecret,
      TURNSTILE_SECRET_KEY: "turnstile-secret",
      RESEND_API_KEY: "resend-secret",
      EMAIL_FROM: "Nexus Notes <notes@beta.test>",
      AI_ENABLED: "false",
      AI_CHAT_API_URL: "https://ai.example.test/v1/chat/completions",
      AI_CHAT_API_KEY: "server-only-key",
      AI_CHAT_MODEL: "beta-model",
      USER_SECRETS_ENCRYPTION_KEY: "user-secret-encryption-key-that-is-long-enough",
    };

    const response = await createBetaWorker().fetch(new Request("https://beta.test/api/v2/ai/chat", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `nexus_session=${sessionToken}`,
        "x-workspace-id": "ws-1",
      },
      body: JSON.stringify({ messages: [{ role: "user", content: "你好" }] }),
    }), env);

    expect(response.status).toBe(503);
    expect(provider).not.toHaveBeenCalled();
    const statusResponse = await createBetaWorker().fetch(new Request("https://beta.test/api/v2/ai/status", {
      headers: { cookie: `nexus_session=${sessionToken}`, "x-workspace-id": "ws-1" },
    }), env);
    expect(statusResponse.status).toBe(503);
    await expect(statusResponse.json()).resolves.toMatchObject({
      success: false,
      error: { code: "SERVER_NOT_CONFIGURED" },
    });
    const configBody = { base_url: "https://api.example.test/v1", model: "beta-model", api_key: "personal-secret-key-123456" };
    const saveResponse = await createBetaWorker().fetch(new Request("https://beta.test/api/v2/ai/config", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie: `nexus_session=${sessionToken}` },
      body: JSON.stringify({ ...configBody, base_revision: null }),
    }), env);
    expect(saveResponse.status).toBe(503);
    const testConfigResponse = await createBetaWorker().fetch(new Request("https://beta.test/api/v2/ai/config/test", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `nexus_session=${sessionToken}` },
      body: JSON.stringify(configBody),
    }), env);
    expect(testConfigResponse.status).toBe(503);
    const deleteResponse = await createBetaWorker().fetch(new Request("https://beta.test/api/v2/ai/config", {
      method: "DELETE",
      headers: { "content-type": "application/json", cookie: `nexus_session=${sessionToken}` },
      body: JSON.stringify({ base_revision: 1 }),
    }), env);
    expect(deleteResponse.status).toBe(503);
    const rejectResponse = await createBetaWorker().fetch(new Request("https://beta.test/api/v2/ai/actions/action-disabled/reject", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `nexus_session=${sessionToken}`,
        "x-workspace-id": "ws-1",
      },
      body: JSON.stringify({ action_id: "action-disabled", base_revision: 1 }),
    }), env);
    expect(rejectResponse.status).toBe(503);
  });

  it("replays a committed note mutation before the proposal completion write", async () => {
    const test = await createTestD1({ through: 22 });
    disposals.push(test.dispose);
    await seedTenants(test.db);
    const tokenHash = await new SecureTokenService(`auth:${rateLimitSecret}`).hash(sessionToken);
    await test.db.batch([
      test.db.prepare(
        "INSERT INTO sessions (id, user_id, token_hash, expires_at, last_seen_at, created_at) VALUES ('session-replay', 'user-1', ?, ?, ?, ?)",
      ).bind(tokenHash, "2099-01-01T00:00:00.000Z", now, now),
      test.db.prepare(
        "INSERT INTO workspace_members (workspace_id, user_id, role, revision, joined_at, updated_at) VALUES ('ws-1', 'user-1', 'owner', 1, ?, ?)",
      ).bind(now, now),
    ]);
    const noteService = new NoteService(new D1NoteRepository(test.db), {
      createId: () => crypto.randomUUID(),
      clock: () => new Date(now),
    });
    const note = await noteService.create({ workspaceId: "ws-1", userId: "user-1", targetId: "replay-note" }, {
      title: "Original",
      content: "Body",
    });
    const actionRepository = new D1AiToolRepository(test.db);
    await actionRepository.insertProposal({
      actionId: "action-replay",
      userId: "user-1",
      workspaceId: "ws-1",
      tool: "update_note",
      input: { target_note_id: note.id, base_revision: 1, patch: { title: "AI title" } },
      expiresAt: "2099-01-01T00:00:00.000Z",
      now,
      requiresConfirmation: true,
    });
    const confirmed = await actionRepository.claimConfirmation({
      userId: "user-1", workspaceId: "ws-1", actionId: "action-replay", baseRevision: 1, now,
    });
    expect(confirmed).toMatchObject({ status: "confirmed", revision: 2 });
    const executing = await actionRepository.claimExecution({
      userId: "user-1", workspaceId: "ws-1", actionId: "action-replay", baseRevision: 2, now,
    });
    expect(executing).toMatchObject({ status: "executing", revision: 3 });
    await noteService.update({
      workspaceId: "ws-1",
      userId: "user-1",
      requestId: "request-before-crash",
      targetId: aiActionTargetId("update_note", "action-replay"),
    }, note.id, { base_revision: 1, title: "AI title", source: "manual" });
    await test.db.prepare(
      "UPDATE ai_action_proposals SET execution_lease_until = ? WHERE id = ? AND status = 'executing'",
    ).bind("2020-01-01T00:00:00.000Z", "action-replay").run();

    const response = await createBetaWorker().fetch(new Request("https://beta.test/api/v2/ai/actions/action-replay/confirm", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `nexus_session=${sessionToken}`,
        "x-workspace-id": "ws-1",
      },
      body: JSON.stringify({ action_id: "action-replay", base_revision: 1 }),
    }), {
      DB: test.db,
      APP_BASE_URL: "https://beta.test",
      RATE_LIMIT_SECRET: rateLimitSecret,
      TURNSTILE_SECRET_KEY: "turnstile-secret",
      RESEND_API_KEY: "resend-secret",
      EMAIL_FROM: "Nexus Notes <notes@beta.test>",
      AI_ENABLED: "true",
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { action: { action_id: "action-replay", status: "executed", entity_id: note.id, revision: 2 } },
    });
    await expect(actionRepository.getOwned("user-1", "ws-1", "action-replay")).resolves.toMatchObject({ status: "executed" });
    await expect(noteService.get({ workspaceId: "ws-1", userId: "user-1" }, note.id)).resolves.toMatchObject({
      title: "AI title", revision: 2,
    });
  });
});
