import type { NoteRevision } from "@nexus/contracts";

const sourceLabels: Record<NoteRevision["source"], string> = {
  autosave: "自动保存",
  manual: "手动保存",
  restore: "恢复版本",
  conflict: "冲突快照",
  import: "导入",
};

function revisionDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export interface NoteHistoryPanelProps {
  open: boolean;
  revisions: NoteRevision[];
  loading: boolean;
  error: string | null;
  restoringRevision: number | null;
  readOnly: boolean;
  onToggle(): void;
  onRetry(): void;
  onRestore(revision: NoteRevision): void;
}

export function NoteHistoryPanel({
  open,
  revisions,
  loading,
  error,
  restoringRevision,
  readOnly,
  onToggle,
  onRetry,
  onRestore,
}: NoteHistoryPanelProps) {
  return (
    <section className="note-history-panel" aria-labelledby="note-history-title">
      <header className="note-history-heading">
        <div>
          <p className="eyebrow">RECOVERY</p>
          <h2 id="note-history-title">版本历史</h2>
        </div>
        <button type="button" className="note-history-toggle" aria-expanded={open} onClick={onToggle}>
          {open ? "收起历史" : "打开版本历史"}
        </button>
      </header>
      {open ? (
        <div className="note-history-body">
          {loading ? <p className="note-history-status" role="status">正在加载版本历史…</p> : null}
          {error ? (
            <div className="note-history-error" role="alert">
              <p>{error}</p>
              <button type="button" onClick={onRetry}>重试加载版本历史</button>
            </div>
          ) : null}
          {!loading && !error && revisions.length === 0 ? (
            <p className="note-history-status">还没有可查看的历史版本。</p>
          ) : null}
          {!loading && !error && revisions.length > 0 ? (
            <ol className="note-history-list">
              {revisions.map((item) => {
                const restoring = restoringRevision === item.revision;
                return (
                  <li className="note-history-item" key={item.id}>
                    <div className="note-history-item-heading">
                      <div>
                        <strong>版本 {item.revision}</strong>
                        <span>{sourceLabels[item.source]} · {revisionDate(item.created_at)}</span>
                      </div>
                      <button
                        type="button"
                        className="note-history-restore"
                        aria-label={`恢复版本 ${item.revision}`}
                        disabled={readOnly || restoringRevision !== null}
                        onClick={() => onRestore(item)}
                      >
                        {restoring ? "正在恢复…" : "恢复"}
                      </button>
                    </div>
                    <h3>{item.title.trim() || "未命名笔记"}</h3>
                    <p className="note-history-preview">{item.content.trim() || "空白笔记"}</p>
                  </li>
                );
              })}
            </ol>
          ) : null}
          {readOnly && revisions.length > 0 ? <p className="note-history-readonly">当前角色只能查看历史，恢复版本需要编辑权限。</p> : null}
        </div>
      ) : null}
    </section>
  );
}
