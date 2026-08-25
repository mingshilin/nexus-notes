import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NoteHistoryPanel } from "../src/notes/NoteHistoryPanel";

const revision = {
  id: "revision-2",
  workspace_id: "workspace-1",
  note_id: "note-1",
  revision: 2,
  title: "第二版标题",
  content: "第二版内容\n保留换行",
  source: "manual" as const,
  created_by: "user-1",
  created_at: "2026-08-23T00:00:00.000Z",
};

describe("NoteHistoryPanel", () => {
  it("shows a recoverable version preview and emits the selected revision", () => {
    const onRestore = vi.fn();

    render(
      <NoteHistoryPanel
        open
        revisions={[revision]}
        loading={false}
        error={null}
        restoringRevision={null}
        readOnly={false}
        onToggle={vi.fn()}
        onRetry={vi.fn()}
        onRestore={onRestore}
      />,
    );

    expect(screen.getByRole("heading", { name: "版本历史" })).toBeVisible();
    expect(screen.getByText("第二版标题")).toBeVisible();
    expect(screen.getByText(/第二版内容/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "恢复版本 2" }));
    expect(onRestore).toHaveBeenCalledWith(revision);
  });

  it("keeps retry available when history loading fails", () => {
    const onRetry = vi.fn();

    render(
      <NoteHistoryPanel
        open
        revisions={[]}
        loading={false}
        error="历史暂时无法加载。"
        restoringRevision={null}
        readOnly={false}
        onToggle={vi.fn()}
        onRetry={onRetry}
        onRestore={vi.fn()}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("历史暂时无法加载。");
    fireEvent.click(screen.getByRole("button", { name: "重试加载版本历史" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
