import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { Attachment, KnowledgeDiagnostic } from "@nexus/contracts";

import type { KnowledgeClient } from "../data/knowledge-client";

export interface KnowledgeRecoveryFilters {
  mimeType: string;
  ocrStatus: string;
}

export interface UseKnowledgeRecoveryDataParams {
  client: KnowledgeClient;
  workspaceId?: string;
  initialFilters?: KnowledgeRecoveryFilters;
  refreshVersion?: number;
}

export interface KnowledgeRecoveryDataState {
  attachments: Attachment[];
  setAttachments: Dispatch<SetStateAction<Attachment[]>>;
  diagnostics: KnowledgeDiagnostic[];
  setDiagnostics: Dispatch<SetStateAction<KnowledgeDiagnostic[]>>;
  filters: KnowledgeRecoveryFilters;
  setFilters: Dispatch<SetStateAction<KnowledgeRecoveryFilters>>;
  attachmentCursor: string | null;
  diagnosticCursor: string | null;
  loading: boolean;
  refreshing: boolean;
  attachmentError: string | null;
  diagnosticError: string | null;
  setDiagnosticError: Dispatch<SetStateAction<string | null>>;
  retryFeedback: string | null;
  setRetryFeedback: Dispatch<SetStateAction<string | null>>;
  retryingIds: Set<string>;
  loadMoreAttachments(): void;
  loadMoreDiagnostics(): void;
  retryAttachments(attachmentIds: string[]): void;
  refresh(): void;
  abortRequests(): void;
}

const EMPTY_FILTERS: KnowledgeRecoveryFilters = { mimeType: "", ocrStatus: "" };

function isAborted(error: unknown, signal: AbortSignal) {
  return signal.aborted || (error instanceof DOMException && error.name === "AbortError");
}

function recoveryFeedback(result: { queued: string[]; ineligible: string[]; duplicate: string[] }) {
  const feedback: string[] = [];
  if (result.queued.length) feedback.push(`已加入 ${result.queued.length} 项 OCR 重试。`);
  if (result.ineligible.length) feedback.push(`${result.ineligible.length} 项不符合重试条件。`);
  if (result.duplicate.length) feedback.push(`${result.duplicate.length} 项已在处理中。`);
  return feedback.join(" ") || "没有可重试的附件。";
}

function appendUnique<T>(current: T[], next: T[], keyFor: (item: T) => string) {
  const byKey = new Map(current.map((item) => [keyFor(item), item]));
  next.forEach((item) => byKey.set(keyFor(item), item));
  return [...byKey.values()];
}

