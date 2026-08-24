import type { Job, OperationsStatus, Usage } from "@nexus/contracts";
import { createPortal } from "react-dom";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useWorkbenchModalState } from "../layout/AdaptiveWorkbench";
import type { OperationsClientLike, ProfileClientLike } from "./index";

const confirmationPhrase = "永久删除我的账户";
const focusableSelector = "button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex='-1'])";
const statusLabels = { ready: "正常", degraded: "降级", unconfigured: "未配置" } as const;

function isAbort(error: unknown, signal: AbortSignal) {
  return signal.aborted || (error instanceof DOMException && error.name === "AbortError");
}

function deletionErrorMessage(error: unknown) {
  if (error && typeof error === "object" && "code" in error && error.code === "OWNERSHIP_TRANSFER_REQUIRED") {
    const message = error instanceof Error ? error.message : "";
    return `删除前必须先移交以下工作区的所有权。${message}`;
  }
  return "删除账户失败，请检查当前密码和网络后重试。";
}

export interface DataPrivacyPanelProps {
  active?: boolean;
  client: ProfileClientLike;
  operations?: OperationsClientLike;
  activeWorkspaceId: string | null;
  onPrepareDelete?(): Promise<void>;
  onDeleteFailed?(): void;
  onDeleted(): void;
}

