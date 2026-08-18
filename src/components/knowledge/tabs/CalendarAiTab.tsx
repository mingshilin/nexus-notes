import { CalendarDays, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Card, displayText, EmptyLine, formatDate } from "@/components/knowledge/KnowledgeCenterShared";

interface CalendarFeedItem {
  id: string;
  note_id?: string | null;
  title: string;
}

interface CalendarFeedData {
  reminders: Array<CalendarFeedItem & { due_at: string }>;
  daily: Array<CalendarFeedItem & { daily_date: string }>;
  database_dates: Array<CalendarFeedItem & { date: string }>;
}

interface CalendarAiTabProps {
  mode: "calendar" | "ai";
  calendarFeed: CalendarFeedData | null;
  onOpenNote: (id: string) => void;
}

export function CalendarAiTab({ mode, calendarFeed, onOpenNote }: CalendarAiTabProps) {
  if (mode === "calendar") {
    return (
      <Card title="统一日历" icon={CalendarDays}>
        <div className="grid gap-3 md:grid-cols-3">
          <CalendarColumn title="提醒" items={(calendarFeed?.reminders ?? []).map((item) => ({ id: item.id, noteId: item.note_id, title: item.title, date: item.due_at }))} onOpenNote={onOpenNote} />
          <CalendarColumn title="每日笔记" items={(calendarFeed?.daily ?? []).map((item) => ({ id: item.id, noteId: item.id, title: item.title, date: item.daily_date }))} onOpenNote={onOpenNote} />
          <CalendarColumn title="数据库日期" items={(calendarFeed?.database_dates ?? []).map((item) => ({ id: item.id, noteId: item.id, title: item.title, date: item.date }))} onOpenNote={onOpenNote} />
        </div>
      </Card>
    );
  }

  return (
    <Card title="按需 AI 辅助" icon={Sparkles}>
      <div className="mb-4 rounded-[16px] border border-dashed border-border bg-background/70 p-4 text-sm text-muted-foreground">
        AI 功能保持手动触发。当前版本没有检测到模型配置时，只展示入口和预期行为，不自动改写用户内容。
      </div>
      <div className="grid gap-3 md:grid-cols-4">
        {["摘要当前笔记", "建议标签", "查找相似笔记", "生成标题"].map((label) => (
          <button key={label} className="rounded-[18px] border border-dashed border-border bg-background/70 p-5 text-left text-sm hover:bg-white/80 dark:hover:bg-white/[0.06]" onClick={() => toast.message("AI 辅助尚未配置模型；配置后可手动触发。")}>
            <Sparkles className="mb-3 h-5 w-5 text-primary" />
            <div className="font-medium">{label}</div>
            <div className="mt-1 text-xs text-muted-foreground">手动触发，不默认改写内容。</div>
          </button>
        ))}
      </div>
    </Card>
  );
}

function CalendarColumn({ title, items, onOpenNote }: { title: string; items: Array<{ id: string; noteId?: string | null; title: string; date: string }>; onOpenNote: (id: string) => void }) {
  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold text-muted-foreground">{title}</div>
      {items.map((item) => (
        <button key={`${title}-${item.id}`} className="block w-full rounded-[12px] bg-background/70 px-3 py-2 text-left text-sm" onClick={() => item.noteId ? onOpenNote(item.noteId) : undefined}>
          <div className="truncate font-medium">{displayText(item.title, "无标题")}</div>
          <div className="text-xs text-muted-foreground">{formatDate(item.date)}</div>
        </button>
      ))}
      {items.length === 0 ? <EmptyLine>暂无。</EmptyLine> : null}
    </div>
  );
}
