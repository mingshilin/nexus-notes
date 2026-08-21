import type { DatabaseRecord } from "@nexus/contracts";

export function DatabaseCommentForm({ records, recordId, comments, body, disabled, onRecordChange, onBodyChange, onSubmit }: { records: readonly DatabaseRecord[]; recordId: string; comments: readonly { id: string; body: string }[]; body: string; disabled: boolean; onRecordChange(value: string): void; onBodyChange(value: string): void; onSubmit(): void }) {
  return <section aria-label="评论表单"><h2>评论</h2><label>记录<select value={recordId} onChange={(event) => onRecordChange(event.target.value)}>{records.map((record) => <option key={record.id} value={record.id}>{record.id}</option>)}</select></label><ul className="database-entity-list">{comments.map((comment) => <li key={comment.id}>{comment.body}</li>)}</ul><label>评论内容<textarea value={body} onChange={(event) => onBodyChange(event.target.value)} /></label><button type="button" disabled={disabled} onClick={onSubmit}>添加评论</button></section>;
}

export function DatabasePermissionForm({ subjectId, role, disabled, onSubjectChange, onRoleChange, onSubmit }: { subjectId: string; role: "owner" | "editor" | "viewer"; disabled: boolean; onSubjectChange(value: string): void; onRoleChange(value: "owner" | "editor" | "viewer"): void; onSubmit(): void }) {
  return <section aria-label="权限表单"><h2>数据库权限</h2><label>成员或角色 ID<input value={subjectId} onChange={(event) => onSubjectChange(event.target.value)} /></label><label>角色<select value={role} onChange={(event) => onRoleChange(event.target.value as typeof role)}><option value="owner">owner</option><option value="editor">editor</option><option value="viewer">viewer</option></select></label><button type="button" disabled={disabled} onClick={onSubmit}>保存权限</button></section>;
}
