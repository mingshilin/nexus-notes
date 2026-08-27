import {
  Archive,
  Bell,
  Boxes,
  Command,
  LayoutGrid,
  Pin,
  Plus,
  Search,
  Share2,
  Sparkles,
  Star,
  UserRound,
  X,
} from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { MAX_UPLOAD_BYTES, NoteSchema, SUPPORTED_ATTACHMENT_MIME_TYPES } from "@nexus/contracts";
import type { Attachment, AuthSession, AuthUserSummary, Database, DatabaseRecord, Folder, KnowledgeDiagnostic, Note, NoteLink, NoteRevision, Profile, SyncOperation, SyncOperationResult, Tag, WorkspaceMembershipSummary, WorkspaceRoleContract } from "@nexus/contracts";
import { AuthClient, AuthGate } from "../auth";
import { ApiClient, ApiClientError } from "../data/api-client";
import { CollaborationClient } from "../data/collaboration-client";
import { NoteAiActions } from "../ai/NoteAiActions";
import { KnowledgeRecoveryPanel, type RecoveryDiagnostic, type RecoveryFilters } from "../knowledge/KnowledgeRecoveryPanel";
import type { ServiceWorkerUpdate } from "../data/service-worker";
import { useWorkbenchMode } from "../layout/use-mobile-layout";
import type { DatabaseClient, DatabaseBundle } from "../data/database-client";
import { BetaLocalStore } from "../data/local-store";
import { NoteDraftController, type DraftSyncResult, type NoteDraftStore } from "../notes/note-draft-controller";
import { NormalizedCache } from "../data/normalized-cache";
import { useWorkspaceSync } from "../data/use-workspace-sync";
import type { SyncChange } from "../data/sync-engine";
import { ProductNavigation, type AccountSubsection, type ProductDomain } from "../navigation/ProductNavigation";
import { QuickCapturePanel } from "../notes/QuickCapturePanel";
import { WebClipperPanel } from "../notes/WebClipperPanel";
import { NoteOrganizationPanel } from "../notes/NoteOrganizationPanel";
import { NoteTagPanel } from "../notes/NoteTagPanel";
import { NoteEditorSurface } from "../notes/NoteEditorSurface";
import { NoteConflictPanel } from "../notes/NoteConflictPanel";
import { NoteLinksPanel } from "../notes/NoteLinksPanel";
import { NoteHistoryPanel } from "../notes/NoteHistoryPanel";
import { MarkdownPreview } from "../notes/MarkdownPreview";
import { CommandPalette, type CommandAction } from "../commands/CommandPalette";
import { CreateCenter, ImportExportCenter, type CreateActionResult } from "../create";
import { FeatureHub } from "../features";
import { InviteRedemptionPage } from "../collaboration/InviteRedemptionPage";
import { PublicSharePage } from "../collaboration/PublicSharePage";
import { NotificationCenter, notificationButtonLabel } from "../collaboration/NotificationCenter";
import type { CollaborationCommentTarget, CollaborationShareTarget, NotificationTarget } from "../collaboration/collaboration-types";
import { useWorkspaceClients } from "./use-workspace-clients";
import { useWorkspaceNavigation } from "./use-workspace-navigation";
import { WorkspaceShell } from "./WorkspaceShell";
import {
  loadAccountCenter,
  loadAIChatPanel,
  loadCollaborationCenter,
  loadDatabaseWorkbench,
  loadKnowledgeCalendarPanel,
  loadKnowledgeGraphPanel,
  loadKnowledgeSearchPanel,
  loadReminderPanel,
  preloadWorkspaceDomain,
} from "./workspace-domain-loader";

const LazyDatabaseWorkbench = lazy(async () => {
  const module = await loadDatabaseWorkbench();
  return { default: module.DatabaseWorkbench };
});
const LazyKnowledgeSearchPanel = lazy(async () => {
  const module = await loadKnowledgeSearchPanel();
  return { default: module.KnowledgeSearchPanel };
});
const LazyKnowledgeGraphPanel = lazy(async () => {
  const module = await loadKnowledgeGraphPanel();
  return { default: module.KnowledgeGraphPanel };
});
const LazyKnowledgeCalendarPanel = lazy(async () => {
  const module = await loadKnowledgeCalendarPanel();
  return { default: module.KnowledgeCalendarPanel };
});
const LazyReminderPanel = lazy(async () => {
  const module = await loadReminderPanel();
  return { default: module.ReminderPanel };
});
const LazyAccountCenter = lazy(async () => {
  const module = await loadAccountCenter();
  return { default: module.AccountCenter };
});
const LazyAIChatPanel = lazy(async () => {
  const module = await loadAIChatPanel();
  return { default: module.AIChatPanel };
});
const LazyCollaborationCenter = lazy(async () => {
  const module = await loadCollaborationCenter();
  return { default: module.CollaborationCenter };
});

const defaultAuthClient = new AuthClient(new ApiClient());
const initialRecoveryFilters: RecoveryFilters = { mimeType: "", ocrStatus: "" };
type OcrStatus = NonNullable<Attachment["ocr_status"]>;
type AppRoute =
  | { kind: "workspace"; workspaceId?: string }
  | { kind: "invite"; token: string }
  | { kind: "share"; token: string };
type NoteListView = "all" | "inbox" | "today" | "favorites" | "pinned" | "archived" | "trash";
type WorkspaceRouteAuthority = { userId: string; workspaceId: string };
type WorkspaceModal = "create" | "quick-capture" | "web-clipper" | "import" | "permanent-delete";
type UserScopedLocalStore = NoteDraftStore & { destroy(): Promise<void> };
type LogoutPhase = "idle" | "quiescing" | "cleanup" | "cleanup-error";
type NoteConflictState = {
  workspaceId: string;
  entityId: string;
  local: { title: string; content: string };
  server: Note;
};

function permanentDeleteErrorMessage(error: unknown) {
  const candidate = error instanceof ApiClientError
    ? { code: error.code, retryable: error.retryable, requestId: error.requestId }
    : typeof error === "object" && error !== null
      ? error as { code?: unknown; retryable?: unknown; requestId?: unknown; request_id?: unknown }
      : {};
  const code = typeof candidate.code === "string" ? candidate.code : "";
  const retryable = candidate.retryable === true;
  const requestId = typeof candidate.requestId === "string"
    ? candidate.requestId
    : typeof candidate.request_id === "string" ? candidate.request_id : undefined;
  const message = code === "NOTE_CONFLICT"
    ? "笔记已发生变化。请刷新回收站后再试。"
    : code === "NOTE_NOT_TRASHED"
      ? "笔记已不在回收站中。请刷新回收站后再试。"
      : code === "NOTE_NOT_FOUND"
        ? "笔记已不存在或无权访问。请刷新回收站后再试。"
        : code === "NETWORK_ERROR" || code === "TIMEOUT" || retryable
          ? "网络或服务暂时不可用。笔记仍保留在回收站中，可安全重试。"
          : "永久删除失败，请重试。笔记仍保留在回收站中。";
  const safeRequestId = requestId && /^[A-Za-z0-9._:-]{1,128}$/u.test(requestId) ? requestId : undefined;
  return safeRequestId ? `${message} 请求 ID：${safeRequestId}` : message;
}

function localDateKey(date = new Date()) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

function noteMatchesListView(note: Note, view: NoteListView, todayDate = localDateKey()) {
  if (view === "trash") return note.status === "trashed";
  if (view === "archived") return note.status === "archived";
  if (note.status !== "active") return false;
  if (view === "inbox") return note.folder_id === null;
  if (view === "today") return note.daily_date === todayDate;
  if (view === "favorites") return note.is_favorite;
  if (view === "pinned") return note.is_pinned;
  return true;
}

function clearUserScopedBrowserState() {
  if (typeof window === "undefined") return;
  for (const storage of [window.localStorage, window.sessionStorage]) {
    const keys: string[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key?.startsWith("nexus:")) keys.push(key);
    }
    keys.forEach((key) => storage.removeItem(key));
  }
}

function LogoutCleanupRecovery({ failed, deleted, onRetry }: { failed: boolean; deleted: boolean; onRetry(): void }) {
  return (
    <main className="logout-cleanup-page">
      <section className="logout-cleanup-card" aria-live="polite">
        <p className="eyebrow">SECURE SIGN OUT</p>
        <h1>{failed ? "本地数据清理失败" : "正在清理本地数据"}</h1>
        {failed ? (
          <>
            <p role="alert">{deleted ? "账户已删除，但此设备上的离线数据尚未清理完成。完成清理前无法重新登录。" : "服务器会话已退出，但此设备上的离线数据尚未清理完成。完成清理前无法重新登录。"}</p>
            <button type="button" onClick={onRetry}>重试清理本地数据</button>
          </>
        ) : <p role="status">正在移除此账户的离线数据，请勿关闭页面。</p>}
      </section>
    </main>
  );
}

function resetTokenFromLocation() {
  if (typeof window === "undefined") return undefined;
  return new URLSearchParams(window.location.search).get("reset_token") ?? undefined;
}

function recoveryFeedback(result: { queued: string[]; ineligible: string[]; duplicate: string[] }) {
  const feedback: string[] = [];
  if (result.queued.length) feedback.push(`已加入 ${result.queued.length} 项 OCR 重试。`);
  if (result.ineligible.length) feedback.push(`${result.ineligible.length} 项不符合重试条件。`);
  if (result.duplicate.length) feedback.push(`${result.duplicate.length} 项已在处理中。`);
  return feedback.join(" ") || "没有可重试的附件。";
}

function isSupportedAttachmentMime(value: string): value is typeof SUPPORTED_ATTACHMENT_MIME_TYPES[number] {
  return (SUPPORTED_ATTACHMENT_MIME_TYPES as readonly string[]).includes(value);
}

function isAborted(error: unknown, signal: AbortSignal) {
  return signal.aborted || (error instanceof DOMException && error.name === "AbortError");
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;
  const element = target as HTMLElement;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName)
    || element.isContentEditable
    || Boolean(element.closest("[contenteditable='true']"));
}

function isRecordNotFound(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const details = error as { code?: string; status?: number };
  return details.code === "RECORD_NOT_FOUND" && details.status === 404;
}

async function resolveDatabaseNotificationTarget(
  client: DatabaseClient,
  target: NotificationTarget,
  signal: AbortSignal,
) {
  const databases = await client.listDatabases(signal);
  const candidates = target.databaseId
    ? databases.filter((database) => database.id === target.databaseId)
    : databases;
  for (const database of candidates) {
    try {
      const record = await client.getRecord(database.id, target.targetId, signal);
      return { database, databases, record };
    } catch (error) {
      if (isRecordNotFound(error)) continue;
      throw error;
    }
  }
  throw Object.assign(new Error("Database notification target was not found"), { code: "RECORD_NOT_FOUND", status: 404 });
}

function routeFromLocation(): AppRoute {
  if (typeof window === "undefined") return { kind: "workspace" };
  const share = window.location.pathname.match(/^\/share\/([A-Za-z0-9_-]{43,256})\/?$/u)?.[1];
  if (share) return { kind: "share", token: share };
  const invite = window.location.pathname.match(/^\/invite\/([A-Za-z0-9_-]{43,256})\/?$/u)?.[1];
  if (invite) return { kind: "invite", token: invite };
  return { kind: "workspace" };
}

function WorkspaceSessionBoundary({ session, routeWorkspaceId, routeAuthority, initialWorkspaceId, onStaleRoute, children }: {
  session: AuthSession;
  routeWorkspaceId?: string;
  routeAuthority: WorkspaceRouteAuthority | null;
  initialWorkspaceId?: string;
  onStaleRoute(workspaceId: string, authority: WorkspaceRouteAuthority | null): void;
  children(selection: {
    activeWorkspace: WorkspaceMembershipSummary | undefined;
    activeWorkspaceId: string | null;
    memberships: WorkspaceMembershipSummary[];
  }): ReactNode;
}) {
  const memberships = Array.isArray(session.workspaces) ? session.workspaces : [];
  const routeWorkspace = routeWorkspaceId
    ? memberships.find((workspace) => workspace.id === routeWorkspaceId)
    : undefined;
  const routeAuthorized = Boolean(
    routeWorkspace
    && routeAuthority?.userId === session.user.id
    && routeAuthority.workspaceId === routeWorkspaceId,
  );
  const sessionWorkspace = memberships.find((workspace) => workspace.id === session.active_workspace_id);
  const initialWorkspace = initialWorkspaceId
    ? memberships.find((workspace) => workspace.id === initialWorkspaceId)
    : undefined;
  const activeWorkspace = routeAuthorized ? routeWorkspace : sessionWorkspace ?? initialWorkspace;
  const staleRoute = Boolean(routeWorkspaceId && !routeAuthorized);

  useEffect(() => {
    if (staleRoute && routeWorkspaceId) onStaleRoute(routeWorkspaceId, routeAuthority);
  }, [onStaleRoute, routeAuthority, routeWorkspaceId, staleRoute]);

  return <>{children({ activeWorkspace, activeWorkspaceId: activeWorkspace?.id ?? null, memberships })}</>;
}

