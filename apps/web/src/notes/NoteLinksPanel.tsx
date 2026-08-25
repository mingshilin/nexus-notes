import { Link2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { Note, NoteLink } from "@nexus/contracts";

interface NoteLinksPanelProps {
  currentNoteId?: string;
  notes: Note[];
  linkedNoteIds: string[];
  backlinks: NoteLink[];
  loading?: boolean;
  readOnly?: boolean;
  saving?: boolean;
  error?: string | null;
  onSave(targetNoteIds: string[]): void | Promise<void>;
}

export function NoteLinksPanel({
  currentNoteId,
  notes,
  linkedNoteIds,
  backlinks,
  loading = false,
  readOnly = false,
  saving = false,
  error = null,
  onSave,
}: NoteLinksPanelProps) {
  const [open, setOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>(linkedNoteIds);

  useEffect(() => setSelectedIds(linkedNoteIds), [linkedNoteIds]);

  const candidates = notes.filter((note) => note.id !== currentNoteId && note.status === "active");
  const titleById = new Map(notes.map((note) => [note.id, note.title.trim() || "未命名笔记"]));

  return (
    <section className="note-links-panel">
      <button className="note-links-toggle" type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <span><Link2 aria-hidden="true" size={15} />笔记链接</span>
        <small>{selectedIds.length} 个链接 · {backlinks.length} 个反向链接</small>
      </button>
      {open ? (
        <div className="note-links-content" role="region" aria-label="笔记链接">
          {loading ? <p className="note-links-state" role="status">正在加载笔记链接…</p> : null}
          <div className="note-links-section">
            <strong>链接到</strong>
            {candidates.length === 0 ? <p>暂无其他可链接的笔记。</p> : <div className="note-links-options">
              {candidates.map((note) => <label key={note.id}>
                <input
                  type="checkbox"
                  aria-label={`链接到：${note.title.trim() || "未命名笔记"}`}
                  checked={selectedIds.includes(note.id)}
                  disabled={readOnly || saving}
                  onChange={(event) => setSelectedIds((current) => event.target.checked
                    ? [...current, note.id]
                    : current.filter((id) => id !== note.id))}
                />
                <span>{note.title.trim() || "未命名笔记"}</span>
              </label>)}
            </div>}
          </div>
          <div className="note-links-section">
            <strong>反向链接</strong>
            {backlinks.length === 0 ? <p>还没有笔记链接到这里。</p> : <ul className="note-backlinks-list">
              {backlinks.map((link) => <li key={link.id}>来自：{titleById.get(link.source_note_id) ?? link.source_note_id}</li>)}
            </ul>}
          </div>
          {error ? <p className="note-links-error" role="alert">{error}</p> : null}
          {!readOnly ? <button className="note-links-save" type="button" disabled={saving} onClick={() => void onSave(selectedIds)}>{saving ? "保存中…" : "保存笔记链接"}</button> : null}
        </div>
      ) : null}
    </section>
  );
}
