import { fireEvent, render, screen, within } from "@testing-library/react";
import type { Note, NoteLink } from "@nexus/contracts";
import { describe, expect, it, vi } from "vitest";
import { NoteLinksPanel } from "../src/notes/NoteLinksPanel";

const baseNote: Note = {
  id: "note-current",
  workspace_id: "ws-1",
  folder_id: null,
  database_id: null,
  created_by: "user-1",
  updated_by: "user-1",
  title: "当前笔记",
  content: "正文",
  status: "active",
  is_favorite: false,
  is_pinned: false,
  daily_date: null,
  revision: 1,
  created_at: "2026-08-23T00:00:00.000Z",
  updated_at: "2026-08-23T00:00:00.000Z",
};

const targetNote = { ...baseNote, id: "note-target", title: "目标笔记" };
const backlink: NoteLink = {
  id: "link-1",
  workspace_id: "ws-1",
  source_note_id: "note-source",
  target_note_id: "note-current",
  created_at: "2026-08-23T00:00:00.000Z",
};

describe("NoteLinksPanel", () => {
  it("keeps link controls collapsed and saves selected target notes when opened", () => {
    const onSave = vi.fn(async () => undefined);
    render(<NoteLinksPanel notes={[baseNote, targetNote]} linkedNoteIds={[]} backlinks={[backlink]} onSave={onSave} />);

    expect(screen.queryByRole("checkbox", { name: "链接到：目标笔记" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("笔记链接"));

    const panel = screen.getByRole("region", { name: "笔记链接" });
    const checkbox = within(panel).getByRole("checkbox", { name: "链接到：目标笔记" });
    fireEvent.click(checkbox);
    fireEvent.click(within(panel).getByRole("button", { name: "保存笔记链接" }));

    expect(onSave).toHaveBeenCalledWith(["note-target"]);
    expect(within(panel).getByText("当前笔记")).toBeInTheDocument();
  });

  it("shows read-only backlinks without offering a write control", () => {
    render(<NoteLinksPanel notes={[baseNote]} linkedNoteIds={[]} backlinks={[backlink]} readOnly onSave={vi.fn()} />);

    fireEvent.click(screen.getByText("笔记链接"));
    expect(screen.getByText("来自：note-source")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "保存笔记链接" })).not.toBeInTheDocument();
  });
});
