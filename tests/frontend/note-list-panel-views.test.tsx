import type React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { formatDailyTime } from "@/components/notes/DailyNoteListView";
import { NoteListPanel } from "@/components/notes/NoteListPanel";

const baseNote = {
  id: "note-1",
  folder_id: null,
  folder: null,
  title: "Daily capture",
  content: "A short note",
  is_favorite: false,
  is_pinned: false,
  is_daily: false,
  daily_date: null,
  created_at: "2026-05-10T09:30:00+08:00",
  updated_at: "2026-05-10T10:00:00+08:00",
  deleted_at: null,
  archived_at: null,
  last_opened_at: null,
  tags: [],
};

function renderPanel(overrides: Partial<React.ComponentProps<typeof NoteListPanel>> = {}) {
  return render(
    <NoteListPanel
      loading={false}
      loadError={null}
      libraryView="all"
      notes={[]}
      folders={[]}
      tags={[]}
      selectedNoteId={null}
      searchQuery=""
      recentSearches={[]}
      favoriteOnly={false}
      selectedTagId={null}
      page={1}
      pageSize={30}
      total={0}
      noteListView="list"
      noteSort="updated_desc"
      isTrashView={false}
      batchMode={false}
      batchSelectedIds={[]}
      onSearch={vi.fn()}
      onUseRecentSearch={vi.fn()}
      onFavoriteToggle={vi.fn()}
      onTagToggle={vi.fn()}
      onSelectNote={vi.fn()}
      onShareNote={vi.fn()}
      onExportNote={vi.fn()}
      onToggleBatchMode={vi.fn()}
      onToggleBatchNote={vi.fn()}
      onSelectAllVisible={vi.fn()}
      onClearBatchSelection={vi.fn()}
      onBatchDelete={vi.fn()}
      onBatchArchive={vi.fn()}
      onBatchPin={vi.fn()}
      onBatchMoveFolder={vi.fn()}
      onQuickDelete={vi.fn()}
      onCreateNote={vi.fn()}
      onOpenTemplatePicker={vi.fn()}
      onDailyDateChange={vi.fn()}
      onSetListView={vi.fn()}
      onSetNoteSort={vi.fn()}
      onPrevPage={vi.fn()}
      onNextPage={vi.fn()}
      onRetryLoad={vi.fn()}
      {...overrides}
    />,
  );
}

afterEach(() => {
  cleanup();
});

describe("NoteListPanel view semantics", () => {
  it("shows inbox-specific copy and actions", () => {
    renderPanel({ libraryView: "inbox" });

    expect(screen.getByText("收集箱")).toBeInTheDocument();
    expect(screen.getByText(/先收集，再整理/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "快速清理" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "批量归类" })).toBeInTheDocument();
  });

  it("shows daily-specific date controls and timeline labels", () => {
    renderPanel({
      libraryView: "daily",
      activeDailyDate: "2026-05-10",
      notes: [{ ...baseNote, is_daily: true, daily_date: "2026-05-10" }],
      total: 1,
    });

    expect(screen.getByTestId("daily-note-list-view")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "今天" })).toBeInTheDocument();
    expect(screen.getByLabelText("每日笔记日期")).toHaveValue("2026-05-10");
    expect(screen.getAllByText(formatDailyTime(baseNote.created_at)).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "写记录" })).toBeInTheDocument();
  });

  it("keeps all-notes view as the generic library browser", () => {
    renderPanel({ libraryView: "all", total: 12 });

    expect(screen.getByText("全部笔记")).toBeInTheDocument();
    expect(screen.getByText("Library")).toBeInTheDocument();
    expect(screen.getByLabelText("笔记排序")).toBeInTheDocument();
    expect(screen.queryByText("日期切换")).not.toBeInTheDocument();
    expect(screen.queryByText("先收集，再整理")).not.toBeInTheDocument();
  });
});
