import { Activity, Bell, MessageSquare, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  databaseRoles,
  displayText,
  EmptyLine,
  type FeedLogWithKind,
  type FieldPermissionRow,
  formatTime,
  memberLabel,
  type PermissionEntry,
  StatusPill,
  type WorkspaceRole,
  workspaceRoles,
} from "@/components/knowledge/KnowledgeCenterShared";
import { cn, normalizeDisplayIcon } from "@/lib/utils";
import type { Database, DatabasePermissionRole } from "@/types/database";
import type { CommentThreadItem, NotificationItem } from "@/types/knowledge";
import type { NoteWithTags } from "@/types/note";
import type { WorkspaceMember } from "@/types/workspace";

interface CollaborationSecurityTabProps {
  unreadCount: number;
  readOnly: boolean;
  notifications: NotificationItem[];
  selectedNote: NoteWithTags | null;
  selectedNoteId: string | null;
  commentBody: string;
  mentionIds: string[];
  workspaceMembers: WorkspaceMember[];
  comments: CommentThreadItem[];
  memberMap: Map<string, WorkspaceMember>;
  activityFilter: string;
  filteredFeed: FeedLogWithKind[];
  databases: Database[];
  permissionDatabaseId: string;
  selectedDatabase: Database | null;
  databasePermissions: PermissionEntry[];
  fieldPermissionRows: FieldPermissionRow[];
  onMarkAllNotificationsRead: () => Promise<void>;
  onMarkNotificationRead: (id: string) => Promise<void>;
  onCommentBodyChange: (value: string) => void;
  onToggleMention: (userId: string) => void;
  onSubmitComment: () => void;
  onActivityFilterChange: (value: string) => void;
  onLoadPermissionDatabase: (databaseId: string) => Promise<void>;
  onSetDatabasePermission: (subjectType: "workspace_role" | "member", subjectId: string, role: DatabasePermissionRole | "inherit") => void;
  onToggleFieldRole: (propertyId: string, field: "viewer_roles" | "editor_roles", role: WorkspaceRole) => void;
  onSavePermissionDatabase: () => void;
}

