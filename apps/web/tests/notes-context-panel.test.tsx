import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Folder, Note } from "@nexus/contracts";

import { NotesContextPanel } from "../src/app/NotesContextPanel";

const note: Note = {
  id: "note-1",
  workspace_id: "ws-1",
  folder_id: null,
  database_id: null,
  created_by: "user-1",
  updated_by: "user-1",
  title: "发布计划",
  content: "正文内容",
  status: "active",
  is_favorite: false,
  is_pinned: false,
  daily_date: null,
  revision: 1,
  created_at: "2026-08-30T00:00:00.000Z",
  updated_at: "2026-08-30T00:00:00.000Z",
};

const folder: Folder = {
  id: "folder-1",
  workspace_id: "ws-1",
  name: "工作",
  created_by: "user-1",
  revision: 1,
  created_at: "2026-08-30T00:00:00.000Z",
  updated_at: "2026-08-30T00:00:00.000Z",
};

function renderPanel() {
  const callbacks = {
    onQuickCapture: vi.fn(),
    onOpenCreateCenter: vi.fn(),
    onOpenProfile: vi.fn(),
    onStartNewNote: vi.fn(),
    onSelectFolder: vi.fn(),
    onCreateFolder: vi.fn(async () => undefined),
    onChangeNoteListView: vi.fn(),
    onOpenTodayNote: vi.fn(),
    onSearchChange: vi.fn(),
    onClearSearch: vi.fn(),
    onClearSearchEmptyState: vi.fn(),
    onSelectNote: vi.fn(),
    onLoadMoreNotes: vi.fn(),
  };
  render(<NotesContextPanel
    workspaceId="ws-1"
    folders={[folder]}
    selectedFolderId={null}
    folderLoading={false}
    disabled={false}
    noteListView="all"
    onQuickCapture={callbacks.onQuickCapture}
    onOpenCreateCenter={callbacks.onOpenCreateCenter}
    onOpenProfile={callbacks.onOpenProfile}
    onStartNewNote={callbacks.onStartNewNote}
    onSelectFolder={callbacks.onSelectFolder}
    onCreateFolder={callbacks.onCreateFolder}
    onChangeNoteListView={callbacks.onChangeNoteListView}
    dailyNoteOpening={false}
    onOpenTodayNote={callbacks.onOpenTodayNote}
    noteError={null}
    activePane="context"
    noteSearchQuery=""
    debouncedNoteSearchQuery=""
    onSearchChange={callbacks.onSearchChange}
    onClearSearch={callbacks.onClearSearch}
    notesLoading={false}
    notesError={null}
    visibleNotes={[note]}
    selectedNoteId={null}
    onSelectNote={callbacks.onSelectNote}
    notesNextCursor="next"
    notesPageLoading={false}
    onLoadMoreNotes={callbacks.onLoadMoreNotes}
  />);
  return callbacks;
}

describe("NotesContextPanel", () => {
  it("keeps note organization, search, selection, and pagination actions in one scoped panel", () => {
    const callbacks = renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "快速捕获" }));
    fireEvent.click(screen.getByRole("button", { name: "创建内容" }));
    fireEvent.click(screen.getByRole("button", { name: "个人资料与设置（笔记列表）" }));
    fireEvent.click(screen.getByRole("button", { name: "文件夹：工作" }));
    fireEvent.click(screen.getByRole("button", { name: "今日" }));
    fireEvent.click(screen.getByRole("button", { name: "新建笔记" }));
    fireEvent.click(screen.getByRole("button", { name: "加载更多笔记" }));
    fireEvent.click(screen.getByRole("button", { name: /发布计划/ }));

    fireEvent.change(screen.getByRole("textbox", { name: "搜索笔记" }), { target: { value: "计划" } });

    const noteButton = screen.getByRole("button", { name: /发布计划/ });
    expect(noteButton).not.toHaveAttribute("aria-label");
    expect(noteButton).toHaveAccessibleName(/正文内容/);

    expect(callbacks.onQuickCapture).toHaveBeenCalledOnce();
    expect(callbacks.onOpenCreateCenter).toHaveBeenCalledOnce();
    expect(callbacks.onOpenProfile).toHaveBeenCalledOnce();
    expect(callbacks.onSelectFolder).toHaveBeenCalledWith("folder-1");
    expect(callbacks.onChangeNoteListView).toHaveBeenCalledWith("today");
    expect(callbacks.onStartNewNote).toHaveBeenCalledOnce();
    expect(callbacks.onLoadMoreNotes).toHaveBeenCalledOnce();
    expect(callbacks.onSelectNote).toHaveBeenCalledWith(note);
    expect(callbacks.onSearchChange).toHaveBeenCalledWith("计划");
  });

  it("preserves loading, error, search-empty, and disabled states", () => {
    renderPanel();
    expect(screen.getByRole("search").parentElement!.querySelector(".note-organization")).toBeInTheDocument();
    cleanup();

    render(<NotesContextPanel
      workspaceId="ws-1"
      folders={[]}
      selectedFolderId={null}
      folderLoading
      disabled
      noteListView="today"
      onQuickCapture={vi.fn()}
      onOpenCreateCenter={vi.fn()}
      onOpenProfile={vi.fn()}
      onStartNewNote={vi.fn()}
      onSelectFolder={vi.fn()}
      onCreateFolder={vi.fn(async () => undefined)}
      onChangeNoteListView={vi.fn()}
      dailyNoteOpening
      onOpenTodayNote={vi.fn()}
      noteError="今日笔记失败"
      activePane="context"
      noteSearchQuery="无结果"
      debouncedNoteSearchQuery="无结果"
      onSearchChange={vi.fn()}
      onClearSearch={vi.fn()}
      notesLoading={false}
      notesError="列表失败"
      visibleNotes={[]}
      selectedNoteId={null}
      onSelectNote={vi.fn()}
      notesNextCursor={null}
      notesPageLoading={false}
      onLoadMoreNotes={vi.fn()}
    />);

    expect(screen.getByText("正在加载文件夹…")).toBeInTheDocument();
    expect(screen.getByText("列表失败")).toBeInTheDocument();
    expect(screen.getByText("没有找到匹配笔记。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "正在打开今日笔记…" })).toBeDisabled();
  });
});
