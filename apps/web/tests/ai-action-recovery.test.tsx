import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AIChatPanel } from "../src/ai/AIChatPanel";

type ChatRequest = {
  path: string;
  method?: string;
  body?: {
    messages?: Array<{ role: string; content: string }>;
  };
  policy?: {
    idempotencyKey?: string;
  };
};

function makeClient(responses: unknown[]) {
  let chatIndex = 0;
  const request = vi.fn(async (options: ChatRequest) => {
    if (options.path === "/api/v2/ai/status") return { configured: true, source: "server_default" };
    if (options.path === "/api/v2/ai/chat") return responses[chatIndex++] ?? { message: "没有更多结果。", model: "beta-model" };
    throw new Error(`Unexpected request: ${options.path}`);
  });

  return {
    request,
    confirmAiAction: vi.fn(),
    rejectAiAction: vi.fn(),
  };
}

async function sendPrompt(prompt: string) {
  const input = await screen.findByRole("textbox", { name: "输入问题" });
  fireEvent.change(input, { target: { value: prompt } });
  fireEvent.click(screen.getByRole("button", { name: "发送" }));
}

describe("AI action recovery", () => {
  it("does not offer recovery for an executed automatic result", async () => {
    const client = makeClient([{
      message: "已创建笔记。",
      model: "beta-model",
      action_results: [{ action_id: "automatic-note", status: "executed", entity_id: "note-1", revision: 2 }],
    }]);

    render(<AIChatPanel client={client as any} workspaceId="ws-1" />);
    await sendPrompt("创建一篇笔记");

    expect(await screen.findByText("AI 操作已完成。")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "重新发起" })).not.toBeInTheDocument();
  });

  it("shows a failed result with an accessible recovery control", async () => {
    const originalPrompt = "失败后继续执行整理";
    const client = makeClient([{
      message: "操作未完成。",
      model: "beta-model",
      action_results: [{
        action_id: "failed-action",
        status: "failed",
        retryable: false,
        error: { code: "AI_ACTION_EXECUTION_FAILED", message: "safe", status: 500 },
      }],
    }]);

    render(<AIChatPanel client={client as any} workspaceId="ws-1" />);
    await sendPrompt(originalPrompt);

    expect(await screen.findByText("AI 操作执行失败，请重新发起。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重新发起" }));
    expect(screen.getByRole("textbox", { name: "输入问题" })).toHaveValue(originalPrompt);
    expect(screen.getByText("AI 操作执行失败，请重新发起。")).toBeInTheDocument();
  });

  it("shows a conflict result with a state-specific recovery control", async () => {
    const originalPrompt = "更新冲突笔记的标题";
    const client = makeClient([{
      message: "操作未完成。",
      model: "beta-model",
      action_results: [{
        action_id: "conflict-action",
        status: "conflict",
        retryable: false,
        error: { code: "AI_ACTION_NOTE_CONFLICT", message: "safe", status: 409 },
      }],
    }]);

    render(<AIChatPanel client={client as any} workspaceId="ws-1" />);
    await sendPrompt(originalPrompt);

    expect(await screen.findByText("AI 操作未执行：目标内容已发生变化。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重新发起" }));
    expect(screen.getByRole("textbox", { name: "输入问题" })).toHaveValue(originalPrompt);
  });

  it("warns before recovery when an in-progress result may still be completing", async () => {
    const originalPrompt = "继续等待正在执行的操作";
    const client = makeClient([{
      message: "操作仍在执行。",
      model: "beta-model",
      action_results: [{
        action_id: "in-progress-action",
        status: "failed",
        retryable: true,
        error: { code: "AI_ACTION_IN_PROGRESS", message: "safe", status: 409 },
      }],
    }]);

    render(<AIChatPanel client={client as any} workspaceId="ws-1" />);
    await sendPrompt(originalPrompt);

    expect(await screen.findByText("上一次 AI 操作可能仍在完成，请勿重复提交。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重新发起" }));
    expect(screen.getByRole("textbox", { name: "输入问题" })).toHaveValue(originalPrompt);
    expect(client.request.mock.calls.filter(([options]) => options.path === "/api/v2/ai/chat")).toHaveLength(1);
  });

  it("recovers proposals from the original user prompt and keeps the proposal visible", async () => {
    const originalPrompt = "请把这篇周报整理成三个行动项";
    const client = makeClient([{
      message: "已生成待确认操作。",
      model: "beta-model",
      action_proposals: [{
        action_id: "proposal-action",
        tool: "update_note",
        summary: "整理周报",
        input: { target_note_id: "note-1", base_revision: 2, patch: { title: "行动项" } },
        requires_confirmation: true,
        expires_at: "2000-08-25T01:00:00.000Z",
      }],
    }]);

    render(<AIChatPanel client={client as any} workspaceId="ws-1" />);
    await sendPrompt(originalPrompt);

    expect(await screen.findByText("整理周报")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重新发起" }));
    expect(screen.getByRole("textbox", { name: "输入问题" })).toHaveValue(originalPrompt);
    expect(screen.getByText("整理周报")).toBeInTheDocument();
  });

  it("keeps the old result after recovery and uses a fresh idempotency key for the new send", async () => {
    const originalPrompt = "失败后再次执行这个操作";
    const client = makeClient([
      {
        message: "第一次未完成。",
        model: "beta-model",
        action_results: [{
          action_id: "recoverable-action",
          status: "failed",
          retryable: false,
          error: { code: "AI_ACTION_EXECUTION_FAILED", message: "safe", status: 500 },
        }],
      },
      { message: "第二次已提交。", model: "beta-model" },
    ]);

    render(<AIChatPanel client={client as any} workspaceId="ws-1" />);
    await sendPrompt(originalPrompt);
    expect(await screen.findByText("AI 操作执行失败，请重新发起。")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "重新发起" }));
    expect(screen.getByRole("textbox", { name: "输入问题" })).toHaveValue(originalPrompt);
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => expect(screen.getByText("第二次已提交。")).toBeInTheDocument());
    const chatCalls = client.request.mock.calls
      .map(([options]) => options as ChatRequest)
      .filter((options) => options.path === "/api/v2/ai/chat");
    expect(chatCalls).toHaveLength(2);
    const keys = chatCalls.map((options) => options.policy?.idempotencyKey);
    expect(keys.every((key): key is string => typeof key === "string" && key.length > 0)).toBe(true);
    expect(new Set(keys).size).toBe(2);
    expect(chatCalls[1]?.body?.messages?.at(-1)).toEqual({ role: "user", content: originalPrompt });
    expect(screen.getByText("AI 操作执行失败，请重新发起。")).toBeInTheDocument();
  });
});
