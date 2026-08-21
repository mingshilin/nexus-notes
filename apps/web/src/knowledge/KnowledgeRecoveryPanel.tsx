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

export function KnowledgeRecoveryPanel({
  attachments,
  diagnostics,
  onRetry,
  onBatchRetry,
  onRecover,
}: {
  attachments: RecoveryAttachment[];
  diagnostics: RecoveryDiagnostic[];
  onRetry(attachmentId: string): void;
  onBatchRetry(attachmentIds: string[]): void;
  onRecover(kind: RecoveryDiagnostic["kind"], entityId: string): void;
}) {
  const failed = attachments.filter((attachment) => attachment.ocr_status === "failed" || attachment.ocr_status === "dead_letter");

  return (
    <section className="knowledge-recovery" aria-label="知识恢复">
      <div className="knowledge-recovery-heading">
        <div><small>KNOWLEDGE RECOVERY</small><h3>附件与诊断</h3></div>
        {failed.length > 0 ? (
          <button type="button" onClick={() => onBatchRetry(failed.map((attachment) => attachment.id))}>重试全部失败 OCR</button>
        ) : null}
      </div>
      <label className="knowledge-filter">附件类型<input aria-label="附件类型过滤" placeholder="例如 application/pdf" /></label>
      {failed.map((attachment) => (
        <div className="knowledge-recovery-row" key={attachment.id}>
          <span><strong>{attachment.filename}</strong><small>{attachment.mime_type} · OCR 失败</small></span>
          <button type="button" aria-label={`重试 ${attachment.filename}`} onClick={() => onRetry(attachment.id)}>重试</button>
        </div>
      ))}
      {diagnostics.map((diagnostic) => (
        <div className="knowledge-recovery-row" key={`${diagnostic.kind}:${diagnostic.entity_id}`}>
          <span><strong>{diagnostic.title || "未命名项目"}</strong><small>{diagnostic.kind} · {diagnostic.count}</small></span>
          <button type="button" aria-label={`处理诊断 ${diagnostic.title}`} onClick={() => onRecover(diagnostic.kind, diagnostic.entity_id)}>处理</button>
        </div>
      ))}
    </section>
  );
}
