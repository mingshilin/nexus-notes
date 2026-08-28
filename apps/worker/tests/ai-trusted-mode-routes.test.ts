import { describe, expect, it, vi } from "vitest";
import { createRouteRegistry } from "../src/http/route-registry";
import { registerAiRoutes } from "../src/routes/ai";
import { D1AiToolRepository } from "../src/ai/ai-tool-repository";
import { applyMigration, createTestD1, seedTenants } from "./helpers/d1";

function setup(role: "viewer" | "owner" = "owner") {
  const service = {
    status: vi.fn(async () => ({ configured: false, source: "unconfigured" as const })),
    getTrustedMode: vi.fn(async (workspaceId: string) => ({ workspace_id: workspaceId, enabled: false, expires_at: null, revision: 1 })),
    updateTrustedMode: vi.fn(async (workspaceId: string, input: { enabled: boolean; expires_at: string | null; base_revision: number }) => ({
      workspace_id: workspaceId,
      enabled: input.enabled,
      expires_at: input.expires_at,
      revision: input.base_revision + 1,
    })),
    listActionHistory: vi.fn(async () => [{
      action_id: "action-1",
      tool: "create_note" as const,
      risk: "safe_write" as const,
      status: "executed" as const,
      created_at: "2026-08-28T00:00:00.000Z",
      updated_at: "2026-08-28T00:00:01.000Z",
    }]),
    chat: vi.fn(async () => ({ message: "ok", model: "model" })),
  };
  const registry = createRouteRegistry({
    requestId: () => "req-trusted",
    authenticate: vi.fn(async () => ({ userId: "user-1", sessionId: "session-1" })),
    authorizeWorkspace: vi.fn(async () => ({ workspaceId: "ws-1", userId: "user-1", role, capabilities: new Set<string>() })),
  });
  const definitions: Array<{ method: string; path: string; minimumRole?: string }> = [];
  registerAiRoutes({ register(definition) {
    definitions.push({ method: definition.method, path: definition.path, minimumRole: definition.minimumRole });
    registry.register(definition);
  } }, () => service);
  return { registry, service, definitions };
}

describe("AI trusted mode and action history routes", () => {
  it("registers workspace-scoped read/write routes and returns only safe history fields", async () => {
    const { registry, service, definitions } = setup();
    expect(definitions).toContainEqual({ method: "GET", path: "/api/v2/ai/trusted-mode", minimumRole: "viewer" });
    expect(definitions).toContainEqual({ method: "PATCH", path: "/api/v2/ai/trusted-mode", minimumRole: "editor" });
    expect(definitions).toContainEqual({ method: "GET", path: "/api/v2/ai/actions/history", minimumRole: "viewer" });

    const get = await registry.fetch(new Request("https://beta.test/api/v2/ai/trusted-mode", {
      headers: { "x-workspace-id": "ws-1" },
    }), {});
    const update = await registry.fetch(new Request("https://beta.test/api/v2/ai/trusted-mode", {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-workspace-id": "ws-1" },
      body: JSON.stringify({ enabled: true, expires_at: "2099-08-29T00:00:00.000Z", base_revision: 1 }),
    }), {});
    const history = await registry.fetch(new Request("https://beta.test/api/v2/ai/actions/history?limit=10", {
      headers: { "x-workspace-id": "ws-1" },
    }), {});

    expect([get.status, update.status, history.status]).toEqual([200, 200, 200]);
    expect(service.getTrustedMode).toHaveBeenCalledWith("ws-1");
    expect(service.updateTrustedMode).toHaveBeenCalledWith("ws-1", {
      enabled: true,
      expires_at: "2099-08-29T00:00:00.000Z",
      base_revision: 1,
    }, "req-trusted");
    expect(service.listActionHistory).toHaveBeenCalledWith("user-1", "ws-1", 10);
    const body = await history.json() as { success: boolean; data: { items: Array<Record<string, unknown>> } };
    expect(body.data.items[0]).toEqual({
      action_id: "action-1",
      tool: "create_note",
      risk: "safe_write",
      status: "executed",
      created_at: "2026-08-28T00:00:00.000Z",
      updated_at: "2026-08-28T00:00:01.000Z",
    });
    expect(JSON.stringify(body)).not.toMatch(/prompt|body|api_key|token|secret/iu);
  });

  it("keeps trusted mode writes unavailable to viewers", async () => {
    const { registry, service } = setup("viewer");
    const response = await registry.fetch(new Request("https://beta.test/api/v2/ai/trusted-mode", {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-workspace-id": "ws-1" },
      body: JSON.stringify({ enabled: false, expires_at: null, base_revision: 1 }),
    }), {});

    expect(response.status).toBe(403);
    expect(service.updateTrustedMode).not.toHaveBeenCalled();
  });

  it("uses a D1 CAS for trusted mode and returns only safe, workspace-owned history", async () => {
    const testD1 = await createTestD1({ through: 24 });
    try {
      await seedTenants(testD1.db);
      const repository = new D1AiToolRepository(testD1.db);
      const enabled = await repository.updateTrustedMode("ws-1", {
        enabled: true,
        expires_at: "2099-08-29T00:00:00.000Z",
        base_revision: 1,
      });
      expect(enabled).toEqual({
        workspace_id: "ws-1",
        enabled: true,
        expires_at: "2099-08-29T00:00:00.000Z",
        revision: 2,
      });
      await expect(repository.updateTrustedMode("ws-1", {
        enabled: false,
        expires_at: null,
        base_revision: 1,
      })).resolves.toBeNull();

      await testD1.db.prepare(
        `INSERT INTO ai_action_proposals
         (id, user_id, workspace_id, tool, input_json, status, idempotency_key, revision, expires_at, created_at, updated_at, error_code)
         VALUES ('history-1', 'user-1', 'ws-1', 'send_email', '{"body_text":"secret","api_key":"secret"}', 'failed', 'ai-action:user-1:history-1', 1, ?, ?, ?, 'AI_EMAIL_PERMANENT_FAILURE')`,
      ).bind("2099-08-29T00:00:00.000Z", "2026-08-28T00:00:00.000Z", "2026-08-28T00:00:00.000Z").run();
      await testD1.db.prepare(
        `INSERT INTO ai_action_proposals
         (id, user_id, workspace_id, tool, input_json, status, idempotency_key, revision, expires_at, created_at, updated_at)
         VALUES ('history-other', 'user-1', 'ws-2', 'create_note', '{"title":"other"}', 'executed', 'ai-action:user-1:history-other', 1, ?, ?, ?)`,
      ).bind("2099-08-29T00:00:00.000Z", "2026-08-28T00:00:00.000Z", "2026-08-28T00:00:00.000Z").run();

      const history = await repository.listActionHistory("user-1", "ws-1", 50);
      expect(history).toEqual([{
        action_id: "history-1",
        tool: "send_email",
        risk: "external_or_destructive",
        status: "failed",
        created_at: "2026-08-28T00:00:00.000Z",
        updated_at: "2026-08-28T00:00:00.000Z",
        error_code: "AI_EMAIL_PERMANENT_FAILURE",
      }]);
      expect(JSON.stringify(history)).not.toMatch(/secret|body_text|api_key/iu);
    } finally {
      await testD1.dispose();
    }
  });
});
