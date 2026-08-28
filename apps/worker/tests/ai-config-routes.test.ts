import { describe, expect, it, vi } from "vitest";
import { createRouteRegistry } from "../src/http/route-registry";
import { registerAiRoutes } from "../src/routes/ai";

const summary = { configured: true, source: "personal" as const, base_url: "https://api.example.test/v1/chat/completions", model: "model", key_hint: "••••1234", verified_at: null, revision: 1 };

function setup(role: "viewer" | "owner" = "owner") {
  const service = {
    status: vi.fn(async () => summary),
    getConfig: vi.fn(async () => summary),
    saveConfig: vi.fn(async () => summary),
    testConfig: vi.fn(async () => ({ ok: true, model: "model", latency_ms: 12 })),
    deleteConfig: vi.fn(async () => ({ deleted: true })),
    chat: vi.fn(async () => ({ message: "已完成", model: "model" })),
    confirmAction: vi.fn(async (_userId: string, _workspace: unknown, actionId: string, _baseRevision: number) => ({ action_id: actionId, status: "executed" as const })),
    rejectAction: vi.fn(async (_userId: string, _workspace: unknown, actionId: string, _baseRevision: number) => ({ action_id: actionId, rejected: true })),
  };
  const definitions: Array<{ method: string; path: string; minimumRole?: string }> = [];
  const registry = createRouteRegistry({
    requestId: () => "req-ai",
    authenticate: vi.fn(async () => ({ userId: "user-1", sessionId: "session-1" })),
    authorizeWorkspace: vi.fn(async () => ({ workspaceId: "ws-1", userId: "user-1", role, capabilities: new Set<string>() })),
  });
  registerAiRoutes({ register(definition) { definitions.push({ method: definition.method, path: definition.path, minimumRole: definition.minimumRole }); registry.register(definition); } }, () => service);
  return { registry, service, definitions };
}

describe("AI personal configuration routes", () => {
  it("keeps personal config session-scoped, chat workspace-scoped, and action routes workspace-scoped", async () => {
    const { registry, service, definitions } = setup("viewer");
    const config = await registry.fetch(new Request("https://beta.test/api/v2/ai/config"), {});
    const save = await registry.fetch(new Request("https://beta.test/api/v2/ai/config", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ base_url: "https://api.example.test/v1", model: "model", api_key: "sk-personal-secret", base_revision: null }),
    }), {});
    const test = await registry.fetch(new Request("https://beta.test/api/v2/ai/config/test", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}),
    }), {});
    const chat = await registry.fetch(new Request("https://beta.test/api/v2/ai/chat", {
      method: "POST", headers: { "content-type": "application/json", "x-workspace-id": "ws-1" },
      body: JSON.stringify({ messages: [{ role: "user", content: "你好" }] }),
    }), {});
    const confirm = await registry.fetch(new Request("https://beta.test/api/v2/ai/actions/action-1/confirm", {
      method: "POST",
      headers: { "content-type": "application/json", "x-workspace-id": "ws-1" },
      body: JSON.stringify({ action_id: "action-1", base_revision: 1 }),
    }), {});
    const reject = await registry.fetch(new Request("https://beta.test/api/v2/ai/actions/action-1/reject", {
      method: "POST",
      headers: { "content-type": "application/json", "x-workspace-id": "ws-1" },
      body: JSON.stringify({ action_id: "action-1", base_revision: 1 }),
    }), {});

    expect([config.status, save.status, test.status, chat.status, confirm.status, reject.status]).toEqual([200, 200, 200, 200, 200, 200]);
    expect(service.getConfig).toHaveBeenCalledWith("user-1");
    expect(service.saveConfig).toHaveBeenCalledWith("user-1", expect.objectContaining({ api_key: "sk-personal-secret" }), "req-ai");
    expect(service.testConfig).toHaveBeenCalledWith("user-1", {}, expect.any(AbortSignal), "req-ai");
    expect(service.chat).toHaveBeenCalledWith(expect.anything(), expect.any(AbortSignal), "user-1", expect.objectContaining({
      workspaceId: "ws-1",
      userId: "user-1",
      role: "viewer",
    }));
    expect(definitions).toContainEqual({
      method: "POST",
      path: "/api/v2/ai/actions/:actionId/confirm",
      minimumRole: undefined,
    });
    expect(definitions).toContainEqual({
      method: "POST",
      path: "/api/v2/ai/actions/:actionId/reject",
      minimumRole: undefined,
    });
    expect(service.confirmAction).toHaveBeenCalledWith("user-1", expect.objectContaining({ workspaceId: "ws-1" }), "action-1", 1, "req-ai");
    expect(service.rejectAction).toHaveBeenCalledWith("user-1", expect.objectContaining({ workspaceId: "ws-1" }), "action-1", 1, "req-ai");
    expect(JSON.stringify(await save.json())).not.toContain("sk-personal-secret");
  });

  it("does not require owner role before service calls when the workspace member owns the proposal", async () => {
    const { registry, service } = setup("viewer");
    const confirm = await registry.fetch(new Request("https://beta.test/api/v2/ai/actions/action-1/confirm", {
      method: "POST",
      headers: { "content-type": "application/json", "x-workspace-id": "ws-1" },
      body: JSON.stringify({ action_id: "action-1", base_revision: 1 }),
    }), {});
    const reject = await registry.fetch(new Request("https://beta.test/api/v2/ai/actions/action-1/reject", {
      method: "POST",
      headers: { "content-type": "application/json", "x-workspace-id": "ws-1" },
      body: JSON.stringify({ action_id: "action-1", base_revision: 1 }),
    }), {});

    expect([confirm.status, reject.status]).toEqual([200, 200]);
    expect(service.confirmAction).toHaveBeenCalled();
    expect(service.rejectAction).toHaveBeenCalled();
  });
});
