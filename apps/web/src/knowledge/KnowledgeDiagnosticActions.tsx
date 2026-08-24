import { useState } from "react";
import type { Folder, KnowledgeDiagnostic } from "@nexus/contracts";

interface KnowledgeDiagnosticActionsProps {
  diagnostics: KnowledgeDiagnostic[];
  folders: Folder[];
  disabled: boolean;
  onClassifyUnfiled(folderId: string): void;
  onMoveOrphansToInbox(): void;
  onIgnoreOrphans(): void;
  onMergeDuplicate(diagnostic: KnowledgeDiagnostic): void;
}

export function KnowledgeDiagnosticActions({
  diagnostics,
  folders,
  disabled,
  onClassifyUnfiled,
  onMoveOrphansToInbox,
  onIgnoreOrphans,
  onMergeDuplicate,
}: KnowledgeDiagnosticActionsProps) {
  const [folderId, setFolderId] = useState("");
  const unfiledCount = diagnostics.filter((item) => item.kind === "unfiled_note").length;
  const orphanCount = diagnostics.filter((item) => item.kind === "orphan_note").length;
  const duplicateGroups = diagnostics.filter((item) => item.kind === "duplicate_title");

  if (unfiledCount === 0 && orphanCount === 0 && duplicateGroups.length === 0) return null;

  return (
    <section className="knowledge-diagnostic-actions" aria-label="知识整理动作">
      <div className="knowledge-diagnostic-actions-heading">
        <div><small>RECOVER KNOWLEDGE</small><h3>批量整理</h3></div>
        <p>所有操作都保留原笔记内容，失败时可重新执行。</p>
      </div>
      {unfiledCount > 0 ? (
        <div className="knowledge-diagnostic-action-row">
          <span><strong>未整理笔记</strong><small>{unfiledCount} 篇没有归属文件夹</small></span>
          <div className="knowledge-diagnostic-action-controls">
            <select aria-label="未整理笔记目标文件夹" value={folderId} disabled={disabled} onChange={(event) => setFolderId(event.target.value)}>
              <option value="">选择文件夹</option>
              {folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
            </select>
            <button type="button" disabled={disabled || !folderId} onClick={() => onClassifyUnfiled(folderId)}>批量归类未整理笔记</button>
          </div>
        </div>
      ) : null}
      {orphanCount > 0 ? (
        <div className="knowledge-diagnostic-action-row">
          <span><strong>孤立笔记</strong><small>{orphanCount} 篇引用了不存在的文件夹</small></span>
          <div className="knowledge-diagnostic-action-controls">
            <button type="button" disabled={disabled} onClick={onMoveOrphansToInbox}>移入收件箱</button>
            <button type="button" disabled={disabled} onClick={onIgnoreOrphans}>暂时忽略</button>
          </div>
        </div>
      ) : null}
      {duplicateGroups.map((diagnostic) => (
        <div className="knowledge-diagnostic-action-row" key={`${diagnostic.kind}:${diagnostic.entity_id}`}>
          <span><strong>重复标题：{diagnostic.title || "未命名笔记"}</strong><small>{diagnostic.count} 篇同名笔记</small></span>
          <button type="button" disabled={disabled} onClick={() => onMergeDuplicate(diagnostic)}>整理同名笔记</button>
        </div>
      ))}
    </section>
  );
}
