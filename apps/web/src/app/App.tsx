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
import { useEffect, useRef, useState } from "react";
import type { Attachment, KnowledgeDiagnostic } from "@nexus/contracts";
import { AuthClient, AuthGate } from "../auth";
import { ApiClient } from "../data/api-client";
import { KnowledgeClient } from "../data/knowledge-client";
import { KnowledgeRecoveryPanel, type RecoveryDiagnostic, type RecoveryFilters } from "../knowledge/KnowledgeRecoveryPanel";
import type { ServiceWorkerUpdate } from "../data/service-worker";
import { AdaptiveWorkbench } from "../layout/AdaptiveWorkbench";

const domains = [
  { label: "收集", icon: Inbox },
  { label: "创作", icon: BookOpen },
  { label: "整理", icon: Search },
  { label: "协作", icon: Users },
  { label: "运营", icon: Settings },
];

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

  useEffect(() => {
    const handleUpdate = (event: Event) => {
      setServiceWorkerUpdate((event as CustomEvent<ServiceWorkerUpdate>).detail);
    };
    window.addEventListener("nexus:service-worker-update", handleUpdate);
    return () => window.removeEventListener("nexus:service-worker-update", handleUpdate);
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

    return () => controller.abort();
  }, [apiClient, workspaceId, filters.mimeType, filters.ocrStatus, refreshVersion]);

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
    const retry = ids.length === 1
      ? knowledge.retryAttachmentOcr(ids[0])
      : knowledge.retryAttachmentOcrBatch(ids);
    void retry.then((result) => {
      setRetryFeedback(recoveryFeedback(result));
    }).catch(() => {
      setRetryFeedback("OCR 重试请求失败，请稍后重试。");
    }).finally(() => {
      setRetryingIds(new Set());
      setRefreshVersion((version) => version + 1);
    });
  };

  const navigation = (
    <>
      <div className="brand-mark" aria-label="Nexus Notes">N</div>
      {domains.map(({ label, icon: Icon }, index) => (
        <button key={label} className={index === 1 ? "rail-item active" : "rail-item"} type="button">
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
        contextualList={contextualList}
        inspector={<div className="inspector-content"><small>页面信息</small><h3>Public Beta 重写计划</h3><p>属性、版本与协作状态只在需要时显示。</p></div>}
        inspectorOpen={inspectorOpen}
        activePane={activePane}
        onActivePaneChange={setActivePane}
        onInspectorOpen={openInspector}
        onInspectorClose={closeInspector}
      >
        <article className="editor-document">
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
        </article>
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
