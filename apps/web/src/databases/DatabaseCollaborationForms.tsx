import type { DatabasePermission, DatabaseRecord } from "@nexus/contracts";
import type { CollaborationMember } from "../data/collaboration-client";

export function DatabaseCommentForm({ records, recordLabels = {}, recordId, comments, body, disabled, onRecordChange, onBodyChange, onSubmit }: { records: readonly DatabaseRecord[]; recordLabels?: Readonly<Record<string, string>>; recordId: string; comments: readonly { id: string; body: string }[]; body: string; disabled: boolean; onRecordChange(value: string): void; onBodyChange(value: string): void; onSubmit(): void }) {
  return <section aria-label="评论表单"><h2>评论线程</h2><label>记录<select value={recordId} onChange={(event) => onRecordChange(event.target.value)}>{records.map((record) => <option key={record.id} value={record.id}>{recordLabels[record.id] ?? record.id}</option>)}</select></label><ul className="database-entity-list">{comments.map((comment) => <li key={comment.id}>{comment.body}</li>)}</ul><label>评论内容<textarea value={body} onChange={(event) => onBodyChange(event.target.value)} /></label><button type="button" disabled={disabled} onClick={onSubmit}>添加评论</button></section>;
}

export function DatabasePermissionForm({ subjectType, subjectId, role, members, disabled, onSubjectTypeChange, onSubjectChange, onRoleChange, onSubmit }: {
  subjectType: DatabasePermission["subject_type"];
  subjectId: string;
  role: DatabasePermission["role"];
  members?: readonly CollaborationMember[];
  disabled: boolean;
  onSubjectTypeChange(value: DatabasePermission["subject_type"]): void;
  onSubjectChange(value: string): void;
  onRoleChange(value: DatabasePermission["role"]): void;
  onSubmit(): void;
}) {
  return <section aria-label="权限表单"><h2>数据库权限</h2><label>主体类型<select aria-label="主体类型" value={subjectType} onChange={(event) => onSubjectTypeChange(event.target.value as DatabasePermission["subject_type"])}><option value="user">成员</option><option value="role">角色</option></select></label>{subjectType === "user" ? members ? <label>成员<select aria-label="成员" value={subjectId} onChange={(event) => onSubjectChange(event.target.value)}><option value="">请选择成员</option>{members.map((member) => <option key={member.user_id} value={member.user_id}>{member.display_name} · {member.email}</option>)}</select></label> : <label>成员 ID<input aria-label="成员 ID" value={subjectId} onChange={(event) => onSubjectChange(event.target.value)} /></label> : <label>工作区角色<select aria-label="工作区角色" value={subjectId} onChange={(event) => onSubjectChange(event.target.value)}><option value="owner">owner</option><option value="editor">editor</option><option value="viewer">viewer</option></select></label>}<label>权限角色<select aria-label="权限角色" value={role} onChange={(event) => onRoleChange(event.target.value as DatabasePermission["role"])}><option value="owner">owner</option><option value="editor">editor</option><option value="viewer">viewer</option></select></label><button type="button" disabled={disabled} onClick={onSubmit}>保存权限</button></section>;
}
