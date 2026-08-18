import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NoteCard } from "@/components/notes/NoteCard";
import { ShareDialog } from "@/components/ui/ShareDialog";

const note = {
  id: "note-1",
  folder_id: null,
  folder: null,
  title: "Project kickoff",
  content: "hello world",
  is_favorite: false,
  is_pinned: false,
  is_daily: false,
  daily_date: null,
  created_at: "2026-05-01T00:00:00.000Z",
  updated_at: "2026-05-02T00:00:00.000Z",
  deleted_at: null,
  archived_at: null,
  last_opened_at: null,
  tags: [
    { id: "tag-1", name: "work", color: "#6B9EFF", created_at: "x", updated_at: "x" },
  ],
};

afterEach(() => {
  cleanup();
});

describe("NoteCard", () => {
  it("clicking a tag does not open the note card", () => {
    const onSelect = vi.fn();
    const onTagSelect = vi.fn();

    render(
      <NoteCard
        note={note}
        selected={false}
        onSelect={onSelect}
        onTagSelect={onTagSelect}
      />,
    );

    fireEvent.click(screen.getByText("work").closest("button")!);

    expect(onTagSelect).toHaveBeenCalledWith("tag-1");
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe("ShareDialog", () => {
  it("shows invite controls for owners", () => {
    render(
      <ShareDialog
        open
        noteTitle="Project kickoff"
        canInvite
        canCreatePublicShare
        onOpenChange={vi.fn()}
        onCopyDeepLink={vi.fn().mockResolvedValue(undefined)}
        onCreatePublicShare={vi.fn().mockResolvedValue({ share_url: "https://example.com/?share=abc" })}
        onCreateInvite={vi.fn().mockResolvedValue({ invite_url: "https://example.com" })}
      />,
    );

    expect(screen.getByText("生成可编辑邀请链接")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("成员邮箱")).toBeInTheDocument();
  });

  it("hides invite controls for non-owners", () => {
    render(
      <ShareDialog
        open
        noteTitle="Project kickoff"
        canInvite={false}
        canCreatePublicShare={false}
        onOpenChange={vi.fn()}
        onCopyDeepLink={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    expect(screen.queryByText("生成可编辑邀请链接")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("成员邮箱")).not.toBeInTheDocument();
  });
});
