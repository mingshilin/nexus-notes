import {
  Bell,
  BookOpen,
  Boxes,
  Inbox,
  PanelLeft,
  Search,
  Settings,
  Sparkles,
  Users,
} from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import type { Attachment, Database, DatabaseRecord, KnowledgeDiagnostic, Note, WorkspaceRoleContract } from "@nexus/contracts";
import { AuthClient, AuthGate } from "../auth";
import { ApiClient } from "../data/api-client";
import { CollaborationClient } from "../data/collaboration-client";
import { KnowledgeClient } from "../data/knowledge-client";
import { NotesClient } from "../data/notes-client";
import { KnowledgeRecoveryPanel, type RecoveryDiagnostic, type RecoveryFilters } from "../knowledge/KnowledgeRecoveryPanel";
import type { ServiceWorkerUpdate } from "../data/service-worker";
import { AdaptiveWorkbench } from "../layout/AdaptiveWorkbench";
import { DatabaseClient, type DatabaseBundle } from "../data/database-client";
import { NormalizedCache } from "../data/normalized-cache";
import {
  CollaborationCenter,
  InviteRedemptionPage,
  NotificationButton,
  NotificationCenter,
  PublicSharePage,
  notificationButtonLabel,
  type CollaborationCommentTarget,
  type CollaborationShareTarget,
  type NotificationTarget,
} from "../collaboration";

const domains = [
  { label: "收集", icon: Inbox, target: "notes" as const },
  { label: "创作", icon: BookOpen, target: "notes" as const },
  { label: "整理", icon: Search, target: "notes" as const },
  { label: "协作", icon: Users, target: "collaboration" as const },
  { label: "运营", icon: Settings, target: "notes" as const },
  { label: "数据库", icon: Boxes, target: "databases" as const },
];

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