function AuthenticatedWorkspace({
  apiClient,
  workspaceId,
  workspaces,
  activeWorkspaceId,
  user,
  role,
  collaborationEnabled,
  localStore,
  draftControllerRef,
  logoutPending,
  logoutError,
  onLogout,
  onRetryLogout,
  onDiagnosticNavigate,
  onWorkspaceChange,
  onCreateWorkspace,
  onDeleted,
}: {
  apiClient: ApiClient;
  workspaceId?: string;
  workspaces: WorkspaceMembershipSummary[];
  activeWorkspaceId: string | null;
  user: AuthUserSummary;
  role: WorkspaceRoleContract;
  collaborationEnabled: boolean;
  localStore: NoteDraftStore;
  draftControllerRef: { current: NoteDraftController | null };
  logoutPending: boolean;
  logoutError: string | null;
  onLogout(): void;
  onRetryLogout(): void;
  onWorkspaceChange(workspaceId: string): void | Promise<void>;
  onCreateWorkspace(name: string): Promise<WorkspaceMembershipSummary>;
  onDeleted(): void;
  onDiagnosticNavigate?: (diagnostic: KnowledgeDiagnostic) => void;
}) {
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [activePane, setActivePane] = useState<"context" | "canvas">("canvas");
  const { activeDomain, requestedDomain, domainPending, navigate: navigateWorkspaceDomain } = useWorkspaceNavigation("notes");
  const [accountSubsection, setAccountSubsection] = useState<AccountSubsection>("overview");
  const workspaceClients = useWorkspaceClients(apiClient, workspaceId ?? "");
  const collaborationClient = workspaceClients.collaboration;
  const databaseClient = workspaceClients.databases;
  const knowledgeClient = workspaceClients.knowledge;
  const notesClient = workspaceClients.notes;
  const operationsClient = workspaceClients.operations;
  const profileClient = workspaceClients.profile;
  const transitionToDomain = useCallback((domain: ProductDomain) => {
    setActivePane("canvas");
    navigateWorkspaceDomain(domain);
  }, [navigateWorkspaceDomain]);
  const [navigationUser, setNavigationUser] = useState(user);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [notes, setNotes] = useState<Note[]>([]);
  const [notesLoading, setNotesLoading] = useState(Boolean(workspaceId));
  const [notesError, setNotesError] = useState<string | null>(null);
  const [notesRefreshVersion, setNotesRefreshVersion] = useState(0);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [folderLoading, setFolderLoading] = useState(Boolean(workspaceId));
  const [noteFolderFilter, setNoteFolderFilter] = useState<string | null>(null);
  const [noteSearchQuery, setNoteSearchQuery] = useState("");
  const [debouncedNoteSearchQuery, setDebouncedNoteSearchQuery] = useState("");
  const [tags, setTags] = useState<Tag[]>([]);
  const [noteTagIds, setNoteTagIds] = useState<Record<string, string[]>>({});
  const [noteTagsLoading, setNoteTagsLoading] = useState(false);
  const [noteTagsSaving, setNoteTagsSaving] = useState(false);
  const [noteTagsError, setNoteTagsError] = useState<string | null>(null);
  const [linkedNoteIds, setLinkedNoteIds] = useState<string[]>([]);
  const [backlinks, setBacklinks] = useState<NoteLink[]>([]);
  const [noteLinksLoading, setNoteLinksLoading] = useState(false);
  const [noteLinksSaving, setNoteLinksSaving] = useState(false);
  const [noteLinksError, setNoteLinksError] = useState<string | null>(null);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [workspaceModal, setWorkspaceModal] = useState<WorkspaceModal | null>(null);
  const createCenterOpen = workspaceModal === "create";
  const quickCaptureOpen = workspaceModal === "quick-capture";
  const webClipperOpen = workspaceModal === "web-clipper";
  const importCenterOpen = workspaceModal === "import";
  const permanentDeleteOpen = workspaceModal === "permanent-delete";
  const setCreateCenterOpen = useCallback((open: boolean) => {
    setWorkspaceModal((current) => open
      ? current === null || current === "create" ? "create" : current
      : current === "create" ? null : current);
  }, []);
  const setQuickCaptureOpen = useCallback((open: boolean) => {
    setWorkspaceModal((current) => open
      ? current === null || current === "quick-capture" ? "quick-capture" : current
      : current === "quick-capture" ? null : current);
  }, []);
  const setImportCenterOpen = useCallback((open: boolean) => {
    setWorkspaceModal((current) => open
      ? current === null || current === "import" ? "import" : current
      : current === "import" ? null : current);
  }, []);
  const setPermanentDeleteOpen = useCallback((open: boolean) => {
    setWorkspaceModal((current) => open
      ? current === null || current === "permanent-delete" ? "permanent-delete" : current
      : current === "permanent-delete" ? null : current);
  }, []);
  const replaceWorkspaceModal = useCallback((modal: WorkspaceModal | null) => {
    setWorkspaceModal(modal);
  }, []);
  const [featureMapOpen, setFeatureMapOpen] = useState(false);
  const [noteListView, setNoteListView] = useState<NoteListView>("all");
  const [creatingNote, setCreatingNote] = useState(false);
  const [dailyNoteOpening, setDailyNoteOpening] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftContent, setDraftContent] = useState("");
  const [editorMode, setEditorMode] = useState<"edit" | "preview">("edit");
  const [draftFolderId, setDraftFolderId] = useState<string | null>(null);
  const [draftDatabaseId, setDraftDatabaseId] = useState<string | null>(null);
  const [noteDatabases, setNoteDatabases] = useState<Database[]>([]);
  const [noteDatabasesLoading, setNoteDatabasesLoading] = useState(false);
  const [noteDatabasesError, setNoteDatabasesError] = useState<string | null>(null);
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteMessage, setNoteMessage] = useState<string | null>(null);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [noteRevisions, setNoteRevisions] = useState<NoteRevision[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyRefreshVersion, setHistoryRefreshVersion] = useState(0);
  const [restoringRevision, setRestoringRevision] = useState<number | null>(null);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [commandPaletteQuery, setCommandPaletteQuery] = useState("");
  const [permanentDeletePending, setPermanentDeletePending] = useState(false);
  const [permanentDeleteError, setPermanentDeleteError] = useState<string | null>(null);
  const [activeDraftId, setActiveDraftId] = useState<string | null>(null);
  const [serverRetryVersion, setServerRetryVersion] = useState(0);
  const [noteConflict, setNoteConflict] = useState<NoteConflictState | null>(null);
  const [resolvingConflict, setResolvingConflict] = useState(false);
  const [pendingReconcile, setPendingReconcile] = useState<{ workspaceId: string; entityId: string; result: DraftSyncResult } | null>(null);
  const [selectedDatabaseRecordId, setSelectedDatabaseRecordId] = useState<string | null>(null);
  const [selectedCommentId, setSelectedCommentId] = useState<string | null>(null);
  const [collaborationInitialSection, setCollaborationInitialSection] = useState<"people" | "comments" | "shares">("people");
  const [databases, setDatabases] = useState<Database[]>([]);
  const [selectedDatabaseId, setSelectedDatabaseId] = useState<string | null>(null);
  const [databaseBundle, setDatabaseBundle] = useState<DatabaseBundle | null>(null);
  const [databaseRecords, setDatabaseRecords] = useState<DatabaseRecord[]>([]);
  const [resolvedNotificationRecord, setResolvedNotificationRecord] = useState<DatabaseRecord | null>(null);
  const [databaseRecordsNextCursor, setDatabaseRecordsNextCursor] = useState<string | null>(null);
  const [databaseLoading, setDatabaseLoading] = useState(false);
  const [databaseError, setDatabaseError] = useState<string | null>(null);
  const [databaseRefreshVersion, setDatabaseRefreshVersion] = useState(0);
  const [firstDatabaseName, setFirstDatabaseName] = useState("");
  const [databaseCreateOpen, setDatabaseCreateOpen] = useState(false);
  const [creatingFirstDatabase, setCreatingFirstDatabase] = useState(false);
  const [serviceWorkerUpdate, setServiceWorkerUpdate] = useState<ServiceWorkerUpdate | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<KnowledgeDiagnostic[]>([]);
  const [filters, setFilters] = useState<RecoveryFilters>(initialRecoveryFilters);
  const [attachmentCursor, setAttachmentCursor] = useState<string | null>(null);
  const [diagnosticCursor, setDiagnosticCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(workspaceId));
  const [refreshing, setRefreshing] = useState(false);
  const [attachmentError, setAttachmentError] = useState<string | null>(workspaceId ? null : "未选择工作区，无法加载恢复数据。");
  const [diagnosticError, setDiagnosticError] = useState<string | null>(null);
  const [retryFeedback, setRetryFeedback] = useState<string | null>(null);
  const [retryingIds, setRetryingIds] = useState<Set<string>>(new Set());
  const [refreshVersion, setRefreshVersion] = useState(0);
  const requestControllers = useRef(new Set<AbortController>());
  const retryControllers = useRef(new Set<AbortController>());
  const databaseControllers = useRef(new Set<AbortController>());
  const databaseCache = useRef(new NormalizedCache());
  const databaseSelectionSync = useRef<string | null>(null);
  const attachmentQueryIdentity = useRef<string | null>(null);
  const inspectorOpenerRef = useRef<HTMLElement | null>(null);
  const notificationOpenerRef = useRef<HTMLElement | null>(null);
  const notificationTargetController = useRef<AbortController | null>(null);
  const historyController = useRef<AbortController | null>(null);
  const noteListViewRef = useRef<NoteListView>(noteListView);
  const [draftController] = useState(() => {
    return new NoteDraftController(localStore);
  });
  const activeDraftIdRef = useRef<string | null>(null);
  const activationInFlight = useRef(false);
  const dailyNoteOpeningRef = useRef(false);
  const userSelectedNote = useRef(false);
  const draftTitleRef = useRef("");
  const draftContentRef = useRef("");
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const createCenterFocusTargetRef = useRef<HTMLButtonElement | null>(null);
  const openCreateCenter = useCallback((opener?: HTMLButtonElement | null) => {
    const active = typeof document !== "undefined" && document.activeElement instanceof HTMLButtonElement
      ? document.activeElement
      : null;
    createCenterFocusTargetRef.current = opener ?? active;
    setCreateCenterOpen(true);
  }, [setCreateCenterOpen]);
  const permanentDeleteOpenerRef = useRef<HTMLButtonElement | null>(null);
  const permanentDeleteDialogRef = useRef<HTMLDivElement | null>(null);
  const permanentDeleteCancelRef = useRef<HTMLButtonElement | null>(null);
  const permanentDeleteFallbackRef = useRef<HTMLHeadingElement | null>(null);
  const permanentDeletePendingRef = useRef(false);
  const permanentDeleteWasOpenRef = useRef(false);
  const permanentDeleteFocusTargetRef = useRef<"origin" | "fallback">("origin");
  const focusInstalledNoteRef = useRef(false);
  const installedNotesRef = useRef(new Map<string, Note>());
  const mountedRef = useRef(true);
  const selectedNote = notes.find((note) => note.id === selectedNoteId) ?? null;
  const workbenchMode = useWorkbenchMode();
  permanentDeletePendingRef.current = permanentDeletePending;
  const visibleNotes = noteFolderFilter === null
    ? notes
    : notes.filter((note) => note.folder_id === noteFolderFilter);
  const noteTargets = notes.map((note) => ({
    type: "note" as const,
    id: note.id,
    label: note.title.trim() || "未命名笔记",
  }));
  const userId = user.id;

  const applyWorkspaceSyncChange = useCallback(async (change: SyncChange) => {
    if (change.entity_type !== "note") return;
    if (change.kind === "delete") {
      setNotes((current) => current.filter((note) => note.id !== change.entity_id));
      if (activeDraftIdRef.current === change.entity_id) {
        setNoteError("当前笔记已在其他设备删除，本地草稿仍保留。请先处理本地内容。");
      }
      return;
    }
    const parsed = NoteSchema.safeParse(change.payload);
    if (!parsed.success) return;
    const note = parsed.data;
    if (activeDraftIdRef.current === note.id) {
      setNoteConflict({
        workspaceId: note.workspace_id,
        entityId: note.id,
        local: { title: draftTitleRef.current, content: draftContentRef.current },
        server: note,
      });
      return;
    }
    setNotes((current) => current.some((item) => item.id === note.id)
      ? current.map((item) => item.id === note.id ? note : item)
      : [note, ...current]);
  }, []);

  const handleWorkspaceSyncConflict = useCallback((operation: SyncOperation, result: SyncOperationResult) => {
    if (operation.entity_type !== "note" || !workspaceId || result.status !== "conflict") return;
    const localTitle = typeof operation.patch.title === "string" ? operation.patch.title : draftTitleRef.current;
    const localContent = typeof operation.patch.content === "string" ? operation.patch.content : draftContentRef.current;
    void notesClient.get(operation.entity_id).then((server) => {
      if (activeDraftIdRef.current !== operation.entity_id) return;
      setNoteConflict({
        workspaceId,
        entityId: operation.entity_id,
        local: { title: localTitle, content: localContent },
        server,
      });
    }).catch(() => {
      setNoteError("离线同步发生冲突，服务器版本暂时无法加载。本地草稿仍保留，可稍后重试。");
    });
  }, [notesClient, workspaceId]);

  const workspaceSync = useWorkspaceSync({
    apiClient,
    store: localStore,
    workspaceId,
    enabled: !logoutPending,
    applyChange: applyWorkspaceSyncChange,
    onConflict: handleWorkspaceSyncConflict,
  });

  useEffect(() => {
    if (!workspaceId) {
      setFolders([]);
      setFolderLoading(false);
      setNoteFolderFilter(null);
      return undefined;
    }
    const controller = new AbortController();
    setFolderLoading(true);
    void knowledgeClient.listFolders(controller.signal).then((items) => {
      if (!controller.signal.aborted) setFolders(items);
    }).catch(() => {
      if (!controller.signal.aborted) setFolders([]);
    }).finally(() => {
      if (!controller.signal.aborted) setFolderLoading(false);
    });
    return () => controller.abort();
  }, [knowledgeClient, workspaceId]);

  useEffect(() => {
    if (!workspaceId || !selectedNoteId || creatingNote) {
      setLinkedNoteIds([]);
      setBacklinks([]);
      setNoteLinksLoading(false);
      setNoteLinksError(null);
      return undefined;
    }
    const controller = new AbortController();
    setNoteLinksLoading(true);
    setNoteLinksError(null);
    void Promise.all([knowledgeClient.listNoteLinks(selectedNoteId, controller.signal), knowledgeClient.listBacklinks(selectedNoteId, controller.signal)]).then(([links, incoming]) => {
      if (controller.signal.aborted) return;
      setLinkedNoteIds(links.map((link) => link.target_note_id));
      setBacklinks(incoming);
    }).catch(() => {
      if (!controller.signal.aborted) setNoteLinksError("笔记链接暂时无法加载，当前内容不受影响。请重试。");
    }).finally(() => {
      if (!controller.signal.aborted) setNoteLinksLoading(false);
    });
    return () => controller.abort();
  }, [creatingNote, knowledgeClient, selectedNoteId, workspaceId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedNoteSearchQuery(noteSearchQuery.trim().slice(0, 500));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [noteSearchQuery]);

  useEffect(() => {
    // A query belongs to one workspace; never carry it into another tenant.
    setNoteSearchQuery("");
    setDebouncedNoteSearchQuery("");
  }, [workspaceId]);

  useEffect(() => {
    if (!workspaceId) {
      setTags([]);
      setNoteTagIds({});
      setNoteTagsError(null);
      return undefined;
    }
    const controller = new AbortController();
    void knowledgeClient.listTags(controller.signal).then((items) => {
      if (!controller.signal.aborted) setTags(items);
    }).catch(() => {
      if (!controller.signal.aborted) setTags([]);
    });
    return () => controller.abort();
  }, [knowledgeClient, workspaceId]);

  const closePermanentDeleteDialog = (focusTarget: "origin" | "fallback" = "origin") => {
    permanentDeleteFocusTargetRef.current = focusTarget;
    setPermanentDeleteOpen(false);
  };

  useEffect(() => {
    draftControllerRef.current = draftController;
    return () => {
      if (draftControllerRef.current === draftController) draftControllerRef.current = null;
    };
  }, [draftController, draftControllerRef]);

  useLayoutEffect(() => {
    if (!inspectorOpen && inspectorOpenerRef.current) {
      const opener = inspectorOpenerRef.current.isConnected
        ? inspectorOpenerRef.current
        : document.querySelector<HTMLElement>('button[aria-label="打开检查器"]');
      if (opener && !opener.closest("[inert]")) opener.focus();
      inspectorOpenerRef.current = null;
    }
  }, [inspectorOpen]);

  useLayoutEffect(() => {
    if (!permanentDeleteOpen) {
      if (permanentDeleteWasOpenRef.current) {
        (permanentDeleteFocusTargetRef.current === "fallback"
          ? permanentDeleteFallbackRef.current
          : permanentDeleteOpenerRef.current)?.focus();
        permanentDeleteWasOpenRef.current = false;
        permanentDeleteFocusTargetRef.current = "origin";
      }
      return undefined;
    }
    permanentDeleteWasOpenRef.current = true;
    if (permanentDeletePending) permanentDeleteDialogRef.current?.focus();
    else permanentDeleteCancelRef.current?.focus();
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (!permanentDeletePendingRef.current) closePermanentDeleteDialog();
        return;
      }
      if (event.key !== "Tab") return;
      const dialog = permanentDeleteDialogRef.current;
      if (!dialog) return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>("button:not([disabled])")];
      if (!focusable.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const activeIndex = focusable.indexOf(document.activeElement as HTMLElement);
      const nextIndex = event.shiftKey
        ? activeIndex <= 0 ? focusable.length - 1 : activeIndex - 1
        : activeIndex < 0 || activeIndex === focusable.length - 1 ? 0 : activeIndex + 1;
      event.preventDefault();
      focusable[nextIndex]!.focus();
    };
    document.addEventListener("keydown", trapFocus);
    return () => document.removeEventListener("keydown", trapFocus);
  }, [permanentDeleteOpen, permanentDeletePending]);

  const openInspector = (opener?: HTMLElement) => {
    inspectorOpenerRef.current = opener ?? null;
    setInspectorOpen(true);
  };

  const closeInspector = () => setInspectorOpen(false);
  const toggleNotifications = (opener: HTMLElement) => {
    if (!collaborationEnabled) return;
    notificationOpenerRef.current = opener;
    setNotificationOpen((open) => !open);
  };

  const startNewNote = async (): Promise<CreateActionResult> => {
    if (logoutPending) return { status: "rejected", message: "正在退出登录，请稍候。" };
    if (!workspaceId) return { status: "rejected", message: "当前没有可用工作区，暂时无法新建笔记。" };
    if (activationInFlight.current || activeDraftIdRef.current) {
      return { status: "rejected", message: "未能开始新建笔记。当前已有未完成的新建操作，请完成后再试。" };
    }
    activationInFlight.current = true;
    userSelectedNote.current = true;
    setFeatureMapOpen(false);
    setHistoryOpen(false);
    setEditorMode("edit");
    setNoteConflict(null);
    setResolvingConflict(false);
    setNoteError(null);
    try {
      const draft = await draftController.create(workspaceId);
      activeDraftIdRef.current = draft.entity_id;
      draftTitleRef.current = draft.title;
      draftContentRef.current = draft.content;
      setActiveDraftId(draft.entity_id);
      setSelectedNoteId(null);
      setCreatingNote(true);
      setDraftTitle(draft.title);
      setDraftContent(draft.content);
      setDraftFolderId(null);
      setDraftDatabaseId(null);
      setNoteMessage(null);
      setNoteError(null);
      transitionToDomain("notes");
      return { status: "completed" };
    } catch {
      const message = "本地草稿保存失败，未创建临时笔记。请重试。";
      setNotesError(message);
      setNoteError(message);
      transitionToDomain("notes");
      return { status: "rejected", message };
    } finally {
      activationInFlight.current = false;
    }
  };

  const selectNote = (note: Note) => {
    setFeatureMapOpen(false);
    setHistoryOpen(false);
    setEditorMode("edit");
    setNoteRevisions([]);
    setHistoryError(null);
    setNoteConflict(null);
    setResolvingConflict(false);
    activeDraftIdRef.current = null;
    setActiveDraftId(null);
    userSelectedNote.current = true;
    setNoteSaving(false);
    setSelectedNoteId(note.id);
    setCreatingNote(false);
    setDraftTitle(note.title);
    setDraftContent(note.content);
    setDraftFolderId(note.folder_id);
    setDraftDatabaseId(note.database_id);
    draftTitleRef.current = note.title;
    draftContentRef.current = note.content;
    setNoteMessage(null);
    setNoteError(null);
    setSelectedDatabaseRecordId(null);
    setSelectedCommentId(null);
    setResolvedNotificationRecord(null);
    setActivePane("canvas");
  };

  const restoreSelectedRevision = (revision: NoteRevision) => {
    if (logoutPending || role === "viewer" || !workspaceId || !selectedNote || restoringRevision !== null) return;
    setRestoringRevision(revision.revision);
    setHistoryError(null);
    void notesClient.restore(selectedNote.id, revision.revision, {
      base_revision: selectedNote.revision,
    }).then((saved) => {
      installedNotesRef.current.set(saved.id, saved);
      setNotes((current) => [saved, ...current.filter((note) => note.id !== saved.id)]);
      setSelectedNoteId(saved.id);
      setCreatingNote(false);
      setDraftTitle(saved.title);
      setDraftContent(saved.content);
      setDraftFolderId(saved.folder_id);
      setDraftDatabaseId(saved.database_id);
      draftTitleRef.current = saved.title;
      draftContentRef.current = saved.content;
      setNoteMessage(`已恢复版本 ${revision.revision}`);
      setHistoryOpen(false);
      setEditorMode("edit");
    }).catch((error: unknown) => {
      const code = error instanceof ApiClientError ? error.code : "";
      setHistoryError(code === "NOTE_CONFLICT"
        ? "笔记已发生变化，历史版本没有覆盖当前内容。请重新加载历史后再试。"
        : "版本恢复失败，当前内容仍保留。请重试。");
    }).finally(() => setRestoringRevision(null));
  };

  const selectFolderFilter = (folderId: string | null) => {
    setFeatureMapOpen(false);
    noteListViewRef.current = "all";
    setNoteListView("all");
    setNoteFolderFilter(folderId);
    setActivePane("context");
    if (!activeDraftIdRef.current) {
      userSelectedNote.current = false;
      setSelectedNoteId(null);
      setCreatingNote(false);
      setDraftTitle("");
      setDraftContent("");
      setDraftFolderId(null);
      setDraftDatabaseId(null);
    }
  };

  const createFolder = async (name: string) => {
    if (!workspaceId) throw new Error("Workspace is required");
    const folder = await knowledgeClient.createFolder({ name });
    setFolders((current) => [...current, folder].sort((left, right) => left.position - right.position || left.name.localeCompare(right.name)));
    selectFolderFilter(folder.id);
  };

  const openTodayNote = async (): Promise<CreateActionResult> => {
    if (logoutPending) return { status: "rejected", message: "正在退出登录，请稍候。" };
    if (!workspaceId) return { status: "rejected", message: "当前没有可用工作区，暂时无法打开今日笔记。" };
    if (dailyNoteOpeningRef.current) return { status: "rejected", message: "今日笔记正在打开，请稍候。" };
    const dailyDate = localDateKey();
    const existing = notes.find((note) => note.status === "active" && note.daily_date === dailyDate);
    if (existing) {
      focusInstalledNoteRef.current = true;
      selectNote(existing);
      queueMicrotask(() => titleInputRef.current?.focus());
      return { status: "completed" };
    }

    dailyNoteOpeningRef.current = true;
    setDailyNoteOpening(true);
    setNoteError(null);
    try {
      const note = await notesClient.openOrCreateDaily(dailyDate);
      installedNotesRef.current.set(note.id, note);
      focusInstalledNoteRef.current = true;
      setNotes((current) => [note, ...current.filter((item) => item.id !== note.id)]);
      selectNote(note);
      return { status: "completed" };
    } catch {
      const message = "今日笔记暂时无法打开，可重试。当前选择和草稿内容已保留。";
      setNoteError(message);
      return { status: "rejected", message };
    } finally {
      dailyNoteOpeningRef.current = false;
      setDailyNoteOpening(false);
    }
  };

  const handleQuickCapture = (note: Note) => {
    setNotes((current) => [note, ...current.filter((item) => item.id !== note.id)]);
    setQuickCaptureOpen(false);
    selectNote(note);
  };

  const handleWebClipperCapture = (note: Note) => {
    setNotes((current) => [note, ...current.filter((item) => item.id !== note.id)]);
    setWorkspaceModal(null);
    selectNote(note);
  };

  const changeNoteListView = (view: NoteListView) => {
    if (view === noteListView) return;
    setFeatureMapOpen(false);
    noteListViewRef.current = view;
    setNoteListView(view);
    if (view !== "all") setNoteFolderFilter(null);
    setActivePane("context");
    if (!activeDraftIdRef.current) {
      userSelectedNote.current = false;
      setSelectedNoteId(null);
      setCreatingNote(false);
      setDraftTitle("");
      setDraftContent("");
      setDraftFolderId(null);
      setDraftDatabaseId(null);
    }
  };

  const createNoteTag = async (name: string) => {
    if (!workspaceId || role === "viewer") throw new Error("当前工作区没有标签编辑权限。");
    setNoteTagsError(null);
    try {
      const created = await knowledgeClient.createTag({ name, color: "" });
      setTags((current) => current.some((tag) => tag.id === created.id) ? current : [...current, created].sort((left, right) => left.name.localeCompare(right.name)));
      return created;
    } catch (error) {
      setNoteTagsError("创建标签失败，请重试。标签名称仍保留在输入框中。");
      throw error;
    }
  };

  const updateSelectedNoteTags = (nextTagIds: string[]) => {
    if (logoutPending || !workspaceId || !selectedNoteId || creatingNote || role === "viewer" || selectedNote?.status === "trashed" || noteTagsSaving) return;
    const noteId = selectedNoteId;
    const previousTagIds = noteTagIds[noteId] ?? [];
    setNoteTagIds((current) => ({ ...current, [noteId]: nextTagIds }));
    setNoteTagsSaving(true);
    setNoteTagsError(null);
    void knowledgeClient.setNoteTags(noteId, { tag_ids: nextTagIds }).then(() => {
      if (mountedRef.current && selectedNoteId === noteId) setNoteMessage("标签已保存");
    }).catch(() => {
      if (!mountedRef.current) return;
      setNoteTagIds((current) => ({ ...current, [noteId]: previousTagIds }));
      setNoteTagsError("标签保存失败，请重试。当前选择已恢复。");
    }).finally(() => {
      if (mountedRef.current) setNoteTagsSaving(false);
    });
  };

  const applyAiContent = (content: string, action: "summary" | "tasks") => {
    if (logoutPending || !workspaceId || creatingNote || role === "viewer" || !selectedNote || selectedNote.status === "trashed") return;
    const heading = action === "summary" ? "AI 摘要" : "AI 提取的任务";
    const separator = draftContentRef.current.trim() ? "\n\n" : "";
    updateActiveDraftInput(
      draftTitleRef.current,
      `${draftContentRef.current}${separator}## ${heading}\n\n${content.trim()}`,
    );
    setNoteMessage("AI 结果已加入草稿，请确认后保存笔记");
    setNoteError(null);
  };

  const applyAiTags = async (suggestedNames: string[]) => {
    if (logoutPending || !workspaceId || creatingNote || role === "viewer" || !selectedNote || selectedNote.status === "trashed") return;
    const noteId = selectedNote.id;
    const existingIds = noteTagIds[noteId] ?? [];
    const nextIds = [...existingIds];
    for (const name of suggestedNames) {
      const normalizedName = name.trim().toLocaleLowerCase();
      if (!normalizedName) continue;
      const existing = tags.find((tag) => tag.name.trim().toLocaleLowerCase() === normalizedName);
      const tag = existing ?? await createNoteTag(name.trim());
      if (!nextIds.includes(tag.id)) nextIds.push(tag.id);
    }
    await knowledgeClient.setNoteTags(noteId, { tag_ids: nextIds });
    setNoteTagIds((current) => ({ ...current, [noteId]: nextIds }));
    setNoteMessage("AI 标签建议已应用");
    setNoteTagsError(null);
  };

  const saveSelectedNoteLinks = async (targetNoteIds: string[]) => {
    if (logoutPending || !workspaceId || !selectedNoteId || creatingNote || role === "viewer" || noteLinksSaving) return;
    setNoteLinksSaving(true);
    setNoteLinksError(null);
    try {
      await knowledgeClient.setNoteLinks(selectedNoteId, { target_note_ids: targetNoteIds });
      setLinkedNoteIds([...targetNoteIds]);
      setNoteMessage("笔记链接已保存");
    } catch {
      setNoteLinksError("笔记链接保存失败，请重试。当前选择已保留。");
    } finally {
      setNoteLinksSaving(false);
    }
  };

  const saveNote = () => {
    if (logoutPending || !workspaceId || noteSaving) return;
    if (creatingNote && activeDraftId) {
      setServerRetryVersion((version) => version + 1);
      return;
    }
    if (!selectedNote) return;
    setNoteSaving(true);
    setNoteMessage(null);
    setNoteError(null);
    const request = notesClient.update(selectedNote.id, {
        base_revision: selectedNote.revision,
        title: draftTitle,
        content: draftContent,
        folder_id: draftFolderId,
        database_id: draftDatabaseId,
        source: "manual",
      });
    void request.then((saved) => {
      setNotes((current) => [saved, ...current.filter((note) => note.id !== saved.id)]);
      setSelectedNoteId(saved.id);
      setCreatingNote(false);
      setDraftTitle(saved.title);
      setDraftContent(saved.content);
      setDraftFolderId(saved.folder_id);
      setDraftDatabaseId(saved.database_id);
      draftTitleRef.current = saved.title;
      draftContentRef.current = saved.content;
      setNoteMessage("已保存");
      setEditorMode("edit");
    }).catch(() => {
      setNoteError("笔记保存失败，请稍后重试。未保存的内容仍保留在当前编辑器中。");
    }).finally(() => setNoteSaving(false));
  };

  const changeSelectedNoteStatus = (status: "active" | "archived" | "trashed") => {
    if (logoutPending || !workspaceId || noteSaving || !selectedNote) return;
    setNoteSaving(true);
    setNoteMessage(null);
    setNoteError(null);
    const contentChanged = draftTitle !== selectedNote.title || draftContent !== selectedNote.content;
    const folderChanged = draftFolderId !== selectedNote.folder_id;
    const databaseChanged = draftDatabaseId !== selectedNote.database_id;
    void notesClient.update(selectedNote.id, {
      base_revision: selectedNote.revision,
      status,
      source: "manual",
      ...(contentChanged ? { title: draftTitle, content: draftContent } : {}),
      ...(folderChanged ? { folder_id: draftFolderId } : {}),
      ...(databaseChanged ? { database_id: draftDatabaseId } : {}),
    }).then((saved) => {
      const nextView: NoteListView = status === "trashed" ? "trash" : status === "archived" ? "archived" : "all";
      noteListViewRef.current = nextView;
      installedNotesRef.current.set(saved.id, saved);
      setNoteListView(nextView);
      setNotes((current) => [saved, ...current.filter((note) => note.id !== saved.id)]);
      setSelectedNoteId(saved.id);
      setCreatingNote(false);
      setDraftTitle(saved.title);
      setDraftContent(saved.content);
      setDraftFolderId(saved.folder_id);
      setDraftDatabaseId(saved.database_id);
      draftTitleRef.current = saved.title;
      draftContentRef.current = saved.content;
      setNoteMessage(status === "trashed" ? "已移入回收站" : "已恢复");
      setEditorMode("edit");
      setActivePane("canvas");
    }).catch(() => {
      setNoteError(status === "trashed" ? "移入回收站失败，请稍后重试。" : "恢复笔记失败，请稍后重试。");
    }).finally(() => setNoteSaving(false));
  };

  const toggleSelectedNoteFlag = (field: "is_favorite" | "is_pinned") => {
    if (logoutPending || role === "viewer" || noteSaving || !workspaceId || !selectedNote || selectedNote.status === "trashed") return;
    const nextValue = !selectedNote[field];
    setNoteSaving(true);
    setNoteMessage(null);
    setNoteError(null);
    void notesClient.update(selectedNote.id, {
      base_revision: selectedNote.revision,
      [field]: nextValue,
      source: "manual",
    }).then((saved) => {
      setNotes((current) => [saved, ...current.filter((note) => note.id !== saved.id)]);
      installedNotesRef.current.set(saved.id, saved);
      setSelectedNoteId(saved.id);
      setDraftTitle(saved.title);
      setDraftContent(saved.content);
      setDraftFolderId(saved.folder_id);
      setDraftDatabaseId(saved.database_id);
      draftTitleRef.current = saved.title;
      draftContentRef.current = saved.content;
      setNoteMessage(field === "is_favorite"
        ? nextValue ? "已加入收藏" : "已取消收藏"
        : nextValue ? "已置顶" : "已取消置顶");
      setEditorMode("edit");
    }).catch(() => {
      setNoteError(field === "is_favorite" ? "收藏状态保存失败，请重试。" : "置顶状态保存失败，请重试。");
    }).finally(() => setNoteSaving(false));
  };

  const openPermanentDelete = (opener: HTMLButtonElement) => {
    if (logoutPending || !selectedNote || selectedNote.status !== "trashed") return;
    permanentDeleteOpenerRef.current = opener;
    permanentDeleteFocusTargetRef.current = "origin";
    setPermanentDeleteError(null);
    setPermanentDeleteOpen(true);
  };

  const deleteSelectedNotePermanently = () => {
    if (logoutPending || permanentDeletePending || !workspaceId || !selectedNote || selectedNote.status !== "trashed") return;
    setPermanentDeletePending(true);
    setPermanentDeleteError(null);
    void notesClient.deletePermanently(selectedNote.id, {
      base_revision: selectedNote.revision,
    }).then(() => {
      setNotes((current) => current.filter((note) => note.id !== selectedNote.id));
      setSelectedNoteId(null);
      setDraftTitle("");
      setDraftContent("");
      setDraftFolderId(null);
      setDraftDatabaseId(null);
      setEditorMode("edit");
      draftTitleRef.current = "";
      draftContentRef.current = "";
      setNoteMessage("笔记已永久删除");
      closePermanentDeleteDialog("fallback");
    }).catch((error: unknown) => {
      setPermanentDeleteError(permanentDeleteErrorMessage(error));
    }).finally(() => setPermanentDeletePending(false));
  };

  const updateActiveDraftInput = (title: string, content: string) => {
    if (logoutPending) return;
    draftTitleRef.current = title;
    draftContentRef.current = content;
    setDraftTitle(title);
    setDraftContent(content);
    setNoteMessage(null);
    if (workspaceId && activeDraftIdRef.current) {
      void draftController.save(workspaceId, activeDraftIdRef.current, title, content).catch(() => {
        if (mountedRef.current && activeDraftIdRef.current) {
          setNoteError("本地草稿保存失败，当前内容仍保留在编辑器中。请重试。");
        }
      });
    }
  };

  const installSyncedDraft = (syncedWorkspaceId: string, draftId: string, result: DraftSyncResult) => {
    if (!mountedRef.current) return;
    const wasActiveDraft = activeDraftIdRef.current === draftId;
    if (wasActiveDraft) {
      activeDraftIdRef.current = null;
      setActiveDraftId(null);
      focusInstalledNoteRef.current = true;
    }
    installedNotesRef.current.set(result.note.id, result.note);
    setNotes((current) => noteMatchesListView(result.note, noteListViewRef.current)
      ? [result.note, ...current.filter((note) => note.id !== result.note.id)]
      : current.filter((note) => note.id !== result.note.id));
    setPendingReconcile({ workspaceId: syncedWorkspaceId, entityId: draftId, result });
    if (!wasActiveDraft) return;
    setSelectedNoteId(result.note.id);
    setCreatingNote(false);
    setDraftTitle(result.note.title);
    setDraftContent(result.note.content);
    setDraftFolderId(result.note.folder_id);
    setDraftDatabaseId(result.note.database_id);
    draftTitleRef.current = result.note.title;
    draftContentRef.current = result.note.content;
    setNoteMessage("已保存");
  };

  const resolveNoteConflict = async (resolution: "local" | "server") => {
    const conflict = noteConflict;
    if (
      resolvingConflict
      || !conflict
      || !workspaceId
      || conflict.workspaceId !== workspaceId
      || activeDraftIdRef.current !== conflict.entityId
    ) return;

    setResolvingConflict(true);
    setNoteError(null);
    try {
      const resolved = await draftController.resolveConflict(
        workspaceId,
        conflict.entityId,
        resolution,
        conflict.server,
      );
      if (!resolved) throw new Error("Conflict draft is no longer available");

      setNoteConflict(null);
      if (resolution === "local") {
        setNoteMessage("已保留本地版本，正在基于最新服务器版本重试同步。");
        setServerRetryVersion((version) => version + 1);
      } else {
        setDraftTitle(conflict.server.title);
        setDraftContent(conflict.server.content);
        setDraftFolderId(conflict.server.folder_id);
        setDraftDatabaseId(conflict.server.database_id);
        draftTitleRef.current = conflict.server.title;
        draftContentRef.current = conflict.server.content;
        setNoteMessage("已采用服务器版本，本地草稿已更新，可继续编辑。");
      }
    } catch {
      setNoteError("冲突恢复失败，本地和服务器版本均已保留。请重试。");
    } finally {
      setResolvingConflict(false);
    }
  };

  useEffect(() => () => {
    mountedRef.current = false;
    void draftController.flush().catch(() => undefined);
  }, [draftController]);

  useEffect(() => {
    if (!creatingNote && !focusInstalledNoteRef.current) return;
    titleInputRef.current?.focus();
    focusInstalledNoteRef.current = false;
  }, [activeDraftId, creatingNote, selectedNoteId]);

  useLayoutEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((!event.ctrlKey && !event.metaKey) || event.repeat || permanentDeleteOpen) return;
      const key = event.key.toLowerCase();
      if (key === "k") {
        event.preventDefault();
        openCommandPalette();
        return;
      }
      if (key !== "n" || isEditableTarget(event.target)) return;
      event.preventDefault();
      void startNewNote();
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [logoutPending, permanentDeleteOpen, workspaceId]);

  useEffect(() => {
    if (logoutPending || !workspaceId || !activeDraftId) return undefined;
    const draftId = activeDraftId;
    let active = true;
    setNoteSaving(true);
    setNoteError(null);
    void draftController.sync(workspaceId, draftId, notesClient).then((result) => {
      installSyncedDraft(workspaceId, draftId, result);
    }).catch((error: unknown) => {
      if (active && mountedRef.current && activeDraftIdRef.current === draftId) {
        const serverCandidate = error instanceof ApiClientError && error.code === "NOTE_CONFLICT"
          ? NoteSchema.safeParse(error.details?.server_note)
          : null;
        if (serverCandidate?.success && serverCandidate.data.workspace_id === workspaceId) {
          setNoteConflict({
            workspaceId,
            entityId: draftId,
            local: { title: draftTitleRef.current, content: draftContentRef.current },
            server: serverCandidate.data,
          });
          setNoteError("检测到服务器已有新版本，请选择要保留的内容。");
        } else {
          setNoteError("笔记同步失败，草稿仍保留在本地。请重试。");
        }
      }
    }).finally(() => {
      if (active && mountedRef.current) setNoteSaving(false);
    });
    return () => {
      active = false;
      void draftController.flush(workspaceId, draftId).catch(() => undefined);
    };
  }, [activeDraftId, apiClient, draftController, logoutPending, serverRetryVersion, workspaceId]);

  useEffect(() => {
    if (logoutPending || !pendingReconcile || !workspaceId || pendingReconcile.workspaceId !== workspaceId) return undefined;
    if (!installedNotesRef.current.has(pendingReconcile.result.note.id)) return undefined;
    const { entityId, result } = pendingReconcile;
    let cancelled = false;
    void draftController.reconcile(workspaceId, entityId, result).then((removed) => {
      if (cancelled) return;
      if (removed) {
        setPendingReconcile(null);
        return;
      }
      setPendingReconcile(null);
      void draftController.sync(workspaceId, entityId, notesClient).then((next) => {
        installSyncedDraft(workspaceId, entityId, next);
      }).catch(() => {
        if (mountedRef.current && activeDraftIdRef.current === entityId) {
          setNoteError("笔记同步失败，草稿仍保留在本地。请重试。");
        }
      });
    }).catch(() => {
      if (!cancelled) setNoteError("服务器已创建笔记，但本地草稿清理失败；内容仍已打开。请稍后重试。");
    });
    return () => { cancelled = true; };
  }, [apiClient, draftController, logoutPending, pendingReconcile, workspaceId]);

  const abortRecoveryRequests = () => {
    requestControllers.current.forEach((controller) => controller.abort());
    requestControllers.current.clear();
  };

  const createRecoveryRequest = () => {
    const controller = new AbortController();
    requestControllers.current.add(controller);
    return controller;
  };

  const abortRetryRequests = () => {
    retryControllers.current.forEach((controller) => controller.abort());
    retryControllers.current.clear();
  };

  const abortDatabaseRequests = () => {
    databaseControllers.current.forEach((controller) => controller.abort());
    databaseControllers.current.clear();
  };

  const createDatabaseRequest = () => {
    const controller = new AbortController();
    databaseControllers.current.add(controller);
    return controller;
  };

  const createRetryRequest = () => {
    const controller = new AbortController();
    retryControllers.current.add(controller);
    return controller;
  };

  useLayoutEffect(() => {
    const handleUpdate = (event: Event) => {
      setServiceWorkerUpdate((event as CustomEvent<ServiceWorkerUpdate>).detail);
    };
    window.addEventListener("nexus:service-worker-update", handleUpdate);
    return () => window.removeEventListener("nexus:service-worker-update", handleUpdate);
  }, []);

  useEffect(() => {
    if (!workspaceId) {
      setNotes([]);
      setSelectedNoteId(null);
      setCreatingNote(false);
      setNotesLoading(false);
      setNotesError(null);
      setNoteSearchQuery("");
      setDebouncedNoteSearchQuery("");
      return undefined;
    }
    const controller = new AbortController();
    setNotesLoading(true);
    setNotesError(null);
    const todayDate = localDateKey();
    const selectedFolderId = noteListView === "all" ? noteFolderFilter ?? undefined : undefined;
    const listOptions = noteListView === "inbox"
      ? { status: "active" as const, folderId: null, limit: 50, signal: controller.signal }
      : noteListView === "today"
        ? { status: "active" as const, dailyDate: todayDate, limit: 50, signal: controller.signal }
        : noteListView === "favorites"
          ? { status: "active" as const, favorite: true, limit: 50, signal: controller.signal }
          : noteListView === "pinned"
            ? { status: "active" as const, pinned: true, limit: 50, signal: controller.signal }
            : noteListView === "archived"
              ? { status: "archived" as const, limit: 50, signal: controller.signal }
              : noteListView === "trash"
                ? { status: "trashed" as const, limit: 50, signal: controller.signal }
                : { status: "active" as const, folderId: selectedFolderId, limit: 50, signal: controller.signal };
    const listOptionsWithSearch = debouncedNoteSearchQuery
      ? { ...listOptions, query: debouncedNoteSearchQuery }
      : listOptions;
    void notesClient.list(listOptionsWithSearch).then((page) => {
      if (controller.signal.aborted) return;
      const activeNotes = page.items.filter((note) => noteMatchesListView(note, noteListView, todayDate));
      const installedNotes = [...installedNotesRef.current.values()]
        .filter((note) => note.workspace_id === workspaceId
          && noteMatchesListView(note, noteListView, todayDate)
          && (!debouncedNoteSearchQuery || [note.title, note.content].join("\n").toLocaleLowerCase().includes(debouncedNoteSearchQuery.toLocaleLowerCase()))
          && (noteFolderFilter === null || note.folder_id === noteFolderFilter));
      const byId = new Map([...activeNotes, ...installedNotes].map((note) => [note.id, note]));
      setNotes([...byId.values()]);
      if (!activeDraftIdRef.current && !activationInFlight.current && !userSelectedNote.current) {
        setSelectedNoteId((current) => userSelectedNote.current && current && byId.has(current)
          ? current
          : [...byId.values()][0]?.id ?? null);
        setCreatingNote(false);
      }
    }).catch((error: unknown) => {
      if (!isAborted(error, controller.signal)) setNotesError("笔记列表暂时无法加载。你仍可以尝试新建笔记。");
    }).finally(() => {
      if (!controller.signal.aborted) setNotesLoading(false);
    });
    return () => controller.abort();
  }, [apiClient, debouncedNoteSearchQuery, noteFolderFilter, noteListView, notesRefreshVersion, workspaceId]);

  useEffect(() => {
    if (logoutPending || !workspaceId || notesLoading || activeDraftIdRef.current || userSelectedNote.current) return undefined;
    let cancelled = false;
    void draftController.recover(workspaceId).then((draft) => {
      if (!draft || cancelled || activeDraftIdRef.current || userSelectedNote.current) return;
      activeDraftIdRef.current = draft.entity_id;
      draftTitleRef.current = draft.title;
      draftContentRef.current = draft.content;
      setActiveDraftId(draft.entity_id);
      setSelectedNoteId(null);
      setCreatingNote(true);
      setDraftTitle(draft.title);
      setDraftContent(draft.content);
      setNoteMessage(null);
      setNoteError("已恢复本地草稿，服务器同步失败时可重试。");
      transitionToDomain("notes");
    }).catch(() => {
      if (!cancelled) setNotesError("本地草稿恢复失败。你仍可以尝试新建笔记。");
    });
    return () => { cancelled = true; };
  }, [draftController, logoutPending, notesLoading, workspaceId]);

  useEffect(() => {
    if (creatingNote) return;
    if (selectedNote) {
      setDraftTitle(selectedNote.title);
      setDraftContent(selectedNote.content);
      setDraftFolderId(selectedNote.folder_id);
      setDraftDatabaseId(selectedNote.database_id);
      draftTitleRef.current = selectedNote.title;
      draftContentRef.current = selectedNote.content;
    } else {
      setDraftTitle("");
      setDraftContent("");
      setDraftFolderId(null);
      setDraftDatabaseId(null);
      draftTitleRef.current = "";
      draftContentRef.current = "";
    }
  }, [creatingNote, selectedNote]);

  useEffect(() => {
    if (!workspaceId || !selectedNoteId || creatingNote) {
      setNoteDatabasesLoading(false);
      setNoteDatabasesError(null);
      return undefined;
    }
    const controller = new AbortController();
    setNoteDatabasesLoading(true);
    setNoteDatabasesError(null);
    void databaseClient.listDatabases(controller.signal).then((items) => {
      if (!controller.signal.aborted) setNoteDatabases(items);
    }).catch((error: unknown) => {
      if (!isAborted(error, controller.signal)) {
        setNoteDatabases([]);
        setNoteDatabasesError("数据库列表暂时无法加载。保存笔记不受影响，可稍后重试。");
      }
    }).finally(() => {
      if (!controller.signal.aborted) setNoteDatabasesLoading(false);
    });
    return () => controller.abort();
  }, [creatingNote, databaseClient, selectedNoteId, workspaceId]);

  useEffect(() => {
    if (!workspaceId || !selectedNoteId || creatingNote) {
      setNoteTagsLoading(false);
      setNoteTagsError(null);
      return undefined;
    }
    const controller = new AbortController();
    setNoteTagsLoading(true);
    setNoteTagsError(null);
    void knowledgeClient.listNoteTags(selectedNoteId, controller.signal).then((items) => {
      if (controller.signal.aborted) return;
      setNoteTagIds((current) => ({ ...current, [selectedNoteId]: items.map((tag) => tag.id) }));
    }).catch(() => {
      if (!controller.signal.aborted) setNoteTagsError("标签暂时无法加载，保持当前选择后可重试。");
    }).finally(() => {
      if (!controller.signal.aborted) setNoteTagsLoading(false);
    });
    return () => controller.abort();
  }, [apiClient, creatingNote, selectedNoteId, workspaceId]);

  useEffect(() => {
    historyController.current?.abort();
    if (!historyOpen || !workspaceId || !selectedNoteId || creatingNote) {
      setHistoryLoading(false);
      return undefined;
    }
    const controller = new AbortController();
    historyController.current = controller;
    setHistoryLoading(true);
    setHistoryError(null);
    void notesClient.listRevisions(selectedNoteId, controller.signal).then((items) => {
      if (!controller.signal.aborted) setNoteRevisions(items);
    }).catch(() => {
      if (!controller.signal.aborted) setHistoryError("版本历史暂时无法加载，当前内容不受影响。请重试。");
    }).finally(() => {
      if (!controller.signal.aborted) setHistoryLoading(false);
    });
    return () => {
      controller.abort();
      if (historyController.current === controller) historyController.current = null;
    };
  }, [apiClient, creatingNote, historyOpen, historyRefreshVersion, selectedNoteId, workspaceId]);

  useEffect(() => {
    if (!workspaceId || !collaborationEnabled) {
      setUnreadCount(0);
      return undefined;
    }
    const controller = new AbortController();
    const loadUnreadCount = () => {
      void collaborationClient.getUnreadCount(controller.signal).then((count) => {
        if (!controller.signal.aborted) setUnreadCount(count);
      }).catch(() => {
        if (!controller.signal.aborted) setUnreadCount(0);
      });
    };
    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    const idleHandle = idleWindow.requestIdleCallback?.(loadUnreadCount, { timeout: 500 });
    const timer = idleHandle === undefined ? window.setTimeout(loadUnreadCount, 100) : undefined;
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
      if (idleHandle !== undefined) idleWindow.cancelIdleCallback?.(idleHandle);
      controller.abort();
    };
  }, [collaborationClient, collaborationEnabled, workspaceId]);

  useEffect(() => () => {
    abortRecoveryRequests();
    abortRetryRequests();
    abortDatabaseRequests();
    notificationTargetController.current?.abort();
    historyController.current?.abort();
  }, []);

  useEffect(() => {
    abortRecoveryRequests();
    const nextQueryIdentity = `${workspaceId ?? ""}\u0000${filters.mimeType}\u0000${filters.ocrStatus}`;
    if (attachmentQueryIdentity.current !== null && attachmentQueryIdentity.current !== nextQueryIdentity) {
      setAttachmentCursor(null);
    }
    attachmentQueryIdentity.current = nextQueryIdentity;
    if (!workspaceId) {
      setAttachments([]);
      setDiagnostics([]);
      setAttachmentCursor(null);
      setDiagnosticCursor(null);
      setLoading(false);
      setRefreshing(false);
      setAttachmentError("未选择工作区，无法加载恢复数据。");
      setDiagnosticError(null);
      return undefined;
    }

    const controller = createRecoveryRequest();
    const hasCachedData = attachments.length > 0 || diagnostics.length > 0;
    setLoading(!hasCachedData);
    setRefreshing(hasCachedData);
    setAttachmentError(null);
    setDiagnosticError(null);
    void Promise.allSettled([
      knowledgeClient.listAttachments({
        mime_type: (filters.mimeType as Attachment["mime_type"]) || undefined,
        ocr_status: (filters.ocrStatus as OcrStatus) || undefined,
        limit: 50,
      }, controller.signal),
      knowledgeClient.getKnowledgeDiagnostics({ limit: 50 }, controller.signal),
    ]).then(([attachmentResult, diagnosticResult]) => {
      if (controller.signal.aborted) return;
      if (attachmentResult.status === "fulfilled") {
        setAttachments(attachmentResult.value.items);
        setAttachmentCursor(attachmentResult.value.next_cursor);
        setAttachmentError(null);
      } else if (!isAborted(attachmentResult.reason, controller.signal)) {
        setAttachmentError("附件暂时无法加载，保留最近可用数据。");
      }
      if (diagnosticResult.status === "fulfilled") {
        setDiagnostics(diagnosticResult.value.items);
        setDiagnosticCursor(diagnosticResult.value.next_cursor);
        setDiagnosticError(null);
      } else if (!isAborted(diagnosticResult.reason, controller.signal)) {
        setDiagnosticError("诊断暂时无法加载，保留最近可用数据。");
      }
    }).finally(() => {
      requestControllers.current.delete(controller);
      if (!controller.signal.aborted) {
        setLoading(false);
        setRefreshing(false);
      }
    });

    return () => abortRecoveryRequests();
  }, [filters.mimeType, filters.ocrStatus, knowledgeClient, refreshVersion, workspaceId]);

  useEffect(() => {
    if (activeDomain !== "databases") return undefined;
    if (selectedDatabaseId && databaseSelectionSync.current === selectedDatabaseId && databaseBundle?.database.id === selectedDatabaseId) {
      databaseSelectionSync.current = null;
      return undefined;
    }
    abortDatabaseRequests();
    if (!workspaceId) {
      setDatabases([]);
      setSelectedDatabaseId(null);
      setDatabaseBundle(null);
      setDatabaseRecords([]);
      setDatabaseError("未选择工作区，无法加载数据库。");
      return undefined;
    }
    const controller = createDatabaseRequest();
    setDatabaseLoading(!databaseBundle && databases.length === 0);
    setDatabaseError(null);
    void databaseClient.bootstrap({
      databaseId: selectedDatabaseId ?? undefined,
      limit: databaseBundle?.views[0]?.config.page_size ?? 50,
      signal: controller.signal,
    }).then((bootstrap) => {
      if (controller.signal.aborted) return;
      setDatabases(bootstrap.items);
      databaseSelectionSync.current = bootstrap.selected_database_id;
      setSelectedDatabaseId(bootstrap.selected_database_id);
      setDatabaseBundle(bootstrap.bundle);
      const targetRecord = bootstrap.bundle && resolvedNotificationRecord?.database_id === bootstrap.bundle.database.id
        && !bootstrap.records.items.some((record) => record.id === resolvedNotificationRecord.id)
        ? resolvedNotificationRecord
        : null;
      const records = targetRecord ? [targetRecord, ...bootstrap.records.items] : bootstrap.records.items;
      setDatabaseRecords(records);
      setDatabaseRecordsNextCursor(bootstrap.records.next_cursor);
      setSelectedDatabaseRecordId((current) => current && records.some((record) => record.id === current) ? current : records[0]?.id ?? null);
      if (bootstrap.bundle) {
        databaseCache.current.writeEntity({ workspaceId, type: "database", id: bootstrap.bundle.database.id, revision: bootstrap.bundle.database.revision, data: bootstrap.bundle.database });
        for (const property of bootstrap.bundle.properties) {
          databaseCache.current.writeEntity({ workspaceId, type: "database-property", id: property.id, revision: property.revision, data: property });
        }
        for (const record of records) {
          databaseCache.current.writeEntity({ workspaceId, type: "database-record", id: record.id, revision: record.revision, data: record });
        }
      }
    }).catch((error: unknown) => {
      if (!isAborted(error, controller.signal)) setDatabaseError("数据库内容暂时无法加载，保留最近可用数据。");
    }).finally(() => {
      databaseControllers.current.delete(controller);
      if (!controller.signal.aborted) setDatabaseLoading(false);
    });
    return () => controller.abort();
  }, [activeDomain, databaseBundle, databaseClient, databaseRefreshVersion, databases.length, resolvedNotificationRecord, selectedDatabaseId, workspaceId]);

  useEffect(() => {
    if (!webClipperOpen || !workspaceId) return undefined;
    const controller = new AbortController();
    void databaseClient.listDatabases(controller.signal).then((items) => {
      if (!controller.signal.aborted) setDatabases(items);
    }).catch(() => {
      // The clipper remains usable for Inbox and Daily when database discovery is unavailable.
    });
    return () => controller.abort();
  }, [databaseClient, webClipperOpen, workspaceId]);

  const requestDatabasePage = useCallback(({ cursor, limit, viewId, signal }: { cursor: string | null; limit: number; viewId?: string; signal?: AbortSignal }) => {
    if (!workspaceId || !selectedDatabaseId) return Promise.resolve({ items: [], next_cursor: null });
    return databaseClient.listRecords(selectedDatabaseId, { cursor: cursor ?? undefined, viewId, limit, signal });
  }, [databaseClient, selectedDatabaseId, workspaceId]);

  const createDatabaseFromName = (name: string) => {
    if (!workspaceId || !name.trim() || creatingFirstDatabase) return;
    setCreatingFirstDatabase(true);
    setDatabaseError(null);
    void databaseClient.createDatabase({ name: name.trim(), description: "" }).then((created) => {
      setDatabases((current) => [...current, created]);
      setSelectedDatabaseId(created.id);
      setFirstDatabaseName("");
      setDatabaseCreateOpen(false);
      setActivePane("canvas");
    }).catch(() => setDatabaseError("数据库暂时无法创建，请稍后重试。"))
      .finally(() => setCreatingFirstDatabase(false));
  };

  const createFirstDatabase = () => createDatabaseFromName(firstDatabaseName);

  const openDatabaseCreation = () => {
    setFeatureMapOpen(false);
    setFirstDatabaseName("");
    transitionToDomain("databases");
    setActivePane(databases.length > 0 ? "context" : "canvas");
    setDatabaseCreateOpen(databases.length > 0);
  };

  const loadMoreAttachments = () => {
    if (!workspaceId || !attachmentCursor || loading || refreshing) return;
    const controller = createRecoveryRequest();
    setRefreshing(true);
    void knowledgeClient.listAttachments({
      mime_type: (filters.mimeType as Attachment["mime_type"]) || undefined,
      ocr_status: (filters.ocrStatus as OcrStatus) || undefined,
      cursor: attachmentCursor,
      limit: 50,
    }, controller.signal).then((page) => {
      if (controller.signal.aborted) return;
      setAttachments((current) => [...current, ...page.items]);
      setAttachmentCursor(page.next_cursor);
      setAttachmentError(null);
    }).catch((requestError: unknown) => {
      if (!isAborted(requestError, controller.signal)) setAttachmentError("更多附件暂时无法加载，请稍后重试。");
    }).finally(() => {
      requestControllers.current.delete(controller);
      if (!controller.signal.aborted) setRefreshing(false);
    });
  };

  const loadMoreDiagnostics = () => {
    if (!workspaceId || !diagnosticCursor || loading || refreshing) return;
    const controller = createRecoveryRequest();
    setRefreshing(true);
    void knowledgeClient.getKnowledgeDiagnostics({ cursor: diagnosticCursor, limit: 50 }, controller.signal).then((page) => {
      if (controller.signal.aborted) return;
      setDiagnostics((current) => [...current, ...page.items]);
      setDiagnosticCursor(page.next_cursor);
      setDiagnosticError(null);
    }).catch((requestError: unknown) => {
      if (!isAborted(requestError, controller.signal)) setDiagnosticError("更多诊断暂时无法加载，请稍后重试。");
    }).finally(() => {
      requestControllers.current.delete(controller);
      if (!controller.signal.aborted) setRefreshing(false);
    });
  };

  const retryAttachments = (attachmentIds: string[]) => {
    if (!workspaceId || retryingIds.size > 0) return;
    const ids = [...new Set(attachmentIds)];
    if (ids.length === 0) return;
    setRetryingIds(new Set(ids));
    setRetryFeedback(null);
    const controller = createRetryRequest();
    const retry = ids.length === 1
      ? knowledgeClient.retryAttachmentOcr(ids[0], controller.signal)
      : knowledgeClient.retryAttachmentOcrBatch(ids, controller.signal);
    void retry.then((result) => {
      if (controller.signal.aborted) return;
      setRetryFeedback(recoveryFeedback(result));
    }).catch((retryError: unknown) => {
      if (!isAborted(retryError, controller.signal)) {
        setRetryFeedback("OCR 重试请求失败，请稍后重试。");
      }
    }).finally(() => {
      retryControllers.current.delete(controller);
      if (controller.signal.aborted) return;
      setRetryingIds(new Set());
      setRefreshVersion((version) => version + 1);
    });
  };

  const updateDiagnosticNotes = async (
    items: KnowledgeDiagnostic[],
    patchFor: (note: Note) => { folder_id?: string | null; database_id?: string | null },
  ) => {
    if (!workspaceId || role === "viewer" || items.length === 0) return;
    const updated: Note[] = [];
    let failed = 0;
    for (const item of items) {
      try {
        const current = await notesClient.get(item.entity_id);
        updated.push(await notesClient.update(current.id, {
          base_revision: current.revision,
          ...patchFor(current),
          source: "manual",
        }));
      } catch {
        failed += 1;
      }
    }
    if (updated.length > 0) {
      updated.forEach((note) => installedNotesRef.current.set(note.id, note));
      setNotes((current) => {
        const byId = new Map(current.map((note) => [note.id, note]));
        updated.forEach((note) => byId.set(note.id, note));
        return [...byId.values()];
      });
    }
    setRetryFeedback(failed > 0
      ? `已处理 ${updated.length} 篇，${failed} 篇失败；失败项仍保留，可重试。`
      : `已处理 ${updated.length} 篇笔记。`);
    setRefreshVersion((version) => version + 1);
  };

  const classifyUnfiledNotes = (folderId: string) => {
    if (!folderId) return;
    void updateDiagnosticNotes(
      diagnostics.filter((item) => item.kind === "unfiled_note"),
      () => ({ folder_id: folderId, database_id: null }),
    );
  };

  const moveOrphansToInbox = () => {
    void updateDiagnosticNotes(
      diagnostics.filter((item) => item.kind === "orphan_note"),
      () => ({ folder_id: null }),
    );
  };

  const ignoreOrphans = () => {
    setDiagnostics((current) => current.filter((item) => item.kind !== "orphan_note"));
    setRetryFeedback("已暂时隐藏当前页面的孤立笔记诊断；刷新后仍可恢复查看。");
  };

  const mergeDuplicateNotes = async (diagnostic: KnowledgeDiagnostic) => {
    if (!workspaceId || role === "viewer" || diagnostic.kind !== "duplicate_title") return;
    try {
      const page = await notesClient.list({ query: diagnostic.title, limit: 100 });
      const title = diagnostic.title.trim().toLocaleLowerCase();
      const matches = page.items
        .filter((note) => note.status === "active" && note.title.trim().toLocaleLowerCase() === title)
        .sort((left, right) => right.updated_at.localeCompare(left.updated_at) || right.id.localeCompare(left.id));
      if (matches.length < 2) throw new Error("当前没有足够的同名笔记可合并。");
      const [primary, ...duplicates] = matches;
      const mergedContent = [
        primary.content,
        ...duplicates.map((note) => `\n\n---\n\n# ${note.title || "未命名笔记"}\n\n${note.content}`),
      ].join("").trim();
      const saved = await notesClient.update(primary.id, {
        base_revision: primary.revision,
        content: mergedContent,
        source: "manual",
      });
      installedNotesRef.current.set(saved.id, saved);
      for (const duplicate of duplicates) {
        const archived = await notesClient.update(duplicate.id, {
          base_revision: duplicate.revision,
          status: "archived",
          source: "manual",
        });
        installedNotesRef.current.set(archived.id, archived);
      }
      setNotes((current) => current.map((note) => {
        if (note.id === saved.id) return saved;
        const archived = duplicates.find((item) => item.id === note.id);
        return archived ? { ...archived, status: "archived" as const } : note;
      }));
      setRetryFeedback(`已合并 ${matches.length} 篇同名笔记，重复副本已归档，可在归档列表恢复。`);
      setRefreshVersion((version) => version + 1);
    } catch (error) {
      setDiagnosticError(error instanceof Error ? error.message : "同名笔记合并失败，内容未删除。请重试。");
    }
  };

  const uploadAttachment = (file: File, insertIntoEditor = false) => {
    const targetNoteId = selectedNoteId;
    if (!workspaceId || role === "viewer" || uploadingAttachment) return Promise.resolve();
    const mimeType = file.type;
    if (!isSupportedAttachmentMime(mimeType)) {
      setUploadError("不支持这个附件类型。请上传 PDF、JPG、PNG、WEBP 或纯文本文件。");
      if (insertIntoEditor) setNoteError("附件类型不受支持，正文内容未改变。");
      return Promise.resolve();
    }
    if (file.size <= 0 || file.size > MAX_UPLOAD_BYTES) {
      setUploadError("附件必须大于 0 且不超过 25 MB。");
      if (insertIntoEditor) setNoteError("附件大小不符合要求，正文内容未改变。");
      return Promise.resolve();
    }

    setUploadingAttachment(true);
    setUploadError(null);
    let reservedId: string | null = null;
    return (async () => {
      try {
        const reserved = await knowledgeClient.createAttachmentUpload({
          filename: file.name,
          mime_type: mimeType,
          size_bytes: file.size,
          note_id: selectedNoteId,
        });
        reservedId = reserved.id;
        const uploaded = await knowledgeClient.uploadAttachmentContent(reserved.id, await file.arrayBuffer());
        const completed = await knowledgeClient.completeAttachmentUpload(uploaded.id);
        setAttachments((current) => [completed, ...current.filter((attachment) => attachment.id !== completed.id)]);
        setRetryFeedback(`已上传 ${file.name}，OCR 已加入队列。`);
        if (insertIntoEditor && targetNoteId && targetNoteId === selectedNoteId && !creatingNote) {
          const safeLabel = file.name.replace(/[\[\]\r\n]/gu, "_");
          const link = `[${safeLabel}](/api/v2/attachments/${encodeURIComponent(completed.id)}/file)`;
          const separator = draftContentRef.current.trim() ? "\n\n" : "";
          updateActiveDraftInput(draftTitleRef.current, `${draftContentRef.current}${separator}${link}`);
          setNoteError(null);
          setNoteMessage("附件已插入正文，保存笔记后生效。");
        }
        setRefreshVersion((version) => version + 1);
      } catch {
        if (reservedId) await knowledgeClient.deleteAttachment(reservedId).catch(() => undefined);
        setUploadError("附件上传失败，请重新选择文件。未完成的上传会自动清理。");
        if (insertIntoEditor) setNoteError("附件上传失败，正文内容仍保留。请重试。");
      } finally {
        if (mountedRef.current) setUploadingAttachment(false);
      }
    })();
  };

  const changeDomain = (domain: ProductDomain, options?: { collaborationSection?: "people" | "comments" | "shares" }) => {
    if (domain === "collaboration") setCollaborationInitialSection(options?.collaborationSection ?? "people");
    if (domain === "account") setAccountSubsection("overview");
    setFeatureMapOpen(false);
    transitionToDomain(domain);
  };
  useEffect(() => {
    setNavigationUser((current) => current.id === user.id && current.email === user.email && current.displayName === user.displayName ? current : user);
  }, [user.displayName, user.email, user.id]);
  useEffect(() => {
    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    const preload = () => {
      for (const domain of ["databases", "knowledge", "reminders", "account"] as const) {
        void preloadWorkspaceDomain(domain).catch(() => undefined);
      }
    };
    const idleHandle = idleWindow.requestIdleCallback?.(preload, { timeout: 2_000 });
    const timer = idleHandle === undefined ? window.setTimeout(preload, 500) : undefined;
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
      if (idleHandle !== undefined) idleWindow.cancelIdleCallback?.(idleHandle);
    };
  }, []);
  const handleProfileChange = (next: Profile) => {
    setNavigationUser((current) => ({ ...current, email: next.email, displayName: next.display_name || next.email }));
  };
  const openAccountSubsection = (subsection: AccountSubsection) => {
    changeDomain("account");
    setAccountSubsection(subsection);
  };
  const openFeatureMap = () => {
    setFeatureMapOpen(true);
    transitionToDomain("notes");
  };
  const navigateFeatureMap = (domain: Parameters<typeof changeDomain>[0]) => {
    if (domain === "account") {
      openAccountSubsection("personal");
      return;
    }
    changeDomain(domain);
  };
  const closeCommandPalette = () => {
    setCommandPaletteOpen(false);
    setCommandPaletteQuery("");
  };
  const openCommandPalette = () => {
    setFeatureMapOpen(false);
    setCommandPaletteQuery("");
    setCommandPaletteOpen(true);
  };
  const runCommand = (callback: () => void | Promise<unknown>) => {
    closeCommandPalette();
    void callback();
  };
  const commandActions: CommandAction[] = [
    {
      id: "new-note",
      label: "新建笔记",
      description: "立即打开可编辑的新笔记草稿",
      keywords: ["创建", "note", "new"],
      shortcut: "Ctrl/Cmd+N",
      onSelect: () => runCommand(() => { void startNewNote(); }),
    },
    ...(workspaceId ? [{
      id: "today-note",
      label: "打开今日笔记",
      description: "打开或创建今天的每日笔记",
      keywords: ["daily", "today"],
      onSelect: () => runCommand(() => { void openTodayNote(); }),
    }, {
      id: "quick-capture",
      label: "快速捕获",
      description: "先记录内容，稍后再整理",
      keywords: ["capture", "inbox"],
      onSelect: () => runCommand(() => setQuickCaptureOpen(true)),
    }] : []),
    {
      id: "create-center",
      label: "创建内容",
      description: "打开笔记、数据库、提醒和导入入口",
      keywords: ["create", "import"],
      onSelect: () => runCommand(() => setCreateCenterOpen(true)),
    },
    { id: "databases", label: "数据库", description: "打开结构化数据库工作区", keywords: ["table", "board", "calendar"], onSelect: () => runCommand(() => changeDomain("databases")) },
    { id: "knowledge", label: "知识整理", description: "搜索、附件恢复和知识图谱", keywords: ["search", "graph", "ocr"], onSelect: () => runCommand(() => changeDomain("knowledge")) },
    { id: "reminders", label: "提醒", description: "查看和管理提醒", keywords: ["reminder", "calendar"], onSelect: () => runCommand(() => changeDomain("reminders")) },
    { id: "collaboration", label: "协作", description: "成员、评论、通知和分享", keywords: ["team", "comment", "share"], onSelect: () => runCommand(() => changeDomain("collaboration")) },
    { id: "ai", label: "AI 助手", description: "打开安全的服务端 AI 对话", keywords: ["assistant", "chat", "人工智能"], onSelect: () => runCommand(() => changeDomain("ai")) },
    { id: "account", label: "个人资料与设置", description: "修改个人信息、密码、安全和工作区", keywords: ["profile", "settings", "password"], onSelect: () => runCommand(() => openAccountSubsection("personal")) },
  ];
  const changeWorkspace = async (nextWorkspaceId: string) => {
    if (!workspaceId || nextWorkspaceId === workspaceId) return;
    try {
      await draftController.quiesce();
      await onWorkspaceChange(nextWorkspaceId);
      abortRecoveryRequests();
      abortRetryRequests();
      abortDatabaseRequests();
      notificationTargetController.current?.abort();
    } catch (error) {
      draftController.resume();
      throw error;
    }
  };
  const productNavigationProps = {
    active: requestedDomain,
    user: navigationUser,
    unreadCount,
    collaborationEnabled,
    notificationsEnabled: Boolean(collaborationEnabled && workspaceId),
    contextOpen: activePane === "context",
    logoutPending,
    onChange: changeDomain,
    onPrefetch: (domain: ProductDomain) => { void preloadWorkspaceDomain(domain).catch(() => undefined); },
    onCreateCenter: openCreateCenter,
    onCreateNote: startNewNote,
    createNoteDisabled: logoutPending,
    onContextToggle: () => setActivePane((pane) => pane === "context" ? "canvas" : "context"),
    onPersonalCenter: () => openAccountSubsection("personal"),
    onNotifications: toggleNotifications,
    onWorkspace: () => openAccountSubsection("workspace"),
    onLogout,
  };
  const navigation = <ProductNavigation {...productNavigationProps} mode="rail" />;
  const mobileNavigation = <ProductNavigation {...productNavigationProps} mode="mobile" />;
  const createCenterDialog = (
    <CreateCenter
      open={createCenterOpen}
      onOpenChange={setCreateCenterOpen}
      renderTrigger={false}
      focusReturnRef={createCenterFocusTargetRef}
      disabled={logoutPending}
      onCreateNote={workspaceId ? startNewNote : undefined}
      onQuickCapture={workspaceId ? () => {
        replaceWorkspaceModal("quick-capture");
        return { status: "completed" };
      } : undefined}
      onWebClipper={workspaceId ? () => {
        replaceWorkspaceModal("web-clipper");
        return { status: "completed" };
      } : undefined}
      onTodayNote={workspaceId ? openTodayNote : undefined}
      onCreateDatabase={workspaceId ? () => {
        openDatabaseCreation();
        return { status: "completed" };
      } : undefined}
      onCreateReminder={workspaceId ? () => {
        changeDomain("reminders");
        return { status: "completed" };
      } : undefined}
      onImport={workspaceId ? () => {
        replaceWorkspaceModal("import");
        return { status: "completed" };
      } : undefined}
      />
  );
  const createCenterAction = (
    <button className="create-center-trigger" type="button" aria-label={activeDomain === "notes" && !selectedNote && !creatingNote && workbenchMode !== "mobile" ? "打开创建中心" : "创建内容"} title="打开创建中心" disabled={logoutPending} onClick={(event) => openCreateCenter(event.currentTarget)}>
      <Plus aria-hidden="true" size={17} />
      <span>创建内容</span>
    </button>
  );
  const createCenterQuickStartTrigger = (
    <button className="create-center-trigger" type="button" aria-label="创建内容" title="打开创建中心" disabled={logoutPending} onClick={(event) => openCreateCenter(event.currentTarget)}>
      <Plus aria-hidden="true" size={17} />
      <span>创建内容</span>
    </button>
  );
  const desktopAccountAction = (
    <button className="create-center-trigger workspace-account-trigger" type="button" aria-label="打开个人资料与设置" title="个人资料、密码、安全与工作区" disabled={logoutPending} onClick={() => openAccountSubsection("personal")}>
      <UserRound aria-hidden="true" size={16} />
      <span>个人资料与设置</span>
    </button>
  );
  const featureMapAction = (
    <button className="feature-map-trigger" type="button" aria-label="打开功能地图" aria-pressed={featureMapOpen} onClick={openFeatureMap}>
      <LayoutGrid aria-hidden="true" size={16} />
      <span>功能地图</span>
    </button>
  );
  const showWorkspaceOverview = activeDomain === "notes" && !selectedNote && !creatingNote;
  const mobileCreateAction = activePane !== "context" && activeDomain === "notes" ? (
    <button className="mobile-create-note-button" type="button" aria-label="新建笔记" disabled={logoutPending} onClick={startNewNote}>
      <Plus aria-hidden="true" size={20} />
      <span>新建笔记</span>
    </button>
  ) : null;
  const desktopCreateAction = (
    <div className="desktop-create-actions">
      {featureMapAction}
      {createCenterAction}
      {desktopAccountAction}
      {activeDomain === "notes" && !showWorkspaceOverview ? (
        <button
          className="editor-new-note-button"
          type="button"
          aria-label="新建笔记"
          aria-keyshortcuts="Control+N Meta+N"
          title="新建笔记（Ctrl/Cmd+N）"
          disabled={logoutPending}
          onClick={startNewNote}
        >
          <Plus aria-hidden="true" size={16} />
          <span>新建笔记</span>
        </button>
      ) : null}
    </div>
  );

  const contextualList = (
    <div className="context-content">
      <div className="context-heading">
        <div><small>CREATE</small><h2>所有笔记</h2></div>
        <div className="context-heading-actions">
          <button className="secondary-create-note" type="button" aria-label="快速捕获" onClick={() => setQuickCaptureOpen(true)}>
            <span>快速捕获</span>
          </button>
          <button className="secondary-create-note context-entry-action" type="button" aria-label="创建内容" onClick={(event) => openCreateCenter(event.currentTarget)}>
            <Plus aria-hidden="true" size={15} />
            <span>创建内容</span>
          </button>
          <button className="secondary-create-note context-entry-action" type="button" aria-label="个人资料与设置（笔记列表）" onClick={() => openAccountSubsection("personal")}>
            <UserRound aria-hidden="true" size={15} />
            <span>个人资料</span>
          </button>
          <button className="primary-create-note" type="button" aria-label="新建笔记" disabled={logoutPending} onClick={startNewNote}>
            <Plus aria-hidden="true" size={17} />
            <span>新建笔记</span>
          </button>
        </div>
      </div>
      <NoteOrganizationPanel
        folders={folders}
        selectedFolderId={noteFolderFilter}
        loading={folderLoading}
        disabled={logoutPending || !workspaceId}
        onSelectFolder={selectFolderFilter}
        onCreateFolder={createFolder}
      />
      <nav className="note-list-views" aria-label="笔记视图">
        {([["all", "全部"], ["inbox", "收件箱"], ["today", "今日"], ["favorites", "收藏"], ["pinned", "置顶"], ["archived", "归档"], ["trash", "回收站"]] as const).map(([view, label]) => (
          <button key={view} type="button" aria-pressed={noteListView === view} className={noteListView === view ? "active" : ""} onClick={() => changeNoteListView(view)}>{label}</button>
        ))}
      </nav>
      {noteListView === "today" ? (
        <button className="primary-create-note daily-note-action" type="button" disabled={logoutPending || dailyNoteOpening} onClick={openTodayNote}>
          {dailyNoteOpening ? "正在打开今日笔记…" : "打开今日笔记"}
        </button>
      ) : null}
      {noteListView === "today" && activePane === "context" && noteError ? <p className="database-operation-error" role="alert">{noteError}</p> : null}
      <div className="search-field" role="search">
        <Search aria-hidden="true" size={15} />
        <input aria-label="搜索笔记" placeholder="搜索标题、正文、标签…" maxLength={500} value={noteSearchQuery} onChange={(event) => setNoteSearchQuery(event.target.value)} />
        {noteSearchQuery ? (
          <button className="search-clear-button" type="button" aria-label="清除笔记搜索" title="清除搜索" onClick={() => setNoteSearchQuery("")}>
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
              <button className="secondary-create-note" type="button" onClick={() => setNoteSearchQuery("")}>清除搜索</button>
            </>
          ) : (
            <>
              <p className="database-empty">暂无笔记，开始记录你的想法。</p>
              <button className="primary-create-note note-empty-create-note" type="button" aria-label="新建笔记" disabled={logoutPending} onClick={startNewNote}>
                <Plus aria-hidden="true" size={17} />
                <span>新建笔记</span>
              </button>
            </>
          )}
        </div>
      ) : null}
      {visibleNotes.map((note) => (
        <button key={note.id} className={note.id === selectedNoteId ? "note-row selected" : "note-row"} type="button" onClick={() => selectNote(note)}>
          <strong>{note.title.trim() || "未命名笔记"}</strong><span>{new Date(note.updated_at).toLocaleDateString()}</span>
          <p>{note.content.trim().slice(0, 80) || "空白笔记"}</p>
        </button>
      ))}
    </div>
  );

  const databaseContextualList = (
    <div className="context-content">
      <div className="context-heading">
        <div><small>STRUCTURE</small><h2>数据库</h2></div>
        <button
          className="primary-create-note"
          type="button"
          aria-label="新建数据库"
          onClick={() => {
            if (databases.length === 0) {
              setActivePane("canvas");
              return;
            }
            setFirstDatabaseName("");
            setDatabaseCreateOpen(true);
          }}
        >
          <Plus aria-hidden="true" size={17} />
          <span>新建数据库</span>
        </button>
      </div>
      {databaseCreateOpen && databases.length > 0 ? (
        <form
          className="database-create-inline"
          aria-label="新建数据库表单"
          onSubmit={(event) => {
            event.preventDefault();
            createFirstDatabase();
          }}
        >
          <label>数据库名称<input aria-label="新建数据库名称" value={firstDatabaseName} onChange={(event) => setFirstDatabaseName(event.target.value)} autoFocus /></label>
          <div className="database-create-inline-actions">
            <button type="button" onClick={() => setDatabaseCreateOpen(false)}>取消</button>
            <button type="submit" disabled={!firstDatabaseName.trim() || creatingFirstDatabase}>{creatingFirstDatabase ? "创建中…" : "创建数据库"}</button>
          </div>
        </form>
      ) : null}
      {databaseLoading && databases.length === 0 ? <p className="database-empty" role="status">正在加载数据库…</p> : null}
      {databaseError ? <p className="database-operation-error" role="alert">{databaseError}</p> : null}
      {databases.map((database) => (
        <button
          key={database.id}
          className={database.id === selectedDatabaseId ? "note-row selected" : "note-row"}
          type="button"
          onClick={() => { setSelectedDatabaseId(database.id); setSelectedDatabaseRecordId(null); setSelectedCommentId(null); setResolvedNotificationRecord(null); setActivePane("canvas"); }}
        >
          <strong>{database.name}</strong><p>{database.description || "Structured database"}</p>
        </button>
      ))}
      {!databaseLoading && !databaseError && databases.length === 0 ? <p className="database-empty">尚未创建数据库。</p> : null}
    </div>
  );

  const recoveryPanel = (
    <KnowledgeRecoveryPanel
      attachments={attachments}
      diagnostics={diagnostics as RecoveryDiagnostic[]}
      filters={filters}
      loading={loading}
      refreshing={refreshing}
      attachmentError={attachmentError}
      diagnosticError={diagnosticError}
      retryFeedback={retryFeedback}
      isRetryPending={retryingIds.size > 0}
      onUpload={role === "viewer" ? undefined : uploadAttachment}
      uploading={uploadingAttachment}
      uploadError={uploadError}
      attachmentNextCursor={attachmentCursor}
      diagnosticNextCursor={diagnosticCursor}
      onRetry={(id) => retryAttachments([id])}
      onBatchRetry={retryAttachments}
      onRecover={(diagnostic) => {
        onDiagnosticNavigate?.(diagnostic as KnowledgeDiagnostic);
        setActivePane("context");
      }}
      folders={folders}
      onClassifyUnfiled={role === "viewer" || logoutPending ? undefined : classifyUnfiledNotes}
      onMoveOrphansToInbox={role === "viewer" || logoutPending ? undefined : moveOrphansToInbox}
      onIgnoreOrphans={ignoreOrphans}
      onMergeDuplicate={role === "viewer" || logoutPending ? undefined : (diagnostic) => { void mergeDuplicateNotes(diagnostic); }}
      onFiltersChange={setFilters}
      onLoadMoreAttachments={loadMoreAttachments}
      onLoadMoreDiagnostics={loadMoreDiagnostics}
    />
  );

  const databaseCanvas = databaseBundle && workspaceId ? (
    <Suspense fallback={<p className="database-empty" role="status">正在准备数据库视图…</p>}>
      <LazyDatabaseWorkbench
        database={databaseBundle.database}
        databases={databases}
        properties={databaseBundle.properties}
        records={databaseRecords}
        recordsNextCursor={databaseRecordsNextCursor}
        views={databaseBundle.views}
        templates={databaseBundle.templates}
        client={databaseClient}
        collaborationClient={collaborationClient}
        onMutation={() => setDatabaseRefreshVersion((version) => version + 1)}
        onRecordsPageRequest={requestDatabasePage}
        onBoardMove={(input) => databaseClient.boardMove(databaseBundle.database.id, input)}
        onCalendarAssign={(input) => databaseClient.calendarAssign(databaseBundle.database.id, input)}
      />
    </Suspense>
  ) : (
    <section className="database-workbench">
      {databaseLoading ? <p className="database-empty" role="status">正在加载数据库内容…</p> : null}
      {databaseError ? <p className="database-operation-error" role="alert">{databaseError}</p> : null}
      {!databaseLoading && databases.length === 0 && workspaceId ? <section className="database-first-create" aria-label="创建第一个数据库"><p className="eyebrow">STRUCTURED DATABASE</p><h1>创建第一个数据库</h1><p>从一个轻量的表格开始，之后可随时添加属性、视图和协作规则。</p><label>数据库名称<input aria-label="数据库名称" value={firstDatabaseName} onChange={(event) => setFirstDatabaseName(event.target.value)} /></label><button type="button" disabled={!firstDatabaseName.trim() || creatingFirstDatabase} onClick={createFirstDatabase}>创建数据库</button></section> : null}
      {!databaseLoading && !databaseError && databases.length > 0 && !databaseBundle ? <p className="database-empty">请选择数据库。</p> : null}
    </section>
  );
  const knowledgeCanvas = (
    <section className="product-domain-page knowledge-domain-page">
      <p className="eyebrow">KNOWLEDGE CENTER</p>
      <h1>知识恢复</h1>
      <p className="product-domain-lead">搜索、保存查询，并集中处理附件 OCR 状态与知识诊断。</p>
      <Suspense fallback={<p className="knowledge-search-state" role="status">正在加载知识工具…</p>}>
        <LazyKnowledgeSearchPanel client={knowledgeClient} />
        <LazyKnowledgeGraphPanel client={knowledgeClient} />
        <LazyKnowledgeCalendarPanel client={knowledgeClient} />
      </Suspense>
      {recoveryPanel}
    </section>
  );
  const remindersCanvas = <Suspense fallback={<p className="reminder-state" role="status">正在加载提醒中心…</p>}><LazyReminderPanel client={knowledgeClient} notesClient={notesClient} /></Suspense>;
  const aiCanvas = <Suspense fallback={<p className="database-empty" role="status">正在加载 AI 助手…</p>}><LazyAIChatPanel client={apiClient} workspaceId={workspaceId ?? ""} showStatus /></Suspense>;
  const accountCanvas = (
    <Suspense fallback={<p className="database-empty" role="status">正在加载账户中心…</p>}>
      <LazyAccountCenter
        client={profileClient}
        collaboration={collaborationClient}
        operations={operationsClient}
        workspaces={workspaces}
        activeWorkspaceId={activeWorkspaceId}
        currentUserId={userId}
        initialTab={accountSubsection === "workspace" ? "workspace" : accountSubsection === "personal" ? "profile" : "overview"}
        onWorkspaceChange={changeWorkspace}
        onCreateWorkspace={onCreateWorkspace}
        onPrepareDelete={() => draftController.quiesce()}
        onDeleteFailed={() => draftController.resume()}
        onDeleted={onDeleted}
        onProfileChange={handleProfileChange}
      />
    </Suspense>
  );
  const collaborationUnavailableCanvas = (
    <section className="product-domain-page product-status-page">
      <p className="eyebrow">COLLABORATION</p>
      <h1>协作功能当前不可用</h1>
      <p className="product-domain-lead">当前没有可用工作区或协作能力。选择其他产品区域不会更改你的笔记数据。</p>
    </section>
  );
  const workspaceOverviewCanvas = (
    <article className="editor-document">
      <header className="editor-toolbar">
        <span className="saved-state" role="status" aria-live="polite"><span /> 已保存</span>
        <div>
          <button type="button" aria-label="打开快速操作" aria-keyshortcuts="Control+K Meta+K" title="快速操作（Ctrl/Cmd+K）" onClick={openCommandPalette}><Command aria-hidden="true" size={17} /></button>
          <button type="button" aria-label={notificationButtonLabel(unreadCount)} onClick={(event) => toggleNotifications(event.currentTarget)}><Bell aria-hidden="true" size={17} /></button>
          <button type="button" aria-label="打开检查器" onClick={(event) => openInspector(event.currentTarget)}><Boxes size={17} /></button>
        </div>
      </header>
      <div className="editor-copy">
        <p className="eyebrow">NEXUS NOTES / PUBLIC BETA</p>
        <h1 ref={permanentDeleteFallbackRef} tabIndex={-1}>Public Beta 重写计划</h1>
        <p className="lead">一个稳定、响应迅速、离线可恢复的知识工作台。</p>
        <section className="workspace-quick-start" aria-label="快速开始">
          <div className="workspace-quick-start-heading">
            <div>
              <p className="eyebrow">现在就开始</p>
              <h2>快速开始</h2>
            </div>
            <p>常用入口集中在这里，不需要先找菜单。</p>
          </div>
          <div className="workspace-quick-start-actions">
            <button className="workspace-quick-start-action workspace-quick-start-primary" type="button" aria-label={workbenchMode === "mobile" ? "新建笔记（快速开始）" : "新建笔记"} disabled={logoutPending} onClick={() => { void startNewNote(); }}>
              <span className="workspace-quick-start-icon"><Plus aria-hidden="true" size={18} /></span>
              <span><strong>新建笔记</strong><small>打开一篇空白笔记</small></span>
            </button>
            <div className="workspace-quick-start-create-center">
              {createCenterQuickStartTrigger}
              <small>笔记、快速捕获或数据库</small>
            </div>
            <button className="workspace-quick-start-action" type="button" aria-label="个人资料与设置" disabled={logoutPending} onClick={() => openAccountSubsection("personal")}>
              <span className="workspace-quick-start-icon"><UserRound aria-hidden="true" size={18} /></span>
              <span><strong>个人资料与设置</strong><small>资料、密码、安全和工作区</small></span>
            </button>
          </div>
        </section>
        <NoteOrganizationPanel
          folders={folders}
          selectedFolderId={noteFolderFilter}
          loading={folderLoading}
          disabled={logoutPending || !workspaceId}
          onSelectFolder={selectFolderFilter}
          onCreateFolder={createFolder}
        />
        {noteError && activePane !== "context" ? <p className="database-operation-error" role="alert">{noteError}</p> : null}
        <hr />
        <h2>自适应工作台</h2>
        <p>导航保持轻量，列表按需出现，主画布获得最多空间，检查器不再永久挤压编辑区域。</p>
        <div className="callout"><Sparkles size={18} /><p>视觉风格继续使用原有蓝色强调、玻璃层级和舒适圆角。</p></div>
        <FeatureHub availability={{ collaboration: collaborationEnabled, reminders: Boolean(workspaceId) }} onNavigate={navigateFeatureMap} />
        {recoveryPanel}
      </div>
    </article>
  );

  const collaborationRecords = resolvedNotificationRecord && !databaseRecords.some((record) => record.id === resolvedNotificationRecord.id)
    ? [...databaseRecords, resolvedNotificationRecord]
    : databaseRecords;
  const recordTargets: CollaborationCommentTarget[] = collaborationRecords.map((record) => ({
      type: "database_record" as const,
      id: record.id,
      label: `${record.id === resolvedNotificationRecord?.id ? `${databases.find((database) => database.id === record.database_id)?.name ?? "数据库"} / ` : ""}${Object.values(record.values).find((value): value is string => typeof value === "string" && Boolean(value.trim())) ?? `Record ${record.id}`}`,
    }));
  const commentTargets: CollaborationCommentTarget[] = [
    ...noteTargets,
    ...(selectedNoteId && !noteTargets.some((target) => target.id === selectedNoteId)
      ? [{ type: "note" as const, id: selectedNoteId, label: "通知中的笔记" }]
      : []),
    ...recordTargets,
    ...(selectedDatabaseRecordId && !recordTargets.some((target) => target.id === selectedDatabaseRecordId)
      ? [{ type: "database_record" as const, id: selectedDatabaseRecordId, label: "通知中的数据库记录" }]
      : []),
  ];
  const shareTargets: CollaborationShareTarget[] = [
    ...noteTargets,
    ...(databaseBundle?.views.map((view) => ({
      type: "database_view" as const,
      id: view.id,
      label: `${databaseBundle.database.name} / ${view.name}`,
    })) ?? []),
  ];
  const activeCollaborationTarget = selectedDatabaseRecordId
    ? { type: "database_record" as const, id: selectedDatabaseRecordId }
    : selectedNoteId
      ? { type: "note" as const, id: selectedNoteId }
      : undefined;
  const navigateNotificationTarget = (target: NotificationTarget) => {
    setNotificationOpen(false);
    notificationTargetController.current?.abort();
    if (target.targetType === "note") {
      setSelectedNoteId(target.targetId);
      setSelectedDatabaseRecordId(null);
      setResolvedNotificationRecord(null);
      setSelectedCommentId(target.commentId);
      setCollaborationInitialSection("comments");
      transitionToDomain("collaboration");
      return;
    }

    const selectTarget = (availableDatabases: Database[], database: Database, record: DatabaseRecord) => {
      setDatabases(availableDatabases);
      setSelectedDatabaseId(database.id);
      setSelectedDatabaseRecordId(record.id);
      setResolvedNotificationRecord(record);
      setSelectedCommentId(target.commentId);
      setDatabaseError(null);
      setCollaborationInitialSection("comments");
      transitionToDomain("collaboration");
    };
    const loadedRecord = collaborationRecords.find((record) => record.id === target.targetId && (!target.databaseId || record.database_id === target.databaseId));
    const loadedDatabase = loadedRecord ? databases.find((database) => database.id === loadedRecord.database_id) : undefined;
    if (loadedRecord && loadedDatabase) {
      selectTarget(databases, loadedDatabase, loadedRecord);
      return;
    }

    if (!workspaceId) return;
    const controller = new AbortController();
    notificationTargetController.current = controller;
    void resolveDatabaseNotificationTarget(databaseClient, target, controller.signal).then(({ database, databases: availableDatabases, record }) => {
      if (!controller.signal.aborted) selectTarget(availableDatabases, database, record);
    }).catch((error: unknown) => {
      if (isAborted(error, controller.signal)) return;
      setSelectedDatabaseRecordId(target.targetId);
      setResolvedNotificationRecord(null);
      setSelectedCommentId(target.commentId);
      setDatabaseError("无法定位通知中的数据库记录。");
      setCollaborationInitialSection("comments");
      transitionToDomain("collaboration");
    }).finally(() => {
      if (notificationTargetController.current === controller) notificationTargetController.current = null;
    });
  };
  const inspectorTitle = activeDomain === "databases"
    ? databaseBundle?.database.name ?? "数据库"
    : activeDomain === "collaboration"
      ? "协作中心"
      : activeDomain === "knowledge"
        ? "知识整理"
        : activeDomain === "ai"
          ? "AI 助手"
          : activeDomain === "account"
            ? "账户中心"
            : selectedNote?.title || "笔记";

  return (
    <>
      <div className="workspace-modal-background" data-testid="workspace-modal-background" aria-hidden={workspaceModal !== null || undefined} inert={workspaceModal !== null || undefined}>
      {workspaceSync.status === "syncing" ? <div className="sync-status-banner" role="status">正在同步离线操作…</div> : null}
      {workspaceSync.status === "error" ? <div className="sync-status-banner sync-status-error" role="status" aria-live="assertive"><span>离线操作同步失败，本地数据仍保留，可安全重试。</span><button type="button" onClick={workspaceSync.retry}>重试同步</button></div> : null}
      {serviceWorkerUpdate ? (
        <div className="update-banner" role="status">
          <span>新版本已准备好。</span>
          <button type="button" onClick={() => {
            navigator.serviceWorker?.addEventListener("controllerchange", () => window.location.reload(), { once: true });
            serviceWorkerUpdate.activate();
          }}>更新并重新加载</button>
        </div>
      ) : null}
      {logoutError ? (
        <div className="logout-error-banner" role="alert">
          <span>{logoutError}</span>
          <button type="button" disabled={logoutPending} onClick={onRetryLogout}>重试退出登录</button>
        </div>
      ) : null}
      <WorkspaceShell
        activeDomain={activeDomain}
        requestedDomain={requestedDomain}
        domainPending={domainPending}
        navigation={navigation}
        mobileNavigation={mobileNavigation}
        mobileCreateAction={mobileCreateAction}
        desktopCreateAction={desktopCreateAction}
        contextualList={activeDomain === "databases" ? databaseContextualList : activeDomain === "notes" ? contextualList : undefined}
        inspector={<div className="inspector-content"><small>页面信息</small><h3>{inspectorTitle}</h3><p>属性、版本与协作状态只在需要时显示。</p></div>}
        inspectorOpen={inspectorOpen}
        externalModalOpen={workspaceModal !== null || commandPaletteOpen}
        activePane={activePane}
        onActivePaneChange={setActivePane}
        onInspectorOpen={openInspector}
        onInspectorClose={closeInspector}
      >
        <>
        {activeDomain === "collaboration" ? collaborationEnabled && workspaceId ? <Suspense fallback={<p className="database-empty" role="status">正在加载协作中心…</p>}><LazyCollaborationCenter client={collaborationClient} workspaceId={workspaceId} userId={userId} role={role} initialSection={collaborationInitialSection} activeTarget={activeCollaborationTarget} selectedCommentId={selectedCommentId} commentTargets={commentTargets} shareTargets={shareTargets} /></Suspense> : collaborationUnavailableCanvas : activeDomain === "databases" ? databaseCanvas : activeDomain === "knowledge" ? knowledgeCanvas : activeDomain === "reminders" ? remindersCanvas : activeDomain === "ai" ? aiCanvas : activeDomain === "account" ? accountCanvas : featureMapOpen ? workspaceOverviewCanvas : selectedNote || creatingNote ? <article className="editor-document">
          <header className="editor-toolbar">
            <span className="saved-state" role="status" aria-live="polite"><span /> {noteSaving ? "保存中…" : noteMessage ?? "未保存更改"}</span>
            <div>
              {!creatingNote && selectedNote ? <>
                <button type="button" aria-label={selectedNote.is_favorite ? "取消收藏" : "收藏笔记"} title={selectedNote.is_favorite ? "取消收藏" : "收藏笔记"} disabled={logoutPending || role === "viewer" || noteSaving || selectedNote.status === "trashed"} onClick={() => toggleSelectedNoteFlag("is_favorite")}><Star aria-hidden="true" size={17} fill={selectedNote.is_favorite ? "currentColor" : "none"} /></button>
                <button type="button" aria-label={selectedNote.is_pinned ? "取消置顶" : "置顶笔记"} title={selectedNote.is_pinned ? "取消置顶" : "置顶笔记"} disabled={logoutPending || role === "viewer" || noteSaving || selectedNote.status === "trashed"} onClick={() => toggleSelectedNoteFlag("is_pinned")}><Pin aria-hidden="true" size={17} fill={selectedNote.is_pinned ? "currentColor" : "none"} /></button>
                {selectedNote.status !== "trashed" ? <button type="button" aria-label={selectedNote.status === "archived" ? "取消归档" : "归档笔记"} title={selectedNote.status === "archived" ? "取消归档" : "归档笔记"} disabled={logoutPending || role === "viewer" || noteSaving} onClick={() => changeSelectedNoteStatus(selectedNote.status === "archived" ? "active" : "archived")}><Archive aria-hidden="true" size={17} /></button> : null}
                <button type="button" aria-label="打开笔记分享" title="打开笔记分享" disabled={logoutPending || noteSaving} onClick={() => changeDomain("collaboration", { collaborationSection: "shares" })}><Share2 aria-hidden="true" size={17} /></button>
              </> : null}
              <button type="button" aria-label="打开快速操作" aria-keyshortcuts="Control+K Meta+K" title="快速操作（Ctrl/Cmd+K）" onClick={openCommandPalette}><Command aria-hidden="true" size={17} /></button>
              <button type="button" aria-label={notificationButtonLabel(unreadCount)} onClick={(event) => toggleNotifications(event.currentTarget)}><Bell aria-hidden="true" size={17} /></button>
              <button type="button" aria-label="打开检查器" onClick={(event) => openInspector(event.currentTarget)}><Boxes size={17} /></button>
            </div>
          </header>
          <div className="editor-copy">
            <p className="eyebrow">NEXUS NOTES / PUBLIC BETA</p>
            <h1>{draftTitle.trim() || "未命名笔记"}</h1>
            {editorMode === "edit" ? <>
              <label className="note-editor-field">标题<input ref={titleInputRef} aria-label="笔记标题" disabled={logoutPending || selectedNote?.status === "trashed"} value={draftTitle} onChange={(event) => updateActiveDraftInput(event.target.value, draftContentRef.current)} /></label>
              <label className="note-editor-field">文件夹<select aria-label="笔记文件夹" disabled={logoutPending || creatingNote || selectedNote?.status === "trashed"} value={draftFolderId ?? ""} onChange={(event) => { setDraftFolderId(event.target.value || null); setNoteMessage(null); }}><option value="">未分类</option>{folders.map((folder, index) => <option key={`${folder.id || "folder"}-${index}`} value={folder.id}>{folder.name}</option>)}</select></label>
              {!creatingNote && selectedNote ? <>
                <label className="note-editor-field">笔记数据库<select
                  aria-label="笔记数据库"
                  aria-busy={noteDatabasesLoading}
                  disabled={logoutPending || role === "viewer" || noteSaving || selectedNote.status === "trashed" || noteDatabasesLoading}
                  value={draftDatabaseId ?? ""}
                  onChange={(event) => { setDraftDatabaseId(event.target.value || null); setNoteMessage(null); }}
                >
                  <option value="">未关联数据库</option>
                  {noteDatabasesLoading ? <option value="__loading" disabled>加载数据库…</option> : null}
                  {noteDatabases.map((database) => <option key={database.id} value={database.id}>{database.name}</option>)}
                </select></label>
                {noteDatabasesError ? <p className="database-operation-error" role="alert">{noteDatabasesError}</p> : null}
              </> : null}
              {!creatingNote && selectedNote ? <NoteTagPanel
                tags={tags}
                selectedTagIds={noteTagIds[selectedNote.id] ?? []}
                saving={noteTagsLoading || noteTagsSaving}
                readOnly={role === "viewer" || selectedNote.status === "trashed"}
                error={noteTagsError}
                onChange={updateSelectedNoteTags}
                onCreateTag={role === "viewer" || selectedNote.status === "trashed" ? undefined : createNoteTag}
              /> : null}
              {!creatingNote && selectedNote ? <NoteLinksPanel
                currentNoteId={selectedNote.id}
                notes={notes}
                linkedNoteIds={linkedNoteIds}
                backlinks={backlinks}
                loading={noteLinksLoading}
                readOnly={role === "viewer" || selectedNote.status === "trashed"}
                saving={noteLinksSaving}
                error={noteLinksError}
                onSave={saveSelectedNoteLinks}
              /> : null}
              {!creatingNote && selectedNote ? <NoteAiActions
                key={selectedNote.id}
                client={apiClient}
                workspaceId={workspaceId ?? ""}
                note={{ title: draftTitle, content: draftContent }}
                disabled={logoutPending || role === "viewer" || noteSaving || selectedNote.status === "trashed"}
                onApplyContent={applyAiContent}
                onApplyTags={applyAiTags}
              /> : null}
              <label className="note-editor-field">内容<NoteEditorSurface
                value={draftContent}
                ariaLabel="笔记内容"
                readOnly={logoutPending || selectedNote?.status === "trashed"}
                onUploadAttachment={!creatingNote && selectedNote && role !== "viewer" && selectedNote.status !== "trashed" ? (file) => uploadAttachment(file, true) : undefined}
                uploadingAttachment={uploadingAttachment}
                onChange={(content) => updateActiveDraftInput(draftTitleRef.current, content)}
              /></label>
              {noteConflict && noteConflict.workspaceId === workspaceId && noteConflict.entityId === activeDraftId ? (
                <NoteConflictPanel
                  local={noteConflict.local}
                  server={noteConflict.server}
                  onKeepLocal={() => { void resolveNoteConflict("local"); }}
                  onUseServer={() => { void resolveNoteConflict("server"); }}
                />
              ) : null}
            </> : <MarkdownPreview content={draftContent} />}
            <div className="note-editor-actions">
              <button type="button" className="note-mode-action" onClick={() => setEditorMode((mode) => mode === "edit" ? "preview" : "edit")}>
                {editorMode === "edit" ? "预览笔记" : "返回编辑器"}
              </button>
              {selectedNote?.status !== "trashed" ? (
                editorMode === "edit" ? <button type="button" disabled={logoutPending || noteSaving || (!creatingNote && !draftTitle.trim() && !draftContent.trim())} onClick={saveNote}>{creatingNote && noteError ? "重试同步" : "保存笔记"}</button> : null
              ) : null}
              {!creatingNote && selectedNote ? (
                <>
                  <button type="button" className="note-lifecycle-action" disabled={logoutPending || role === "viewer" || noteSaving} onClick={() => changeSelectedNoteStatus(selectedNote.status === "trashed" ? "active" : "trashed")}>
                    {selectedNote.status === "trashed" ? "恢复笔记" : "移入回收站"}
                  </button>
                  {selectedNote.status === "archived" ? <button type="button" className="note-lifecycle-action" disabled={logoutPending || role === "viewer" || noteSaving} onClick={() => changeSelectedNoteStatus("active")}>取消归档</button> : null}
                </>
              ) : null}
              {selectedNote?.status === "trashed" ? (
                <button type="button" className="note-lifecycle-action note-lifecycle-danger" disabled={logoutPending || noteSaving || permanentDeletePending} onClick={(event) => openPermanentDelete(event.currentTarget)}>永久删除</button>
              ) : null}
              {noteMessage ? <p role="status">{noteMessage}</p> : null}
              {noteError && activePane !== "context" ? <p className="database-operation-error" role="alert">{noteError}</p> : null}
            </div>
            {!creatingNote && selectedNote ? (
              <NoteHistoryPanel
                open={historyOpen}
                revisions={noteRevisions}
                loading={historyLoading}
                error={historyError}
                restoringRevision={restoringRevision}
                readOnly={role === "viewer" || selectedNote.status === "trashed"}
                onToggle={() => setHistoryOpen((open) => !open)}
                onRetry={() => setHistoryRefreshVersion((version) => version + 1)}
                onRestore={restoreSelectedRevision}
              />
            ) : null}
            {recoveryPanel}
          </div>
        </article> : workspaceOverviewCanvas}
        <NotificationCenter
          client={collaborationClient}
          open={notificationOpen}
          unreadCount={unreadCount}
          opener={notificationOpenerRef.current}
          onClose={() => setNotificationOpen(false)}
          onNotificationRead={(count) => setUnreadCount((current) => Math.max(0, current - count))}
          onDeepLink={navigateNotificationTarget}
        />
        </>
      </WorkspaceShell>
      </div>
      {createCenterDialog}
      <CommandPalette
        open={commandPaletteOpen}
        query={commandPaletteQuery}
        actions={commandActions}
        onQueryChange={setCommandPaletteQuery}
        onClose={closeCommandPalette}
      />
      {quickCaptureOpen && workspaceId ? (
        <div className="quick-capture-backdrop" role="presentation" aria-hidden={workspaceModal !== "quick-capture" || undefined} inert={workspaceModal !== "quick-capture" || undefined} onMouseDown={(event) => { if (event.target === event.currentTarget) setQuickCaptureOpen(false); }}>
          <div className="quick-capture-dialog" role="dialog" aria-modal="true" aria-labelledby="quick-capture-title" onMouseDown={(event) => event.stopPropagation()}>
            <QuickCapturePanel client={notesClient} onClose={() => setQuickCaptureOpen(false)} onCaptured={handleQuickCapture} />
          </div>
        </div>
      ) : null}
      {webClipperOpen && workspaceId ? (
        <WebClipperPanel
          client={notesClient}
          databases={databases}
          onClose={() => setWorkspaceModal(null)}
          onCaptured={handleWebClipperCapture}
        />
      ) : null}
      {importCenterOpen && workspaceId ? (
        <ImportExportCenter
          open
          onOpenChange={setImportCenterOpen}
          operations={operationsClient}
          onImported={() => setNotesRefreshVersion((version) => version + 1)}
        />
      ) : null}
      {permanentDeleteOpen && selectedNote ? (
        <div className="account-dialog-backdrop" role="presentation" aria-hidden={workspaceModal !== "permanent-delete" || undefined} inert={workspaceModal !== "permanent-delete" || undefined} onMouseDown={(event) => { if (event.target === event.currentTarget && !permanentDeletePending) closePermanentDeleteDialog(); }}>
          <div ref={permanentDeleteDialogRef} className="account-confirm-dialog" role="dialog" aria-modal="true" aria-label="永久删除笔记" tabIndex={-1}>
            <h3>永久删除笔记</h3>
            <p>此操作不可撤销。笔记、其评论和公开分享链接将被永久删除。</p>
            {permanentDeleteError ? <p className="account-error" role="alert">{permanentDeleteError}</p> : null}
            <div className="account-actions">
              <button ref={permanentDeleteCancelRef} type="button" disabled={permanentDeletePending} onClick={() => closePermanentDeleteDialog()}>取消</button>
              <button type="button" className="account-danger-button" disabled={permanentDeletePending} onClick={deleteSelectedNotePermanently}>{permanentDeletePending ? "正在永久删除…" : "确认永久删除"}</button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

export function App({
  authClient = defaultAuthClient,
  apiClient = new ApiClient(),
  localStore,
  workspaceId,
  turnstileSiteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY ?? "",
  resetToken = resetTokenFromLocation(),
  onDiagnosticNavigate,
}: {
  authClient?: AuthClient;
  apiClient?: ApiClient;
  localStore?: UserScopedLocalStore;
  workspaceId?: string;
  turnstileSiteKey?: string;
  resetToken?: string;
  onDiagnosticNavigate?: (diagnostic: KnowledgeDiagnostic) => void;
} = {}) {
  const [route, setRoute] = useState<AppRoute>(() => routeFromLocation());
  const workspaceRouteSelectedRef = useRef<WorkspaceRouteAuthority | null>(null);
  const [authGateVersion, setAuthGateVersion] = useState(0);
  const [defaultLocalStore, setDefaultLocalStore] = useState<UserScopedLocalStore>(() => new BetaLocalStore());
  const [logoutPhase, setLogoutPhase] = useState<LogoutPhase>("idle");
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const [cleanupAfterDelete, setCleanupAfterDelete] = useState(false);
  const logoutAttempted = useRef(false);
  const cleanupInFlight = useRef(false);
  const draftControllerRef = useRef<NoteDraftController | null>(null);
  const activeLocalStore = localStore ?? defaultLocalStore;
  const logoutPending = logoutPhase === "quiescing";
  const requestCleanup = () => {
    if (!cleanupInFlight.current) setLogoutPhase("cleanup");
  };
  useEffect(() => {
    if (logoutPhase !== "cleanup" || cleanupInFlight.current) return;
    cleanupInFlight.current = true;
    const browserStateCleanup = Promise.resolve().then(clearUserScopedBrowserState);
    const localStoreCleanup = Promise.resolve().then(() => {
      if (typeof activeLocalStore.destroy !== "function") {
        throw new Error("Active local store cannot destroy user-scoped data");
      }
      return activeLocalStore.destroy();
    });
    void Promise.allSettled([browserStateCleanup, localStoreCleanup]).then((results) => {
      cleanupInFlight.current = false;
      if (results.some((result) => result.status === "rejected")) {
        setLogoutPhase("cleanup-error");
        return;
      }
      logoutAttempted.current = false;
      workspaceRouteSelectedRef.current = null;
      setRoute({ kind: "workspace" });
      if (!localStore) setDefaultLocalStore(new BetaLocalStore());
      setLogoutError(null);
      setCleanupAfterDelete(false);
      setLogoutPhase("idle");
      setAuthGateVersion((version) => version + 1);
    });
  }, [activeLocalStore, localStore, logoutPhase]);
  const logout = () => {
    if (logoutAttempted.current || logoutPhase !== "idle") return;
    const draftController = draftControllerRef.current;
    if (!draftController) {
      setLogoutError("暂时无法安全退出，请稍后重试。当前工作区仍保持登录状态。");
      return;
    }
    logoutAttempted.current = true;
    setCleanupAfterDelete(false);
    setLogoutPhase("quiescing");
    setLogoutError(null);
    void draftController.quiesce().then(() => authClient.logout()).then(() => {
      requestCleanup();
    }, () => {
      draftController.resume();
      logoutAttempted.current = false;
      setLogoutPhase("idle");
      setLogoutError("退出登录失败，请检查网络后重试。当前工作区仍保持登录状态。");
    });
  };
  const accountDeleted = () => {
    if (logoutPhase !== "idle") return;
    logoutAttempted.current = true;
    setLogoutError(null);
    setCleanupAfterDelete(true);
    requestCleanup();
  };
  if (route.kind === "share") {
    return <PublicSharePage client={new CollaborationClient(apiClient, "public-share")} token={route.token} />;
  }
  if (route.kind === "invite") {
    return <InviteRedemptionPage
      authClient={authClient}
      client={new CollaborationClient(apiClient, "invite-redemption")}
      token={route.token}
      turnstileSiteKey={turnstileSiteKey}
      onAccepted={(acceptedWorkspaceId, userId) => {
        window.history.replaceState(null, "", "/");
        workspaceRouteSelectedRef.current = { userId, workspaceId: acceptedWorkspaceId };
        setRoute({ kind: "workspace", workspaceId: acceptedWorkspaceId });
      }}
    />;
  }
  if (logoutPhase === "cleanup" || logoutPhase === "cleanup-error") {
    return <LogoutCleanupRecovery failed={logoutPhase === "cleanup-error"} deleted={cleanupAfterDelete} onRetry={requestCleanup} />;
  }
  return (
    <AuthGate key={authGateVersion} client={authClient} turnstileSiteKey={turnstileSiteKey} resetToken={resetToken}>
      {(session, refreshSession) => {
        const routeWorkspaceId = route.kind === "workspace" ? route.workspaceId : undefined;
        const routeAuthority = workspaceRouteSelectedRef.current;
        return <WorkspaceSessionBoundary
          session={session}
          routeWorkspaceId={routeWorkspaceId}
          routeAuthority={routeAuthority}
          initialWorkspaceId={workspaceId}
          onStaleRoute={(staleWorkspaceId, staleAuthority) => {
            if (workspaceRouteSelectedRef.current !== staleAuthority) return;
            workspaceRouteSelectedRef.current = null;
            setRoute((current) => current.kind === "workspace" && current.workspaceId === staleWorkspaceId
              ? { kind: "workspace" }
              : current);
          }}
        >
          {({ activeWorkspace, activeWorkspaceId, memberships }) => (
            <AuthenticatedWorkspace
              key={activeWorkspaceId ?? "no-active-workspace"}
              apiClient={apiClient}
              workspaceId={activeWorkspaceId ?? undefined}
              workspaces={memberships}
              activeWorkspaceId={activeWorkspaceId}
              user={{ ...session.user, displayName: session.user.displayName || session.user.email }}
              role={activeWorkspace?.role ?? "viewer"}
              collaborationEnabled={Boolean(activeWorkspace)}
              localStore={activeLocalStore}
              draftControllerRef={draftControllerRef}
              logoutPending={logoutPending}
              logoutError={logoutError}
              onLogout={logout}
              onRetryLogout={logout}
              onWorkspaceChange={(nextWorkspaceId) => {
                workspaceRouteSelectedRef.current = { userId: session.user.id, workspaceId: nextWorkspaceId };
                setRoute({ kind: "workspace", workspaceId: nextWorkspaceId });
              }}
              onCreateWorkspace={async (name) => {
                const workspace = await authClient.createWorkspace({ name });
                if (!await refreshSession()) {
                  throw Object.assign(new Error("Workspace was created but the session could not be refreshed"), {
                    code: "WORKSPACE_CREATED_SESSION_REFRESH_FAILED",
                  });
                }
                workspaceRouteSelectedRef.current = { userId: session.user.id, workspaceId: workspace.id };
                setRoute({ kind: "workspace", workspaceId: workspace.id });
                return workspace;
              }}
              onDeleted={accountDeleted}
              onDiagnosticNavigate={onDiagnosticNavigate}
            />
          )}
        </WorkspaceSessionBoundary>;
      }}
    </AuthGate>
  );
}
