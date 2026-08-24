import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Note } from "@nexus/contracts";
import { CreateCenter } from "../src/create/CreateCenter";
import { WebClipperPanel } from "../src/notes/WebClipperPanel";

const note: Note = {
  id: "note-1",
  workspace_id: "ws-1",
  folder_id: null,
  database_id: "db-1",
  created_by: "user-1",
  updated_by: "user-1",
  title: "Article",
  content: "Captured body",
  status: "active",
  is_favorite: false,
  is_pinned: false,
  daily_date: null,
  revision: 1,
  created_at: "2026-08-24T00:00:00.000Z",
  updated_at: "2026-08-24T00:00:00.000Z",
};

describe("Web Clipper", () => {
  it("exposes a Web Clipper action from the creation center", () => {
    const onWebClipper = vi.fn();
    render(<CreateCenter open onOpenChange={vi.fn()} onWebClipper={onWebClipper} />);

    fireEvent.click(screen.getByRole("button", { name: "Web Clipper" }));

    expect(onWebClipper).toHaveBeenCalledOnce();
  });

  it("submits a database clip and preserves the created note callback", async () => {
    const clipperCapture = vi.fn(async () => note);
    const onCaptured = vi.fn();
    render(<WebClipperPanel
      client={{ clipperCapture }}
      databases={[{ id: "db-1", name: "Reading List" } as any]}
      onClose={vi.fn()}
      onCaptured={onCaptured}
    />);

    fireEvent.change(screen.getByRole("textbox", { name: "剪藏标题" }), { target: { value: "Article" } });
    fireEvent.change(screen.getByRole("textbox", { name: "来源 URL" }), { target: { value: "https://example.com/article" } });
    fireEvent.change(screen.getByRole("textbox", { name: "剪藏正文" }), { target: { value: "Captured body" } });
    fireEvent.change(screen.getByRole("combobox", { name: "剪藏目标" }), { target: { value: "database" } });
    fireEvent.change(screen.getByRole("combobox", { name: "目标数据库" }), { target: { value: "db-1" } });
    fireEvent.click(screen.getByRole("button", { name: "保存剪藏" }));

    await waitFor(() => expect(clipperCapture).toHaveBeenCalledWith({
      title: "Article",
      url: "https://example.com/article",
      content: "Captured body",
      target: "database",
      database_id: "db-1",
    }));
    expect(onCaptured).toHaveBeenCalledWith(note);
  });

  it("requires a database before allowing the database target", () => {
    render(<WebClipperPanel client={{ clipperCapture: vi.fn() }} databases={[]} onClose={vi.fn()} />);

    fireEvent.change(screen.getByRole("combobox", { name: "剪藏目标" }), { target: { value: "database" } });

    expect(screen.getByRole("button", { name: "保存剪藏" })).toBeDisabled();
    expect(screen.getByText("请先选择目标数据库。" )).toBeInTheDocument();
  });
});
