import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Note } from "@nexus/contracts";
import { QuickCapturePanel } from "../src/notes/QuickCapturePanel";

const captured: Note = {
  id: "note-quick-1", workspace_id: "ws-1", folder_id: null, database_id: null, created_by: "user-1", updated_by: "user-1",
  title: "临时想法", content: "稍后整理", status: "active", is_favorite: false, is_pinned: false, daily_date: null,
  revision: 1, created_at: "2026-08-23T00:00:00.000Z", updated_at: "2026-08-23T00:00:00.000Z",
};

describe("QuickCapturePanel", () => {
  it("submits content through the NotesClient contract and returns the created note", async () => {
    const quickCapture = vi.fn(async () => captured);
    const onCaptured = vi.fn();
    render(<QuickCapturePanel client={{ quickCapture } as any} onClose={vi.fn()} onCaptured={onCaptured} />);

    fireEvent.change(screen.getByRole("textbox", { name: "快速捕获标题" }), { target: { value: "临时想法" } });
    fireEvent.change(screen.getByRole("textbox", { name: "快速捕获内容" }), { target: { value: "稍后整理" } });
    fireEvent.click(screen.getByRole("button", { name: "保存捕获" }));

    await waitFor(() => expect(quickCapture).toHaveBeenCalledWith({ title: "临时想法", content: "稍后整理" }));
    expect(onCaptured).toHaveBeenCalledWith(captured);
  });

  it("keeps the draft and exposes a retryable error when capture fails", async () => {
    const quickCapture = vi.fn(async () => { throw new Error("offline"); });
    render(<QuickCapturePanel client={{ quickCapture } as any} onClose={vi.fn()} onCaptured={vi.fn()} />);

    const content = screen.getByRole("textbox", { name: "快速捕获内容" });
    fireEvent.change(content, { target: { value: "离线内容" } });
    fireEvent.click(screen.getByRole("button", { name: "保存捕获" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("快速捕获失败");
    expect(content).toHaveValue("离线内容");
    expect(screen.getByRole("button", { name: "保存捕获" })).toBeEnabled();
  });
});
