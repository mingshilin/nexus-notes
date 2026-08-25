interface ConflictDraft {
  title: string;
  content: string;
}

interface ConflictServerNote extends ConflictDraft {
  revision: number;
}

interface NoteConflictPanelProps {
  local: ConflictDraft;
  server: ConflictServerNote;
  onKeepLocal(): void;
  onUseServer(): void;
}

export function NoteConflictPanel({ local, server, onKeepLocal, onUseServer }: NoteConflictPanelProps) {
  return (
    <section className="note-conflict-panel" aria-label="笔记冲突恢复">
      <div className="note-conflict-heading">
        <div>
          <small>离线冲突</small>
          <h3>请选择要保留的版本</h3>
        </div>
        <span role="status">本地内容仍已保留</span>
      </div>
      <div className="note-conflict-versions">
        <article className="note-conflict-version">
          <div className="note-conflict-version-heading">
            <strong>本地草稿</strong>
            <span>尚未同步</span>
          </div>
          <h4>{local.title || "未命名笔记"}</h4>
          <pre>{local.content || "（没有正文）"}</pre>
          <button type="button" onClick={onKeepLocal}>保留本地版本</button>
        </article>
        <article className="note-conflict-version">
          <div className="note-conflict-version-heading">
            <strong>服务器版本 · 修订 {server.revision}</strong>
            <span>其他设备或浏览器已更新</span>
          </div>
          <h4>{server.title || "未命名笔记"}</h4>
          <pre>{server.content || "（没有正文）"}</pre>
          <button type="button" onClick={onUseServer}>采用服务器版本</button>
        </article>
      </div>
    </section>
  );
}
