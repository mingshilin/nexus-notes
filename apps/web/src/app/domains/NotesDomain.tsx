import {
  Archive,
  Bell,
  Boxes,
  Command,
  LayoutGrid,
  Pin,
  Plus,
  Share2,
  Sparkles,
  Star,
  UserRound,
} from "lucide-react";
import type { RefObject, ReactNode } from "react";
import type { Folder, Note, NoteLink, NoteRevision, Tag, WorkspaceRoleContract } from "@nexus/contracts";

import type { ApiClient } from "../../data/api-client";
import { FeatureHub, type FeatureId } from "../../features";
import { NotificationCenter, notificationButtonLabel } from "../../collaboration/NotificationCenter";
import { MarkdownPreview } from "../../notes/MarkdownPreview";
import { NoteAiActions } from "../../ai/NoteAiActions";
import { NoteConflictPanel } from "../../notes/NoteConflictPanel";
import { NoteEditorSurface } from "../../notes/NoteEditorSurface";
import { NoteHistoryPanel } from "../../notes/NoteHistoryPanel";
import { NoteLinksPanel } from "../../notes/NoteLinksPanel";
import { NoteOrganizationPanel } from "../../notes/NoteOrganizationPanel";
import { NoteTagPanel } from "../../notes/NoteTagPanel";

export interface WorkspaceDomainProps<Client, SelectedEntity, Callbacks> {
  client: Client;
  workspaceId: string;
  role: WorkspaceRoleContract;
  selectedEntity: SelectedEntity;
  callbacks: Callbacks;
}

export interface NotesOverviewState {
  workbenchMode: "desktop" | "tablet" | "mobile";
  workspaceAvailable: boolean;
  folders: Folder[];
  selectedFolderId: string | null;
  folderLoading: boolean;
  logoutPending: boolean;
  activePane: "context" | "canvas";
  noteError: string | null;
  collaborationEnabled: boolean;
  unreadCount: number;
  recoveryContent: ReactNode;
  headingRef: RefObject<HTMLHeadingElement | null>;
}

export interface NotesEditorState {
  selectedNote: Note | null;
  creatingNote: boolean;
  activeDraftId: string | null;
  draftTitle: string;
  draftContent: string;
  editorMode: "edit" | "preview";
  draftFolderId: string | null;
  draftDatabaseId: string | null;
  folders: Folder[];
  tags: Tag[];
  notes: Note[];
  noteTagIds: Record<string, string[]>;
  linkedNoteIds: string[];
  backlinks: NoteLink[];
  noteDatabases: Array<{ id: string; name: string }>;
  noteDatabasesLoading: boolean;
  noteDatabasesError: string | null;
  noteTagsLoading: boolean;
  noteTagsSaving: boolean;
  noteTagsError: string | null;
  noteLinksLoading: boolean;
  noteLinksSaving: boolean;
  noteLinksError: string | null;
  uploadingAttachment: boolean;
  logoutPending: boolean;
  activePane: "context" | "canvas";
  unreadCount: number;
  noteConflict: {
    workspaceId: string;
    entityId: string;
    local: { title: string; content: string };
    server: Note;
  } | null;
  noteSaving: boolean;
  noteMessage: string | null;
  noteError: string | null;
  historyOpen: boolean;
  noteRevisions: NoteRevision[];
  historyLoading: boolean;
  historyError: string | null;
  restoringRevision: number | null;
  permanentDeletePending: boolean;
  titleInputRef: RefObject<HTMLInputElement | null>;
  permanentDeleteOpenerRef: RefObject<HTMLButtonElement | null>;
  recoveryContent: ReactNode;
}

export interface NotesDomainSelection {
  featureMapOpen: boolean;
  editor: NotesEditorState | null;
  overview: NotesOverviewState;
}

export interface NotesDomainCallbacks {
  onStartNewNote(): void | Promise<unknown>;
  onOpenCreateCenter(opener?: HTMLButtonElement | null): void;
  onOpenProfile(): void;
  onSelectFolder(folderId: string | null): void;
  onCreateFolder(name: string): Promise<void>;
  onNavigateFeature(id: FeatureId): void;
  onToggleNotifications(opener: HTMLElement): void;
  onOpenInspector(opener: HTMLElement): void;
  onToggleFavorite(): void;
  onTogglePinned(): void;
  onOpenShare(): void;
  onOpenCommandPalette(): void;
  onDraftTitleChange(value: string): void;
  onDraftFolderChange(value: string | null): void;
  onDraftDatabaseChange(value: string | null): void;
  onCreateTag(name: string): Promise<Tag>;
  onUpdateTags(tagIds: string[]): void;
  onSaveLinks(noteIds: string[]): void | Promise<void>;
  onApplyAIContent(content: string, action: "summary" | "tasks"): void | Promise<void>;
  onApplyAITags(tags: string[]): void | Promise<void>;
  onDraftContentChange(content: string): void;
  onResolveConflict(resolution: "local" | "server"): void | Promise<void>;
  onToggleEditorMode(): void;
  onSaveNote(): void;
  onChangeStatus(status: "active" | "archived" | "trashed"): void;
  onOpenPermanentDelete(opener: HTMLButtonElement): void;
  onToggleHistory(): void;
  onRetryHistory(): void;
  onRestoreRevision(revision: NoteRevision): void;
  onUploadAttachment(file: File): void | Promise<void>;
}

