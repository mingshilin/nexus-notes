import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AIChatPanel } from "../src/ai/AIChatPanel";

describe("AIChatPanel", () => {
  function actionResponse(summary: string) {
    return {
      message: `${summary}消息`,
      model: "beta-model",
      action_proposals: [{
        action_id: "shared-action-id",
        tool: "create_note" as const,
        summary,
        input: { title: summary, content: `${summary}内容` },
        requires_confirmation: true,
        expires_at: "2099-08-25T01:00:00.000Z",
      }],
    };
  }

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

  it("hides chat and personal configuration when the AI status endpoint is disabled", async () => {
    const client = {
      request: vi.fn(async (options: { path: string }) => {
        if (options.path === "/api/v2/ai/status") {
          throw Object.assign(new Error("AI service is disabled"), { code: "SERVER_NOT_CONFIGURED", status: 503 });
        }
        throw new Error("should not call another AI endpoint");
      }),
    };

    render(<AIChatPanel client={client as any} workspaceId="ws-1" showStatus />);

    expect(await screen.findByText("AI 助手当前不可用", { exact: false })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "输入问题" })).not.toBeInTheDocument();
    expect(screen.queryByText("个人 AI 配置")).not.toBeInTheDocument();
    expect(client.request.mock.calls.every(([input]) => input.path === "/api/v2/ai/status")).toBe(true);
  });

  it("checks the server AI status before revealing the default chat surface", async () => {
    const client = {
      request: vi.fn(async (options: { path: string }) => {
        if (options.path === "/api/v2/ai/status") {
          throw Object.assign(new Error("AI service is disabled"), { code: "SERVER_NOT_CONFIGURED", status: 503 });
        }
        throw new Error("chat must remain gated");
      }),
    };

    render(<AIChatPanel client={client as any} workspaceId="ws-1" />);

    expect(await screen.findByText("AI 助手当前不可用", { exact: false })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "输入问题" })).not.toBeInTheDocument();
    expect(client.request).toHaveBeenCalledOnce();
    expect(client.request).toHaveBeenCalledWith(expect.objectContaining({ path: "/api/v2/ai/status" }));
  });

  it("locks the default chat surface after the server reports that AI is disabled", async () => {
    const client = {
      request: vi.fn(async (input: { path: string }) => {
        if (input.path === "/api/v2/ai/chat") {
          throw Object.assign(new Error("AI service is disabled"), { code: "SERVER_NOT_CONFIGURED", status: 503 });
        }
        return { message: "unused", model: "beta-model" };
      }),
    };

    render(<AIChatPanel client={client as any} workspaceId="ws-1" />);
    fireEvent.change(await screen.findByRole("textbox", { name: "输入问题" }), { target: { value: "你好" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    expect(await screen.findByText("AI 助手当前不可用", { exact: false })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "输入问题" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "发送" })).not.toBeInTheDocument();
    expect(client.request).toHaveBeenCalledTimes(2);
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
    const input = await screen.findByRole("textbox", { name: "输入问题" });
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

  it("sends only the selected note and database context until workspace search is enabled", async () => {
    const client = {
      request: vi.fn(async () => ({ message: "已读取当前内容。", model: "beta-model" })),
    };

    render(<AIChatPanel
      client={client as any}
      workspaceId="ws-1"
      readContext={{ selected_note_ids: ["note-1"], selected_database_ids: ["db-1"] }}
    />);
    expect(await screen.findByRole("checkbox", { name: "允许搜索工作区" })).not.toBeChecked();

    fireEvent.change(await screen.findByRole("textbox", { name: "输入问题" }), { target: { value: "总结当前内容" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() => expect(client.request).toHaveBeenCalledWith(expect.objectContaining({
      path: "/api/v2/ai/chat",
      body: {
        messages: [{ role: "user", content: "总结当前内容" }],
        read_context: {
          selected_note_ids: ["note-1"],
          selected_database_ids: ["db-1"],
          allow_workspace_search: false,
        },
      },
    })));

    fireEvent.click(screen.getByRole("checkbox", { name: "允许搜索工作区" }));
    expect(screen.getByRole("checkbox", { name: "允许搜索工作区" })).toBeChecked();
  });

  it("invalidates a pending chat when the explicit read scope changes and restores the prompt", async () => {
    let resolveChat!: (value: { message: string; model: string }) => void;
    const request = vi.fn((input: { path: string }) => input.path === "/api/v2/ai/chat"
      ? new Promise<{ message: string; model: string }>((resolve) => { resolveChat = resolve; })
      : Promise.resolve({ configured: true, source: "server_default" }));
    const client = { request };
    const view = render(<AIChatPanel
      client={client as any}
      workspaceId="ws-1"
      readContext={{ selected_note_ids: ["note-a"], selected_database_ids: ["db-a"] }}
    />);
    fireEvent.click(await screen.findByRole("checkbox", { name: "允许搜索工作区" }));
    fireEvent.change(screen.getByRole("textbox", { name: "输入问题" }), { target: { value: "总结范围 A" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith(expect.objectContaining({ path: "/api/v2/ai/chat" })));
    const chatRequest = request.mock.calls.find(([input]) => input.path === "/api/v2/ai/chat")?.[0];
    const signal = chatRequest?.policy.signal as AbortSignal;

    view.rerender(<AIChatPanel
      client={client as any}
      workspaceId="ws-1"
      readContext={{ selected_note_ids: ["note-b"], selected_database_ids: ["db-b"] }}
    />);

    await waitFor(() => expect(signal.aborted).toBe(true));
    expect(screen.getByRole("textbox", { name: "输入问题" })).toHaveValue("总结范围 A");
    expect(screen.getByRole("textbox", { name: "输入问题" })).toBeEnabled();
    expect(screen.getByRole("checkbox", { name: "允许搜索工作区" })).not.toBeChecked();
    expect(screen.getByRole("alert")).toHaveTextContent("AI 读取范围已变化，请确认当前范围后重新发送。");

    resolveChat({ message: "范围 A 的晚到回复", model: "beta-model" });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.queryByText("范围 A 的晚到回复")).not.toBeInTheDocument();
  });

  it("keeps a pending chat when new arrays contain the same ordered scope ids", async () => {
    let resolveChat!: (value: { message: string; model: string }) => void;
    const request = vi.fn((input: { path: string }) => input.path === "/api/v2/ai/chat"
      ? new Promise<{ message: string; model: string }>((resolve) => { resolveChat = resolve; })
      : Promise.resolve({ configured: true, source: "server_default" }));
    const client = { request };
    const view = render(<AIChatPanel
      client={client as any}
      workspaceId="ws-1"
      readContext={{ selected_note_ids: ["note-a", "note-b"], selected_database_ids: ["db-a"] }}
    />);
    fireEvent.change(await screen.findByRole("textbox", { name: "输入问题" }), { target: { value: "保持当前范围" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith(expect.objectContaining({ path: "/api/v2/ai/chat" })));
    const chatRequest = request.mock.calls.find(([input]) => input.path === "/api/v2/ai/chat")?.[0];
    const signal = chatRequest?.policy.signal as AbortSignal;

    view.rerender(<AIChatPanel
      client={client as any}
      workspaceId="ws-1"
      readContext={{ selected_note_ids: ["note-a", "note-b"], selected_database_ids: ["db-a"] }}
    />);

    expect(signal.aborted).toBe(false);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    resolveChat({ message: "同一范围回复", model: "beta-model" });
    expect(await screen.findByText("同一范围回复")).toBeInTheDocument();
  });

  it("clears completed scope state while preserving an unsent draft", async () => {
    const request = vi.fn(async (input: { path: string }) => input.path === "/api/v2/ai/chat"
      ? {
          message: "范围 A 的回复",
          model: "beta-model",
          action_proposals: [{
            action_id: "scope-a-action",
            tool: "create_note" as const,
            summary: "范围 A 的待确认操作",
            input: { title: "旧范围", content: "旧范围内容" },
            requires_confirmation: true,
            expires_at: "2099-08-25T01:00:00.000Z",
          }],
        }
      : { configured: true, source: "server_default" });
    const client = { request, confirmAiAction: vi.fn(), rejectAiAction: vi.fn() };
    const view = render(<AIChatPanel
      client={client as any}
      workspaceId="ws-1"
      readContext={{ selected_note_ids: ["note-a"], selected_database_ids: [] }}
    />);
    fireEvent.change(await screen.findByRole("textbox", { name: "输入问题" }), { target: { value: "生成旧范围操作" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    expect(await screen.findByText("范围 A 的待确认操作")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "输入问题" }), { target: { value: "尚未发送的草稿" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "允许搜索工作区" }));

    view.rerender(<AIChatPanel
      client={client as any}
      workspaceId="ws-1"
      readContext={{ selected_note_ids: ["note-b"], selected_database_ids: [] }}
    />);

    await waitFor(() => expect(screen.queryByText("范围 A 的待确认操作")).not.toBeInTheDocument());
    expect(screen.queryByText("范围 A 的回复")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "确认执行" })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "输入问题" })).toHaveValue("尚未发送的草稿");
    expect(screen.getByRole("checkbox", { name: "允许搜索工作区" })).not.toBeChecked();
    expect(screen.getByRole("alert")).toHaveTextContent("AI 读取范围已变化，请确认当前范围后重新发送。");
  });

  it("clears the transcript when the workspace changes", async () => {
    const client = {
      request: vi.fn(async (input: { path: string }) => input.path === "/api/v2/ai/chat"
        ? { message: "工作区一的回复", model: "beta-model" }
        : { configured: false }),
    };
    const view = render(<AIChatPanel client={client as any} workspaceId="ws-1" />);
    const input = await screen.findByRole("textbox", { name: "输入问题" });
    fireEvent.change(input, { target: { value: "只属于工作区一的问题" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    expect(await screen.findByText("工作区一的回复")).toBeInTheDocument();

    view.rerender(<AIChatPanel client={client as any} workspaceId="ws-2" />);

    expect(screen.queryByText("工作区一的回复")).not.toBeInTheDocument();
    expect(await screen.findByText("可以问我如何整理任务、拆解目标或改进笔记结构。")).toBeInTheDocument();
  });

  it("does not restore a response after clearing an in-flight conversation", async () => {
    let resolveRequest!: (value: { message: string; model: string }) => void;
    const request = vi.fn((input: { path: string }) => input.path === "/api/v2/ai/chat"
      ? new Promise<{ message: string; model: string }>((resolve) => { resolveRequest = resolve; })
      : Promise.resolve({ configured: true }));
    render(<AIChatPanel client={{ request } as any} workspaceId="ws-1" />);
    fireEvent.change(await screen.findByRole("textbox", { name: "输入问题" }), { target: { value: "待清空的问题" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith(expect.objectContaining({ path: "/api/v2/ai/chat" })));

    fireEvent.click(screen.getByRole("button", { name: "清空对话" }));
    resolveRequest({ message: "不应该恢复的回复", model: "beta-model" });
    await act(async () => { await Promise.resolve(); });

    expect(screen.queryByText("不应该恢复的回复")).not.toBeInTheDocument();
    expect(screen.getByText("可以问我如何整理任务、拆解目标或改进笔记结构。")).toBeInTheDocument();
  });

  it("ignores a late response from the previous workspace even if abort is ignored", async () => {
    let resolveRequest!: (value: { message: string; model: string }) => void;
    const request = vi.fn((input: { path: string }) => input.path === "/api/v2/ai/chat"
      ? new Promise<{ message: string; model: string }>((resolve) => { resolveRequest = resolve; })
      : Promise.resolve({ configured: false }));
    const view = render(<AIChatPanel client={{ request } as any} workspaceId="ws-1" />);
    fireEvent.change(await screen.findByRole("textbox", { name: "输入问题" }), { target: { value: "旧工作区问题" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith(expect.objectContaining({ path: "/api/v2/ai/chat" })));

    view.rerender(<AIChatPanel client={{ request } as any} workspaceId="ws-2" />);
    resolveRequest({ message: "旧工作区的晚到回复", model: "beta-model" });
    await act(async () => { await Promise.resolve(); });

    expect(screen.queryByText("旧工作区的晚到回复")).not.toBeInTheDocument();
    expect(await screen.findByText("可以问我如何整理任务、拆解目标或改进笔记结构。")).toBeInTheDocument();
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
    fireEvent.change(await screen.findByRole("textbox", { name: "输入问题" }), { target: { value: "你好" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("当前没有可用的 AI");
    expect(screen.getByRole("textbox", { name: "输入问题" })).toHaveValue("你好");
  });

  it("does not duplicate a failed question when the user retries", async () => {
    let chatAttempt = 0;
    let rejectFirst!: (error: unknown) => void;
    const client = {
      request: vi.fn(async (input: { path: string }) => {
        if (input.path === "/api/v2/ai/status") return { configured: true, source: "server_default" };
        chatAttempt += 1;
        if (chatAttempt === 1) return new Promise<never>((_resolve, reject) => { rejectFirst = reject; });
        return { message: "已重试", model: "beta-model" };
      }),
    };

    render(<AIChatPanel client={client as any} workspaceId="ws-1" />);
    const input = await screen.findByRole("textbox", { name: "输入问题" });
    fireEvent.change(input, { target: { value: "重试这个问题" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() => expect(chatAttempt).toBe(1));
    rejectFirst(Object.assign(new Error("provider unavailable"), { code: "AI_PROVIDER_UNAVAILABLE" }));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => expect(client.request).toHaveBeenCalledTimes(3));
    const chatCalls = client.request.mock.calls.filter(([input]) => input.path === "/api/v2/ai/chat");
    expect(chatCalls[1]?.[0]).toEqual(expect.objectContaining({
      body: { messages: [{ role: "user", content: "重试这个问题" }] },
    }));
    expect(await screen.findByText("已重试")).toBeInTheDocument();
  });

  it("renders AI action proposals and confirms only the targeted card", async () => {
    const confirmAiAction = vi.fn(async () => ({
      action: { action_id: "action-email-1", status: "executed", revision: 2 },
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
    fireEvent.change(await screen.findByRole("textbox", { name: "输入问题" }), { target: { value: "帮我执行后续动作" } });
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

  it("does not repopulate a stale confirmation after the explicit read scope changes", async () => {
    let chatAttempt = 0;
    let resolveConfirm!: (value: { action: { action_id: string; status: "executed"; revision: number } }) => void;
    const request = vi.fn(async (input: { path: string }) => {
      if (input.path === "/api/v2/ai/status") return { configured: true, source: "server_default" };
      chatAttempt += 1;
      return actionResponse(chatAttempt === 1 ? "旧范围提案" : "新范围提案");
    });
    const confirmAiAction = vi.fn(() => new Promise<{ action: { action_id: string; status: "executed"; revision: number } }>((resolve) => {
      resolveConfirm = resolve;
    }));
    const view = render(<AIChatPanel
      client={{ request, confirmAiAction, rejectAiAction: vi.fn() } as any}
      workspaceId="ws-1"
      readContext={{ selected_note_ids: ["note-a"], selected_database_ids: [] }}
    />);
    fireEvent.change(await screen.findByRole("textbox", { name: "输入问题" }), { target: { value: "确认旧范围" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    expect(await screen.findByRole("heading", { name: "旧范围提案" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "确认执行" }));
    await waitFor(() => expect(confirmAiAction).toHaveBeenCalledOnce());

    view.rerender(<AIChatPanel
      client={{ request, confirmAiAction, rejectAiAction: vi.fn() } as any}
      workspaceId="ws-1"
      readContext={{ selected_note_ids: ["note-b"], selected_database_ids: [] }}
    />);
    await waitFor(() => expect(screen.queryByRole("heading", { name: "旧范围提案" })).not.toBeInTheDocument());
    fireEvent.change(screen.getByRole("textbox", { name: "输入问题" }), { target: { value: "确认新范围" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    expect(await screen.findByRole("heading", { name: "新范围提案" })).toBeInTheDocument();

    resolveConfirm({ action: { action_id: "shared-action-id", status: "executed", revision: 2 } });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText("待确认")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "确认执行" })).toBeInTheDocument();
    expect(screen.queryByText("已确认")).not.toBeInTheDocument();
  });

  it("does not repopulate a stale rejection after the explicit read scope changes", async () => {
    let chatAttempt = 0;
    let resolveReject!: (value: { action: { action_id: string; rejected: boolean } }) => void;
    const request = vi.fn(async (input: { path: string }) => {
      if (input.path === "/api/v2/ai/status") return { configured: true, source: "server_default" };
      chatAttempt += 1;
      return actionResponse(chatAttempt === 1 ? "旧范围拒绝提案" : "新范围拒绝提案");
    });
    const rejectAiAction = vi.fn(() => new Promise<{ action: { action_id: string; rejected: boolean } }>((resolve) => {
      resolveReject = resolve;
    }));
    const view = render(<AIChatPanel
      client={{ request, confirmAiAction: vi.fn(), rejectAiAction } as any}
      workspaceId="ws-1"
      readContext={{ selected_note_ids: ["note-a"], selected_database_ids: [] }}
    />);
    fireEvent.change(await screen.findByRole("textbox", { name: "输入问题" }), { target: { value: "拒绝旧范围" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    expect(await screen.findByRole("heading", { name: "旧范围拒绝提案" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "拒绝" }));
    await waitFor(() => expect(rejectAiAction).toHaveBeenCalledOnce());

    view.rerender(<AIChatPanel
      client={{ request, confirmAiAction: vi.fn(), rejectAiAction } as any}
      workspaceId="ws-1"
      readContext={{ selected_note_ids: ["note-b"], selected_database_ids: [] }}
    />);
    await waitFor(() => expect(screen.queryByRole("heading", { name: "旧范围拒绝提案" })).not.toBeInTheDocument());
    fireEvent.change(screen.getByRole("textbox", { name: "输入问题" }), { target: { value: "拒绝新范围" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    expect(await screen.findByRole("heading", { name: "新范围拒绝提案" })).toBeInTheDocument();

    resolveReject({ action: { action_id: "shared-action-id", rejected: true } });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText("待确认")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "拒绝" })).toBeInTheDocument();
    expect(screen.queryByText("已拒绝")).not.toBeInTheDocument();
  });

  it("does not repopulate a stale confirmation after clearing the conversation", async () => {
    let chatAttempt = 0;
    let resolveConfirm!: (value: { action: { action_id: string; status: "executed"; revision: number } }) => void;
    const request = vi.fn(async (input: { path: string }) => {
      if (input.path === "/api/v2/ai/status") return { configured: true, source: "server_default" };
      chatAttempt += 1;
      return actionResponse(chatAttempt === 1 ? "清空前提案" : "清空后提案");
    });
    const confirmAiAction = vi.fn(() => new Promise<{ action: { action_id: string; status: "executed"; revision: number } }>((resolve) => {
      resolveConfirm = resolve;
    }));
    render(<AIChatPanel client={{ request, confirmAiAction, rejectAiAction: vi.fn() } as any} workspaceId="ws-1" />);
    fireEvent.change(await screen.findByRole("textbox", { name: "输入问题" }), { target: { value: "清空前确认" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    expect(await screen.findByRole("heading", { name: "清空前提案" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "确认执行" }));
    await waitFor(() => expect(confirmAiAction).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole("button", { name: "清空对话" }));

    fireEvent.change(screen.getByRole("textbox", { name: "输入问题" }), { target: { value: "清空后确认" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    expect(await screen.findByRole("heading", { name: "清空后提案" })).toBeInTheDocument();

    resolveConfirm({ action: { action_id: "shared-action-id", status: "executed", revision: 2 } });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText("待确认")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "确认执行" })).toBeInTheDocument();
    expect(screen.queryByText("已确认")).not.toBeInTheDocument();
  });

  it("does not repopulate a stale rejection after clearing the conversation", async () => {
    let chatAttempt = 0;
    let resolveReject!: (value: { action: { action_id: string; rejected: boolean } }) => void;
    const request = vi.fn(async (input: { path: string }) => {
      if (input.path === "/api/v2/ai/status") return { configured: true, source: "server_default" };
      chatAttempt += 1;
      return actionResponse(chatAttempt === 1 ? "清空前拒绝提案" : "清空后拒绝提案");
    });
    const rejectAiAction = vi.fn(() => new Promise<{ action: { action_id: string; rejected: boolean } }>((resolve) => {
      resolveReject = resolve;
    }));
    render(<AIChatPanel client={{ request, confirmAiAction: vi.fn(), rejectAiAction } as any} workspaceId="ws-1" />);
    fireEvent.change(await screen.findByRole("textbox", { name: "输入问题" }), { target: { value: "清空前拒绝" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    expect(await screen.findByRole("heading", { name: "清空前拒绝提案" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "拒绝" }));
    await waitFor(() => expect(rejectAiAction).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole("button", { name: "清空对话" }));

    fireEvent.change(screen.getByRole("textbox", { name: "输入问题" }), { target: { value: "清空后拒绝" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    expect(await screen.findByRole("heading", { name: "清空后拒绝提案" })).toBeInTheDocument();

    resolveReject({ action: { action_id: "shared-action-id", rejected: true } });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText("待确认")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "拒绝" })).toBeInTheDocument();
    expect(screen.queryByText("已拒绝")).not.toBeInTheDocument();
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
    fireEvent.change(await screen.findByRole("textbox", { name: "输入问题" }), { target: { value: "send secret prompt" } });
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

  it("keeps the action card retryable after a transport confirmation failure", async () => {
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
        .mockResolvedValueOnce({ action: { action_id: "action-email-1", status: "executed", revision: 2 } }),
      rejectAiAction: vi.fn(),
    };

    render(<AIChatPanel client={client as any} workspaceId="ws-1" />);
    fireEvent.change(await screen.findByRole("textbox", { name: "输入问题" }), { target: { value: "重试 action" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    fireEvent.click((await screen.findAllByRole("button", { name: "确认执行" }))[0]!);
    expect(await screen.findByRole("alert")).toHaveTextContent("请求未完成，可以再次确认。");

    fireEvent.click(screen.getByRole("button", { name: "确认执行" }));
    await waitFor(() => expect(client.confirmAiAction).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("已确认")).toBeInTheDocument();
  });

  it("marks a non-retryable confirmation denial as failed", async () => {
    const client = {
      request: vi.fn(async () => ({
        message: "已生成一个待确认操作。",
        model: "beta-model",
        action_proposals: [{
          action_id: "action-denied",
          tool: "update_note" as const,
          summary: "更新笔记",
          input: { target_note_id: "note-1", base_revision: 1, patch: { title: "新标题" } },
          requires_confirmation: true,
          expires_at: "2099-08-25T01:00:00.000Z",
        }],
      })),
      confirmAiAction: vi.fn(async () => {
        throw Object.assign(new Error("permission denied"), { code: "AI_ACTION_PERMISSION_DENIED", status: 403, retryable: false });
      }),
      rejectAiAction: vi.fn(),
    };

    render(<AIChatPanel client={client as any} workspaceId="ws-1" />);
    fireEvent.change(await screen.findByRole("textbox", { name: "输入问题" }), { target: { value: "更新笔记" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    fireEvent.click((await screen.findAllByRole("button", { name: "确认执行" }))[0]!);

    expect(await screen.findByText("执行失败")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "确认执行" })).not.toBeInTheDocument();
    expect(screen.getByText("当前没有权限执行此 AI 操作。")).toBeInTheDocument();
  });

  it("marks a non-retryable server failure as failed", async () => {
    const client = {
      request: vi.fn(async () => ({
        message: "已生成一个待确认操作。",
        model: "beta-model",
        action_proposals: [{
          action_id: "action-server-failed",
          tool: "update_note" as const,
          summary: "更新笔记",
          input: { target_note_id: "note-1", base_revision: 1, patch: { title: "新标题" } },
          requires_confirmation: true,
          expires_at: "2099-08-25T01:00:00.000Z",
        }],
      })),
      confirmAiAction: vi.fn(async () => {
        throw Object.assign(new Error("server rejected"), { code: "AI_ACTION_EXECUTION_FAILED", status: 503, retryable: false });
      }),
      rejectAiAction: vi.fn(),
    };

    render(<AIChatPanel client={client as any} workspaceId="ws-1" />);
    fireEvent.change(await screen.findByRole("textbox", { name: "输入问题" }), { target: { value: "更新笔记" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    fireEvent.click((await screen.findAllByRole("button", { name: "确认执行" }))[0]!);

    expect(await screen.findByText("执行失败")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "确认执行" })).not.toBeInTheDocument();
  });

  it("keeps a lease-in-progress action retryable", async () => {
    const client = {
      request: vi.fn(async () => ({
        message: "已生成一个待确认操作。",
        model: "beta-model",
        action_proposals: [{
          action_id: "action-in-progress",
          tool: "update_note" as const,
          summary: "更新笔记",
          input: { target_note_id: "note-1", base_revision: 1, patch: { title: "新标题" } },
          requires_confirmation: true,
          expires_at: "2099-08-25T01:00:00.000Z",
        }],
      })),
      confirmAiAction: vi.fn(async () => {
        throw Object.assign(new Error("still executing"), { code: "AI_ACTION_IN_PROGRESS", status: 409, retryable: true });
      }),
      rejectAiAction: vi.fn(),
    };

    render(<AIChatPanel client={client as any} workspaceId="ws-1" />);
    fireEvent.change(await screen.findByRole("textbox", { name: "输入问题" }), { target: { value: "更新笔记" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    fireEvent.click((await screen.findAllByRole("button", { name: "确认执行" }))[0]!);

    expect(await screen.findByRole("alert")).toHaveTextContent("操作仍在执行");
    expect(screen.getByRole("button", { name: "确认执行" })).toBeInTheDocument();
  });

  it("renders a retryable trusted batch result as in progress instead of failed", async () => {
    const client = {
      request: vi.fn(async () => ({
        message: "操作仍在执行。",
        model: "beta-model",
        action_results: [{
          action_id: "action-in-progress-result",
          status: "failed" as const,
          retryable: true,
          error: { code: "AI_ACTION_IN_PROGRESS", message: "safe", status: 409 },
        }],
      })),
      confirmAiAction: vi.fn(),
      rejectAiAction: vi.fn(),
    };

    render(<AIChatPanel client={client as any} workspaceId="ws-1" />);
    fireEvent.change(await screen.findByRole("textbox", { name: "输入问题" }), { target: { value: "继续执行" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    expect(await screen.findByText("AI 操作仍在执行，请稍后重试。")).toBeInTheDocument();
    expect(screen.queryByText("AI 操作执行失败，请重新发起。")).not.toBeInTheDocument();
  });

  it("does not show success when the server returns a failed execution result", async () => {
    const client = {
      request: vi.fn(async () => ({
        message: "已生成一个待确认操作。",
        model: "beta-model",
        action_proposals: [{
          action_id: "action-note-1",
          tool: "update_note" as const,
          summary: "更新笔记",
          input: { target_note_id: "note-1", base_revision: 1, patch: { title: "新标题" } },
          requires_confirmation: true,
          expires_at: "2099-08-25T01:00:00.000Z",
        }],
      })),
      confirmAiAction: vi.fn(async () => ({
        action: {
          action_id: "action-note-1",
          status: "failed" as const,
          error: { code: "AI_ACTION_NOTE_CONFLICT", message: "safe", status: 409 },
        },
      })),
      rejectAiAction: vi.fn(),
    };

    render(<AIChatPanel client={client as any} workspaceId="ws-1" />);
    fireEvent.change(await screen.findByRole("textbox", { name: "输入问题" }), { target: { value: "更新笔记" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    fireEvent.click((await screen.findAllByRole("button", { name: "确认执行" }))[0]!);

    await waitFor(() => expect(client.confirmAiAction).toHaveBeenCalledOnce());
    expect(await screen.findByText("执行失败")).toBeInTheDocument();
    expect(screen.queryByText("已确认")).not.toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent("笔记内容已发生变化");
  });

  it("keeps a conflict result distinct from a generic failed action", async () => {
    const client = {
      request: vi.fn(async () => ({
        message: "已生成待确认操作。",
        model: "beta-model",
        action_proposals: [{
          action_id: "action-note-conflict",
          tool: "update_note" as const,
          summary: "更新笔记",
          input: { target_note_id: "note-1", base_revision: 1, patch: { title: "新标题" } },
          proposal_revision: 1,
          requires_confirmation: true,
          expires_at: "2099-08-25T01:00:00.000Z",
        }],
      })),
      confirmAiAction: vi.fn(async () => ({
        action: {
          action_id: "action-note-conflict",
          status: "conflict" as const,
          error: { code: "AI_ACTION_NOTE_CONFLICT", message: "safe", status: 409 },
        },
      })),
      rejectAiAction: vi.fn(),
    };

    render(<AIChatPanel client={client as any} workspaceId="ws-1" />);
    fireEvent.change(await screen.findByRole("textbox", { name: "输入问题" }), { target: { value: "更新笔记" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    fireEvent.click((await screen.findAllByRole("button", { name: "确认执行" }))[0]!);

    expect(await screen.findByText("内容已变化")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重新发起" })).toBeInTheDocument();
  });

  it("uses proposal revision independently from the target note revision", async () => {
    const client = {
      request: vi.fn(async () => ({
        message: "已生成待确认操作。",
        model: "beta-model",
        action_proposals: [{
          action_id: "action-note-revision",
          proposal_revision: 3,
          tool: "update_note" as const,
          summary: "更新高版本笔记",
          input: { target_note_id: "note-1", base_revision: 7, patch: { title: "新标题" } },
          requires_confirmation: true,
          expires_at: "2099-08-25T01:00:00.000Z",
        }],
      })),
      confirmAiAction: vi.fn(async () => ({ action: { action_id: "action-note-revision", status: "executed" as const, revision: 8 } })),
      rejectAiAction: vi.fn(),
    };

    render(<AIChatPanel client={client as any} workspaceId="ws-1" />);
    fireEvent.change(await screen.findByRole("textbox", { name: "输入问题" }), { target: { value: "更新高版本笔记" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    fireEvent.click((await screen.findAllByRole("button", { name: "确认执行" }))[0]!);

    await waitFor(() => expect(client.confirmAiAction).toHaveBeenCalledWith("ws-1", "action-note-revision", 3));
    expect(await screen.findByText("已确认")).toBeInTheDocument();
  });

  it("renders every trusted action result when a batch only partially succeeds", async () => {
    const client = {
      request: vi.fn(async () => ({
        message: "AI 操作完成 1 个，1 个未执行。",
        model: "beta-model",
        action_results: [
          { action_id: "action-ok", status: "executed" as const, entity_id: "note-1", revision: 1 },
          { action_id: "action-failed", status: "failed" as const, error: { code: "AI_ACTION_EXECUTION_FAILED", message: "safe", status: 500 } },
        ],
      })),
      confirmAiAction: vi.fn(),
      rejectAiAction: vi.fn(),
    };

    render(<AIChatPanel client={client as any} workspaceId="ws-1" />);
    fireEvent.change(await screen.findByRole("textbox", { name: "输入问题" }), { target: { value: "执行两个操作" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    expect(await screen.findByText("AI 操作已完成。")).toBeInTheDocument();
    expect(await screen.findByText("AI 操作执行失败，请重新发起。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重新发起" }));
    expect(screen.getByRole("textbox", { name: "输入问题" })).toHaveValue("执行两个操作");
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
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
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
      expect(client.request).toHaveBeenCalledTimes(2);
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
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const input = screen.getByRole("textbox", { name: "输入问题" });
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