export function CollaborationSecurityTab({
  unreadCount,
  readOnly,
  notifications,
  selectedNote,
  selectedNoteId,
  commentBody,
  mentionIds,
  workspaceMembers,
  comments,
  memberMap,
  activityFilter,
  filteredFeed,
  databases,
  permissionDatabaseId,
  selectedDatabase,
  databasePermissions,
  fieldPermissionRows,
  onMarkAllNotificationsRead,
  onMarkNotificationRead,
  onCommentBodyChange,
  onToggleMention,
  onSubmitComment,
  onActivityFilterChange,
  onLoadPermissionDatabase,
  onSetDatabasePermission,
  onToggleFieldRole,
  onSavePermissionDatabase,
}: CollaborationSecurityTabProps) {
  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <Card
        title="通知中心"
        icon={Bell}
        actions={unreadCount ? <Button size="sm" variant="outline" disabled={readOnly} onClick={() => void onMarkAllNotificationsRead()}>全部已读</Button> : null}
      >
        <div className="space-y-2">
          {notifications.map((item) => (
            <button key={item.id} className="block w-full rounded-[14px] bg-background/70 px-3 py-2 text-left text-sm" onClick={() => void onMarkNotificationRead(item.id)}>
              <div className="flex items-center gap-2 font-medium">{!item.read_at ? <span className="h-2 w-2 rounded-full bg-primary" /> : null}{item.title}</div>
              <div className="mt-1 text-xs text-muted-foreground">{item.body} · {formatTime(item.created_at)}</div>
            </button>
          ))}
          {notifications.length === 0 ? <EmptyLine>暂无通知。</EmptyLine> : null}
        </div>
      </Card>

      <Card title="当前笔记评论" icon={MessageSquare}>
        {selectedNote ? <p className="mb-2 text-xs text-muted-foreground">评论对象：{displayText(selectedNote.title, "无标题")}</p> : <p className="mb-2 text-xs text-muted-foreground">先打开一篇笔记再评论。</p>}
        <Textarea value={commentBody} onChange={(event) => onCommentBodyChange(event.target.value)} placeholder="写评论；可在下方选择要通知的成员" className="min-h-24 rounded-[12px]" />
        <div className="mt-2 flex flex-wrap gap-2">
          {workspaceMembers.map((member) => {
            const active = mentionIds.includes(member.user_id);
            return (
              <button
                key={member.user_id}
                type="button"
                className={cn("rounded-full border px-2 py-1 text-xs", active ? "border-primary bg-primary/10 text-primary" : "border-border bg-background/70 text-muted-foreground")}
                onClick={() => onToggleMention(member.user_id)}
              >
                @{memberLabel(member)}
              </button>
            );
          })}
        </div>
        <Button className="mt-2 rounded-[12px]" disabled={readOnly || !selectedNoteId || !commentBody.trim()} onClick={() => void onSubmitComment()}>发布评论</Button>
        <div className="mt-3 space-y-2">
          {comments.map((item) => (
            <div key={item.id} className="rounded-[14px] bg-background/70 px-3 py-2 text-sm">
              <div>{item.body}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {memberMap.get(item.created_by_user_id) ? memberLabel(memberMap.get(item.created_by_user_id)!) : item.created_by_user_id} · {formatTime(item.created_at)}
              </div>
            </div>
          ))}
          {comments.length === 0 ? <EmptyLine>暂无评论。</EmptyLine> : null}
        </div>
      </Card>

      <Card title="活动与审计" icon={Activity}>
        <Input value={activityFilter} onChange={(event) => onActivityFilterChange(event.target.value)} placeholder="筛选操作、对象或 ID" className="mb-3 rounded-[12px]" />
        <div className="max-h-[28rem] space-y-2 overflow-auto pr-1">
          {filteredFeed.map((item) => (
            <div key={`${item.feedKind}-${item.id}-${item.action}`} className="rounded-[14px] bg-background/70 px-3 py-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <div className="font-medium">{item.action}</div>
                <StatusPill tone={item.feedKind === "审计" ? "warn" : "muted"}>{item.feedKind}</StatusPill>
              </div>
              <div className="text-xs text-muted-foreground">{item.entity_type} · {formatTime(item.created_at)}</div>
            </div>
          ))}
          {filteredFeed.length === 0 ? <EmptyLine>没有匹配的活动或审计记录。</EmptyLine> : null}
        </div>
      </Card>

      <Card title="数据库与字段权限" icon={ShieldCheck}>
        <select value={permissionDatabaseId} onChange={(event) => void onLoadPermissionDatabase(event.target.value)} className="mb-3 w-full rounded-[12px] border border-input bg-background/80 px-3 py-2 text-sm">
          <option value="">选择数据库</option>
          {databases.map((database) => (
            <option key={database.id} value={database.id}>{normalizeDisplayIcon(database.icon) ? `${normalizeDisplayIcon(database.icon)} ` : ""}{displayText(database.name)}</option>
          ))}
        </select>
        {selectedDatabase ? (
          <div className="space-y-4">
            <div className="rounded-[14px] bg-background/70 p-3">
              <div className="mb-2 text-xs font-semibold text-muted-foreground">工作区角色权限</div>
              {workspaceRoles.map((role) => {
                const existing = databasePermissions.find((item) => item.subject_type === "workspace_role" && item.subject_id === role);
                return (
                  <label key={role} className="mb-2 grid grid-cols-[1fr_120px] items-center gap-2 text-sm">
                    <span>{role}</span>
                    <select value={existing?.role ?? (role === "viewer" ? "viewer" : "admin")} onChange={(event) => onSetDatabasePermission("workspace_role", role, event.target.value as DatabasePermissionRole)} className="rounded-[10px] border border-input bg-background px-2 py-1">
                      {databaseRoles.map((permissionRole) => <option key={permissionRole} value={permissionRole}>{permissionRole}</option>)}
                    </select>
                  </label>
                );
              })}
            </div>
            <div className="rounded-[14px] bg-background/70 p-3">
              <div className="mb-2 text-xs font-semibold text-muted-foreground">成员覆盖权限</div>
              {workspaceMembers.map((member) => {
                const existing = databasePermissions.find((item) => item.subject_type === "member" && item.subject_id === member.user_id);
                return (
                  <label key={member.user_id} className="mb-2 grid grid-cols-[1fr_120px] items-center gap-2 text-sm">
                    <span className="truncate">{memberLabel(member)}</span>
                    <select value={existing?.role ?? "inherit"} onChange={(event) => onSetDatabasePermission("member", member.user_id, event.target.value as DatabasePermissionRole | "inherit")} className="rounded-[10px] border border-input bg-background px-2 py-1">
                      <option value="inherit">继承</option>
                      {databaseRoles.map((permissionRole) => <option key={permissionRole} value={permissionRole}>{permissionRole}</option>)}
                    </select>
                  </label>
                );
              })}
              {workspaceMembers.length === 0 ? <EmptyLine>暂无成员可配置。</EmptyLine> : null}
            </div>
            <div className="space-y-2">
              <div className="text-xs font-semibold text-muted-foreground">字段权限</div>
              {fieldPermissionRows.map((row) => (
                <div key={row.id} className="rounded-[14px] bg-background/70 p-3 text-sm">
                  <div className="mb-2 font-medium">{row.name}</div>
                  {(["viewer_roles", "editor_roles"] as const).map((field) => (
                    <div key={field} className="mb-2">
                      <div className="mb-1 text-xs text-muted-foreground">{field === "viewer_roles" ? "可见角色" : "可编辑角色"}</div>
                      <div className="flex flex-wrap gap-2">
                        {workspaceRoles.map((role) => (
                          <button key={role} type="button" className={cn("rounded-full border px-2 py-1 text-xs", row[field].includes(role) ? "border-primary bg-primary/10 text-primary" : "border-border bg-background")} onClick={() => onToggleFieldRole(row.id, field, role)}>
                            {role}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ))}
              {fieldPermissionRows.length === 0 ? <EmptyLine>该数据库暂无可配置字段。</EmptyLine> : null}
            </div>
            <Button className="rounded-[12px]" disabled={readOnly} onClick={() => void onSavePermissionDatabase()}>保存权限</Button>
          </div>
        ) : <EmptyLine>选择数据库后可配置数据库级和字段级权限。</EmptyLine>}
      </Card>
    </div>
  );
}
