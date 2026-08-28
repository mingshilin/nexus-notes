import { describe, expect, it, vi } from "vitest";
import { AiChatService, AiChatServiceError } from "../src/ai/ai-chat-service";
import { registerAiRoutes } from "../src/routes/ai";

describe("AI chat proxy", () => {
  it("registers an authenticated workspace route with viewer access", () => {
    const definitions: Array<{ method: string; path: string; auth: string; minimumRole?: string }> = [];
    registerAiRoutes({ register(definition: typeof definitions[number]) { definitions.push(definition); } }, () => new AiChatService({}));

    expect(definitions.map(({ method, path, auth }) => ({ method, path, auth }))).toEqual([
      { method: "GET", path: "/api/v2/ai/status", auth: "workspace" },
      { method: "GET", path: "/api/v2/ai/config", auth: "session" },
      { method: "PUT", path: "/api/v2/ai/config", auth: "session" },
      { method: "POST", path: "/api/v2/ai/config/test", auth: "session" },
      { method: "DELETE", path: "/api/v2/ai/config", auth: "session" },
      { method: "POST", path: "/api/v2/ai/actions/:actionId/confirm", auth: "workspace" },
      { method: "POST", path: "/api/v2/ai/actions/:actionId/reject", auth: "workspace" },
      { method: "POST", path: "/api/v2/ai/chat", auth: "workspace" },
    ]);
    expect(definitions[0]).toEqual(expect.objectContaining({ minimumRole: "viewer" }));
    expect(definitions.at(-1)).toEqual(expect.objectContaining({
      minimumRole: "viewer",
      rateLimit: { bucket: "ip", limit: 30, windowSeconds: 60 },
    }));
  });

  it("awaits the provider response before building the route envelope", async () => {
    const definitions: Array<{ path: string; handler: (context: any) => Promise<{ data: unknown }> }> = [];
    registerAiRoutes({ register(definition: { path: string; handler: (context: any) => Promise<{ data: unknown }> }) { definitions.push(definition); } }, () => ({
      chat: vi.fn(async () => ({ message: "已完成", model: "beta-model" })),
    }));

    const result = await definitions.find((definition) => definition.path === "/api/v2/ai/chat")!.handler({ env: {}, body: { messages: [{ role: "user", content: "完成" }] }, signal: new AbortController().signal });
    expect(result.data).toEqual({ message: "已完成", model: "beta-model" });
  });

  it("passes the server workspace context and explicit read scope to the AI service", async () => {
    const definitions: Array<{ path: string; handler: (context: any) => Promise<{ data: unknown }> }> = [];
    const service = {
      chat: vi.fn(async (input: unknown, signal: AbortSignal, userId?: string, workspace?: unknown) => ({
        message: JSON.stringify({ input, aborted: signal.aborted, userId, workspace }),
        model: "beta-model",
      })),
    };
    registerAiRoutes({ register(definition: { path: string; handler: (context: any) => Promise<{ data: unknown }> }) { definitions.push(definition); } }, () => service);
    const workspace = { workspaceId: "server-ws", userId: "server-user", role: "viewer" as const, capabilities: new Set<string>() };
    const input = {
      messages: [{ role: "user", content: "查找" }],
      read_context: { selected_note_ids: ["note-1"], selected_database_ids: [], allow_workspace_search: false },
    };
    const signal = new AbortController().signal;
    await definitions.find((definition) => definition.path === "/api/v2/ai/chat")!.handler({
      env: {}, body: input, signal, principal: { userId: "server-user" }, workspace,
    });
    expect(service.chat).toHaveBeenCalledWith(input, signal, "server-user", workspace);
  });

  it("sends the configured model and secret only from the Worker", async () => {
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(init?.headers).toEqual(expect.objectContaining({ authorization: "Bearer server-only-key" }));
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({
        model: "beta-model",
        messages: [{ role: "user", content: "整理我的任务" }],
        stream: false,
        tool_choice: "auto",
      });
      expect(body.tools.map((tool: { function: { name: string } }) => tool.function.name)).toEqual([
        "create_note",
        "create_reminder",
        "create_notification",
        "send_email",
        "update_note",
        "move_note",
        "archive_note",
        "restore_note",
        "delete_note",
        "create_folder",
        "apply_tag",
        "create_database_record",
        "update_database_record",
        "apply_template",
      ]);
      expect(JSON.stringify(body)).not.toContain("server-only-key");
      return Response.json({
        choices: [{ message: { content: "先列出三个最重要的任务。" } }],
      });
    });
    const service = new AiChatService({
      apiUrl: "https://ai.example.test/v1/chat/completions",
      apiKey: "server-only-key",
      model: "beta-model",
      fetchImpl,
    });

    await expect(service.chat({ messages: [{ role: "user", content: "整理我的任务" }] }, new AbortController().signal))
      .resolves.toEqual({ message: "先列出三个最重要的任务。", model: "beta-model" });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("executes trusted safe-write proposals through the supplied action runner", async () => {
    const fetchImpl = vi.fn(async () => Response.json({
      choices: [{
        message: {
          content: "已创建笔记。",
          tool_calls: [{
            id: "call-1",
            type: "function",
            function: { name: "create_note", arguments: JSON.stringify({ title: "Roadmap", content: "Body" }) },
          }],
        },
      }],
    }));
    const proposal = {
      action_id: "action-1",
      tool: "create_note" as const,
      summary: "创建笔记待确认",
      input: { title: "Roadmap", content: "Body" },
      requires_confirmation: false,
      expires_at: "2099-08-25T01:00:00.000Z",
    };
    const executeActions = vi.fn(async () => [{ action_id: "action-1", status: "executed" as const, entity_id: "note-1", revision: 1 }]);
    const service = new AiChatService({
      apiUrl: "https://ai.example.test/v1/chat/completions",
      apiKey: "server-only-key",
      model: "beta-model",
      fetchImpl,
    });

    await expect(service.chat(
      { messages: [{ role: "user", content: "创建路线图" }] },
      new AbortController().signal,
      { proposeActions: vi.fn(async () => [proposal]), executeActions },
    )).resolves.toEqual({
      message: "已创建笔记。",
      model: "beta-model",
      action_results: [{ action_id: "action-1", status: "executed", entity_id: "note-1", revision: 1 }],
    });
    expect(executeActions).toHaveBeenCalledWith([proposal]);
  });

  it("returns trusted business failures without hiding partial action results", async () => {
    const proposal = {
      action_id: "action-failed",
      tool: "create_note" as const,
      summary: "创建笔记待确认",
      input: { title: "Roadmap", content: "Body" },
      requires_confirmation: false,
      expires_at: "2099-08-25T01:00:00.000Z",
    };
    const service = new AiChatService({
      apiUrl: "https://ai.example.test/v1/chat/completions",
      apiKey: "server-only-key",
      model: "beta-model",
      fetchImpl: vi.fn(async () => Response.json({ choices: [{ message: {
        content: "已创建笔记。",
        tool_calls: [{
          id: "call-failed", type: "function",
          function: { name: "create_note", arguments: JSON.stringify({ title: "Roadmap", content: "Body" }) },
        }],
      } }] })),
    });

    await expect(service.chat(
      { messages: [{ role: "user", content: "创建路线图" }] },
      new AbortController().signal,
      {
        proposeActions: vi.fn(async () => [proposal]),
        executeActions: vi.fn(async () => [{
          action_id: "action-failed",
          status: "failed" as const,
          error: { code: "AI_ACTION_EXECUTION_FAILED", message: "safe", status: 500 },
        }]),
      },
    )).resolves.toMatchObject({
      message: "AI 操作完成 0 个，1 个未执行。",
      action_results: [{ action_id: "action-failed", status: "failed" }],
    });
  });

  it("preserves retryable in-progress results in the chat response", async () => {
    const proposal = {
      action_id: "action-in-progress",
      tool: "create_note" as const,
      summary: "创建笔记待确认",
      input: { title: "Roadmap", content: "Body" },
      requires_confirmation: false,
      expires_at: "2099-08-25T01:00:00.000Z",
    };
    const service = new AiChatService({
      apiUrl: "https://ai.example.test/v1/chat/completions",
      apiKey: "server-only-key",
      model: "beta-model",
      fetchImpl: vi.fn(async () => Response.json({ choices: [{ message: {
        content: "创建路线图",
        tool_calls: [{
          id: "call-in-progress", type: "function",
          function: { name: "create_note", arguments: JSON.stringify({ title: "Roadmap", content: "Body" }) },
        }],
      } }] })),
    });

    await expect(service.chat(
      { messages: [{ role: "user", content: "创建路线图" }] },
      new AbortController().signal,
      {
        proposeActions: vi.fn(async () => [proposal]),
        executeActions: vi.fn(async () => [{
          action_id: "action-in-progress",
          status: "failed" as const,
          retryable: true,
          error: { code: "AI_ACTION_IN_PROGRESS", message: "safe", status: 409 },
        }]),
      },
    )).resolves.toMatchObject({
      action_results: [{ action_id: "action-in-progress", retryable: true }],
    });
  });

  it("rejects an HTTP provider URL before sending the API key", async () => {
    const fetchImpl = vi.fn();
    const service = new AiChatService({
      apiUrl: "http://ai.example.test/v1/chat/completions",
      apiKey: "server-only-key",
      model: "beta-model",
      fetchImpl,
    });

    await expect(service.chat({ messages: [{ role: "user", content: "你好" }] }, new AbortController().signal))
      .rejects.toMatchObject<Partial<AiChatServiceError>>({ code: "AI_NOT_CONFIGURED" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects an oversized provider response before decoding the whole body", async () => {
    const service = new AiChatService({
      apiUrl: "https://ai.example.test/v1/chat/completions",
      apiKey: "server-only-key",
      model: "beta-model",
      maxResponseBytes: 16,
      fetchImpl: vi.fn(async () => new Response("x".repeat(100), { headers: { "content-length": "100" } })),
    });

    await expect(service.chat({ messages: [{ role: "user", content: "你好" }] }, new AbortController().signal))
      .rejects.toMatchObject<Partial<AiChatServiceError>>({ code: "AI_PROVIDER_INVALID_RESPONSE" });
  });

  it("rejects a model configuration that cannot satisfy the public response contract", async () => {
    const fetchImpl = vi.fn();
    const service = new AiChatService({
      apiUrl: "https://ai.example.test/v1/chat/completions",
      apiKey: "server-only-key",
      model: "m".repeat(129),
      fetchImpl,
    });

    await expect(service.chat({ messages: [{ role: "user", content: "你好" }] }, new AbortController().signal))
      .rejects.toMatchObject<Partial<AiChatServiceError>>({ code: "AI_NOT_CONFIGURED" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reports incomplete provider settings without revealing the configured key", () => {
    const service = new AiChatService({
      apiUrl: "http://ai.example.test/v1/chat/completions",
      apiKey: "server-only-key",
      model: " ",
    });

    expect(service.status()).toEqual({ configured: false });
    expect(JSON.stringify(service.status())).not.toContain("server-only-key");
  });

  it("returns a stable configuration error without making an upstream request", async () => {
    const fetchImpl = vi.fn();
    const service = new AiChatService({ fetchImpl });

    await expect(service.chat({ messages: [{ role: "user", content: "你好" }] }, new AbortController().signal))
      .rejects.toMatchObject<Partial<AiChatServiceError>>({ code: "AI_NOT_CONFIGURED", status: 503 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("converts a slow provider into a bounded retryable timeout", async () => {
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("provider did not respond")), 20);
      init?.signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(new DOMException("The operation was aborted", "AbortError"));
      }, { once: true });
    }));
    const service = new AiChatService({
      apiUrl: "https://ai.example.test/v1/chat/completions",
      apiKey: "server-only-key",
      model: "beta-model",
      timeoutMs: 5,
      fetchImpl,
    });

    await expect(service.chat({ messages: [{ role: "user", content: "你好" }] }, new AbortController().signal))
      .rejects.toMatchObject<Partial<AiChatServiceError>>({ code: "AI_PROVIDER_TIMEOUT", status: 504, retryable: true });
  });
});
