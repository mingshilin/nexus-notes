import { FolderPlus, Folder as FolderIcon } from "lucide-react";
import { useState, type FormEvent } from "react";
import type { Folder } from "@nexus/contracts";

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

export interface NoteOrganizationPanelProps {
  folders: Folder[];
  selectedFolderId: string | null;
  loading?: boolean;
  disabled?: boolean;
  onSelectFolder(folderId: string | null): void;
  onCreateFolder(name: string): Promise<void>;
}

export function NoteOrganizationPanel({
  folders,
  selectedFolderId,
  loading = false,
  disabled = false,
  onSelectFolder,
  onCreateFolder,
}: NoteOrganizationPanelProps) {
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const uniqueFolders = folders.filter((folder, index) => folders.findIndex((candidate) => candidate.id === folder.id) === index);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextName = name.trim();
    if (!nextName || pending || disabled) return;
    setPending(true);
    setError(null);
    void onCreateFolder(nextName).then(() => setName("")).catch((error: unknown) => {
      if (isAbortError(error)) return;
      setError("文件夹创建失败，请重试。当前输入仍保留。");
    }).finally(() => setPending(false));
  };

  return (
    <section className="note-organization" aria-label="笔记整理">
      <div className="note-organization-heading">
        <div><small>ORGANIZE</small><h3>文件夹</h3></div>
        <FolderIcon aria-hidden="true" size={16} />
      </div>
      <div className="note-organization-list" aria-label="文件夹列表">
        <button type="button" className={selectedFolderId === null ? "active" : ""} aria-label="全部文件夹" aria-pressed={selectedFolderId === null} disabled={disabled} onClick={() => onSelectFolder(null)}>
          <span>全部文件夹</span><small>{uniqueFolders.length > 0 ? `${uniqueFolders.length} 个` : "未分类也会显示"}</small>
        </button>
        {uniqueFolders.map((folder, index) => (
          <button key={`${folder.id || "folder"}-${index}`} type="button" className={selectedFolderId === folder.id ? "active" : ""} aria-label={`文件夹：${folder.name}`} aria-pressed={selectedFolderId === folder.id} disabled={disabled} onClick={() => onSelectFolder(folder.id)}>
            <span>{folder.name}</span>
          </button>
        ))}
      </div>
      {loading ? <p className="note-organization-state" role="status">正在加载文件夹…</p> : null}
      {error ? <p className="note-organization-error" role="alert">{error}</p> : null}
      <form className="note-organization-create" onSubmit={submit}>
        <input aria-label="新建文件夹名称" value={name} onChange={(event) => setName(event.target.value)} placeholder="新建文件夹" disabled={disabled || pending} />
        <button type="submit" aria-label="创建文件夹" disabled={disabled || pending || !name.trim()}>
          <FolderPlus aria-hidden="true" size={15} />
          <span>{pending ? "创建中…" : "创建文件夹"}</span>
        </button>
      </form>
    </section>
  );
}
