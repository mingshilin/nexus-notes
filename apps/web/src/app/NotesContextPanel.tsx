import { Plus, Search, UserRound, X } from "lucide-react";
import type { Folder, Note } from "@nexus/contracts";

import { NoteOrganizationPanel } from "../notes/NoteOrganizationPanel";
import type { NoteListView } from "./use-notes-list-data";

export interface NotesContextPanelProps {
  workspaceId?: string;
  folders: Folder[];
  selectedFolderId: string | null;
  folderLoading: boolean;
  disabled: boolean;
  noteListView: NoteListView;
  onQuickCapture(): void;
  onOpenCreateCenter(opener: HTMLButtonElement): void;
  onOpenProfile(): void;
  onStartNewNote(): void | Promise<unknown>;
  onSelectFolder(folderId: string | null): void;
  onCreateFolder(name: string): Promise<void>;
  onChangeNoteListView(view: NoteListView): void;
  dailyNoteOpening: boolean;
  onOpenTodayNote(): void;
  noteError: string | null;
  activePane: "context" | "canvas";
  noteSearchQuery: string;
  debouncedNoteSearchQuery: string;
  onSearchChange(value: string): void;
  onClearSearch(): void;
  notesLoading: boolean;
  notesError: string | null;
  visibleNotes: Note[];
  selectedNoteId: string | null;
  onSelectNote(note: Note): void;
  notesNextCursor: string | null;
  notesPageLoading: boolean;
  onLoadMoreNotes(): void;
}

const noteViews: ReadonlyArray<readonly [NoteListView, string]> = [
  ["all", "全部"],
  ["inbox", "收件箱"],
  ["today", "今日"],
  ["favorites", "收藏"],
  ["pinned", "置顶"],
  ["archived", "归档"],
  ["trash", "回收站"],
];

export function NotesContextPanel({
  workspaceId,
  folders,
  selectedFolderId,
  folderLoading,
  disabled,
  noteListView,
  onQuickCapture,
  onOpenCreateCenter,
  onOpenProfile,
  onStartNewNote,
  onSelectFolder,
  onCreateFolder,
  onChangeNoteListView,
  dailyNoteOpening,
  onOpenTodayNote,
  noteError,
  activePane,
  noteSearchQuery,
  debouncedNoteSearchQuery,
  onSearchChange,
  onClearSearch,
  notesLoading,
  notesError,
  visibleNotes,
  selectedNoteId,
  onSelectNote,
  notesNextCursor,
  notesPageLoading,
  onLoadMoreNotes,
}: NotesContextPanelProps) {
  return (
    <div className="context-content">
      <div className="context-heading">
        <div><small>CREATE</small><h2>所有笔记</h2></div>
        <div className="context-heading-actions">
          <button className="secondary-create-note" type="button" aria-label="快速捕获" onClick={onQuickCapture}>
            <span>快速捕获</span>
          </button>
          <button className="secondary-create-note context-entry-action" type="button" aria-label="创建内容" onClick={(event) => onOpenCreateCenter(event.currentTarget)}>
            <Plus aria-hidden="true" size={15} />
            <span>创建内容</span>
          </button>
          <button className="secondary-create-note context-entry-action" type="button" aria-label="个人资料与设置（笔记列表）" onClick={onOpenProfile}>
            <UserRound aria-hidden="true" size={15} />
            <span>个人资料</span>
          </button>
          <button className="primary-create-note" type="button" aria-label="新建笔记" disabled={disabled} onClick={() => { void onStartNewNote(); }}>
            <Plus aria-hidden="true" size={17} />
            <span>新建笔记</span>
          </button>
        </div>
      </div>
      <NoteOrganizationPanel
        folders={folders}
        selectedFolderId={selectedFolderId}
        loading={folderLoading}
        disabled={disabled || !workspaceId}
        onSelectFolder={onSelectFolder}
        onCreateFolder={onCreateFolder}
      />
      <nav className="note-list-views" aria-label="笔记视图">
        {noteViews.map(([view, label]) => (
          <button key={view} type="button" aria-pressed={noteListView === view} className={noteListView === view ? "active" : ""} onClick={() => onChangeNoteListView(view)}>{label}</button>
        ))}
      </nav>
      {noteListView === "today" ? (
        <button className="primary-create-note daily-note-action" type="button" disabled={disabled || dailyNoteOpening} onClick={onOpenTodayNote}>
          {dailyNoteOpening ? "正在打开今日笔记…" : "打开今日笔记"}
        </button>
      ) : null}
      {noteListView === "today" && activePane === "context" && noteError ? <p className="database-operation-error" role="alert">{noteError}</p> : null}
      <div className="search-field" role="search">
        <Search aria-hidden="true" size={15} />
        <input aria-label="搜索笔记" placeholder="搜索标题、正文、标签…" maxLength={500} value={noteSearchQuery} onChange={(event) => onSearchChange(event.target.value)} />
        {noteSearchQuery ? (
          <button className="search-clear-button" type="button" aria-label="清除笔记搜索" title="清除搜索" onClick={onClearSearch}>
            <X aria-hidden="true" size={15} />
          </button>
        ) : null}
      </div>
      {noteSearchQuery.trim() !== debouncedNoteSearchQuery ? <p className="search-status" role="status" aria-live="polite">正在搜索…</p> : null}
      {notesLoading ? <p className="database-empty" role="status">正在加载笔记…</p> : null}
      {notesError ? <p className="database-operation-error" role="alert">{notesError}</p> : null}
      {!notesLoading && visibleNotes.length === 0 ? (
        <div className="note-empty-state">
          {debouncedNoteSearchQuery ? (
            <>
              <p className="database-empty">没有找到匹配笔记。</p>
              <button className="secondary-create-note" type="button" onClick={onClearSearch}>清除搜索</button>
            </>
          ) : (
            <>
              <p className="database-empty">暂无笔记，开始记录你的想法。</p>
              <button className="primary-create-note note-empty-create-note" type="button" aria-label="新建笔记" disabled={disabled} onClick={() => { void onStartNewNote(); }}>
                <Plus aria-hidden="true" size={17} />
                <span>新建笔记</span>
              </button>
            </>
          )}
        </div>
      ) : null}
      {visibleNotes.map((note) => (
        <button key={note.id} className={note.id === selectedNoteId ? "note-row selected" : "note-row"} type="button" onClick={() => onSelectNote(note)}>
          <strong>{note.title.trim() || "未命名笔记"}</strong><span>{new Date(note.updated_at).toLocaleDateString()}</span>
          <p>{note.content.trim().slice(0, 80) || "空白笔记"}</p>
        </button>
      ))}
      {notesNextCursor ? (
        <button className="secondary-create-note note-list-load-more" type="button" disabled={notesPageLoading} onClick={onLoadMoreNotes}>
          {notesPageLoading ? "正在加载更多笔记…" : "加载更多笔记"}
        </button>
      ) : null}
    </div>
  );
}
