import { describe, expect, it, vi } from "vitest";
import { createRouteRegistry } from "../src/http/route-registry";
import { registerAiRoutes } from "../src/routes/ai";

const summary = { configured: true, source: "personal" as const, base_url: "https://api.example.test/v1/chat/completions", model: "model", key_hint: "••••1234", verified_at: null, revision: 1 };

function setup() {
  const service = {
    status: vi.fn(async () => summary),
    getConfig: vi.fn(async () => summary),
    saveConfig: vi.fn(async () => summary),
    testConfig: vi.fn(async () => ({ ok: true, model: "model", latency_ms: 12 })),
    deleteConfig: vi.fn(async () => ({ deleted: true })),
    chat: vi.fn(async () => ({ message: "已完成", model: "model" })),
  };
  const registry = createRouteRegistry({
    requestId: () => "req-ai",
    authenticate: vi.fn(async () => ({ userId: "user-1", sessionId: "session-1" })),
    authorizeWorkspace: vi.fn(async () => ({ workspaceId: "ws-1", userId: "user-1", role: "viewer", capabilities: new Set<string>() })),
  });
  registerAiRoutes(registry, () => service);
  return { registry, service };
}

describe("AI personal configuration routes", () => {
  it("keeps personal config session-scoped and chat workspace-scoped", async () => {
    const { registry, service } = setup();
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

    expect([config.status, save.status, test.status, chat.status]).toEqual([200, 200, 200, 200]);
    expect(service.getConfig).toHaveBeenCalledWith("user-1");
    expect(service.saveConfig).toHaveBeenCalledWith("user-1", expect.objectContaining({ api_key: "sk-personal-secret" }), "req-ai");
    expect(service.testConfig).toHaveBeenCalledWith("user-1", {}, expect.any(AbortSignal), "req-ai");
    expect(service.chat).toHaveBeenCalledWith(expect.anything(), expect.any(AbortSignal), "user-1");
    expect(JSON.stringify(await save.json())).not.toContain("sk-personal-secret");
  });
});
