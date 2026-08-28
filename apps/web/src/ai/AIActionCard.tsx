import type { AiActionProposal } from "@nexus/contracts";
import { useEffect, useRef } from "react";

const EMAIL_BODY_PREVIEW_LIMIT = 240;

function describeUpdateNotePatch(patch: Extract<AiActionProposal, { tool: "update_note" }>["input"]["patch"]) {
  const fields: string[] = [];
  if (patch.title !== undefined) fields.push(`标题：${patch.title || "未命名笔记"}`);
  if (patch.content !== undefined) fields.push(`内容：${patch.content || "空内容"}`);
  if (patch.folder_id !== undefined) fields.push(`文件夹：${patch.folder_id ?? "根目录"}`);
  if (patch.database_id !== undefined) fields.push(`数据库：${patch.database_id ?? "未设置"}`);
  if (patch.daily_date !== undefined) fields.push(`日期：${patch.daily_date ?? "未设置"}`);
  if (patch.is_favorite !== undefined) fields.push(`收藏：${patch.is_favorite ? "是" : "否"}`);
  if (patch.is_pinned !== undefined) fields.push(`置顶：${patch.is_pinned ? "是" : "否"}`);
  return fields.length > 0 ? fields.join("；") : "无变更";
}

export type AIActionCardStatus =
  | "proposed"
  | "confirming"
  | "confirmed"
  | "rejecting"
  | "rejected"
  | "expired"
  | "failed"
  | "conflict";

interface AIActionCardProps {
  proposal: AiActionProposal;
  status: AIActionCardStatus;
  error?: string | null;
  autoFocus?: boolean;
  onConfirm(): void;
  onReject(): void;
  onRegenerate?(): void;
}

function titleForTool(proposal: AiActionProposal) {
  const tool = proposal.tool;
  switch (tool) {
    case "create_note":
      return "创建笔记";
    case "create_reminder":
      return "创建提醒";
    case "create_notification":
      return "创建通知";
    case "send_email":
      return "发送邮件";
    case "update_note":
      return "更新笔记";
    case "move_note":
      return "移动笔记";
    case "archive_note":
      return "归档笔记";
    case "restore_note":
      return "恢复笔记";
    case "delete_note":
      return "删除笔记";
  }
  const exhaustiveTool: never = tool;
  return `AI 操作(${exhaustiveTool})`;
}

function detailsForProposal(proposal: AiActionProposal) {
  const tool = proposal.tool;
  switch (tool) {
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
    case "update_note":
      return [
        ["目标笔记", proposal.input.target_note_id],
        ["基准版本", String(proposal.input.base_revision)],
        ["更新字段", describeUpdateNotePatch(proposal.input.patch)],
      ] as const;
    case "move_note":
      return [
        ["目标笔记", proposal.input.target_note_id],
        ["基准版本", String(proposal.input.base_revision)],
        ["目标文件夹", proposal.input.patch.folder_id ?? "根目录"],
      ] as const;
    case "archive_note":
      return [
        ["目标笔记", proposal.input.target_note_id],
        ["基准版本", String(proposal.input.base_revision)],
        ["操作", "归档"],
      ] as const;
    case "restore_note":
      return [
        ["目标笔记", proposal.input.target_note_id],
        ["基准版本", String(proposal.input.base_revision)],
        ["操作", "恢复到活动"],
      ] as const;
    case "delete_note":
      return [
        ["目标笔记", proposal.input.target_note_id],
        ["基准版本", String(proposal.input.base_revision)],
        ["操作", "移入回收站"],
      ] as const;
  }
  const exhaustiveTool: never = tool;
  return [["工具", `AI 操作(${exhaustiveTool})`]] as const;
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
    case "conflict":
      return "内容已变化";
    case "proposed":
      return "待确认";
  }
}

export function AIActionCard({ proposal, status, error = null, autoFocus = false, onConfirm, onReject, onRegenerate }: AIActionCardProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const actionable = status === "proposed" || status === "confirming" || status === "rejecting";
  const busy = status === "confirming" || status === "rejecting";

  useEffect(() => {
    if (autoFocus && status === "proposed") confirmRef.current?.focus();
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
            {status === "confirming" ? "确认中…" : "确认执行"}
          </button>
          <button type="button" disabled={busy} onClick={onReject}>
            {status === "rejecting" ? "拒绝中…" : "拒绝"}
          </button>
        </div>
      ) : null}
      {(status === "failed" || status === "conflict" || status === "expired") && onRegenerate ? (
        <div className="ai-action-card-actions">
          <button type="button" onClick={onRegenerate}>重新发起</button>
        </div>
      ) : null}
    </article>
  );
}
