import { useEffect, useState } from "react";
import { CalendarDays, Database, Inbox } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { Database as DatabaseItem } from "@/types/database";
import { normalizeDisplayIcon } from "@/lib/utils";

export type QuickCaptureTarget = "inbox" | "daily" | "database";

interface QuickCaptureDialogProps {
  open: boolean;
  databases: DatabaseItem[];
  onOpenChange: (open: boolean) => void;
  onSubmit: (payload: { target: QuickCaptureTarget; databaseId?: string | null; title: string; content: string }) => Promise<void> | void;
}

export function QuickCaptureDialog({ open, databases, onOpenChange, onSubmit }: QuickCaptureDialogProps) {
  const [target, setTarget] = useState<QuickCaptureTarget>("inbox");
  const [databaseId, setDatabaseId] = useState("");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      setTarget("inbox");
      setDatabaseId("");
      setTitle("");
      setContent("");
      setSaving(false);
    }
  }, [open]);

  async function submit() {
    if (!title.trim() && !content.trim()) return;
    setSaving(true);
    try {
      await onSubmit({ target, databaseId: target === "database" ? databaseId || databases[0]?.id || null : null, title: title.trim() || "快速记录", content });
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="mac-glass max-w-lg gap-0 rounded-[24px] p-0">
        <DialogHeader className="border-b px-5 py-4" style={{ borderColor: "var(--border-subtle)" }}>
          <DialogTitle>快速捕获</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 px-5 py-4">
          <div className="grid grid-cols-3 gap-2">
            <Button type="button" variant={target === "inbox" ? "default" : "outline"} className="rounded-[12px]" onClick={() => setTarget("inbox")}>
              <Inbox className="h-4 w-4" />
              收集箱
            </Button>
            <Button type="button" variant={target === "daily" ? "default" : "outline"} className="rounded-[12px]" onClick={() => setTarget("daily")}>
              <CalendarDays className="h-4 w-4" />
              每日
            </Button>
            <Button type="button" variant={target === "database" ? "default" : "outline"} className="rounded-[12px]" onClick={() => setTarget("database")} disabled={databases.length === 0}>
              <Database className="h-4 w-4" />
              数据库
            </Button>
          </div>
          {target === "database" ? (
            <select value={databaseId} onChange={(event) => setDatabaseId(event.target.value)} className="h-10 w-full rounded-[12px] border border-input bg-background/80 px-3 text-sm outline-none">
              {databases.map((database) => (
                <option key={database.id} value={database.id}>{normalizeDisplayIcon(database.icon) ? `${normalizeDisplayIcon(database.icon)} ` : ""}{database.name}</option>
              ))}
            </select>
          ) : null}
          <Input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="标题" className="rounded-[12px]" />
          <Textarea value={content} onChange={(event) => setContent(event.target.value)} placeholder="马上记下内容..." className="min-h-36 rounded-[12px]" />
          <div className="flex justify-end gap-2">
            <Button variant="outline" className="rounded-[12px]" onClick={() => onOpenChange(false)}>取消</Button>
            <Button className="rounded-[12px]" disabled={saving || (!title.trim() && !content.trim())} onClick={() => void submit()}>保存</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
