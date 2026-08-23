import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AIChatPanel } from "../src/ai/AIChatPanel";

describe("AIChatPanel", () => {
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
});
