import {
  Bell,
  Boxes,
  Plus,
  Search,
  Sparkles,
} from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { Attachment, AuthSession, AuthUserSummary, Database, DatabaseRecord, KnowledgeDiagnostic, Note, Profile, WorkspaceMembershipSummary, WorkspaceRoleContract } from "@nexus/contracts";
import { AuthClient, AuthGate } from "../auth";
import { ApiClient } from "../data/api-client";
import { ProfileClient } from "../data/profile-client";
import { OperationsClient } from "../data/operations-client";
import { AccountCenter } from "../account";
import { CollaborationClient } from "../data/collaboration-client";
import { AIChatPanel } from "../ai/AIChatPanel";
import { KnowledgeClient } from "../data/knowledge-client";
import { NotesClient } from "../data/notes-client";
import { KnowledgeRecoveryPanel, type RecoveryDiagnostic, type RecoveryFilters } from "../knowledge/KnowledgeRecoveryPanel";
import type { ServiceWorkerUpdate } from "../data/service-worker";
import { AdaptiveWorkbench } from "../layout/AdaptiveWorkbench";
import { DatabaseClient, type DatabaseBundle } from "../data/database-client";
import { BetaLocalStore } from "../data/local-store";
import { NoteDraftController, type DraftSyncResult, type NoteDraftStore } from "../notes/note-draft-controller";
import { NormalizedCache } from "../data/normalized-cache";
import { ProductNavigation, type AccountSubsection, type ProductDomain } from "../navigation/ProductNavigation";
import { QuickCapturePanel } from "../notes/QuickCapturePanel";
import {
  CollaborationCenter,
  InviteRedemptionPage,
  NotificationCenter,
  PublicSharePage,
  notificationButtonLabel,
  type CollaborationCommentTarget,
  type CollaborationShareTarget,
  type NotificationTarget,
} from "../collaboration";

const LazyDatabaseWorkbench = lazy(async () => {
  const module = await import("../databases/DatabaseWorkbench");
  return { default: module.DatabaseWorkbench };
});

const defaultAuthClient = new AuthClient(new ApiClient());
const initialRecoveryFilters: RecoveryFilters = { mimeType: "", ocrStatus: "" };
type OcrStatus = NonNullable<Attachment["ocr_status"]>;
type AppRoute =
  | { kind: "workspace"; workspaceId?: string }
  | { kind: "invite"; token: string }
  | { kind: "share"; token: string };
type NoteListView = "all" | "inbox" | "today" | "trash";
type WorkspaceRouteAuthority = { userId: string; workspaceId: string };
type UserScopedLocalStore = NoteDraftStore & { destroy(): Promise<void> };
type LogoutPhase = "idle" | "quiescing" | "cleanup" | "cleanup-error";

function localDateKey(date = new Date()) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

