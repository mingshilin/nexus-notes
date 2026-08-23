import { describe, expect, it, vi } from "vitest";
import { AiChatService, AiChatServiceError } from "../src/ai/ai-chat-service";
import { registerAiRoutes } from "../src/routes/ai";

describe("AI chat proxy", () => {
  it("registers an authenticated workspace route with viewer access", () => {
    const definitions: Array<{ method: string; path: string; auth: string; minimumRole?: string }> = [];
    registerAiRoutes({ register(definition: typeof definitions[number]) { definitions.push(definition); } }, () => new AiChatService({}));

    expect(definitions).toEqual([
      expect.objectContaining({
        method: "POST",
        path: "/api/v2/ai/chat",
        auth: "workspace",
        minimumRole: "viewer",
        rateLimit: { bucket: "ip", limit: 30, windowSeconds: 60 },
      }),
    ]);
  });

  it("awaits the provider response before building the route envelope", async () => {
    const definitions: Array<{ handler: (context: any) => Promise<{ data: unknown }> }> = [];
    registerAiRoutes({ register(definition: { handler: (context: any) => Promise<{ data: unknown }> }) { definitions.push(definition); } }, () => ({
      chat: vi.fn(async () => ({ message: "已完成", model: "beta-model" })),
    }));

    const result = await definitions[0]!.handler({ env: {}, body: { messages: [{ role: "user", content: "完成" }] }, signal: new AbortController().signal });
    expect(result.data).toEqual({ message: "已完成", model: "beta-model" });
  });

  it("sends the configured model and secret only from the Worker", async () => {
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(init?.headers).toEqual(expect.objectContaining({ authorization: "Bearer server-only-key" }));
      expect(JSON.parse(String(init?.body))).toEqual({
        model: "beta-model",
        messages: [{ role: "user", content: "整理我的任务" }],
        stream: false,
      });
      return Response.json({ choices: [{ message: { content: "先列出三个最重要的任务。" } }] });
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

  it("returns a stable configuration error without making an upstream request", async () => {
    const fetchImpl = vi.fn();
    const service = new AiChatService({ fetchImpl });

    await expect(service.chat({ messages: [{ role: "user", content: "你好" }] }, new AbortController().signal))
      .rejects.toMatchObject<Partial<AiChatServiceError>>({ code: "AI_NOT_CONFIGURED", status: 503 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
