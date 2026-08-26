import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

  it("renders AI action proposals and confirms only the targeted card", async () => {
    const confirmAiAction = vi.fn(async () => ({
      action: { action_id: "action-email-1", status: "confirmed", revision: 2 },
    }));
    const rejectAiAction = vi.fn(async () => ({ action: { rejected: true } }));
    const client = {
      request: vi.fn(async () => ({
        message: "我准备了两个待确认操作。",
        model: "beta-model",
        action_proposals: [
          {
            action_id: "action-email-1",
            tool: "send_email",
            summary: "发送项目更新邮件",
            input: { to_email: "user@example.test", subject: "项目更新", body_text: "这里是邮件正文。" },
            requires_confirmation: true,
            expires_at: "2099-08-25T01:00:00.000Z",
          },
          {
            action_id: "action-note-1",
            tool: "create_note",
            summary: "创建复盘笔记",
            input: { title: "复盘", content: "整理结论" },
            requires_confirmation: true,
            expires_at: "2099-08-25T01:00:00.000Z",
          },
        ],
      })),
      confirmAiAction,
      rejectAiAction,
    };

    render(<AIChatPanel client={client as any} workspaceId="ws-1" />);
    fireEvent.change(screen.getByRole("textbox", { name: "输入问题" }), { target: { value: "帮我执行后续动作" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    const confirmButtons = await screen.findAllByRole("button", { name: "确认执行" });
    expect(confirmButtons[0]).toHaveFocus();
    expect(screen.getByText("发送项目更新邮件")).toBeInTheDocument();
    expect(screen.getByText("创建复盘笔记")).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "确认执行" })[0]!);

    await waitFor(() => expect(confirmAiAction).toHaveBeenCalledWith("ws-1", "action-email-1", 1));
    expect(await screen.findByText("已确认")).toBeInTheDocument();
    expect(screen.getByText("创建复盘笔记")).toBeInTheDocument();
    expect(rejectAiAction).not.toHaveBeenCalled();
  });

  it("rejects a proposal, handles expiry, and never persists sensitive AI content in browser storage", async () => {
    const rejectAiAction = vi.fn(async () => ({ action: { rejected: true } }));
    const client = {
      request: vi.fn(async () => ({
        message: "已生成一个邮件草稿。",
        model: "beta-model",
        action_proposals: [
          {
            action_id: "action-email-1",
            tool: "send_email",
            summary: "发送项目更新邮件",
            input: {
              to_email: "private@example.test",
              subject: "项目更新",
              body_text: "secret body that must never be persisted",
            },
            requires_confirmation: true,
            expires_at: "2026-08-24T23:59:59.000Z",
          },
        ],
      })),
      confirmAiAction: vi.fn(),
      rejectAiAction,
    };

    render(<AIChatPanel client={client as any} workspaceId="ws-1" />);
    fireEvent.change(screen.getByRole("textbox", { name: "输入问题" }), { target: { value: "send secret prompt" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    expect(await screen.findByText("private@example.test")).toBeInTheDocument();
    expect(await screen.findByText("已过期")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "确认执行" })).not.toBeInTheDocument();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    expect(localStorage.getItem("send secret prompt")).toBeNull();
    expect(sessionStorage.getItem("secret body that must never be persisted")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "清空对话" }));
    expect(screen.queryByText("private@example.test")).not.toBeInTheDocument();
    expect(rejectAiAction).not.toHaveBeenCalled();
  });

  it("keeps the action card retryable after a confirmation failure", async () => {
    const client = {
      request: vi.fn(async () => ({
        message: "已生成一个待确认操作。",
        model: "beta-model",
        action_proposals: [
          {
            action_id: "action-email-1",
            tool: "send_email",
            summary: "发送项目更新邮件",
            input: { to_email: "user@example.test", subject: "项目更新", body_text: "这里是邮件正文。" },
            requires_confirmation: true,
            expires_at: "2099-08-25T01:00:00.000Z",
          },
        ],
      })),
      confirmAiAction: vi.fn()
        .mockRejectedValueOnce(Object.assign(new Error("temporary failure"), { code: "NETWORK_ERROR" }))
        .mockResolvedValueOnce({ action: { action_id: "action-email-1", status: "confirmed", revision: 2 } }),
      rejectAiAction: vi.fn(),
    };

    render(<AIChatPanel client={client as any} workspaceId="ws-1" />);
    fireEvent.change(screen.getByRole("textbox", { name: "输入问题" }), { target: { value: "重试 action" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    fireEvent.click((await screen.findAllByRole("button", { name: "确认执行" }))[0]!);
    expect(await screen.findByRole("alert")).toHaveTextContent("AI 操作暂时失败，请重试。");

    fireEvent.click(screen.getByRole("button", { name: "重试确认" }));
    await waitFor(() => expect(client.confirmAiAction).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("已确认")).toBeInTheDocument();
  });

  it("automatically expires proposals after their expires_at without waiting for a server rejection", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-25T00:00:00.000Z"));
    try {
      const client = {
        request: vi.fn(async () => ({
          message: "已生成一个待确认操作。",
          model: "beta-model",
          action_proposals: [
            {
              action_id: "action-email-1",
              tool: "send_email",
              summary: "发送项目更新邮件",
              input: { to_email: "user@example.test", subject: "项目更新", body_text: "这里是邮件正文。" },
              requires_confirmation: true,
              expires_at: "2026-08-25T00:00:05.000Z",
            },
          ],
        })),
        confirmAiAction: vi.fn(),
        rejectAiAction: vi.fn(),
      };

      render(<AIChatPanel client={client as any} workspaceId="ws-1" />);
      fireEvent.change(screen.getByRole("textbox", { name: "输入问题" }), { target: { value: "帮我执行后续动作" } });
      fireEvent.click(screen.getByRole("button", { name: "发送" }));

      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(screen.getByText("发送项目更新邮件")).toBeInTheDocument();
      expect(screen.getAllByRole("button", { name: "确认执行" })[0]).toBeInTheDocument();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_100);
      });

      expect(screen.getByText("已过期")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "确认执行" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "拒绝" })).not.toBeInTheDocument();
      expect(client.request).toHaveBeenCalledTimes(1);
      expect(client.confirmAiAction).not.toHaveBeenCalled();
      expect(client.rejectAiAction).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
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