export function useKnowledgeRecoveryData({
  client,
  workspaceId,
  initialFilters,
  refreshVersion = 0,
}: UseKnowledgeRecoveryDataParams): KnowledgeRecoveryDataState {
  const [filters, setFilters] = useState<KnowledgeRecoveryFilters>(initialFilters ?? EMPTY_FILTERS);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [diagnostics, setDiagnostics] = useState<KnowledgeDiagnostic[]>([]);
  const [attachmentCursor, setAttachmentCursor] = useState<string | null>(null);
  const [diagnosticCursor, setDiagnosticCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(workspaceId));
  const [refreshing, setRefreshing] = useState(false);
  const [attachmentError, setAttachmentError] = useState<string | null>(workspaceId ? null : "未选择工作区，无法加载恢复数据。");
  const [diagnosticError, setDiagnosticError] = useState<string | null>(null);
  const [retryFeedback, setRetryFeedback] = useState<string | null>(null);
  const [retryingIds, setRetryingIds] = useState<Set<string>>(new Set());
  const [localRefreshVersion, setLocalRefreshVersion] = useState(0);
  const requestControllersRef = useRef(new Set<AbortController>());
  const retryControllersRef = useRef(new Set<AbortController>());
  const generationRef = useRef(0);
  const scopeRef = useRef<{ workspaceId?: string; client: KnowledgeClient }>({ workspaceId, client });
  const queryIdentityRef = useRef<string | null>(null);

  const abortRequests = useCallback(() => {
    generationRef.current += 1;
    requestControllersRef.current.forEach((controller) => controller.abort());
    retryControllersRef.current.forEach((controller) => controller.abort());
    requestControllersRef.current.clear();
    retryControllersRef.current.clear();
  }, []);

  const refresh = useCallback(() => setLocalRefreshVersion((version) => version + 1), []);

  useEffect(() => {
    const scopeChanged = scopeRef.current.workspaceId !== workspaceId || scopeRef.current.client !== client;
    scopeRef.current = { workspaceId, client };
    if (scopeChanged) {
      abortRequests();
      queryIdentityRef.current = null;
      setAttachments([]);
      setDiagnostics([]);
      setAttachmentCursor(null);
      setDiagnosticCursor(null);
      setRetryFeedback(null);
      setRetryingIds(new Set());
      setLoading(Boolean(workspaceId));
      setRefreshing(false);
    }

    const queryIdentity = `${workspaceId ?? ""}\u0000${filters.mimeType}\u0000${filters.ocrStatus}`;
    const queryChanged = queryIdentityRef.current !== null && queryIdentityRef.current !== queryIdentity;
    queryIdentityRef.current = queryIdentity;
    if (queryChanged) {
      setAttachmentCursor(null);
      setDiagnosticCursor(null);
    }

    if (!workspaceId) {
      abortRequests();
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

    abortRequests();
    const controller = new AbortController();
    const generation = generationRef.current;
    requestControllersRef.current.add(controller);
    const hasVisibleData = !scopeChanged && (attachments.length > 0 || diagnostics.length > 0);
    setLoading(!hasVisibleData);
    setRefreshing(hasVisibleData);
    setAttachmentError(null);
    setDiagnosticError(null);

    void Promise.allSettled([
      client.listAttachments({
        mime_type: (filters.mimeType as Attachment["mime_type"]) || undefined,
        ocr_status: (filters.ocrStatus as Attachment["ocr_status"]) || undefined,
        limit: 50,
      }, controller.signal),
      client.getKnowledgeDiagnostics({ limit: 50 }, controller.signal),
    ]).then(([attachmentResult, diagnosticResult]) => {
      if (controller.signal.aborted || generation !== generationRef.current || queryIdentityRef.current !== queryIdentity) return;
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
      requestControllersRef.current.delete(controller);
      if (!controller.signal.aborted && generation === generationRef.current && queryIdentityRef.current === queryIdentity) {
        setLoading(false);
        setRefreshing(false);
      }
    });

    return () => {
      controller.abort();
      requestControllersRef.current.delete(controller);
    };
  }, [
    abortRequests,
    client,
    filters.mimeType,
    filters.ocrStatus,
    localRefreshVersion,
    refreshVersion,
    workspaceId,
  ]);

  const loadMoreAttachments = useCallback(() => {
    if (!workspaceId || !attachmentCursor || loading || refreshing) return;
    const controller = new AbortController();
    const generation = generationRef.current;
    const queryIdentity = queryIdentityRef.current;
    requestControllersRef.current.add(controller);
    setRefreshing(true);
    void client.listAttachments({
      mime_type: (filters.mimeType as Attachment["mime_type"]) || undefined,
      ocr_status: (filters.ocrStatus as Attachment["ocr_status"]) || undefined,
      cursor: attachmentCursor,
      limit: 50,
    }, controller.signal).then((page) => {
      if (controller.signal.aborted || generation !== generationRef.current || queryIdentityRef.current !== queryIdentity) return;
      setAttachments((current) => appendUnique(current, page.items, (item) => item.id));
      setAttachmentCursor(page.next_cursor);
      setAttachmentError(null);
    }).catch((error: unknown) => {
      if (!isAborted(error, controller.signal) && generation === generationRef.current) setAttachmentError("更多附件暂时无法加载，请稍后重试。");
    }).finally(() => {
      requestControllersRef.current.delete(controller);
      if (!controller.signal.aborted && generation === generationRef.current) setRefreshing(false);
    });
  }, [attachmentCursor, client, filters.mimeType, filters.ocrStatus, loading, refreshing, workspaceId]);

  const loadMoreDiagnostics = useCallback(() => {
    if (!workspaceId || !diagnosticCursor || loading || refreshing) return;
    const controller = new AbortController();
    const generation = generationRef.current;
    const queryIdentity = queryIdentityRef.current;
    requestControllersRef.current.add(controller);
    setRefreshing(true);
    void client.getKnowledgeDiagnostics({ cursor: diagnosticCursor, limit: 50 }, controller.signal).then((page) => {
      if (controller.signal.aborted || generation !== generationRef.current || queryIdentityRef.current !== queryIdentity) return;
      setDiagnostics((current) => appendUnique(current, page.items, (item) => `${item.kind}:${item.entity_id}`));
      setDiagnosticCursor(page.next_cursor);
      setDiagnosticError(null);
    }).catch((error: unknown) => {
      if (!isAborted(error, controller.signal) && generation === generationRef.current) setDiagnosticError("更多诊断暂时无法加载，请稍后重试。");
    }).finally(() => {
      requestControllersRef.current.delete(controller);
      if (!controller.signal.aborted && generation === generationRef.current) setRefreshing(false);
    });
  }, [client, diagnosticCursor, loading, refreshing, workspaceId]);

  const retryAttachments = useCallback((attachmentIds: string[]) => {
    if (!workspaceId || retryingIds.size > 0) return;
    const ids = [...new Set(attachmentIds)].filter(Boolean);
    if (ids.length === 0) return;
    const controller = new AbortController();
    const generation = generationRef.current;
    retryControllersRef.current.add(controller);
    setRetryingIds(new Set(ids));
    setRetryFeedback(null);
    const retry = ids.length === 1
      ? client.retryAttachmentOcr(ids[0]!, controller.signal)
      : client.retryAttachmentOcrBatch(ids, controller.signal);
    void retry.then((result) => {
      if (controller.signal.aborted || generation !== generationRef.current) return;
      setRetryFeedback(recoveryFeedback(result));
    }).catch((error: unknown) => {
      if (!isAborted(error, controller.signal) && generation === generationRef.current) setRetryFeedback("OCR 重试请求失败，请稍后重试。");
    }).finally(() => {
      retryControllersRef.current.delete(controller);
      if (controller.signal.aborted || generation !== generationRef.current) return;
      setRetryingIds(new Set());
      refresh();
    });
  }, [client, refresh, retryingIds.size, workspaceId]);

  useEffect(() => () => abortRequests(), [abortRequests]);

  return {
    attachments,
    setAttachments,
    diagnostics,
    setDiagnostics,
    filters,
    setFilters,
    attachmentCursor,
    diagnosticCursor,
    loading,
    refreshing,
    attachmentError,
    diagnosticError,
    setDiagnosticError,
    retryFeedback,
    setRetryFeedback,
    retryingIds,
    loadMoreAttachments,
    loadMoreDiagnostics,
    retryAttachments,
    refresh,
    abortRequests,
  };
}