export function DataPrivacyPanel({ active = true, client, operations, activeWorkspaceId, onPrepareDelete, onDeleteFailed, onDeleted }: DataPrivacyPanelProps) {
  const [usage, setUsage] = useState<Usage | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const [usageError, setUsageError] = useState<string | null>(null);
  const [usageRetry, setUsageRetry] = useState(0);
  const [serviceStatus, setServiceStatus] = useState<OperationsStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [statusRetry, setStatusRetry] = useState(0);
  const [exportKey, setExportKey] = useState<{ workspaceId: string; key: string } | null>(null);
  const [exportPending, setExportPending] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportJob, setExportJob] = useState<Job | null>(null);
  const [exportDownloadPending, setExportDownloadPending] = useState(false);
  const [exportDownloadError, setExportDownloadError] = useState<string | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletePending, setDeletePending] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const usageVersionRef = useRef(0);
  const statusVersionRef = useRef(0);
  const exportGenerationRef = useRef(0);
  const exportPendingRef = useRef(false);
  const deletePendingRef = useRef(false);
  const deleteOriginRef = useRef<HTMLButtonElement | null>(null);
  const deleteDialogRef = useRef<HTMLDivElement | null>(null);
  const deleteCancelRef = useRef<HTMLButtonElement | null>(null);
  const deleteHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const pendingFocusRef = useRef<HTMLElement | null>(null);
  const focusFrameRef = useRef<number | null>(null);
  const setWorkbenchModalOpen = useWorkbenchModalState();
  exportPendingRef.current = exportPending;
  deletePendingRef.current = deletePending;

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    const version = ++usageVersionRef.current;
    const controller = new AbortController();
    setUsage(null);
    setUsageError(null);
    if (!operations || !activeWorkspaceId) {
      setUsageLoading(false);
      return () => controller.abort();
    }
    setUsageLoading(true);
    void operations.getUsage(controller.signal).then((next) => {
      if (version === usageVersionRef.current && !controller.signal.aborted) setUsage(next);
    }).catch((error: unknown) => {
      if (version === usageVersionRef.current && !isAbort(error, controller.signal)) setUsageError("用量加载失败，请重试。");
    }).finally(() => {
      if (version === usageVersionRef.current && !controller.signal.aborted) setUsageLoading(false);
    });
    return () => controller.abort();
  }, [activeWorkspaceId, operations, usageRetry]);

  useEffect(() => {
    const version = ++statusVersionRef.current;
    const controller = new AbortController();
    setServiceStatus(null);
    setStatusError(null);
    if (!operations || !activeWorkspaceId) {
      setStatusLoading(false);
      return () => controller.abort();
    }
    setStatusLoading(true);
    void operations.getStatus(controller.signal).then((next) => {
      if (version === statusVersionRef.current && !controller.signal.aborted) setServiceStatus(next);
    }).catch((error: unknown) => {
      if (version === statusVersionRef.current && !isAbort(error, controller.signal)) setStatusError("服务状态加载失败，请重试。");
    }).finally(() => {
      if (version === statusVersionRef.current && !controller.signal.aborted) setStatusLoading(false);
    });
    return () => controller.abort();
  }, [activeWorkspaceId, operations, statusRetry]);

  useLayoutEffect(() => {
    exportGenerationRef.current += 1;
    exportPendingRef.current = false;
    setExportPending(false);
    setExportError(null);
    setExportJob(null);
    setExportDownloadPending(false);
    setExportDownloadError(null);
    setExportKey((current) => current?.workspaceId === activeWorkspaceId ? current : null);
  }, [activeWorkspaceId, operations]);

  useEffect(() => {
    if (!active || !operations?.getJob || !exportJob || exportJob.status === "complete" || exportJob.status === "failed" || exportJob.status === "cancelled") return undefined;
    const controller = new AbortController();
    let timer: number | undefined;
    const poll = async () => {
      try {
        const next = await operations.getJob!(exportJob.id, controller.signal);
        if (controller.signal.aborted || !next) return;
        setExportJob(next);
        if (next.status !== "complete" && next.status !== "failed" && next.status !== "cancelled") timer = window.setTimeout(() => void poll(), 1_000);
      } catch {
        if (!controller.signal.aborted) timer = window.setTimeout(() => void poll(), 2_000);
      }
    };
    timer = window.setTimeout(() => void poll(), 500);
    return () => {
      controller.abort();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [active, exportJob, operations]);

  useLayoutEffect(() => {
    if (!deleteDialogOpen) return undefined;
    setWorkbenchModalOpen(true);
    deleteCancelRef.current?.focus();
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (!deletePendingRef.current) closeDeleteDialog();
        return;
      }
      if (event.key !== "Tab") return;
      const dialog = deleteDialogRef.current;
      if (!dialog) return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>(focusableSelector)];
      if (focusable.length === 0) return;
      const activeIndex = focusable.indexOf(document.activeElement as HTMLElement);
      const nextIndex = event.shiftKey
        ? activeIndex <= 0 ? focusable.length - 1 : activeIndex - 1
        : activeIndex < 0 || activeIndex === focusable.length - 1 ? 0 : activeIndex + 1;
      event.preventDefault();
      focusable[nextIndex]!.focus();
    };
    document.addEventListener("keydown", trapFocus);
    return () => {
      document.removeEventListener("keydown", trapFocus);
      setWorkbenchModalOpen(false);
    };
  }, [deleteDialogOpen]);

  useLayoutEffect(() => {
    if (focusFrameRef.current !== null) {
      cancelAnimationFrame(focusFrameRef.current);
      focusFrameRef.current = null;
    }
    if (deleteDialogOpen) {
      pendingFocusRef.current = null;
      return undefined;
    }
    const target = pendingFocusRef.current;
    pendingFocusRef.current = null;
    if (!target) return undefined;
    focusFrameRef.current = requestAnimationFrame(() => {
      focusFrameRef.current = null;
      if (!mountedRef.current || !target.isConnected || target.closest("[inert]")) return;
      target.focus();
    });
    return () => {
      if (focusFrameRef.current !== null) {
        cancelAnimationFrame(focusFrameRef.current);
        focusFrameRef.current = null;
      }
    };
  }, [deleteDialogOpen]);

  const requestExport = () => {
    if (!operations || !activeWorkspaceId || exportPendingRef.current) return;
    const generation = exportGenerationRef.current;
    const workspaceId = activeWorkspaceId;
    exportPendingRef.current = true;
    setExportPending(true);
    setExportError(null);
    const idempotencyKey = exportKey?.workspaceId === workspaceId ? exportKey.key : crypto.randomUUID();
    if (exportKey?.workspaceId !== workspaceId) setExportKey({ workspaceId, key: idempotencyKey });
    void operations.createJob({ kind: "export", idempotency_key: idempotencyKey, payload: { format: "zip", scope: "workspace" } }).then((next) => {
      if (!mountedRef.current || generation !== exportGenerationRef.current) return;
      setExportJob(next);
      setExportKey(null);
    }).catch(() => {
      if (mountedRef.current && generation === exportGenerationRef.current) setExportError("导出请求失败，重试将安全复用同一次导出请求。");
    }).finally(() => {
      if (generation !== exportGenerationRef.current) return;
      exportPendingRef.current = false;
      if (mountedRef.current) setExportPending(false);
    });
  };

  const downloadExport = () => {
    if (!operations?.downloadJob || !exportJob || exportJob.status !== "complete" || exportDownloadPending) return;
    const controller = new AbortController();
    setExportDownloadPending(true);
    setExportDownloadError(null);
    void operations.downloadJob(exportJob.id, controller.signal).then((blob) => {
      if (typeof URL.createObjectURL !== "function") throw new Error("DOWNLOAD_UNAVAILABLE");
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `nexus-notes-export-${exportJob.id}.${blob.type.includes("zip") ? "zip" : "md"}`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    }).catch(() => {
      if (mountedRef.current) setExportDownloadError("导出文件下载失败，请稍后重试。任务结果仍保留在工作区。");
    }).finally(() => {
      if (mountedRef.current) setExportDownloadPending(false);
    });
  };

  function closeDeleteDialog(focus: "origin" | "fallback" = "origin", preserveError = false) {
    pendingFocusRef.current = focus === "origin" ? deleteOriginRef.current : deleteHeadingRef.current;
    setDeleteDialogOpen(false);
    if (!preserveError) setDeleteError(null);
  }

  const deleteAccount = () => {
    if (deletePendingRef.current) return;
    deletePendingRef.current = true;
    setDeletePending(true);
    setDeleteError(null);
    void Promise.resolve().then(async () => {
      await onPrepareDelete?.();
      return client.deleteAccount({ current_password: currentPassword, confirmation: confirmationPhrase });
    }).then(() => {
      if (!mountedRef.current) return;
      setCurrentPassword("");
      setConfirmation("");
      closeDeleteDialog("fallback");
      onDeleted();
    }).catch((error: unknown) => {
      onDeleteFailed?.();
      if (mountedRef.current) {
        setDeleteError(deletionErrorMessage(error));
        closeDeleteDialog("origin", true);
      }
    }).finally(() => {
      deletePendingRef.current = false;
      if (mountedRef.current) setDeletePending(false);
    });
  };

  const canDelete = currentPassword.length > 0 && confirmation === confirmationPhrase;
  const deleteDialog = deleteDialogOpen ? createPortal(
    <div className="account-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !deletePendingRef.current) closeDeleteDialog(); }}>
      <div ref={deleteDialogRef} className="account-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-account-heading">
        <h3 id="delete-account-heading">最后确认删除账户</h3>
        <p>此操作会永久删除账户。离线数据清理完成前，你将无法重新登录。</p>
        {deleteError ? <p className="account-error" role="alert">{deleteError}</p> : null}
        <div className="account-actions"><button ref={deleteCancelRef} type="button" disabled={deletePending} onClick={() => closeDeleteDialog()}>取消删除</button><button type="button" className="account-danger-button" disabled={deletePending} onClick={deleteAccount}>{deletePending ? "正在删除…" : "确认永久删除"}</button></div>
      </div>
    </div>,
    document.body,
  ) : null;

  return (
    <section id="account-panel-privacy" role="tabpanel" aria-labelledby="account-tab-privacy" className="account-panel">
      <div className="account-panel-heading"><div><p className="eyebrow">DATA & PRIVACY</p><h2>数据与隐私</h2><p>查看用量与服务状态，导出数据或删除账户。</p></div></div>
      <section className="account-subpanel" aria-labelledby="usage-heading">
        <div className="account-subpanel-heading"><h3 id="usage-heading">工作区用量</h3><button type="button" disabled={usageLoading || !operations} onClick={() => setUsageRetry((value) => value + 1)}>刷新用量</button></div>
        {usageLoading ? <p role="status">正在加载用量…</p> : null}
        {usageError ? <div className="account-error-row"><p role="alert">{usageError}</p><button type="button" onClick={() => setUsageRetry((value) => value + 1)}>重试用量加载</button></div> : null}
        {usage ? <ul className="account-metric-list"><li>{usage.notes} 条笔记</li><li>{usage.databases} 个数据库</li><li>{usage.attachment_bytes} 字节附件</li><li>{usage.queued_jobs} 个排队任务</li></ul> : null}
        {!operations || !activeWorkspaceId ? <p className="account-muted">选择工作区后可查看用量。</p> : null}
      </section>
      <section className="account-subpanel" aria-labelledby="status-heading">
        <div className="account-subpanel-heading"><h3 id="status-heading">服务状态</h3><button type="button" disabled={statusLoading || !operations} onClick={() => setStatusRetry((value) => value + 1)}>刷新状态</button></div>
        {statusLoading ? <p role="status">正在加载服务状态…</p> : null}
        {statusError ? <div className="account-error-row"><p role="alert">{statusError}</p><button type="button" onClick={() => setStatusRetry((value) => value + 1)}>重试服务状态加载</button></div> : null}
        {serviceStatus ? <div className="account-service-status"><span>队列：{statusLabels[serviceStatus.queue]}</span><span>存储：{statusLabels[serviceStatus.storage]}</span><span>OCR：{statusLabels[serviceStatus.ocr]}</span><small>版本 {serviceStatus.version}</small></div> : null}
      </section>
      <section className="account-subpanel" aria-labelledby="backup-heading">
        <h3 id="backup-heading">备份与导出</h3>
        <p>未配置自动备份，可立即导出</p>
        <div className="account-actions">
          <button type="button" disabled={!operations || !activeWorkspaceId || exportPending} onClick={requestExport}>{exportPending ? "正在创建导出…" : exportError ? "重试导出" : exportJob ? "再次导出" : "导出全部数据"}</button>
          {exportJob?.status === "complete" && operations?.downloadJob ? <button type="button" disabled={exportDownloadPending} onClick={downloadExport}>{exportDownloadPending ? "正在下载…" : "下载导出文件"}</button> : null}
        </div>
        {exportError ? <p className="account-error" role="alert">{exportError}</p> : null}
        {exportDownloadError ? <p className="account-error" role="alert">{exportDownloadError}</p> : null}
        {exportJob ? <p className="account-status" role="status">导出任务 {exportJob.id}：{exportJob.status}{exportJob.error_code ? `（${exportJob.error_code}）` : ""}</p> : null}
      </section>
      <section className="account-subpanel account-danger-zone" aria-labelledby="delete-heading">
        <h3 id="delete-heading" ref={deleteHeadingRef} tabIndex={-1}>删除账户</h3>
        <p>删除不可撤销。若你仍是团队工作区所有者，必须先移交所有权。</p>
        <form className="account-form" onSubmit={(event) => { event.preventDefault(); if (canDelete) { setDeleteError(null); setDeleteDialogOpen(true); } }}>
          <label>{active ? "当前密码" : "删除账户当前密码"}<input type="password" autoComplete="current-password" value={currentPassword} disabled={deletePending} onChange={(event) => setCurrentPassword(event.target.value)} /></label>
          <label>删除确认文字<input autoComplete="off" value={confirmation} disabled={deletePending} onChange={(event) => setConfirmation(event.target.value)} placeholder={confirmationPhrase} /></label>
          <button ref={deleteOriginRef} type="submit" className="account-danger-button" disabled={!canDelete || deletePending}>永久删除账户</button>
        </form>
        {deleteError && !deleteDialogOpen ? <p className="account-error" role="alert">{deleteError}</p> : null}
      </section>
      {deleteDialog}
    </section>
  );
}