function noteMatchesListView(note: Note, view: NoteListView, todayDate = localDateKey()) {
  if (view === "trash") return note.status === "trashed";
  if (note.status !== "active") return false;
  if (view === "inbox") return note.folder_id === null;
  if (view === "today") return note.daily_date === todayDate;
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
  onDeleted(): void;
  onDiagnosticNavigate?: (diagnostic: KnowledgeDiagnostic) => void;
}) {
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [activePane, setActivePane] = useState<"context" | "canvas">("canvas");
  const [activeDomain, setActiveDomain] = useState<ProductDomain>("notes");
  const [accountSubsection, setAccountSubsection] = useState<AccountSubsection>("personal");
  const [collaborationClient] = useState(() => new CollaborationClient(apiClient, workspaceId ?? ""));
  const [operationsClient] = useState(() => new OperationsClient(apiClient, workspaceId ?? ""));
  const [profileClient] = useState(() => new ProfileClient(apiClient));
  const [navigationUser, setNavigationUser] = useState(user);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [notes, setNotes] = useState<Note[]>([]);
  const [notesLoading, setNotesLoading] = useState(Boolean(workspaceId));
  const [notesError, setNotesError] = useState<string | null>(null);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [quickCaptureOpen, setQuickCaptureOpen] = useState(false);
  const [noteListView, setNoteListView] = useState<NoteListView>("all");
  const [creatingNote, setCreatingNote] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftContent, setDraftContent] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteMessage, setNoteMessage] = useState<string | null>(null);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [permanentDeleteOpen, setPermanentDeleteOpen] = useState(false);
  const [permanentDeletePending, setPermanentDeletePending] = useState(false);
  const [permanentDeleteError, setPermanentDeleteError] = useState<string | null>(null);
  const [activeDraftId, setActiveDraftId] = useState<string | null>(null);
  const [serverRetryVersion, setServerRetryVersion] = useState(0);
  const [pendingReconcile, setPendingReconcile] = useState<{ workspaceId: string; entityId: string; result: DraftSyncResult } | null>(null);
  const [selectedDatabaseRecordId, setSelectedDatabaseRecordId] = useState<string | null>(null);
  const [selectedCommentId, setSelectedCommentId] = useState<string | null>(null);
  const [collaborationInitialSection, setCollaborationInitialSection] = useState<"people" | "comments">("people");
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
  const attachmentQueryIdentity = useRef<string | null>(null);
  const inspectorOpenerRef = useRef<HTMLElement | null>(null);
  const notificationOpenerRef = useRef<HTMLElement | null>(null);
  const notificationTargetController = useRef<AbortController | null>(null);
  const noteListViewRef = useRef<NoteListView>(noteListView);
  const [draftController] = useState(() => {
    return new NoteDraftController(localStore);
  });
  const activeDraftIdRef = useRef<string | null>(null);
  const activationInFlight = useRef(false);
  const userSelectedNote = useRef(false);
  const draftTitleRef = useRef("");
  const draftContentRef = useRef("");
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const permanentDeleteOpenerRef = useRef<HTMLButtonElement | null>(null);
  const permanentDeleteDialogRef = useRef<HTMLDivElement | null>(null);
  const permanentDeleteCancelRef = useRef<HTMLButtonElement | null>(null);
  const permanentDeletePendingRef = useRef(false);
  const permanentDeleteWasOpenRef = useRef(false);
  const focusInstalledNoteRef = useRef(false);
  const installedNotesRef = useRef(new Map<string, Note>());
  const mountedRef = useRef(true);
  const selectedNote = notes.find((note) => note.id === selectedNoteId) ?? null;
  permanentDeletePendingRef.current = permanentDeletePending;
  const noteTargets = notes.map((note) => ({
    type: "note" as const,
    id: note.id,
    label: note.title.trim() || "未命名笔记",
  }));
  const userId = user.id;

  useEffect(() => {
    draftControllerRef.current = draftController;
    return () => {
      if (draftControllerRef.current === draftController) draftControllerRef.current = null;
    };
  }, [draftController, draftControllerRef]);

  useEffect(() => {
    if (!inspectorOpen && inspectorOpenerRef.current) {
      inspectorOpenerRef.current.focus();
      inspectorOpenerRef.current = null;
    }
  }, [inspectorOpen]);

  useLayoutEffect(() => {
    if (!permanentDeleteOpen) {
      if (permanentDeleteWasOpenRef.current) {
        permanentDeleteOpenerRef.current?.focus();
        permanentDeleteWasOpenRef.current = false;
      }
      return undefined;
    }
    permanentDeleteWasOpenRef.current = true;
    permanentDeleteCancelRef.current?.focus();
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (!permanentDeletePendingRef.current) setPermanentDeleteOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const dialog = permanentDeleteDialogRef.current;
      if (!dialog) return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>("button:not([disabled])")];
      if (!focusable.length) return;
      const activeIndex = focusable.indexOf(document.activeElement as HTMLElement);
      const nextIndex = event.shiftKey
        ? activeIndex <= 0 ? focusable.length - 1 : activeIndex - 1
        : activeIndex < 0 || activeIndex === focusable.length - 1 ? 0 : activeIndex + 1;
      event.preventDefault();
      focusable[nextIndex]!.focus();
    };
    document.addEventListener("keydown", trapFocus);
    return () => document.removeEventListener("keydown", trapFocus);
  }, [permanentDeleteOpen]);

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

  const startNewNote = () => {
    if (logoutPending || !workspaceId || activationInFlight.current || activeDraftIdRef.current) return false;
    activationInFlight.current = true;
    userSelectedNote.current = true;
    setNoteError(null);
    void draftController.create(workspaceId).then((draft) => {
      activeDraftIdRef.current = draft.entity_id;
      draftTitleRef.current = draft.title;
      draftContentRef.current = draft.content;
      setActiveDraftId(draft.entity_id);
      setSelectedNoteId(null);
      setCreatingNote(true);
      setDraftTitle(draft.title);
      setDraftContent(draft.content);
      setNoteMessage(null);
      setNoteError(null);
      setActiveDomain("notes");
      setActivePane("canvas");
    }).catch(() => {
      setNotesError("本地草稿保存失败，未创建临时笔记。请重试。");
    }).finally(() => {
      activationInFlight.current = false;
    });
    return true;
  };

  const selectNote = (note: Note) => {
    activeDraftIdRef.current = null;
    setActiveDraftId(null);
    userSelectedNote.current = true;
    setNoteSaving(false);
    setSelectedNoteId(note.id);
    setCreatingNote(false);
    setDraftTitle(note.title);
    setDraftContent(note.content);
    draftTitleRef.current = note.title;
    draftContentRef.current = note.content;
    setNoteMessage(null);
    setNoteError(null);
    setSelectedDatabaseRecordId(null);
    setSelectedCommentId(null);
    setResolvedNotificationRecord(null);
    setActivePane("canvas");
  };

  const handleQuickCapture = (note: Note) => {
    setNotes((current) => [note, ...current.filter((item) => item.id !== note.id)]);
    setQuickCaptureOpen(false);
    selectNote(note);
  };

  const changeNoteListView = (view: NoteListView) => {
    if (view === noteListView) return;
    noteListViewRef.current = view;
    setNoteListView(view);
    setActivePane("context");
    if (!activeDraftIdRef.current) {
      userSelectedNote.current = false;
      setSelectedNoteId(null);
      setCreatingNote(false);
      setDraftTitle("");
      setDraftContent("");
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
    const client = new NotesClient(apiClient, workspaceId);
    const request = client.update(selectedNote.id, {
        base_revision: selectedNote.revision,
        title: draftTitle,
        content: draftContent,
        source: "manual",
      });
    void request.then((saved) => {
      setNotes((current) => [saved, ...current.filter((note) => note.id !== saved.id)]);
      setSelectedNoteId(saved.id);
      setCreatingNote(false);
      setDraftTitle(saved.title);
      setDraftContent(saved.content);
      draftTitleRef.current = saved.title;
      draftContentRef.current = saved.content;
      setNoteMessage("已保存");
    }).catch(() => {
      setNoteError("笔记保存失败，请稍后重试。未保存的内容仍保留在当前编辑器中。");
    }).finally(() => setNoteSaving(false));
  };

  const changeSelectedNoteStatus = (status: "active" | "trashed") => {
    if (logoutPending || !workspaceId || noteSaving || !selectedNote) return;
    setNoteSaving(true);
    setNoteMessage(null);
    setNoteError(null);
    const contentChanged = draftTitle !== selectedNote.title || draftContent !== selectedNote.content;
    void new NotesClient(apiClient, workspaceId).update(selectedNote.id, {
      base_revision: selectedNote.revision,
      status,
      source: "manual",
      ...(contentChanged ? { title: draftTitle, content: draftContent } : {}),
    }).then((saved) => {
      const nextView: NoteListView = status === "trashed" ? "trash" : "all";
      noteListViewRef.current = nextView;
      installedNotesRef.current.set(saved.id, saved);
      setNoteListView(nextView);
      setNotes((current) => [saved, ...current.filter((note) => note.id !== saved.id)]);
      setSelectedNoteId(saved.id);
      setCreatingNote(false);
      setDraftTitle(saved.title);
      setDraftContent(saved.content);
      draftTitleRef.current = saved.title;
      draftContentRef.current = saved.content;
      setNoteMessage(status === "trashed" ? "已移入回收站" : "已恢复");
      setActivePane("canvas");
    }).catch(() => {
      setNoteError(status === "trashed" ? "移入回收站失败，请稍后重试。" : "恢复笔记失败，请稍后重试。");
    }).finally(() => setNoteSaving(false));
  };

  const openPermanentDelete = (opener: HTMLButtonElement) => {
    if (logoutPending || !selectedNote || selectedNote.status !== "trashed") return;
    permanentDeleteOpenerRef.current = opener;
    setPermanentDeleteError(null);
    setPermanentDeleteOpen(true);
  };

  const deleteSelectedNotePermanently = () => {
    if (logoutPending || permanentDeletePending || !workspaceId || !selectedNote || selectedNote.status !== "trashed") return;
    setPermanentDeletePending(true);
    setPermanentDeleteError(null);
    void new NotesClient(apiClient, workspaceId).deletePermanently(selectedNote.id, {
      base_revision: selectedNote.revision,
    }).then(() => {
      setNotes((current) => current.filter((note) => note.id !== selectedNote.id));
      setSelectedNoteId(null);
      setDraftTitle("");
      setDraftContent("");
      draftTitleRef.current = "";
      draftContentRef.current = "";
      setNoteMessage("笔记已永久删除");
      setPermanentDeleteOpen(false);
    }).catch(() => {
      setPermanentDeleteError("永久删除失败，请重试。笔记仍保留在回收站中。");
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
    draftTitleRef.current = result.note.title;
    draftContentRef.current = result.note.content;
    setNoteMessage("已保存");
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

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "n" || (!event.ctrlKey && !event.metaKey) || event.repeat || isEditableTarget(event.target)) return;
      if (startNewNote()) event.preventDefault();
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [logoutPending, workspaceId]);

  useEffect(() => {
    if (logoutPending || !workspaceId || !activeDraftId) return undefined;
    const draftId = activeDraftId;
    let active = true;
    setNoteSaving(true);
    setNoteError(null);
    void draftController.sync(workspaceId, draftId, new NotesClient(apiClient, workspaceId)).then((result) => {
      installSyncedDraft(workspaceId, draftId, result);
    }).catch(() => {
      if (active && mountedRef.current && activeDraftIdRef.current === draftId) {
        setNoteError("笔记同步失败，草稿仍保留在本地。请重试。");
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
      void draftController.sync(workspaceId, entityId, new NotesClient(apiClient, workspaceId)).then((next) => {
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

  useEffect(() => {
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
      return undefined;
    }
    const controller = new AbortController();
    setNotesLoading(true);
    setNotesError(null);
    const todayDate = localDateKey();
    const listOptions = noteListView === "inbox"
      ? { status: "active" as const, folderId: null, limit: 50, signal: controller.signal }
      : noteListView === "today"
        ? { status: "active" as const, dailyDate: todayDate, limit: 50, signal: controller.signal }
        : noteListView === "trash"
          ? { status: "trashed" as const, limit: 50, signal: controller.signal }
          : { status: "active" as const, limit: 50, signal: controller.signal };
    void new NotesClient(apiClient, workspaceId).list(listOptions).then((page) => {
      if (controller.signal.aborted) return;
      const activeNotes = page.items.filter((note) => noteMatchesListView(note, noteListView, todayDate));
      const installedNotes = [...installedNotesRef.current.values()]
        .filter((note) => note.workspace_id === workspaceId && noteMatchesListView(note, noteListView, todayDate));
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
  }, [apiClient, noteListView, workspaceId]);

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
      setActiveDomain("notes");
      setActivePane("canvas");
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
      draftTitleRef.current = selectedNote.title;
      draftContentRef.current = selectedNote.content;
    } else {
      setDraftTitle("");
      setDraftContent("");
      draftTitleRef.current = "";
      draftContentRef.current = "";
    }
  }, [creatingNote, selectedNote]);

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
    const knowledge = new KnowledgeClient(apiClient, workspaceId);
    void Promise.allSettled([
      knowledge.listAttachments({
        mime_type: (filters.mimeType as Attachment["mime_type"]) || undefined,
        ocr_status: (filters.ocrStatus as OcrStatus) || undefined,
        limit: 50,
      }, controller.signal),
      knowledge.getKnowledgeDiagnostics({ limit: 50 }, controller.signal),
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
  }, [apiClient, workspaceId, filters.mimeType, filters.ocrStatus, refreshVersion]);

  useEffect(() => {
    if (activeDomain !== "databases") return undefined;
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
    const client = new DatabaseClient(apiClient, workspaceId);
    setDatabaseLoading(true);
    setDatabaseError(null);
    void client.listDatabases(controller.signal).then((items) => {
      if (controller.signal.aborted) return;
      setDatabases(items);
      setSelectedDatabaseId((current) => items.some((database) => database.id === current) ? current : items[0]?.id ?? null);
    }).catch((error: unknown) => {
      if (!isAborted(error, controller.signal)) setDatabaseError("数据库列表暂时无法加载。");
    }).finally(() => {
      databaseControllers.current.delete(controller);
      if (!controller.signal.aborted) setDatabaseLoading(false);
    });
    return () => controller.abort();
  }, [activeDomain, apiClient, databaseRefreshVersion, workspaceId]);

  useEffect(() => {
    if (activeDomain !== "databases" || !workspaceId || !selectedDatabaseId) {
      if (!selectedDatabaseId) {
        setDatabaseBundle(null);
        setDatabaseRecords([]);
        setDatabaseRecordsNextCursor(null);
      }
      return undefined;
    }
    const controller = createDatabaseRequest();
    const client = new DatabaseClient(apiClient, workspaceId);
    setDatabaseLoading(true);
    setDatabaseError(null);
    setDatabaseBundle(null);
    setDatabaseRecords([]);
    setDatabaseRecordsNextCursor(null);
    void client.getDatabase(selectedDatabaseId, controller.signal).then(async (bundle) => {
      const page = await client.listRecords(selectedDatabaseId, {
        // The first bounded page must align with the active saved view's cursor chain.
        viewId: bundle.views[0]?.id,
        limit: bundle.views[0]?.config.page_size ?? 50,
        signal: controller.signal,
      });
      return [bundle, page] as const;
    }).then(([bundle, page]) => {
      if (controller.signal.aborted) return;
      const targetRecord = resolvedNotificationRecord?.database_id === bundle.database.id
        && !page.items.some((record) => record.id === resolvedNotificationRecord.id)
        ? resolvedNotificationRecord
        : null;
      const records = targetRecord ? [targetRecord, ...page.items] : page.items;
      setDatabaseBundle(bundle);
      setDatabaseRecords(records);
      setDatabaseRecordsNextCursor(page.next_cursor);
      setSelectedDatabaseRecordId((current) => current ?? records[0]?.id ?? null);
      databaseCache.current.writeEntity({ workspaceId, type: "database", id: bundle.database.id, revision: bundle.database.revision, data: bundle.database });
      for (const property of bundle.properties) {
        databaseCache.current.writeEntity({ workspaceId, type: "database-property", id: property.id, revision: property.revision, data: property });
      }
      for (const record of records) {
        databaseCache.current.writeEntity({ workspaceId, type: "database-record", id: record.id, revision: record.revision, data: record });
      }
    }).catch((error: unknown) => {
      if (!isAborted(error, controller.signal)) setDatabaseError("数据库内容暂时无法加载。");
    }).finally(() => {
      databaseControllers.current.delete(controller);
      if (!controller.signal.aborted) setDatabaseLoading(false);
    });
    return () => controller.abort();
  }, [activeDomain, apiClient, databaseRefreshVersion, resolvedNotificationRecord, selectedDatabaseId, workspaceId]);

  const requestDatabasePage = useCallback(({ cursor, limit, viewId, signal }: { cursor: string | null; limit: number; viewId?: string; signal?: AbortSignal }) => {
    if (!workspaceId || !selectedDatabaseId) return Promise.resolve({ items: [], next_cursor: null });
    return new DatabaseClient(apiClient, workspaceId).listRecords(selectedDatabaseId, { cursor: cursor ?? undefined, viewId, limit, signal });
  }, [apiClient, selectedDatabaseId, workspaceId]);

  const createDatabaseFromName = (name: string) => {
    if (!workspaceId || !name.trim() || creatingFirstDatabase) return;
    setCreatingFirstDatabase(true);
    setDatabaseError(null);
    void new DatabaseClient(apiClient, workspaceId).createDatabase({ name: name.trim(), description: "" }).then((created) => {
      setDatabases((current) => [...current, created]);
      setSelectedDatabaseId(created.id);
      setFirstDatabaseName("");
      setDatabaseCreateOpen(false);
      setActivePane("canvas");
    }).catch(() => setDatabaseError("数据库暂时无法创建，请稍后重试。"))
      .finally(() => setCreatingFirstDatabase(false));
  };

  const createFirstDatabase = () => createDatabaseFromName(firstDatabaseName);

  const loadMoreAttachments = () => {
    if (!workspaceId || !attachmentCursor || loading || refreshing) return;
    const controller = createRecoveryRequest();
    setRefreshing(true);
    const knowledge = new KnowledgeClient(apiClient, workspaceId);
    void knowledge.listAttachments({
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
    const knowledge = new KnowledgeClient(apiClient, workspaceId);
    void knowledge.getKnowledgeDiagnostics({ cursor: diagnosticCursor, limit: 50 }, controller.signal).then((page) => {
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
    const knowledge = new KnowledgeClient(apiClient, workspaceId);
    const controller = createRetryRequest();
    const retry = ids.length === 1
      ? knowledge.retryAttachmentOcr(ids[0], controller.signal)
      : knowledge.retryAttachmentOcrBatch(ids, controller.signal);
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

  const changeDomain = (domain: ProductDomain) => {
    if (domain === "collaboration") setCollaborationInitialSection("people");
    setActiveDomain(domain);
    setActivePane("canvas");
  };
  useEffect(() => {
    setNavigationUser((current) => current.id === user.id && current.email === user.email && current.displayName === user.displayName ? current : user);
  }, [user.displayName, user.email, user.id]);
  const handleProfileChange = (next: Profile) => {
    setNavigationUser((current) => ({ ...current, email: next.email, displayName: next.display_name || next.email }));
  };
  const openAccountSubsection = (subsection: AccountSubsection) => {
    setAccountSubsection(subsection);
    changeDomain("account");
  };
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
    active: activeDomain,
    user: navigationUser,
    unreadCount,
    collaborationEnabled,
    notificationsEnabled: Boolean(collaborationEnabled && workspaceId),
    contextOpen: activePane === "context",
    logoutPending,
    onChange: changeDomain,
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
  const mobileCreateAction = activeDomain === "notes" && activePane !== "context" ? (
    <button className="mobile-create-note-button" type="button" aria-label="新建笔记" disabled={logoutPending} onClick={startNewNote}>
      <Plus aria-hidden="true" size={20} />
      <span>新建笔记</span>
    </button>
  ) : null;
  const desktopCreateAction = activeDomain === "notes" && activePane !== "context" ? (
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
  ) : null;

  const contextualList = (
    <div className="context-content">
      <div className="context-heading">
        <div><small>CREATE</small><h2>所有笔记</h2></div>
        <div className="context-heading-actions">
          <button className="secondary-create-note" type="button" aria-label="快速捕获" onClick={() => setQuickCaptureOpen(true)}>
            <span>快速捕获</span>
          </button>
          <button className="primary-create-note" type="button" aria-label="新建笔记" disabled={logoutPending} onClick={startNewNote}>
            <Plus aria-hidden="true" size={17} />
            <span>新建笔记</span>
          </button>
        </div>
      </div>
      <nav className="note-list-views" aria-label="笔记视图">
        {([["all", "全部"], ["inbox", "收件箱"], ["today", "今日"], ["trash", "回收站"]] as const).map(([view, label]) => (
          <button key={view} type="button" aria-pressed={noteListView === view} className={noteListView === view ? "active" : ""} onClick={() => changeNoteListView(view)}>{label}</button>
        ))}
      </nav>
      <label className="search-field"><Search size={15} /><input aria-label="搜索笔记" placeholder="搜索笔记" /></label>
      {notesLoading ? <p className="database-empty" role="status">正在加载笔记…</p> : null}
      {notesError ? <p className="database-operation-error" role="alert">{notesError}</p> : null}
      {!notesLoading && notes.length === 0 ? (
        <div className="note-empty-state">
          <p className="database-empty">暂无笔记，开始记录你的想法。</p>
          <button className="primary-create-note note-empty-create-note" type="button" aria-label="新建笔记" disabled={logoutPending} onClick={startNewNote}>
            <Plus aria-hidden="true" size={17} />
            <span>新建笔记</span>
          </button>
        </div>
      ) : null}
      {notes.map((note) => (
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
      attachmentNextCursor={attachmentCursor}
      diagnosticNextCursor={diagnosticCursor}
      onRetry={(id) => retryAttachments([id])}
      onBatchRetry={retryAttachments}
      onRecover={(diagnostic) => {
        onDiagnosticNavigate?.(diagnostic as KnowledgeDiagnostic);
        setActivePane("context");
      }}
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
        client={new DatabaseClient(apiClient, workspaceId)}
        onMutation={() => setDatabaseRefreshVersion((version) => version + 1)}
        onRecordsPageRequest={requestDatabasePage}
        onBoardMove={(input) => new DatabaseClient(apiClient, workspaceId).boardMove(databaseBundle.database.id, input)}
        onCalendarAssign={(input) => new DatabaseClient(apiClient, workspaceId).calendarAssign(databaseBundle.database.id, input)}
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
      <p className="eyebrow">KNOWLEDGE RECOVERY</p>
      <h1>知识恢复</h1>
      <p className="product-domain-lead">集中处理附件 OCR 状态与知识诊断。</p>
      {recoveryPanel}
    </section>
  );
  const aiCanvas = <AIChatPanel client={apiClient} workspaceId={workspaceId ?? ""} />;
  const accountCanvas = (
    <AccountCenter
      client={profileClient}
      collaboration={collaborationClient}
      operations={operationsClient}
      workspaces={workspaces}
      activeWorkspaceId={activeWorkspaceId}
      currentUserId={userId}
      initialTab={accountSubsection === "workspace" ? "workspace" : "profile"}
      onWorkspaceChange={changeWorkspace}
      onPrepareDelete={() => draftController.quiesce()}
      onDeleteFailed={() => draftController.resume()}
      onDeleted={onDeleted}
      onProfileChange={handleProfileChange}
    />
  );
  const collaborationUnavailableCanvas = (
    <section className="product-domain-page product-status-page">
      <p className="eyebrow">COLLABORATION</p>
      <h1>协作功能当前不可用</h1>
      <p className="product-domain-lead">当前没有可用工作区或协作能力。选择其他产品区域不会更改你的笔记数据。</p>
    </section>
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
      setActiveDomain("collaboration");
      setActivePane("canvas");
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
      setActiveDomain("collaboration");
      setActivePane("canvas");
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
    void resolveDatabaseNotificationTarget(new DatabaseClient(apiClient, workspaceId), target, controller.signal).then(({ database, databases: availableDatabases, record }) => {
      if (!controller.signal.aborted) selectTarget(availableDatabases, database, record);
    }).catch((error: unknown) => {
      if (isAborted(error, controller.signal)) return;
      setSelectedDatabaseRecordId(target.targetId);
      setResolvedNotificationRecord(null);
      setSelectedCommentId(target.commentId);
      setDatabaseError("无法定位通知中的数据库记录。");
      setCollaborationInitialSection("comments");
      setActiveDomain("collaboration");
      setActivePane("canvas");
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
      <AdaptiveWorkbench
        navigation={navigation}
        mobileNavigation={mobileNavigation}
        mobileCreateAction={mobileCreateAction}
        desktopCreateAction={desktopCreateAction}
        contextualList={activeDomain === "databases" ? databaseContextualList : activeDomain === "notes" ? contextualList : undefined}
        inspector={<div className="inspector-content"><small>页面信息</small><h3>{inspectorTitle}</h3><p>属性、版本与协作状态只在需要时显示。</p></div>}
        inspectorOpen={inspectorOpen}
        activePane={activePane}
        onActivePaneChange={setActivePane}
        onInspectorOpen={openInspector}
        onInspectorClose={closeInspector}
      >
        <>
        {activeDomain === "collaboration" ? collaborationEnabled && workspaceId ? <CollaborationCenter client={collaborationClient} workspaceId={workspaceId} userId={userId} role={role} initialSection={collaborationInitialSection} activeTarget={activeCollaborationTarget} selectedCommentId={selectedCommentId} commentTargets={commentTargets} shareTargets={shareTargets} /> : collaborationUnavailableCanvas : activeDomain === "databases" ? databaseCanvas : activeDomain === "knowledge" ? knowledgeCanvas : activeDomain === "ai" ? aiCanvas : activeDomain === "account" ? accountCanvas : selectedNote || creatingNote ? <article className="editor-document">
          <header className="editor-toolbar">
            <span className="saved-state" role="status" aria-live="polite"><span /> {noteSaving ? "保存中…" : noteMessage ?? "未保存更改"}</span>
            <div>
              <button type="button" aria-label={notificationButtonLabel(unreadCount)} onClick={(event) => toggleNotifications(event.currentTarget)}><Bell aria-hidden="true" size={17} /></button>
              <button type="button" aria-label="打开检查器" onClick={(event) => openInspector(event.currentTarget)}><Boxes size={17} /></button>
            </div>
          </header>
          <div className="editor-copy">
            <p className="eyebrow">NEXUS NOTES / PUBLIC BETA</p>
            <h1>{draftTitle.trim() || "未命名笔记"}</h1>
            <label className="note-editor-field">标题<input ref={titleInputRef} aria-label="笔记标题" disabled={logoutPending || selectedNote?.status === "trashed"} value={draftTitle} onChange={(event) => updateActiveDraftInput(event.target.value, draftContentRef.current)} /></label>
            <label className="note-editor-field">内容<textarea aria-label="笔记内容" disabled={logoutPending || selectedNote?.status === "trashed"} value={draftContent} onChange={(event) => updateActiveDraftInput(draftTitleRef.current, event.target.value)} /></label>
            <div className="note-editor-actions">
              {selectedNote?.status !== "trashed" ? (
                <button type="button" disabled={logoutPending || noteSaving || (!creatingNote && !draftTitle.trim() && !draftContent.trim())} onClick={saveNote}>{creatingNote && noteError ? "重试同步" : "保存笔记"}</button>
              ) : null}
              {!creatingNote && selectedNote ? (
                <button type="button" className="note-lifecycle-action" disabled={logoutPending || noteSaving} onClick={() => changeSelectedNoteStatus(selectedNote.status === "trashed" ? "active" : "trashed")}>
                  {selectedNote.status === "trashed" ? "恢复笔记" : "移入回收站"}
                </button>
              ) : null}
              {selectedNote?.status === "trashed" ? (
                <button type="button" className="note-lifecycle-action note-lifecycle-danger" disabled={logoutPending || noteSaving || permanentDeletePending} onClick={(event) => openPermanentDelete(event.currentTarget)}>永久删除</button>
              ) : null}
              {noteMessage ? <p role="status">{noteMessage}</p> : null}
              {noteError ? <p className="database-operation-error" role="alert">{noteError}</p> : null}
            </div>
            <p className="note-content-preview" aria-label="笔记内容预览">{draftContent || "开始记录你的想法。"}</p>
            {recoveryPanel}
          </div>
        </article> : <article className="editor-document">
          <header className="editor-toolbar">
            <span className="saved-state" role="status" aria-live="polite"><span /> 已保存</span>
            <div>
              <button type="button" aria-label={notificationButtonLabel(unreadCount)} onClick={(event) => toggleNotifications(event.currentTarget)}><Bell aria-hidden="true" size={17} /></button>
              <button type="button" aria-label="打开检查器" onClick={(event) => openInspector(event.currentTarget)}><Boxes size={17} /></button>
            </div>
          </header>
          <div className="editor-copy">
            <p className="eyebrow">NEXUS NOTES / PUBLIC BETA</p>
            <h1>Public Beta 重写计划</h1>
            <p className="lead">一个稳定、响应迅速、离线可恢复的知识工作台。</p>
            <hr />
            <h2>自适应工作台</h2>
            <p>导航保持轻量，列表按需出现，主画布获得最多空间，检查器不再永久挤压编辑区域。</p>
            <div className="callout"><Sparkles size={18} /><p>视觉风格继续使用原有蓝色强调、玻璃层级和舒适圆角。</p></div>
            {recoveryPanel}
          </div>
        </article>}
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
      </AdaptiveWorkbench>
      {quickCaptureOpen && workspaceId ? (
        <div className="quick-capture-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setQuickCaptureOpen(false); }}>
          <div className="quick-capture-dialog" role="dialog" aria-modal="true" aria-labelledby="quick-capture-title" onMouseDown={(event) => event.stopPropagation()}>
            <QuickCapturePanel client={new NotesClient(apiClient, workspaceId)} onClose={() => setQuickCaptureOpen(false)} onCaptured={handleQuickCapture} />
          </div>
        </div>
      ) : null}
      {permanentDeleteOpen && selectedNote ? (
        <div className="account-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !permanentDeletePending) setPermanentDeleteOpen(false); }}>
          <div ref={permanentDeleteDialogRef} className="account-confirm-dialog" role="dialog" aria-modal="true" aria-label="永久删除笔记">
            <h3>永久删除笔记</h3>
            <p>此操作不可撤销。笔记、其评论和公开分享链接将被永久删除。</p>
            {permanentDeleteError ? <p className="account-error" role="alert">{permanentDeleteError}</p> : null}
            <div className="account-actions">
              <button ref={permanentDeleteCancelRef} type="button" disabled={permanentDeletePending} onClick={() => setPermanentDeleteOpen(false)}>取消</button>
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
      {(session) => {
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
              onDeleted={accountDeleted}
              onDiagnosticNavigate={onDiagnosticNavigate}
            />
          )}
        </WorkspaceSessionBoundary>;
      }}
    </AuthGate>
  );
}
