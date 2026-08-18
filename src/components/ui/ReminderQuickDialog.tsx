import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

interface ReminderQuickDialogProps {
  open: boolean;
  noteTitle?: string;
  loading?: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (payload: { title: string; description: string; due_at: string }) => Promise<void>;
}

export function ReminderQuickDialog({
  open,
  noteTitle,
  loading = false,
  onOpenChange,
  onSubmit,
}: ReminderQuickDialogProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueAt, setDueAt] = useState("");

  useEffect(() => {
    if (!open) return;
    setTitle(noteTitle ? `跟进：${noteTitle}` : "");
    setDescription("");
    setDueAt("");
  }, [open, noteTitle]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="mac-glass max-w-lg rounded-[24px]">
        <DialogHeader>
          <div className="mb-2 inline-flex h-11 w-11 items-center justify-center rounded-[14px] border border-primary/15 bg-primary/[0.08] text-primary">
            <Bell className="h-5 w-5" />
          </div>
          <DialogTitle>创建提醒</DialogTitle>
          <DialogDescription>给当前笔记添加一个到期提醒，支持站内提示和邮件提醒。</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="提醒标题" className="rounded-[12px]" />
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="提醒说明"
            className="min-h-24 rounded-[12px] border border-input bg-background/80 px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
          />
          <Input type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} className="rounded-[12px]" />
        </div>

        <DialogFooter>
          <Button variant="outline" className="rounded-[12px]" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            className="rounded-[12px]"
            disabled={loading || !title.trim() || !dueAt}
            onClick={() => void onSubmit({ title: title.trim(), description: description.trim(), due_at: new Date(dueAt).toISOString() })}
          >
            创建提醒
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
