import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

describe("KnowledgeDiagnosticActions", () => {
  it("lets an editor choose a folder for every unfiled note", async () => {
    const { KnowledgeDiagnosticActions } = await import("../src/knowledge/KnowledgeDiagnosticActions");
    const onClassifyUnfiled = vi.fn();

    render(<KnowledgeDiagnosticActions
      diagnostics={[{ kind: "unfiled_note", entity_id: "note-1", title: "未整理笔记", count: 1 }]}
      folders={[{ id: "folder-1", workspace_id: "ws-1", name: "项目", position: 0, created_at: "2026-08-24T00:00:00.000Z", updated_at: "2026-08-24T00:00:00.000Z" }]}
      disabled={false}
      onClassifyUnfiled={onClassifyUnfiled}
      onMoveOrphansToInbox={vi.fn()}
      onIgnoreOrphans={vi.fn()}
      onMergeDuplicate={vi.fn()}
    />);

    fireEvent.change(screen.getByRole("combobox", { name: "未整理笔记目标文件夹" }), { target: { value: "folder-1" } });
    fireEvent.click(screen.getByRole("button", { name: "批量归类未整理笔记" }));
    expect(onClassifyUnfiled).toHaveBeenCalledWith("folder-1");
  });
});
