import { useEffect, useMemo, useState } from "react";
import { Bell, Copy, Download, LogOut, Moon, Settings, Sun, Trash2, Upload, Users } from "lucide-react";
import type { AllExportFormat } from "@/api/export";
import type { ThemeMode } from "@/store/useAppStore";
import type { AuthUser } from "@/types/auth";
import type { NoteWithTags, Reminder } from "@/types/note";
import type { Workspace, WorkspaceMember } from "@/types/workspace";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MoreMenu } from "@/components/ui/MoreMenu";
import { ALL_EXPORT_FORMATS, getExportFormatLabel } from "@/lib/noteActions";
import { copyTextToClipboard } from "@/lib/share";
import { formatRelativeTime } from "@/lib/utils";

interface SettingsDialogProps {
  open: boolean;
  theme: ThemeMode;
  profile: AuthUser | null;
  reminders: Reminder[];
  notes: NoteWithTags[];
  workspaces: Workspace[];
  workspaceMembers: WorkspaceMember[];
  currentWorkspaceId: string | null;
  currentWorkspaceRole: "owner" | "editor" | "viewer";
  savingProfile?: boolean;
  savingReminder?: boolean;
  onOpenChange: (open: boolean) => void;
  onThemeChange: (theme: ThemeMode) => void;
  onOpenShortcuts: () => void;
  onExportAllFormat: (format: AllExportFormat) => void;
  onEmptyTrash: () => void;
  onLogout: () => void;
  onSaveProfile: (payload: { display_name: string; bio: string }) => Promise<void>;
  onUploadAvatar: (file: File) => Promise<void>;
  onCreateReminder: (payload: { note_id?: string | null; title: string; description?: string; due_at: string }) => Promise<void>;
  onToggleReminderComplete: (id: string) => Promise<void>;
  onDeleteReminder: (id: string) => Promise<void>;
  onCreateWorkspace: (name: string) => Promise<void>;
  onSwitchWorkspace: (workspaceId: string) => Promise<void>;
  onInviteWorkspaceMember: (payload: { email: string; role: "editor" | "viewer" }) => Promise<{ invite_url: string }>;
}

const themeLabels: Record<ThemeMode, string> = {
  light: "浅色",
  dark: "深色",
  system: "跟随系统",
};

