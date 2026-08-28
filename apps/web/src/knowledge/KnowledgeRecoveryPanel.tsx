import type { Folder, KnowledgeDiagnostic } from "@nexus/contracts";
import { KnowledgeDiagnosticActions } from "./KnowledgeDiagnosticActions";

export interface RecoveryAttachment {
  id: string;
  filename: string;
  mime_type: string;
  ocr_status: "pending" | "processing" | "completed" | "failed" | "dead_letter" | null;
}

export interface RecoveryDiagnostic {
  kind: "unfiled_note" | "orphan_note" | "duplicate_title" | "broken_link" | "failed_ocr";
  entity_id: string;
  title: string;
  count: number;
}

export interface RecoveryFilters {
  mimeType: string;
  ocrStatus: string;
}

const mimeTypes = ["application/pdf", "image/jpeg", "image/png", "image/webp", "text/plain"];
const ocrStatuses = ["pending", "processing", "completed", "failed", "dead_letter"];

export function KnowledgeRecoveryPanel({
  attachments,
  diagnostics,
  filters,
  loading,
  refreshing,
  attachmentError,
  diagnosticError,
  retryFeedback,
  isRetryPending = false,
  attachmentNextCursor,
  diagnosticNextCursor,
  onRetry,
  onBatchRetry,
  onUpload,
  uploading = false,
  uploadError,
  onRecover,
  onFiltersChange,
  onLoadMoreAttachments,
  onLoadMoreDiagnostics,
  folders = [],
  onClassifyUnfiled,
  onMoveOrphansToInbox,
  onIgnoreOrphans,
  onMergeDuplicate,
}: {
  attachments: RecoveryAttachment[];
  diagnostics: RecoveryDiagnostic[];
  filters: RecoveryFilters;
  loading: boolean;
  refreshing: boolean;
  attachmentError?: string | null;
  diagnosticError?: string | null;
  retryFeedback?: string | null;
  isRetryPending?: boolean;
  attachmentNextCursor?: string | null;
  diagnosticNextCursor?: string | null;
  onRetry(attachmentId: string): void;
  onBatchRetry(attachmentIds: string[]): void;
  onUpload?(file: File): void;
  uploading?: boolean;
  uploadError?: string | null;
  onRecover(diagnostic: RecoveryDiagnostic): void;
  onFiltersChange(filters: RecoveryFilters): void;
  onLoadMoreAttachments(): void;
  onLoadMoreDiagnostics(): void;
  folders?: Folder[];
  onClassifyUnfiled?(folderId: string): void;
  onMoveOrphansToInbox?(): void;
  onIgnoreOrphans?(): void;
  onMergeDuplicate?(diagnostic: KnowledgeDiagnostic): void;
}) {
  const failed = attachments.filter((attachment) => attachment.ocr_status === "failed" || attachment.ocr_status === "dead_letter");
  const empty = attachments.length === 0 && diagnostics.length === 0;
  const hasWriteDiagnostics = diagnostics.some((diagnostic) => diagnostic.kind === "unfiled_note" || diagnostic.kind === "orphan_note" || diagnostic.kind === "duplicate_title");
  const recoveryActionsAvailable = Boolean(onClassifyUnfiled && onMoveOrphansToInbox && onIgnoreOrphans && onMergeDuplicate);
  const resetFilters = () => onFiltersChange({ mimeType: "", ocrStatus: "" });

  return (
    <section className="knowledge-recovery" aria-label="知识恢复">
      <div className="knowledge-recovery-heading">
        <div><small>KNOWLEDGE RECOVERY</small><h3>附件与诊断</h3></div>
        <div className="knowledge-recovery-heading-actions">
          {onUpload ? <label className="knowledge-upload-button">
            上传附件
            <input
              type="file"
              aria-label="上传附件"
              accept="application/pdf,image/jpeg,image/png,image/webp,text/plain"
              disabled={uploading}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                if (file) onUpload(file);
              }}
            />
          </label> : null}
          {failed.length > 0 ? (
            <button type="button" disabled={isRetryPending || uploading} onClick={() => onBatchRetry(failed.map((attachment) => attachment.id))}>重试全部失败 OCR</button>
          ) : null}
        </div>
      </div>
      <div className="knowledge-recovery-filters">
        <label className="knowledge-filter">附件类型
          <select aria-label="附件类型过滤" value={filters.mimeType} onChange={(event) => onFiltersChange({ ...filters, mimeType: event.target.value })}>
            <option value="">全部类型</option>
            {mimeTypes.map((mimeType) => <option key={mimeType} value={mimeType}>{mimeType}</option>)}
          </select>
        </label>
        <label className="knowledge-filter">OCR 状态
          <select aria-label="OCR 状态过滤" value={filters.ocrStatus} onChange={(event) => onFiltersChange({ ...filters, ocrStatus: event.target.value })}>
            <option value="">全部状态</option>
            {ocrStatuses.map((status) => <option key={status} value={status}>{status}</option>)}
          </select>
        </label>
        {(filters.mimeType || filters.ocrStatus) ? <button type="button" className="knowledge-filter-reset" onClick={resetFilters}>清除过滤</button> : null}
      </div>
      {onClassifyUnfiled && onMoveOrphansToInbox && onIgnoreOrphans && onMergeDuplicate ? (
        <KnowledgeDiagnosticActions
          diagnostics={diagnostics as KnowledgeDiagnostic[]}
          folders={folders}
          disabled={isRetryPending || uploading}
          onClassifyUnfiled={onClassifyUnfiled}
          onMoveOrphansToInbox={onMoveOrphansToInbox}
          onIgnoreOrphans={onIgnoreOrphans}
          onMergeDuplicate={onMergeDuplicate}
        />
      ) : null}
      {hasWriteDiagnostics && !recoveryActionsAvailable ? <p className="knowledge-recovery-state" role="status">当前权限仅允许查看诊断；需要编辑权限才能批量归类、移动或合并笔记，原笔记内容不会被修改。</p> : null}
      {loading && empty ? <p className="knowledge-recovery-state" role="status">正在加载附件与诊断…</p> : null}
      {refreshing ? <p className="knowledge-recovery-state" role="status">正在刷新，保留最近可用数据…</p> : null}
      {attachmentError ? <p className="knowledge-recovery-error" role="alert">{attachmentError}</p> : null}
      {uploadError ? <p className="knowledge-recovery-error" role="alert">{uploadError}</p> : null}
      {uploading ? <p className="knowledge-recovery-state" role="status">正在上传附件…</p> : null}
      {diagnosticError ? <p className="knowledge-recovery-error" role="alert">{diagnosticError}</p> : null}
      {retryFeedback ? <p className="knowledge-recovery-feedback" aria-live="polite">{retryFeedback}</p> : null}
      {!loading && empty && !attachmentError && !diagnosticError ? <p className="knowledge-recovery-state">暂无附件或待处理诊断。</p> : null}
      {failed.map((attachment) => (
        <div className="knowledge-recovery-row" key={attachment.id}>
          <span><strong>{attachment.filename}</strong><small>{attachment.mime_type} · OCR 失败</small></span>
          <button type="button" disabled={isRetryPending} aria-label={`重试 ${attachment.filename}`} onClick={() => onRetry(attachment.id)}>重试</button>
        </div>
      ))}
      {attachmentNextCursor ? <button type="button" className="knowledge-load-more" disabled={loading || refreshing} onClick={onLoadMoreAttachments}>加载更多附件</button> : null}
      {diagnostics.map((diagnostic) => (
        <div className="knowledge-recovery-row" key={`${diagnostic.kind}:${diagnostic.entity_id}`}>
          <span><strong>{diagnostic.title || "未命名项目"}</strong><small>{diagnostic.kind} · {diagnostic.count}</small></span>
          <button type="button" aria-label={`处理诊断 ${diagnostic.title}`} onClick={() => onRecover(diagnostic)}>处理</button>
        </div>
      ))}
      {diagnosticNextCursor ? <button type="button" className="knowledge-load-more" disabled={loading || refreshing} onClick={onLoadMoreDiagnostics}>加载更多诊断</button> : null}
    </section>
  );
}
