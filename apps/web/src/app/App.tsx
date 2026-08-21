import {
  Bell,
  BookOpen,
  Boxes,
  Inbox,
  Search,
  Settings,
  Sparkles,
  Users,
} from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import type { Attachment, Database, DatabaseRecord, KnowledgeDiagnostic } from "@nexus/contracts";
import { AuthClient, AuthGate } from "../auth";
import { ApiClient } from "../data/api-client";
import { KnowledgeClient } from "../data/knowledge-client";
import { KnowledgeRecoveryPanel, type RecoveryDiagnostic, type RecoveryFilters } from "../knowledge/KnowledgeRecoveryPanel";
import type { ServiceWorkerUpdate } from "../data/service-worker";
import { AdaptiveWorkbench } from "../layout/AdaptiveWorkbench";
import { DatabaseClient, type DatabaseBundle } from "../data/database-client";
import { NormalizedCache } from "../data/normalized-cache";

const domains = [
  { label: "收集", icon: Inbox, target: "notes" as const },
  { label: "创作", icon: BookOpen, target: "notes" as const },
  { label: "整理", icon: Search, target: "notes" as const },
  { label: "协作", icon: Users, target: "notes" as const },
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

function AuthenticatedWorkspace({
  apiClient,
  workspaceId,
  onDiagnosticNavigate,
}: {
  apiClient: ApiClient;
  workspaceId?: string;
  onDiagnosticNavigate?: (diagnostic: KnowledgeDiagnostic) => void;
}) {
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [activePane, setActivePane] = useState<"context" | "canvas">("canvas");
  const [activeDomain, setActiveDomain] = useState<"notes" | "databases">("notes");
  const [databases, setDatabases] = useState<Database[]>([]);
  const [selectedDatabaseId, setSelectedDatabaseId] = useState<string | null>(null);
  const [databaseBundle, setDatabaseBundle] = useState<DatabaseBundle | null>(null);
  const [databaseRecords, setDatabaseRecords] = useState<DatabaseRecord[]>([]);
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

  useEffect(() => () => {
    abortRecoveryRequests();
    abortRetryRequests();
    abortDatabaseRequests();
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
      setDatabaseBundle(bundle);
      setDatabaseRecords(page.items);
      setDatabaseRecordsNextCursor(page.next_cursor);
      databaseCache.current.writeEntity({ workspaceId, type: "database", id: bundle.database.id, revision: bundle.database.revision, data: bundle.database });
      for (const property of bundle.properties) {
        databaseCache.current.writeEntity({ workspaceId, type: "database-property", id: property.id, revision: property.revision, data: property });
      }
      for (const record of page.items) {
        databaseCache.current.writeEntity({ workspaceId, type: "database-record", id: record.id, revision: record.revision, data: record });
      }
    }).catch((error: unknown) => {
      if (!isAborted(error, controller.signal)) setDatabaseError("数据库内容暂时无法加载。");
    }).finally(() => {
      databaseControllers.current.delete(controller);
      if (!controller.signal.aborted) setDatabaseLoading(false);
    });
    return () => controller.abort();
  }, [activeDomain, apiClient, databaseRefreshVersion, selectedDatabaseId, workspaceId]);

  const requestDatabasePage = useCallback(({ cursor, limit, viewId }: { cursor: string | null; limit: number; viewId?: string }) => {
    if (!workspaceId || !selectedDatabaseId) return Promise.resolve({ items: [], next_cursor: null });
    return new DatabaseClient(apiClient, workspaceId).listRecords(selectedDatabaseId, { cursor: cursor ?? undefined, viewId, limit })
      .then((page) => {
        setDatabaseRecordsNextCursor(page.next_cursor);
        return page;
      });
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
          className={(target === "databases" ? activeDomain === "databases" : activeDomain === "notes" && index === 1) ? "rail-item active" : "rail-item"}
          type="button"
          onClick={() => { setActiveDomain(target); setActivePane("canvas"); }}
        >
          <Icon aria-hidden="true" size={19} />
          <span>{label}</span>
        </button>
      ))}
    </>
  );

  const contextualList = (
    <div className="context-content">
      <div className="context-heading">
        <div><small>CREATE</small><h2>所有笔记</h2></div>
        <button type="button" aria-label="新建笔记"><Sparkles size={17} /></button>
      </div>
      <label className="search-field"><Search size={15} /><input aria-label="搜索笔记" placeholder="搜索笔记" /></label>
      {["Public Beta 重写计划", "每日产品复盘", "数据库设计记录", "欢迎使用 Nexus Notes"].map((title, index) => (
        <button key={title} className={index === 0 ? "note-row selected" : "note-row"} type="button" onClick={() => setActivePane("canvas")}>
          <strong>{title}</strong><span>{index === 0 ? "刚刚" : `${index + 1} 天前`}</span>
          <p>保持专注、可靠并且随时可以恢复的知识工作台。</p>
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
          onClick={() => { setSelectedDatabaseId(database.id); setActivePane("canvas"); }}
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
        contextualList={activeDomain === "databases" ? databaseContextualList : contextualList}
        inspector={<div className="inspector-content"><small>页面信息</small><h3>{activeDomain === "databases" ? databaseBundle?.database.name ?? "数据库" : "Public Beta 重写计划"}</h3><p>属性、版本与协作状态只在需要时显示。</p></div>}
        inspectorOpen={inspectorOpen}
        activePane={activePane}
        onActivePaneChange={setActivePane}
        onInspectorOpen={openInspector}
        onInspectorClose={closeInspector}
      >
        {activeDomain === "databases" ? databaseCanvas : <article className="editor-document">
          <header className="editor-toolbar">
            <span className="saved-state"><span /> 已保存</span>
            <div>
              <button type="button" aria-label="通知"><Bell size={17} /></button>
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
  return (
    <AuthGate client={authClient} turnstileSiteKey={turnstileSiteKey} resetToken={resetToken}>
      {(session) => {
        const activeWorkspaceId = workspaceId ?? session.active_workspace_id;
        return (
          <AuthenticatedWorkspace
            key={activeWorkspaceId ?? "no-active-workspace"}
            apiClient={apiClient}
            workspaceId={activeWorkspaceId ?? undefined}
            onDiagnosticNavigate={onDiagnosticNavigate}
          />
        );
      }}
    </AuthGate>
  );
}
