import { useMemo, useState } from "react";
import { Bell, CheckCircle2, Clock3, Link2, Pencil, Plus, Save, Trash2, X } from "lucide-react";
import type { NoteWithTags, Reminder, UpdateReminderPayload } from "@/types/note";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "./EmptyState";
import { formatRelativeTime } from "@/lib/utils";

type ReminderFilter = "all" | "due" | "open" | "completed";

interface ReminderCenterPageProps {
  reminders: Reminder[];
  notes: NoteWithTags[];
  onOpenNote?: (id: string) => void;
  onCreate: (payload: { note_id?: string | null; title: string; description?: string; due_at: string }) => void;
  onToggleComplete: (id: string) => void;
  onUpdate: (id: string, payload: UpdateReminderPayload) => void;
  onDelete: (id: string) => void;
}

function toDatetimeLocalValue(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function ReminderCenterPage({
  reminders,
  notes,
  onOpenNote,
  onCreate,
  onToggleComplete,
  onUpdate,
  onDelete,
}: ReminderCenterPageProps) {
  const [filter, setFilter] = useState<ReminderFilter>("all");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [noteId, setNoteId] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editDueAt, setEditDueAt] = useState("");
  const [editNoteId, setEditNoteId] = useState("");

  const sorted = useMemo(() => {
    const now = Date.now();
    return [...reminders]
      .filter((item) => {
        const overdue = !item.completed_at && new Date(item.due_at).getTime() <= now;
        if (filter === "due") return overdue;
        if (filter === "open") return !item.completed_at;
        if (filter === "completed") return Boolean(item.completed_at);
        return true;
      })
      .sort((a, b) => {
        if (a.completed_at && !b.completed_at) return 1;
        if (!a.completed_at && b.completed_at) return -1;
        return new Date(a.due_at).getTime() - new Date(b.due_at).getTime();
      });
  }, [filter, reminders]);

  const dueCount = reminders.filter((item) => !item.completed_at && new Date(item.due_at).getTime() <= Date.now()).length;

  function submitCreate() {
    if (!title.trim() || !dueAt) return;
    onCreate({
      note_id: noteId || null,
      title: title.trim(),
      description: description.trim(),
      due_at: new Date(dueAt).toISOString(),
    });
    setTitle("");
    setDescription("");
    setDueAt("");
    setNoteId("");
  }

  function beginEdit(reminder: Reminder) {
    setEditingId(reminder.id);
    setEditTitle(reminder.title);
    setEditDescription(reminder.description ?? "");
    setEditDueAt(toDatetimeLocalValue(reminder.due_at));
    setEditNoteId(reminder.note_id ?? "");
  }

  function cancelEdit() {
    setEditingId(null);
    setEditTitle("");
    setEditDescription("");
    setEditDueAt("");
    setEditNoteId("");
  }

  function submitEdit() {
    if (!editingId || !editTitle.trim() || !editDueAt) return;
    onUpdate(editingId, {
      title: editTitle.trim(),
      description: editDescription.trim(),
      due_at: new Date(editDueAt).toISOString(),
      note_id: editNoteId || null,
    });
    cancelEdit();
  }

  return (
    <div className="scrollbar-subtle h-full overflow-y-auto px-4 py-5 md:px-6">
      <div className="mx-auto max-w-4xl">
        <div className="mb-5 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">提醒中心</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {dueCount > 0 ? `当前有 ${dueCount} 条已到期提醒` : "集中管理提醒、到期事项和关联笔记"}
            </p>
          </div>
          <div className="scrollbar-subtle flex gap-2 overflow-x-auto">
            {[
              { key: "all", label: "全部" },
              { key: "due", label: "已到期" },
              { key: "open", label: "未完成" },
              { key: "completed", label: "已完成" },
            ].map((item) => (
              <Button
                key={item.key}
                size="sm"
                variant={filter === item.key ? "default" : "outline"}
                className="rounded-[12px] whitespace-nowrap"
                onClick={() => setFilter(item.key as ReminderFilter)}
              >
                {item.label}
              </Button>
            ))}
          </div>
        </div>

        <div className="mb-5 rounded-[18px] border border-border/70 bg-white/72 p-4 shadow-sm dark:bg-white/[0.04]">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <Plus className="h-4 w-4" />
            快速创建提醒
          </div>
          <div className="grid gap-3">
            <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="提醒标题" className="rounded-[12px]" />
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="提醒说明"
              className="min-h-20 rounded-[12px] border border-input bg-background/80 px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
            />
            <div className="grid gap-3 md:grid-cols-[1fr_1fr_160px]">
              <Input type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} className="rounded-[12px]" />
              <select
                value={noteId}
                onChange={(event) => setNoteId(event.target.value)}
                className="rounded-[12px] border border-input bg-background/80 px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
              >
                <option value="">不关联笔记</option>
                {notes.map((note) => (
                  <option key={note.id} value={note.id}>
                    {note.title || "无标题笔记"}
                  </option>
                ))}
              </select>
              <Button className="rounded-[12px]" onClick={submitCreate} disabled={!title.trim() || !dueAt}>
                创建提醒
              </Button>
            </div>
          </div>
        </div>

        {sorted.length === 0 ? (
          <div className="flex h-full items-center justify-center p-6">
            <EmptyState icon={Bell} title="还没有提醒" description="你可以在这里或当前笔记的更多菜单里创建提醒。" />
          </div>
        ) : (
          <div className="space-y-3">
            {sorted.map((reminder) => {
              const overdue = !reminder.completed_at && new Date(reminder.due_at).getTime() <= Date.now();
              return (
                <div key={reminder.id} className="rounded-[18px] border border-border/70 bg-white/72 p-4 shadow-sm dark:bg-white/[0.04]">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0 flex-1">
                      {editingId === reminder.id ? (
                        <div className="grid gap-2">
                          <Input value={editTitle} onChange={(event) => setEditTitle(event.target.value)} className="rounded-[10px]" placeholder="提醒标题" />
                          <textarea
                            value={editDescription}
                            onChange={(event) => setEditDescription(event.target.value)}
                            placeholder="提醒说明"
                            className="min-h-16 rounded-[10px] border border-input bg-background/80 px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                          />
                          <div className="grid gap-2 md:grid-cols-[1fr_1fr]">
                            <Input type="datetime-local" value={editDueAt} onChange={(event) => setEditDueAt(event.target.value)} className="rounded-[10px]" />
                            <select
                              value={editNoteId}
                              onChange={(event) => setEditNoteId(event.target.value)}
                              className="rounded-[10px] border border-input bg-background/80 px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                            >
                              <option value="">不关联笔记</option>
                              {notes.map((note) => (
                                <option key={note.id} value={note.id}>
                                  {note.title || "无标题笔记"}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="truncate text-base font-semibold">{reminder.title}</h3>
                            {overdue ? <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-medium text-destructive">已到期</span> : null}
                            {reminder.completed_at ? <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-600">已完成</span> : null}
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                            <span className="inline-flex items-center gap-1">
                              <Clock3 className="h-3.5 w-3.5" />
                              {formatRelativeTime(reminder.due_at)}
                            </span>
                            {reminder.note_id && reminder.note_title ? (
                              <button type="button" className="inline-flex items-center gap-1 text-primary hover:underline" onClick={() => onOpenNote?.(reminder.note_id!)}>
                                <Link2 className="h-3.5 w-3.5" />
                                {reminder.note_title}
                              </button>
                            ) : null}
                          </div>
                          {reminder.description ? <p className="mt-3 text-sm leading-6 text-muted-foreground">{reminder.description}</p> : null}
                        </>
                      )}
                    </div>

                    <div className="scrollbar-subtle flex shrink-0 gap-2 overflow-x-auto">
                      {editingId === reminder.id ? (
                        <>
                          <Button size="sm" variant="outline" className="rounded-[12px] whitespace-nowrap" onClick={submitEdit}>
                            <Save className="h-4 w-4" />
                            保存
                          </Button>
                          <Button size="sm" variant="outline" className="rounded-[12px] whitespace-nowrap" onClick={cancelEdit}>
                            <X className="h-4 w-4" />
                            取消
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button size="sm" variant="outline" className="rounded-[12px] whitespace-nowrap" onClick={() => beginEdit(reminder)}>
                            <Pencil className="h-4 w-4" />
                            编辑
                          </Button>
                          <Button size="sm" variant="outline" className="rounded-[12px] whitespace-nowrap" onClick={() => onToggleComplete(reminder.id)}>
                            <CheckCircle2 className="h-4 w-4" />
                            {reminder.completed_at ? "恢复" : "完成"}
                          </Button>
                          <Button size="sm" variant="outline" className="rounded-[12px] whitespace-nowrap text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => onDelete(reminder.id)}>
                            <Trash2 className="h-4 w-4" />
                            删除
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

