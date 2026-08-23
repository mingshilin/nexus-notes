import type { Note } from "@nexus/contracts";
import { Send, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import type { NotesClient } from "../data/notes-client";

export interface QuickCapturePanelProps {
  client: NotesClient;
  onClose(): void;
  onCaptured(note: Note): void;
}

export function QuickCapturePanel({ client, onClose, onCaptured }: QuickCapturePanelProps) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedContent = content.trim();
    if (!normalizedContent || pending) return;
    setPending(true);
    setError(null);
    try {
      const note = await client.quickCapture({ title: title.trim() || undefined, content: normalizedContent });
      onCaptured(note);
    } catch {
      setError("快速捕获失败，内容仍保留在这里，请重试。");
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="quick-capture-panel" aria-labelledby="quick-capture-title">
      <header className="quick-capture-header">
        <div><p className="eyebrow">QUICK CAPTURE</p><h2 id="quick-capture-title">快速捕获</h2></div>
        <button type="button" aria-label="关闭快速捕获" onClick={onClose}><X size={17} aria-hidden="true" /></button>
      </header>
      <p className="quick-capture-lead">先记录，之后再整理到文件夹、标签或数据库。</p>
      <form className="quick-capture-form" aria-label="快速捕获表单" onSubmit={submit}>
        <label>标题（可选）<input aria-label="快速捕获标题" value={title} maxLength={160} onChange={(event) => setTitle(event.target.value)} autoFocus /></label>
        <label>内容<textarea aria-label="快速捕获内容" value={content} maxLength={200_000} onChange={(event) => setContent(event.target.value)} rows={7} /></label>
        {error ? <p className="database-operation-error" role="alert">{error}</p> : null}
        <div className="quick-capture-actions">
          <button type="button" onClick={onClose}>取消</button>
          <button type="submit" disabled={pending || !content.trim()}><Send size={15} aria-hidden="true" />{pending ? "保存中…" : "保存捕获"}</button>
        </div>
      </form>
    </section>
  );
}
