import type { ClipperInput, Database, Note } from "@nexus/contracts";
import { Globe2, X } from "lucide-react";
import { createPortal } from "react-dom";
import { useId, useState } from "react";

type WebClipperClient = Pick<{
  clipperCapture(input: ClipperInput): Promise<Note>;
}, "clipperCapture">;

export interface WebClipperPanelProps {
  client: WebClipperClient;
  databases: Array<Pick<Database, "id" | "name">>;
  onClose(): void;
  onCaptured?(note: Note): void;
}

function isSafeUrl(value: string) {
  if (!value) return true;
  try {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

export function WebClipperPanel({ client, databases, onClose, onCaptured }: WebClipperPanelProps) {
  const titleId = useId();
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [content, setContent] = useState("");
  const [target, setTarget] = useState<ClipperInput["target"]>("inbox");
  const [databaseId, setDatabaseId] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const databaseTarget = target === "database";
  const invalidUrl = Boolean(url.trim()) && !isSafeUrl(url.trim());
  const canSubmit = !pending && Boolean(content.trim()) && !invalidUrl && (!databaseTarget || Boolean(databaseId));

  const submit = async () => {
    if (!canSubmit) return;
    setPending(true);
    setError(null);
    try {
      const input: ClipperInput = {
        title: title.trim() || undefined,
        url: url.trim() || undefined,
        content,
        target,
        database_id: databaseTarget ? databaseId : undefined,
      };
      const note = await client.clipperCapture(input);
      onCaptured?.(note);
    } catch {
      setError("剪藏失败，输入内容已保留，请检查网络后重试。");
    } finally {
      setPending(false);
    }
  };

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="create-center-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !pending) onClose(); }}>
      <section className="create-center-dialog import-export-dialog web-clipper-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} onMouseDown={(event) => event.stopPropagation()}>
        <header className="create-center-header">
          <div>
            <p className="eyebrow">WEB CLIPPER</p>
            <h2 id={titleId}>保存网页剪藏</h2>
            <p>保留来源、正文和目标位置，失败时不会清空当前输入。</p>
          </div>
          <button type="button" className="create-center-close" aria-label="关闭 Web Clipper" onClick={onClose} disabled={pending}><X aria-hidden="true" size={18} /></button>
        </header>
        <div className="web-clipper-fields">
          <label>标题<input aria-label="剪藏标题" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={160} placeholder="可选，默认使用来源或 Web Clip" /></label>
          <label>来源 URL<input aria-label="来源 URL" type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.com/article" aria-invalid={invalidUrl} /></label>
          {invalidUrl ? <p className="create-center-feedback error" role="alert">来源 URL 只能使用 http 或 https。</p> : null}
          <label>正文<textarea aria-label="剪藏正文" value={content} onChange={(event) => setContent(event.target.value)} rows={9} placeholder="粘贴网页正文或选中的内容" /></label>
          <label>保存到<select aria-label="剪藏目标" value={target} onChange={(event) => { const next = event.target.value as ClipperInput["target"]; setTarget(next); if (next !== "database") setDatabaseId(""); }}>
            <option value="inbox">收件箱</option>
            <option value="daily">今日笔记</option>
            <option value="database">数据库</option>
          </select></label>
          {databaseTarget ? <label>目标数据库<select aria-label="目标数据库" value={databaseId} onChange={(event) => setDatabaseId(event.target.value)}>
            <option value="">选择数据库</option>
            {databases.map((database) => <option key={database.id} value={database.id}>{database.name}</option>)}
          </select></label> : null}
          {databaseTarget && !databaseId ? <p className="create-center-feedback" role="status">请先选择目标数据库。</p> : null}
          {!content.trim() ? <p className="create-center-feedback" role="status">请粘贴正文后再保存剪藏。</p> : null}
          {error ? <p className="create-center-feedback error" role="alert">{error}</p> : null}
        </div>
        <div className="account-actions import-export-actions">
          <button type="button" onClick={onClose} disabled={pending}>取消</button>
          <button type="button" disabled={!canSubmit} onClick={() => void submit()}><Globe2 aria-hidden="true" size={16} />{pending ? "正在保存…" : "保存剪藏"}</button>
        </div>
      </section>
    </div>,
    document.body,
  );
}
