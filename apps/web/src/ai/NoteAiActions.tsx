import type { AiChatResponse } from "@nexus/contracts";
import { ListChecks, Sparkles, Tags } from "lucide-react";
import { useState } from "react";
import type { ApiClient } from "../data/api-client";

type NoteAiAction = "summary" | "tasks" | "tags";

interface NoteAiActionsProps {
  client: Pick<ApiClient, "request">;
  workspaceId: string;
  note: { title: string; content: string };
  disabled?: boolean;
  onApplyContent?(content: string, action: "summary" | "tasks"): void | Promise<void>;
  onApplyTags?(tags: string[]): void | Promise<void>;
}

interface Preview {
  action: NoteAiAction;
  content: string;
}

const ACTIONS: Array<{ action: NoteAiAction; label: string; icon: typeof Sparkles }> = [
  { action: "summary", label: "生成摘要", icon: Sparkles },
  { action: "tasks", label: "提取任务", icon: ListChecks },
  { action: "tags", label: "建议标签", icon: Tags },
];

function actionPrompt(action: NoteAiAction, title: string, content: string) {
  const instruction = action === "summary"
    ? "请用简洁的中文总结这篇笔记，保留关键结论，不要添加笔记中没有的事实。"
    : action === "tasks"
      ? "请从这篇笔记中提取明确的行动项。每行输出一个 Markdown 任务，无法确认的内容不要猜测。"
      : "请为这篇笔记建议 3 到 8 个简短标签，只输出逗号分隔的标签名称，不要解释。";
  return `${instruction}\n\n笔记标题：${title.slice(0, 160)}\n笔记内容：\n${content.slice(0, 12_000)}`;
}

function parseSuggestedTags(content: string) {
  const seen = new Set<string>();
  return content
    .split(/[,，\n]/u)
    .map((item) => item.replace(/^[-*#\s]+|[。.!！；;]+$/gu, "").trim())
    .filter((item) => item.length > 0 && item.length <= 32)
    .filter((item) => {
      const key = item.toLocaleLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 8);
}

export function NoteAiActions({
  client,
  workspaceId,
  note,
  disabled = false,
  onApplyContent,
  onApplyTags,
}: NoteAiActionsProps) {
  const [pendingAction, setPendingAction] = useState<NoteAiAction | null>(null);
  const [applying, setApplying] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);

  const generate = async (action: NoteAiAction) => {
    if (disabled || !workspaceId || pendingAction || applying) return;
    setPendingAction(action);
    setPreview(null);
    setApplied(false);
    setError(null);
    try {
      const response = await client.request<AiChatResponse>({
        path: "/api/v2/ai/chat",
        method: "POST",
        headers: { "x-workspace-id": workspaceId },
        body: { messages: [{ role: "user", content: actionPrompt(action, note.title, note.content) }] },
        requestClass: "command",
        policy: { timeoutMs: 35_000, retry: 0, idempotencyKey: crypto.randomUUID() },
      });
      setPreview({ action, content: response.message });
    } catch {
      setError("AI 生成失败，当前笔记内容没有改变。请稍后重试。");
    } finally {
      setPendingAction(null);
    }
  };

  const applyPreview = async () => {
    if (!preview || applying) return;
    setApplying(true);
    setError(null);
    try {
      if (preview.action === "tags") {
        const tags = parseSuggestedTags(preview.content);
        if (tags.length === 0 || !onApplyTags) throw new Error("NO_TAGS");
        await onApplyTags(tags);
      } else {
        if (!onApplyContent) throw new Error("CONTENT_APPLY_UNAVAILABLE");
        await onApplyContent(preview.content, preview.action);
      }
      setApplied(true);
    } catch {
      setError("应用 AI 结果失败，当前笔记内容没有改变。请重试。");
    } finally {
      setApplying(false);
    }
  };

  return (
    <section className="note-ai-actions" aria-labelledby="note-ai-actions-title">
      <div className="note-ai-actions-heading">
        <div>
          <p className="eyebrow">NOTE ASSIST</p>
          <h2 id="note-ai-actions-title">当前笔记 AI 操作</h2>
        </div>
        <Sparkles size={18} aria-hidden="true" />
      </div>
      <p className="note-ai-actions-help">结果会先预览，确认后才写入当前草稿或标签。</p>
      <div className="note-ai-actions-buttons">
        {ACTIONS.map(({ action, label, icon: Icon }) => (
          <button key={action} type="button" disabled={disabled || pendingAction !== null || applying} onClick={() => { void generate(action); }}>
            <Icon size={15} aria-hidden="true" />
            {pendingAction === action ? "生成中…" : label}
          </button>
        ))}
      </div>
      {error ? <p className="database-operation-error" role="alert">{error}</p> : null}
      {preview ? (
        <div className="note-ai-preview" aria-label="AI 结果预览">
          <strong>AI 结果预览</strong>
          <div className="note-ai-preview-content">{preview.content}</div>
          {applied ? <p role="status">已应用到{preview.action === "tags" ? "标签" : "当前草稿"}。</p> : <button type="button" disabled={applying} onClick={() => { void applyPreview(); }}>{preview.action === "tags" ? "应用标签" : "应用到正文"}</button>}
        </div>
      ) : null}
    </section>
  );
}