function AuthenticatedWorkspace({
  apiClient,
  workspaceId,
  userId,
  role,
  collaborationEnabled,
  onDiagnosticNavigate,
}: {
  apiClient: ApiClient;
  workspaceId?: string;
  userId: string;
  role: WorkspaceRoleContract;
  collaborationEnabled: boolean;
  onDiagnosticNavigate?: (diagnostic: KnowledgeDiagnostic) => void;
}) {
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [activePane, setActivePane] = useState<"context" | "canvas">("canvas");
  const [activeDomain, setActiveDomain] = useState<"notes" | "databases" | "collaboration">("notes");
  const [collaborationClient] = useState(() => new CollaborationClient(apiClient, workspaceId ?? ""));
  const [unreadCount, setUnreadCount] = useState(0);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [notes, setNotes] = useState<Note[]>([]);
  const [notesLoading, setNotesLoading] = useState(Boolean(workspaceId));
  const [notesError, setNotesError] = useState<string | null>(null);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [creatingNote, setCreatingNote] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftContent, setDraftContent] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteMessage, setNoteMessage] = useState<string | null>(null);
  const [noteError, setNoteError] = useState<string | null>(null);
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
  const selectedNote = notes.find((note) => note.id === selectedNoteId) ?? null;
  const noteTargets = notes.map((note) => ({
    type: "note" as const,
    id: note.id,
    label: note.title.trim() || "未命名笔记",
  }));

  useEffect(() => {
    if (!inspectorOpen && inspectorOpenerRef.current) {
      inspectorOpenerRef.current.focus();
      inspectorOpenerRef.current = null;
    }
  }, [inspectorOpen]);

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
    setSelectedNoteId(null);
    setCreatingNote(true);
    setDraftTitle("");
    setDraftContent("");
    setNoteMessage(null);
    setNoteError(null);
    setActiveDomain("notes");
    setActivePane("canvas");
  };

  const selectNote = (note: Note) => {
    setSelectedNoteId(note.id);
    setCreatingNote(false);
    setDraftTitle(note.title);
    setDraftContent(note.content);
    setNoteMessage(null);
    setNoteError(null);
    setSelectedDatabaseRecordId(null);
    setSelectedCommentId(null);
    setResolvedNotificationRecord(null);
    setActivePane("canvas");
  };

  const saveNote = () => {
    if (!workspaceId || noteSaving || (!creatingNote && !selectedNote)) return;
    setNoteSaving(true);
    setNoteMessage(null);
    setNoteError(null);
    const client = new NotesClient(apiClient, workspaceId);
    const request = creatingNote || !selectedNote
      ? client.create({ title: draftTitle, content: draftContent })
      : client.update(selectedNote.id, {
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
      setNoteMessage("已保存");
    }).catch(() => {
      setNoteError("笔记保存失败，请稍后重试。未保存的内容仍保留在当前编辑器中。");
    }).finally(() => setNoteSaving(false));
  };

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
    void new NotesClient(apiClient, workspaceId).list({ limit: 50, signal: controller.signal }).then((page) => {
      if (controller.signal.aborted) return;
      const activeNotes = page.items.filter((note) => note.status === "active");
      setNotes(activeNotes);
      setSelectedNoteId((current) => activeNotes.some((note) => note.id === current) ? current : activeNotes[0]?.id ?? null);
      setCreatingNote(false);
    }).catch((error: unknown) => {
      if (!isAborted(error, controller.signal)) setNotesError("笔记列表暂时无法加载。你仍可以尝试新建笔记。");
    }).finally(() => {
      if (!controller.signal.aborted) setNotesLoading(false);
    });
    return () => controller.abort();
  }, [apiClient, workspaceId]);

  useEffect(() => {
    if (creatingNote) return;
    if (selectedNote) {
      setDraftTitle(selectedNote.title);
      setDraftContent(selectedNote.content);
    } else {
      setDraftTitle("");
      setDraftContent("");
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

  const createFirstDatabase = () => {
    if (!workspaceId || !firstDatabaseName.trim() || creatingFirstDatabase) return;
    setCreatingFirstDatabase(true);
    setDatabaseError(null);
    void new DatabaseClient(apiClient, workspaceId).createDatabase({ name: firstDatabaseName.trim(), description: "" }).then((created) => {
      setDatabases((current) => [...current, created]);
      setSelectedDatabaseId(created.id);
      setFirstDatabaseName("");
    }).catch(() => setDatabaseError("数据库暂时无法创建，请稍后重试。"))
      .finally(() => setCreatingFirstDatabase(false));
  };

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

  const navigation = (
    <>
      <div className="brand-mark" aria-label="Nexus Notes">N</div>
      {domains.map(({ label, icon: Icon, target }, index) => (
        <button
          key={label}
          className={(target === "databases" ? activeDomain === "databases" : target === "collaboration" ? activeDomain === "collaboration" : activeDomain === "notes" && index === 1) ? "rail-item active" : "rail-item"}
          type="button"
          disabled={target === "collaboration" && !collaborationEnabled}
          onClick={() => { if (target === "collaboration") setCollaborationInitialSection("people"); setActiveDomain(target); setActivePane("canvas"); }}
        >
          <Icon aria-hidden="true" size={19} />
          <span>{label}</span>
        </button>
      ))}
      {activeDomain !== "collaboration" ? (
        <button
          className="rail-item"
          type="button"
          aria-label={activePane === "context" ? "关闭笔记列表" : "打开笔记列表"}
          onClick={() => setActivePane((pane) => pane === "context" ? "canvas" : "context")}
        >
          <PanelLeft aria-hidden="true" size={19} />
          <span>列表</span>
        </button>
      ) : null}
      <NotificationButton unreadCount={unreadCount} onClick={toggleNotifications} />
    </>
  );

  const mobileNavigation = <>
    <button type="button" onClick={() => { setActiveDomain("notes"); setActivePane("canvas"); }}>首页</button>
    <button type="button" onClick={() => { setActiveDomain("databases"); setActivePane("canvas"); }}>数据库</button>
    <button type="button" disabled={!collaborationEnabled} onClick={() => { setCollaborationInitialSection("people"); setActiveDomain("collaboration"); setActivePane("canvas"); }}>协作</button>
    <button type="button" aria-label={notificationButtonLabel(unreadCount)} onClick={(event) => toggleNotifications(event.currentTarget)}>通知{unreadCount > 0 ? ` ${unreadCount}` : ""}</button>
    <button type="button" onClick={(event) => openInspector(event.currentTarget)}>检查器</button>
  </>;

  const contextualList = (
    <div className="context-content">
      <div className="context-heading">
        <div><small>CREATE</small><h2>所有笔记</h2></div>
        <button type="button" aria-label="新建笔记" onClick={startNewNote}><Sparkles size={17} /></button>
      </div>
      <label className="search-field"><Search size={15} /><input aria-label="搜索笔记" placeholder="搜索笔记" /></label>
      {notesLoading ? <p className="database-empty" role="status">正在加载笔记…</p> : null}
      {notesError ? <p className="database-operation-error" role="alert">{notesError}</p> : null}
      {!notesLoading && notes.length === 0 ? <p className="database-empty">暂无笔记，点击右上角开始记录。</p> : null}
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
      <div className="context-heading"><div><small>STRUCTURE</small><h2>数据库</h2></div></div>
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
      <AdaptiveWorkbench
        navigation={navigation}
        mobileNavigation={mobileNavigation}
        contextualList={activeDomain === "collaboration" ? undefined : activeDomain === "databases" ? databaseContextualList : contextualList}
        inspector={<div className="inspector-content"><small>页面信息</small><h3>{activeDomain === "databases" ? databaseBundle?.database.name ?? "数据库" : activeDomain === "collaboration" ? "协作中心" : selectedNote?.title || "笔记"}</h3><p>属性、版本与协作状态只在需要时显示。</p></div>}
        inspectorOpen={inspectorOpen}
        activePane={activePane}
        onActivePaneChange={setActivePane}
        onInspectorOpen={openInspector}
        onInspectorClose={closeInspector}
      >
        <>
        {activeDomain === "collaboration" && collaborationEnabled && workspaceId ? <CollaborationCenter client={collaborationClient} workspaceId={workspaceId} userId={userId} role={role} initialSection={collaborationInitialSection} activeTarget={activeCollaborationTarget} selectedCommentId={selectedCommentId} commentTargets={commentTargets} shareTargets={shareTargets} /> : activeDomain === "databases" ? databaseCanvas : selectedNote || creatingNote ? <article className="editor-document">
          <header className="editor-toolbar">
            <span className="saved-state"><span /> {noteSaving ? "保存中…" : noteMessage ?? "未保存更改"}</span>
            <div>
              <button type="button" aria-label={notificationButtonLabel(unreadCount)} onClick={(event) => toggleNotifications(event.currentTarget)}><Bell aria-hidden="true" size={17} /></button>
              <button type="button" aria-label="打开检查器" onClick={(event) => openInspector(event.currentTarget)}><Boxes size={17} /></button>
            </div>
          </header>
          <div className="editor-copy">
            <p className="eyebrow">NEXUS NOTES / PUBLIC BETA</p>
            <h1>{draftTitle.trim() || "未命名笔记"}</h1>
            <label className="note-editor-field">标题<input aria-label="笔记标题" value={draftTitle} onChange={(event) => { setDraftTitle(event.target.value); setNoteMessage(null); }} /></label>
            <label className="note-editor-field">内容<textarea aria-label="笔记内容" value={draftContent} onChange={(event) => { setDraftContent(event.target.value); setNoteMessage(null); }} /></label>
            <div className="note-editor-actions">
              <button type="button" disabled={noteSaving || (!draftTitle.trim() && !draftContent.trim())} onClick={saveNote}>保存笔记</button>
              {noteMessage ? <p role="status">{noteMessage}</p> : null}
              {noteError ? <p className="database-operation-error" role="alert">{noteError}</p> : null}
            </div>
            <p className="note-content-preview" aria-label="笔记内容预览">{draftContent || "开始记录你的想法。"}</p>
            {recoveryPanel}
          </div>
        </article> : <article className="editor-document">
          <header className="editor-toolbar">
            <span className="saved-state"><span /> 已保存</span>
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
    </>
  );
}

export function App({
  authClient = defaultAuthClient,
  apiClient = new ApiClient(),
  workspaceId,
  turnstileSiteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY ?? "",
  resetToken = resetTokenFromLocation(),
  onDiagnosticNavigate,
}: {
  authClient?: AuthClient;
  apiClient?: ApiClient;
  workspaceId?: string;
  turnstileSiteKey?: string;
  resetToken?: string;
  onDiagnosticNavigate?: (diagnostic: KnowledgeDiagnostic) => void;
} = {}) {
  const [route, setRoute] = useState<AppRoute>(() => routeFromLocation());
  if (route.kind === "share") {
    return <PublicSharePage client={new CollaborationClient(apiClient, "public-share")} token={route.token} />;
  }
  if (route.kind === "invite") {
    return <InviteRedemptionPage
      authClient={authClient}
      client={new CollaborationClient(apiClient, "invite-redemption")}
      token={route.token}
      turnstileSiteKey={turnstileSiteKey}
      onAccepted={(acceptedWorkspaceId) => {
        window.history.replaceState(null, "", "/");
        setRoute({ kind: "workspace", workspaceId: acceptedWorkspaceId });
      }}
    />;
  }
  return (
    <AuthGate client={authClient} turnstileSiteKey={turnstileSiteKey} resetToken={resetToken}>
      {(session) => {
        const activeWorkspaceId = workspaceId ?? route.workspaceId ?? session.active_workspace_id;
        const memberships = Array.isArray(session.workspaces) ? session.workspaces : [];
        const activeWorkspace = memberships.find((candidate) => candidate.id === activeWorkspaceId);
        return (
          <AuthenticatedWorkspace
            key={activeWorkspaceId ?? "no-active-workspace"}
            apiClient={apiClient}
            workspaceId={activeWorkspaceId ?? undefined}
            userId={session.user.id}
            role={activeWorkspace?.role ?? "viewer"}
            collaborationEnabled={Boolean(activeWorkspace)}
            onDiagnosticNavigate={onDiagnosticNavigate}
          />
        );
      }}
    </AuthGate>
  );
}
