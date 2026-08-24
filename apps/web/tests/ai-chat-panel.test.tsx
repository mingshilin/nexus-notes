import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AIChatPanel } from "../src/ai/AIChatPanel";

describe("AIChatPanel", () => {
  it("shows an explicit configuration status without exposing provider secrets", async () => {
    const client = { request: vi.fn(async (options: { path: string }) => options.path === "/api/v2/ai/status" || options.path === "/api/v2/ai/config" ? { configured: false, source: "unconfigured" } : { message: "unused", model: "beta-model" }) };

    render(<AIChatPanel client={client as any} workspaceId="ws-1" showStatus />);

    expect(await screen.findByText("AI 尚未配置", { exact: false })).toBeInTheDocument();
    expect(client.request).toHaveBeenCalledWith(expect.objectContaining({
      path: "/api/v2/ai/status",
      headers: { "x-workspace-id": "ws-1" },
    }));
    expect(screen.queryByText(/AI_CHAT_API_KEY|Bearer\s+\S+|sk-[A-Za-z0-9_-]{12,}/u)).not.toBeInTheDocument();
  });

  it("tests and saves a personal OpenAI-compatible configuration without redisplaying the key", async () => {
    const client = { request: vi.fn(async (options: { path: string; method?: string }) => {
      if (options.path === "/api/v2/ai/config" && options.method === "PUT") {
        return { configured: true, source: "personal", base_url: "https://api.deepseek.com/v1/chat/completions", model: "deepseek-chat", key_hint: "••••abcd", revision: 2, verified_at: null };
      }
      if (options.path === "/api/v2/ai/config/test") return { connected: true, model: "deepseek-chat" };
      if (options.path === "/api/v2/ai/config") return { configured: false, source: "unconfigured" };
      return { configured: false, source: "unconfigured" };
    }) };
    render(<AIChatPanel client={client as any} workspaceId="ws-1" showStatus />);
    fireEvent.change(await screen.findByLabelText("AI API 地址"), { target: { value: "https://api.deepseek.com/v1" } });
    fireEvent.change(screen.getByLabelText("AI 模型"), { target: { value: "deepseek-chat" } });
    fireEvent.change(screen.getByLabelText("AI API Key"), { target: { value: "sk-user-secret-123456789" } });
    fireEvent.click(screen.getByRole("button", { name: "测试 AI 连接" }));
    expect(await screen.findByText(/连接测试成功/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "保存 AI 配置" }));
    await waitFor(() => expect(client.request).toHaveBeenCalledWith(expect.objectContaining({
      path: "/api/v2/ai/config", method: "PUT",
      body: expect.objectContaining({ base_url: "https://api.deepseek.com/v1", model: "deepseek-chat", api_key: "sk-user-secret-123456789" }),
    })));
    expect(screen.getByLabelText("AI API Key")).toHaveValue("");
    expect(screen.getByText(/abcd/)).toBeInTheDocument();
    expect(screen.queryByText("sk-user-secret-123456789")).not.toBeInTheDocument();
  });

  it("sends the conversation through the workspace-scoped API client and renders the reply", async () => {
    const client = {
      request: vi.fn(async () => ({ message: "先处理最重要的一项。", model: "beta-model" })),
    };

    render(<AIChatPanel client={client as any} workspaceId="ws-1" />);
    const input = screen.getByRole("textbox", { name: "输入问题" });
    expect(input).toHaveAttribute("maxlength", "4000");
    fireEvent.change(input, { target: { value: "帮我排优先级" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => expect(client.request).toHaveBeenCalledWith(expect.objectContaining({
      path: "/api/v2/ai/chat",
      method: "POST",
      headers: { "x-workspace-id": "ws-1" },
      body: { messages: [{ role: "user", content: "帮我排优先级" }] },
    })));
    expect(await screen.findByText("先处理最重要的一项。" )).toBeInTheDocument();
  });

  it("fills a quick prompt without sending it", async () => {
    const client = { request: vi.fn(async () => ({ configured: true })) };
    render(<AIChatPanel client={client as any} workspaceId="ws-1" showStatus />);

    fireEvent.click(await screen.findByRole("button", { name: "制定今日计划" }));

    expect(screen.getByRole("textbox", { name: "输入问题" })).toHaveValue("制定今日计划");
    expect(client.request).toHaveBeenCalledWith(expect.objectContaining({ path: "/api/v2/ai/status" }));
    expect(client.request).not.toHaveBeenCalledWith(expect.objectContaining({ path: "/api/v2/ai/chat" }));
  });

  it("clears a completed conversation without clearing the provider status", async () => {
    const client = { request: vi.fn(async (input: { path: string }) => input.path === "/api/v2/ai/chat"
      ? { message: "已完成", model: "test-model" }
      : { configured: true, source: "server_default" }) };
    render(<AIChatPanel client={client as any} workspaceId="ws-1" showStatus />);
    const input = await screen.findByRole("textbox", { name: "输入问题" });
    fireEvent.change(input, { target: { value: "测试问题" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    expect(await screen.findByText("已完成")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "清空对话" }));
    expect(screen.queryByText("已完成")).not.toBeInTheDocument();
    expect(screen.getByText("AI 服务已连接，可以开始对话。")).toBeInTheDocument();
  });

  it("keeps a useful recovery message when the server has not been configured", async () => {
    const client = {
      request: vi.fn(async () => {
        throw Object.assign(new Error("AI is not configured"), { code: "AI_NOT_CONFIGURED" });
      }),
    };

    render(<AIChatPanel client={client as any} workspaceId="ws-1" />);
    fireEvent.change(screen.getByRole("textbox", { name: "输入问题" }), { target: { value: "你好" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("AI 服务尚未配置");
    expect(screen.getByRole("textbox", { name: "输入问题" })).toHaveValue("你好");
  });

  it("does not duplicate a failed question when the user retries", async () => {
    const client = {
      request: vi.fn()
        .mockRejectedValueOnce(Object.assign(new Error("provider unavailable"), { code: "AI_PROVIDER_UNAVAILABLE" }))
        .mockResolvedValueOnce({ message: "已重试", model: "beta-model" }),
    };

    render(<AIChatPanel client={client as any} workspaceId="ws-1" />);
    const input = screen.getByRole("textbox", { name: "输入问题" });
    fireEvent.change(input, { target: { value: "重试这个问题" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => expect(client.request).toHaveBeenCalledTimes(2));
    expect(client.request.mock.calls[1]?.[0]).toEqual(expect.objectContaining({
      body: { messages: [{ role: "user", content: "重试这个问题" }] },
    }));
    expect(await screen.findByText("已重试")).toBeInTheDocument();
  });

  it("aborts a pending chat when the panel unmounts", async () => {
    let resolveRequest!: (value: { message: string; model: string }) => void;
    const request = vi.fn((input: { path: string; policy?: { signal?: AbortSignal } }) => input.path === "/api/v2/ai/chat"
      ? new Promise<{ message: string; model: string }>((resolve) => { resolveRequest = resolve; })
      : Promise.resolve({ configured: true }));
    const view = render(<AIChatPanel client={{ request } as any} workspaceId="ws-1" showStatus />);
    const input = await screen.findByRole("textbox", { name: "输入问题" });
    fireEvent.change(input, { target: { value: "测试" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith(expect.objectContaining({ path: "/api/v2/ai/chat" })));
    const signal = request.mock.calls.find(([value]) => value.path === "/api/v2/ai/chat")?.[0].policy.signal as AbortSignal;
    view.unmount();
    expect(signal.aborted).toBe(true);
    resolveRequest({ message: "过期响应", model: "test-model" });
    await Promise.resolve();
  });
});
