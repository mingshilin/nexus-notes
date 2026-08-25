import { useState } from "react";
import type { Tag } from "@nexus/contracts";

export interface NoteTagPanelProps {
  tags: Tag[];
  selectedTagIds: string[];
  saving?: boolean;
  readOnly?: boolean;
  error?: string | null;
  onChange(tagIds: string[]): void;
  onCreateTag?(name: string): Promise<Tag>;
}

export function NoteTagPanel({
  tags,
  selectedTagIds,
  saving = false,
  readOnly = false,
  error = null,
  onChange,
  onCreateTag,
}: NoteTagPanelProps) {
  const [newTagName, setNewTagName] = useState("");
  const [creating, setCreating] = useState(false);
  const selected = new Set(selectedTagIds);

  const toggleTag = (tagId: string) => {
    const next = selected.has(tagId)
      ? selectedTagIds.filter((id) => id !== tagId)
      : [...selectedTagIds, tagId];
    onChange(next);
  };

  const createTag = async () => {
    const name = newTagName.trim();
    if (!name || !onCreateTag || creating) return;
    setCreating(true);
    try {
      const created = await onCreateTag(name);
      onChange([...selectedTagIds, created.id]);
      setNewTagName("");
    } finally {
      setCreating(false);
    }
  };

  return (
    <section className="note-tag-panel" aria-labelledby="note-tags-title">
      <div className="note-tag-panel-header">
        <div>
          <p className="eyebrow">ORGANIZE</p>
          <h2 id="note-tags-title">标签</h2>
        </div>
        {readOnly ? <span role="status">仅查看</span> : saving ? <span role="status">保存中…</span> : null}
      </div>
      {tags.length > 0 ? (
        <div className="note-tag-list">
          {tags.map((tag) => (
            <label key={tag.id} className="note-tag-option">
              <input
                type="checkbox"
                aria-label={`标签：${tag.name}`}
                checked={selected.has(tag.id)}
                disabled={readOnly || saving}
                onChange={() => toggleTag(tag.id)}
              />
              <span className="note-tag-dot" style={tag.color ? { backgroundColor: tag.color } : undefined} aria-hidden="true" />
              <span>{tag.name}</span>
            </label>
          ))}
        </div>
      ) : <p className="note-tag-empty">还没有标签。</p>}
      {onCreateTag && !readOnly ? (
        <div className="note-tag-create">
          <label>
            新建标签
            <input
              aria-label="新建标签"
              value={newTagName}
              maxLength={80}
              disabled={creating || saving}
              onChange={(event) => setNewTagName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void createTag();
                }
              }}
            />
          </label>
          <button type="button" disabled={!newTagName.trim() || creating || saving} onClick={() => void createTag()}>
            {creating ? "创建中…" : "创建标签"}
          </button>
        </div>
      ) : null}
      {error ? <p className="note-tag-error" role="alert">{error}</p> : null}
    </section>
  );
}