type NotesClient = Pick<ApiClient, "request">;
export type NotesDomainProps = WorkspaceDomainProps<NotesClient, NotesDomainSelection, NotesDomainCallbacks>;

function NotesOverview({ state, callbacks }: { state: NotesOverviewState; callbacks: NotesDomainCallbacks }) {
  return (
    <article className="editor-document">
      <header className="editor-toolbar">
        <span className="saved-state" role="status" aria-live="polite"><span /> 已保存</span>
        <div>
          <button type="button" aria-label="打开快速操作" aria-keyshortcuts="Control+K Meta+K" title="快速操作（Ctrl/Cmd+K）" onClick={callbacks.onOpenCommandPalette}><Command aria-hidden="true" size={17} /></button>
          <button type="button" aria-label={notificationButtonLabel(state.unreadCount)} onClick={(event) => callbacks.onToggleNotifications(event.currentTarget)}><Bell aria-hidden="true" size={17} /></button>
          <button type="button" aria-label="打开检查器" onClick={(event) => callbacks.onOpenInspector(event.currentTarget)}><Boxes size={17} aria-hidden="true" /></button>
        </div>
      </header>
      <div className="editor-copy">
        <p className="eyebrow">NEXUS NOTES / PUBLIC BETA</p>
        <h1 ref={state.headingRef} tabIndex={-1}>Public Beta 重写计划</h1>
        <p className="lead">一个稳定、响应迅速、离线可恢复的知识工作台。</p>
        <section className="workspace-quick-start" aria-label="快速开始">
          <div className="workspace-quick-start-heading">
            <div><p className="eyebrow">现在就开始</p><h2>快速开始</h2></div>
            <p>常用入口集中在这里，不需要先找菜单。</p>
          </div>
          <div className="workspace-quick-start-actions">
            <button className="workspace-quick-start-action workspace-quick-start-primary" type="button" aria-label={state.workbenchMode === "mobile" ? "新建笔记（快速开始）" : "新建笔记"} disabled={state.logoutPending} onClick={() => { void callbacks.onStartNewNote(); }}>
              <span className="workspace-quick-start-icon"><Plus aria-hidden="true" size={18} /></span>
              <span><strong>新建笔记</strong><small>打开一篇空白笔记</small></span>
            </button>
            <div className="workspace-quick-start-create-center">
              <button className="create-center-trigger" type="button" aria-label="创建内容" title="打开创建中心" disabled={state.logoutPending} onClick={(event) => callbacks.onOpenCreateCenter(event.currentTarget)}>
                <Plus aria-hidden="true" size={17} /><span>创建内容</span>
              </button>
              <small>笔记、快速捕获或数据库</small>
            </div>
            <button className="workspace-quick-start-action" type="button" aria-label="个人资料与设置" disabled={state.logoutPending} onClick={callbacks.onOpenProfile}>
              <span className="workspace-quick-start-icon"><UserRound aria-hidden="true" size={18} /></span>
              <span><strong>个人资料与设置</strong><small>资料、密码、安全和工作区</small></span>
            </button>
          </div>
        </section>
        <NoteOrganizationPanel
          folders={state.folders}
          selectedFolderId={state.selectedFolderId}
          loading={state.folderLoading}
          disabled={state.logoutPending || !state.workspaceAvailable}
          onSelectFolder={callbacks.onSelectFolder}
          onCreateFolder={callbacks.onCreateFolder}
        />
        {state.noteError && state.activePane !== "context" ? <p className="database-operation-error" role="alert">{state.noteError}</p> : null}
        <hr />
        <h2>自适应工作台</h2>
        <p>导航保持轻量，列表按需出现，主画布获得最多空间，检查器不再永久挤压编辑区域。</p>
        <div className="callout"><Sparkles size={18} /><p>视觉风格继续使用原有蓝色强调、玻璃层级和舒适圆角。</p></div>
        <FeatureHub availability={{ collaboration: state.collaborationEnabled, reminders: state.workspaceAvailable }} onNavigate={callbacks.onNavigateFeature} />
        {state.recoveryContent}
      </div>
    </article>
  );
}