export function SettingsDialog({
  open,
  theme,
  profile,
  reminders,
  notes,
  workspaces,
  workspaceMembers,
  currentWorkspaceId,
  currentWorkspaceRole,
  savingProfile = false,
  savingReminder = false,
  onOpenChange,
  onThemeChange,
  onOpenShortcuts,
  onExportAllFormat,
  onEmptyTrash,
  onLogout,
  onSaveProfile,
  onUploadAvatar,
  onCreateReminder,
  onToggleReminderComplete,
  onDeleteReminder,
  onCreateWorkspace,
  onSwitchWorkspace,
  onInviteWorkspaceMember,
}: SettingsDialogProps) {
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [reminderTitle, setReminderTitle] = useState("");
  const [reminderDescription, setReminderDescription] = useState("");
  const [reminderDueAt, setReminderDueAt] = useState("");
  const [reminderNoteId, setReminderNoteId] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"editor" | "viewer">("editor");
  const [inviteResult, setInviteResult] = useState("");
  const [workspaceBusy, setWorkspaceBusy] = useState(false);

  const sortedReminders = useMemo(
    () =>
      [...reminders].sort((a, b) => {
        if (a.completed_at && !b.completed_at) return 1;
        if (!a.completed_at && b.completed_at) return -1;
        return new Date(a.due_at).getTime() - new Date(b.due_at).getTime();
      }),
    [reminders],
  );

  useEffect(() => {
    setDisplayName(profile?.display_name ?? "");
    setBio(profile?.bio ?? "");
  }, [profile?.display_name, profile?.bio, open]);

  async function submitReminder() {
    if (!reminderTitle.trim() || !reminderDueAt) return;
    const dueIso = new Date(reminderDueAt).toISOString();
    await onCreateReminder({
      note_id: reminderNoteId || null,
      title: reminderTitle.trim(),
      description: reminderDescription.trim(),
      due_at: dueIso,
    });
    setReminderTitle("");
    setReminderDescription("");
    setReminderDueAt("");
    setReminderNoteId("");
  }

  async function submitWorkspaceCreate() {
    if (!workspaceName.trim()) return;
    setWorkspaceBusy(true);
    try {
      await onCreateWorkspace(workspaceName.trim());
      setWorkspaceName("");
    } finally {
      setWorkspaceBusy(false);
    }
  }

  async function submitInvite() {
    if (!inviteEmail.trim()) return;
    setWorkspaceBusy(true);
    setInviteResult("");
    try {
      const result = await onInviteWorkspaceMember({ email: inviteEmail.trim(), role: inviteRole });
      setInviteResult(result.invite_url);
      setInviteEmail("");
    } finally {
      setWorkspaceBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="mac-glass max-w-5xl gap-0 rounded-[24px] p-0">
        <DialogHeader className="border-b px-6 py-5" style={{ borderColor: "var(--border-subtle)" }}>
          <div className="mb-2 inline-flex h-11 w-11 items-center justify-center rounded-[14px] border border-primary/15 bg-primary/[0.08] text-primary">
            <Settings className="h-5 w-5" />
          </div>
          <DialogTitle>个人资料与设置</DialogTitle>
          <DialogDescription>账户资料、工作区协作、提醒和导出都在这里管理。</DialogDescription>
        </DialogHeader>

        <div className="scrollbar-subtle max-h-[min(82dvh,54rem)] overflow-y-auto px-6 py-5">
          <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
          <section className="space-y-6">
            <div className="rounded-[18px] border border-border/70 bg-white/65 p-4 dark:bg-white/[0.04]">
              <div className="mb-4 flex items-center gap-4">
                {profile?.avatar_url ? (
                  <img src={profile.avatar_url} alt={profile.display_name ?? profile.email} className="h-16 w-16 rounded-full border border-border object-cover" />
                ) : (
                  <div className="flex h-16 w-16 items-center justify-center rounded-full border border-border bg-black text-xl font-semibold text-white dark:bg-white dark:text-black">
                    {(profile?.display_name || profile?.email || "N").slice(0, 1).toUpperCase()}
                  </div>
                )}
                <div className="space-y-2">
                  <div>
                    <div className="text-base font-semibold">{profile?.display_name || "未设置显示名"}</div>
                    <div className="text-sm text-muted-foreground">{profile?.email}</div>
                  </div>
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-[12px] border border-border px-3 py-2 text-sm hover:bg-black/[0.03] dark:hover:bg-white/[0.04]">
                    <Upload className="h-4 w-4" />
                    更换头像
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) void onUploadAvatar(file);
                        event.currentTarget.value = "";
                      }}
                    />
                  </label>
                </div>
              </div>

              <div className="grid gap-3">
                <Input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="显示名" className="rounded-[12px]" />
                <textarea
                  value={bio}
                  onChange={(event) => setBio(event.target.value)}
                  placeholder="个人简介"
                  className="min-h-24 rounded-[12px] border border-input bg-background/80 px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                />
                <div className="flex justify-end">
                  <Button className="rounded-[12px]" disabled={savingProfile} onClick={() => void onSaveProfile({ display_name: displayName.trim(), bio: bio.trim() })}>
                    保存资料
                  </Button>
                </div>
              </div>
            </div>

            <div className="rounded-[18px] border border-border/70 bg-white/65 p-4 dark:bg-white/[0.04]">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <Users className="h-4 w-4" />
                共享工作区
              </div>
              <div className="grid gap-3">
                <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                  <Input value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} placeholder="新工作区名称" className="rounded-[12px]" />
                  <Button className="rounded-[12px]" disabled={workspaceBusy} onClick={() => void submitWorkspaceCreate()}>
                    创建工作区
                  </Button>
                </div>

                <div className="grid gap-2">
                  <label className="text-xs text-muted-foreground">当前工作区</label>
                  <select
                    value={currentWorkspaceId ?? ""}
                    onChange={(event) => void onSwitchWorkspace(event.target.value)}
                    className="rounded-[12px] border border-input bg-background/80 px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                  >
                    {workspaces.map((workspace) => (
                      <option key={workspace.id} value={workspace.id}>
                        {workspace.name}
                      </option>
                    ))}
                  </select>
                </div>

                {currentWorkspaceRole === "owner" ? (
                  <div className="grid gap-2 rounded-[12px] border border-border/70 p-3">
                    <div className="grid gap-2 sm:grid-cols-[1fr_120px_auto]">
                      <Input value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="成员邮箱" className="rounded-[10px]" />
                      <select
                        value={inviteRole}
                        onChange={(event) => setInviteRole(event.target.value as "editor" | "viewer")}
                        className="rounded-[10px] border border-input bg-background/80 px-2 text-sm outline-none"
                      >
                        <option value="editor">编辑者</option>
                        <option value="viewer">只读者</option>
                      </select>
                      <Button className="rounded-[10px]" disabled={workspaceBusy} onClick={() => void submitInvite()}>
                        邀请
                      </Button>
                    </div>
                    {inviteResult ? (
                      <div className="space-y-2 rounded-[10px] border border-border/70 bg-background/65 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs text-muted-foreground">最近一次生成的工作区邀请链接</p>
                          <Button size="sm" variant="outline" className="rounded-[10px]" onClick={() => void copyTextToClipboard(inviteResult)}>
                            <Copy className="h-3.5 w-3.5" />
                            复制
                          </Button>
                        </div>
                        <p className="break-all text-xs text-muted-foreground">{inviteResult}</p>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">你当前不是 Owner，仅可查看成员。</p>
                )}

                <div className="space-y-2">
                  {workspaceMembers.map((member) => (
                    <div key={member.id} className="flex items-center justify-between rounded-[10px] border border-border/70 px-3 py-2 text-sm">
                      <div className="min-w-0">
                        <div className="truncate font-medium">{member.display_name || member.email}</div>
                        <div className="truncate text-xs text-muted-foreground">{member.email}</div>
                      </div>
                      <span className="text-xs text-muted-foreground">{member.role}</span>
                    </div>
                  ))}
                  {workspaceMembers.length === 0 ? <p className="text-xs text-muted-foreground">暂无成员数据。</p> : null}
                </div>
              </div>
            </div>

            <div className="rounded-[18px] border border-border/70 bg-white/65 p-4 dark:bg-white/[0.04]">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <Bell className="h-4 w-4" />
                创建提醒
              </div>
              <div className="grid gap-3">
                <Input value={reminderTitle} onChange={(event) => setReminderTitle(event.target.value)} placeholder="提醒标题" className="rounded-[12px]" />
                <textarea
                  value={reminderDescription}
                  onChange={(event) => setReminderDescription(event.target.value)}
                  placeholder="提醒说明"
                  className="min-h-20 rounded-[12px] border border-input bg-background/80 px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                />
                <div className="grid gap-3 sm:grid-cols-2">
                  <Input type="datetime-local" value={reminderDueAt} onChange={(event) => setReminderDueAt(event.target.value)} className="rounded-[12px]" />
                  <select
                    value={reminderNoteId}
                    onChange={(event) => setReminderNoteId(event.target.value)}
                    className="rounded-[12px] border border-input bg-background/80 px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                  >
                    <option value="">不关联笔记</option>
                    {notes.map((note) => (
                      <option key={note.id} value={note.id}>
                        {note.title || "无标题笔记"}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex justify-end">
                  <Button className="rounded-[12px]" disabled={savingReminder} onClick={() => void submitReminder()}>
                    创建提醒
                  </Button>
                </div>
              </div>
            </div>
          </section>

          <section className="space-y-6">
            <div className="rounded-[18px] border border-border/70 bg-white/65 p-4 dark:bg-white/[0.04]">
              <div className="mb-3 text-sm font-semibold">提醒列表</div>
              <div className="space-y-2">
                {sortedReminders.length === 0 ? (
                  <div className="rounded-[14px] border border-dashed border-border/70 p-4 text-sm text-muted-foreground">还没有提醒事项。</div>
                ) : (
                  sortedReminders.map((reminder) => (
                    <div key={reminder.id} className="rounded-[14px] border border-border/70 bg-background/70 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">{reminder.title}</div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {formatRelativeTime(reminder.due_at)}
                            {reminder.note_title ? ` · ${reminder.note_title}` : ""}
                          </div>
                          {reminder.description ? <p className="mt-2 text-xs text-muted-foreground">{reminder.description}</p> : null}
                        </div>
                        <div className="flex shrink-0 gap-2">
                          <Button size="sm" variant="outline" className="rounded-[10px]" onClick={() => void onToggleReminderComplete(reminder.id)}>
                            {reminder.completed_at ? "恢复" : "完成"}
                          </Button>
                          <Button size="sm" variant="destructive" className="rounded-[10px]" onClick={() => void onDeleteReminder(reminder.id)}>
                            删除
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-[18px] border border-border/70 bg-white/65 p-4 dark:bg-white/[0.04]">
              <div className="mb-3 text-sm font-semibold">主题</div>
              <div className="grid grid-cols-3 gap-2">
                {(["light", "dark", "system"] as ThemeMode[]).map((item) => (
                  <Button key={item} variant={theme === item ? "default" : "outline"} className="rounded-[12px]" onClick={() => onThemeChange(item)}>
                    {item === "dark" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
                    {themeLabels[item]}
                  </Button>
                ))}
              </div>
            </div>

            <div className="grid gap-2">
              <Button variant="outline" className="justify-start rounded-[12px]" onClick={() => { onOpenChange(false); onOpenShortcuts(); }}>
                查看快捷键
              </Button>
              <MoreMenu
                triggerLabel="导出全部数据"
                align="left"
                menuClassName="w-48"
                trigger={
                  <Button variant="outline" className="justify-start rounded-[12px]">
                    <Download className="h-4 w-4" />
                    导出全部数据
                  </Button>
                }
              >
                {ALL_EXPORT_FORMATS.map((format) => (
                  <button
                    key={format}
                    type="button"
                    className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm hover:bg-black/5 dark:hover:bg-white/[0.05]"
                    onClick={() => onExportAllFormat(format)}
                  >
                    <Download className="h-4 w-4" />
                    导出 {getExportFormatLabel(format)}
                  </button>
                ))}
              </MoreMenu>
              <Button variant="outline" className="justify-start rounded-[12px]" onClick={onEmptyTrash}>
                <Trash2 className="h-4 w-4" />
                清空回收站
              </Button>
              <Button variant="outline" className="justify-start rounded-[12px]" onClick={onLogout}>
                <LogOut className="h-4 w-4" />
                退出登录
              </Button>
            </div>
          </section>
        </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
