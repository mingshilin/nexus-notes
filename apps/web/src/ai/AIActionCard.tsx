import type { AiActionProposal } from "@nexus/contracts";
import { useEffect, useRef } from "react";

const EMAIL_BODY_PREVIEW_LIMIT = 240;

export type AIActionCardStatus =
  | "proposed"
  | "confirming"
  | "confirmed"
  | "rejecting"
  | "rejected"
  | "expired"
  | "failed";

interface AIActionCardProps {
  proposal: AiActionProposal;
  status: AIActionCardStatus;
  error?: string | null;
  autoFocus?: boolean;
  onConfirm(): void;
  onReject(): void;
}

function titleForTool(proposal: AiActionProposal) {
  switch (proposal.tool) {
    case "create_note":
      return "创建笔记";
    case "create_reminder":
      return "创建提醒";
    case "create_notification":
      return "创建通知";
    case "send_email":
      return "发送邮件";
  }
}

function detailsForProposal(proposal: AiActionProposal) {
  switch (proposal.tool) {
    case "create_note":
      return [
        ["标题", proposal.input.title || "未命名笔记"],
        ["内容预览", proposal.input.content || "空内容"],
      ] as const;
    case "create_reminder":
      return [
        ["标题", proposal.input.title || "未命名提醒"],
        ["提醒时间", proposal.input.remind_at],
        ["时区", proposal.input.timezone || "UTC"],
      ] as const;
    case "create_notification":
      return [
        ["标题", proposal.input.title],
        ["内容", proposal.input.body_text],
      ] as const;
    case "send_email":
      return [
        ["收件人", proposal.input.to_email],
        ["主题", proposal.input.subject],
        ["正文", proposal.input.body_text.length > EMAIL_BODY_PREVIEW_LIMIT
          ? `${proposal.input.body_text.slice(0, EMAIL_BODY_PREVIEW_LIMIT).trimEnd()}…`
          : proposal.input.body_text],
      ] as const;
  }
}

function statusText(status: AIActionCardStatus) {
  switch (status) {
    case "confirming":
      return "确认中";
    case "confirmed":
      return "已确认";
    case "rejecting":
      return "拒绝中";
    case "rejected":
      return "已拒绝";
    case "expired":
      return "已过期";
    case "failed":
      return "执行失败";
    case "proposed":
      return "待确认";
  }
}

export function AIActionCard({ proposal, status, error = null, autoFocus = false, onConfirm, onReject }: AIActionCardProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const actionable = status === "proposed" || status === "failed" || status === "confirming" || status === "rejecting";
  const busy = status === "confirming" || status === "rejecting";

  useEffect(() => {
    if (autoFocus && (status === "proposed" || status === "failed")) confirmRef.current?.focus();
  }, [autoFocus, status]);

  return (
    <article className={`ai-action-card ai-action-card-${status}`} aria-label={`${titleForTool(proposal)}提案`}>
      <header className="ai-action-card-header">
        <div>
          <small>AI 操作卡片</small>
          <h2>{proposal.summary}</h2>
        </div>
        <strong>{statusText(status)}</strong>
      </header>
      <p>{titleForTool(proposal)}</p>
      <dl>
        {detailsForProposal(proposal).map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {error ? <p role="alert">{error}</p> : null}
      {actionable ? (
        <div className="ai-action-card-actions">
          <button ref={confirmRef} type="button" disabled={busy} onClick={onConfirm}>
            {status === "failed" ? "重试确认" : status === "confirming" ? "确认中…" : "确认执行"}
          </button>
          <button type="button" disabled={busy} onClick={onReject}>
            {status === "rejecting" ? "拒绝中…" : "拒绝"}
          </button>
        </div>
      ) : null}
    </article>
  );
}