function NotesEditor({ client, workspaceId, role, state, callbacks }: { client: NotesClient; workspaceId: string; role: WorkspaceRoleContract; state: NotesEditorState; callbacks: NotesDomainCallbacks }) {
  const selectedNote = state.selectedNote;
  return (
    <article className="editor-document">
      <header className="editor-toolbar">
        <span className="saved-state" role="status" aria-live="polite"><span /> {state.noteSaving ? "保存中…" : state.noteMessage ?? "未保存更改"}</span>
        <div>
          {!state.creatingNote && selectedNote ? <>
            <button type="button" aria-label={selectedNote.is_favorite ? "取消收藏" : "收藏笔记"} title={selectedNote.is_favorite ? "取消收藏" : "收藏笔记"} disabled={state.logoutPending || state.noteSaving || role === "viewer" || selectedNote.status === "trashed"} onClick={callbacks.onToggleFavorite}><Star aria-hidden="true" size={17} fill={selectedNote.is_favorite ? "currentColor" : "none"} /></button>
            <button type="button" aria-label={selectedNote.is_pinned ? "取消置顶" : "置顶笔记"} title={selectedNote.is_pinned ? "取消置顶" : "置顶笔记"} disabled={state.logoutPending || state.noteSaving || role === "viewer" || selectedNote.status === "trashed"} onClick={callbacks.onTogglePinned}><Pin aria-hidden="true" size={17} fill={selectedNote.is_pinned ? "currentColor" : "none"} /></button>
            {selectedNote.status !== "trashed" ? <button type="button" aria-label={selectedNote.status === "archived" ? "取消归档" : "归档笔记"} title={selectedNote.status === "archived" ? "取消归档" : "归档笔记"} disabled={state.logoutPending || state.noteSaving || role === "viewer"} onClick={() => callbacks.onChangeStatus(selectedNote.status === "archived" ? "active" : "archived")}><Archive aria-hidden="true" size={17} /></button> : null}
            <button type="button" aria-label="打开笔记分享" title="打开笔记分享" disabled={state.logoutPending || state.noteSaving} onClick={callbacks.onOpenShare}><Share2 aria-hidden="true" size={17} /></button>
          </> : null}
          <button type="button" aria-label="打开快速操作" aria-keyshortcuts="Control+K Meta+K" title="快速操作（Ctrl/Cmd+K）" onClick={callbacks.onOpenCommandPalette}><Command aria-hidden="true" size={17} /></button>
          <button type="button" aria-label={notificationButtonLabel(state.unreadCount)} onClick={(event) => callbacks.onToggleNotifications(event.currentTarget)}><Bell aria-hidden="true" size={17} /></button>
          <button type="button" aria-label="打开检查器" onClick={(event) => callbacks.onOpenInspector(event.currentTarget)}><Boxes size={17} aria-hidden="true" /></button>
        </div>
      </header>
      <div className="editor-copy">
        <p className="eyebrow">NEXUS NOTES / PUBLIC BETA</p>
        <h1>{state.draftTitle.trim() || "未命名笔记"}</h1>
        {state.editorMode === "edit" ? <>
          <label className="note-editor-field">标题<input ref={state.titleInputRef} aria-label="笔记标题" disabled={state.logoutPending || selectedNote?.status === "trashed"} value={state.draftTitle} onChange={(event) => callbacks.onDraftTitleChange(event.target.value)} /></label>
          <label className="note-editor-field">文件夹<select aria-label="笔记文件夹" disabled={state.logoutPending || state.creatingNote || selectedNote?.status === "trashed"} value={state.draftFolderId ?? ""} onChange={(event) => callbacks.onDraftFolderChange(event.target.value || null)}><option value="">未分类</option>{state.folders.map((folder, index) => <option key={`${folder.id || "folder"}-${index}`} value={folder.id}>{folder.name}</option>)}</select></label>
          {!state.creatingNote && selectedNote ? <>
            <label className="note-editor-field">笔记数据库<select aria-label="笔记数据库" aria-busy={state.noteDatabasesLoading} disabled={state.logoutPending || role === "viewer" || state.noteSaving || selectedNote.status === "trashed" || state.noteDatabasesLoading} value={state.draftDatabaseId ?? ""} onChange={(event) => callbacks.onDraftDatabaseChange(event.target.value || null)}><option value="">未关联数据库</option>{state.noteDatabasesLoading ? <option value="__loading" disabled>加载数据库…</option> : null}{state.noteDatabases.map((database) => <option key={database.id} value={database.id}>{database.name}</option>)}</select></label>
            {state.noteDatabasesError ? <p className="database-operation-error" role="alert">{state.noteDatabasesError}</p> : null}
            <NoteTagPanel tags={state.tags} selectedTagIds={state.noteTagIds[selectedNote.id] ?? []} saving={state.noteTagsLoading || state.noteTagsSaving} readOnly={role === "viewer" || selectedNote.status === "trashed"} error={state.noteTagsError} onChange={callbacks.onUpdateTags} onCreateTag={role === "viewer" || selectedNote.status === "trashed" ? undefined : callbacks.onCreateTag} />
            <NoteLinksPanel currentNoteId={selectedNote.id} notes={state.notes} linkedNoteIds={state.linkedNoteIds} backlinks={state.backlinks} loading={state.noteLinksLoading} readOnly={role === "viewer" || selectedNote.status === "trashed"} saving={state.noteLinksSaving} error={state.noteLinksError} onSave={callbacks.onSaveLinks} />
            <NoteAiActions key={selectedNote.id} client={client} workspaceId={workspaceId} note={{ title: state.draftTitle, content: state.draftContent }} disabled={state.logoutPending || role === "viewer" || state.noteSaving || selectedNote.status === "trashed"} onApplyContent={callbacks.onApplyAIContent} onApplyTags={callbacks.onApplyAITags} />
          </> : null}
          <label className="note-editor-field">内容<NoteEditorSurface value={state.draftContent} ariaLabel="笔记内容" readOnly={state.logoutPending || selectedNote?.status === "trashed"} onUploadAttachment={!state.creatingNote && selectedNote && role !== "viewer" && selectedNote.status !== "trashed" ? callbacks.onUploadAttachment : undefined} uploadingAttachment={state.uploadingAttachment} onChange={callbacks.onDraftContentChange} /></label>
          {state.noteConflict && state.noteConflict.workspaceId === workspaceId && state.noteConflict.entityId === state.activeDraftId ? <NoteConflictPanel local={state.noteConflict.local} server={state.noteConflict.server} onKeepLocal={() => { void callbacks.onResolveConflict("local"); }} onUseServer={() => { void callbacks.onResolveConflict("server"); }} /> : null}
        </> : <MarkdownPreview content={state.draftContent} />}
        <div className="note-editor-actions">
          <button type="button" className="note-mode-action" onClick={callbacks.onToggleEditorMode}>{state.editorMode === "edit" ? "预览笔记" : "返回编辑器"}</button>
          {selectedNote?.status !== "trashed" ? (state.editorMode === "edit" ? <button type="button" disabled={state.logoutPending || state.noteSaving || (!state.creatingNote && !state.draftTitle.trim() && !state.draftContent.trim())} onClick={callbacks.onSaveNote}>{state.creatingNote && state.noteError ? "重试同步" : "保存笔记"}</button> : null) : null}
          {!state.creatingNote && selectedNote ? <>
            <button type="button" className="note-lifecycle-action" disabled={state.logoutPending || role === "viewer" || state.noteSaving} onClick={() => callbacks.onChangeStatus(selectedNote.status === "trashed" ? "active" : "trashed")}>{selectedNote.status === "trashed" ? "恢复笔记" : "移入回收站"}</button>
            {selectedNote.status === "archived" ? <button type="button" className="note-lifecycle-action" disabled={state.logoutPending || role === "viewer" || state.noteSaving} onClick={() => callbacks.onChangeStatus("active")}>取消归档</button> : null}
          </> : null}
          {selectedNote?.status === "trashed" ? <button ref={state.permanentDeleteOpenerRef} type="button" className="note-lifecycle-action note-lifecycle-danger" disabled={state.logoutPending || state.noteSaving || state.permanentDeletePending} onClick={(event) => callbacks.onOpenPermanentDelete(event.currentTarget)}>永久删除</button> : null}
          {state.noteMessage ? <p role="status">{state.noteMessage}</p> : null}
          {state.noteError && state.activePane !== "context" ? <p className="database-operation-error" role="alert">{state.noteError}</p> : null}
        </div>
        {!state.creatingNote && selectedNote ? <NoteHistoryPanel open={state.historyOpen} revisions={state.noteRevisions} loading={state.historyLoading} error={state.historyError} restoringRevision={state.restoringRevision} readOnly={role === "viewer" || selectedNote.status === "trashed"} onToggle={callbacks.onToggleHistory} onRetry={callbacks.onRetryHistory} onRestore={callbacks.onRestoreRevision} /> : null}
        {state.recoveryContent}
      </div>
    </article>
  );
}

export function NotesDomain({ client, workspaceId, role, selectedEntity, callbacks }: NotesDomainProps) {
  const content = selectedEntity.featureMapOpen || !selectedEntity.editor
    ? <NotesOverview state={selectedEntity.overview} callbacks={callbacks} />
    : <NotesEditor client={client} workspaceId={workspaceId} role={role} state={selectedEntity.editor} callbacks={callbacks} />;
  return content;
}
