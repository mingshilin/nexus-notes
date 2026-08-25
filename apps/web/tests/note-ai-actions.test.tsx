import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NoteAiActions } from "../src/ai/NoteAiActions";

const note = {
  id: "note-1",
  title: "发布计划",
  content: "先完成测试，再确认部署窗口。",
};

describe("NoteAiActions", () => {
  it("previews a summary and only writes it after explicit confirmation", async () => {
    const client = {
      request: vi.fn(async () => ({ message: "这是一份关于发布计划的摘要。", model: "beta-model" })),
    };
    const onApplyContent = vi.fn();

    render(<NoteAiActions client={client as any} workspaceId="ws-1" note={note} onApplyContent={onApplyContent} />);

    fireEvent.click(screen.getByRole("button", { name: "生成摘要" }));
    await screen.findByText("这是一份关于发布计划的摘要。");
    expect(onApplyContent).not.toHaveBeenCalled();
    expect(client.request).toHaveBeenCalledWith(expect.objectContaining({
      path: "/api/v2/ai/chat",
      method: "POST",
      headers: { "x-workspace-id": "ws-1" },
      body: { messages: [{ role: "user", content: expect.stringContaining("发布计划") }] },
    }));

    fireEvent.click(screen.getByRole("button", { name: "应用到正文" }));
    expect(onApplyContent).toHaveBeenCalledWith("这是一份关于发布计划的摘要。", "summary");
  });

  it("previews extracted tasks and applies tag suggestions only after confirmation", async () => {
    const client = {
      request: vi.fn()
        .mockResolvedValueOnce({ message: "- [ ] 完成测试\n- [ ] 确认部署窗口", model: "beta-model" })
        .mockResolvedValueOnce({ message: "发布, 测试, 部署", model: "beta-model" }),
    };
    const onApplyContent = vi.fn();
    const onApplyTags = vi.fn();

    render(<NoteAiActions client={client as any} workspaceId="ws-1" note={note} onApplyContent={onApplyContent} onApplyTags={onApplyTags} />);

    fireEvent.click(screen.getByRole("button", { name: "提取任务" }));
    await screen.findByText(/完成测试/u);
    fireEvent.click(screen.getByRole("button", { name: "应用到正文" }));
    expect(onApplyContent).toHaveBeenCalledWith("- [ ] 完成测试\n- [ ] 确认部署窗口", "tasks");
    await screen.findByRole("status");

    fireEvent.click(screen.getByRole("button", { name: "建议标签" }));
    await screen.findByText("发布, 测试, 部署");
    expect(onApplyTags).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "应用标签" }));
    await waitFor(() => expect(onApplyTags).toHaveBeenCalledWith(["发布", "测试", "部署"]));
  });

  it("keeps the editor untouched when generation fails", async () => {
    const client = {
      request: vi.fn(async () => {
        throw new Error("provider unavailable");
      }),
    };
    const onApplyContent = vi.fn();

    render(<NoteAiActions client={client as any} workspaceId="ws-1" note={note} onApplyContent={onApplyContent} />);

    fireEvent.click(screen.getByRole("button", { name: "生成摘要" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("AI 生成失败");
    expect(onApplyContent).not.toHaveBeenCalled();
  });
});
