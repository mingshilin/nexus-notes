import { ChevronLeft, ChevronRight } from "lucide-react";
import type { NoteExportFormat } from "@/api/export";
import type { NoteWithTags } from "@/types/note";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NoteCard } from "./NoteCard";

function parseDateString(dateString: string) {
  const [year, month, day] = dateString.split("-").map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
}

function formatDateString(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getTodayDateString() {
  return formatDateString(new Date());
}

export function shiftDate(dateString: string, deltaDays: number) {
  const date = parseDateString(dateString);
  date.setDate(date.getDate() + deltaDays);
  return formatDateString(date);
}

export function formatDailyHeading(dateString: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(parseDateString(dateString));
}

export function formatDailyTime(dateString: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(dateString));
}

export function isSameLocalDay(dateString: string, compareDateString: string) {
  return formatDateString(new Date(dateString)) === compareDateString;
}

interface DailyNoteListViewProps {
  items: NoteWithTags[];
  displayDate: string;
  total: number;
  visibleQuery: string;
  selectedNoteId: string | null;
  batchMode: boolean;
  batchSelectedIds: string[];
  onDailyDateChange?: (date: string) => void;
  onTagToggle: (id: string | null) => void;
  onSelectNote: (id: string) => void;
  onShareNote?: (id: string) => void;
  onExportNote?: (id: string, format: NoteExportFormat) => void;
  onToggleBatchNote: (id: string) => void;
  onQuickDelete?: (id: string) => void;
}

export function DailyNoteListView({
  items,
  displayDate,
  total,
  visibleQuery,
  selectedNoteId,
  batchMode,
  batchSelectedIds,
  onDailyDateChange,
  onTagToggle,
  onSelectNote,
  onShareNote,
  onExportNote,
  onToggleBatchNote,
  onQuickDelete,
}: DailyNoteListViewProps) {
  const sortedItems = [...items].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const firstDailyTime = sortedItems[0] ? formatDailyTime(sortedItems[0].created_at) : "--:--";
  const lastDailyTime = sortedItems.at(-1) ? formatDailyTime(sortedItems.at(-1)!.updated_at) : "--:--";
  const isToday = displayDate === getTodayDateString();

  return (
    <div className="space-y-2" data-testid="daily-note-list-view">
      <div className="flex min-w-0 flex-col gap-1.5 overflow-hidden rounded-[14px] border border-emerald-500/15 bg-emerald-500/[0.05] px-2 py-1.5 text-xs sm:rounded-[16px] sm:px-3 sm:py-2 2xl:flex-row 2xl:items-center 2xl:justify-between">
        <div className="min-w-0 2xl:max-w-[42%]">
          <div className="truncate font-semibold text-emerald-700 dark:text-emerald-300">
            {total} 条 · {firstDailyTime}-{lastDailyTime}
          </div>
          <div className="hidden text-[11px] text-muted-foreground sm:block">{isToday ? "今天" : displayDate}</div>
        </div>
        <div className="grid w-full min-w-0 grid-cols-[32px_minmax(0,1fr)_auto_32px] items-center gap-1.5 2xl:w-auto 2xl:max-w-[58%] 2xl:shrink-0">
          <Button size="icon" variant="outline" className="h-8 w-8 rounded-[10px]" onClick={() => onDailyDateChange?.(shiftDate(displayDate, -1))}>
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>
          <Input
            type="date"
            value={displayDate}
            onChange={(event) => onDailyDateChange?.(event.target.value)}
            className="h-8 w-full min-w-0 rounded-[10px] border-border/70 bg-white/80 px-2 text-xs shadow-none dark:bg-white/[0.06] 2xl:w-[138px]"
            aria-label="每日笔记日期"
          />
          <Button size="sm" variant={isToday ? "default" : "outline"} className="h-8 min-w-0 rounded-[10px] px-2 text-xs" onClick={() => onDailyDateChange?.(getTodayDateString())}>
            今天
          </Button>
          <Button size="icon" variant="outline" className="h-8 w-8 rounded-[10px]" onClick={() => onDailyDateChange?.(shiftDate(displayDate, 1))}>
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="rounded-[18px] border border-emerald-500/15 bg-white/65 px-3 py-3 shadow-sm dark:bg-white/[0.03] sm:rounded-[22px] sm:px-4 sm:py-4">
        <div className="space-y-3 sm:space-y-4">
          {sortedItems.map((note, index) => (
            <div key={note.id} className="grid grid-cols-[42px_minmax(0,1fr)] gap-2 sm:grid-cols-[58px_minmax(0,1fr)] sm:gap-3">
              <div className="pt-3 text-right text-[10px] font-medium tabular-nums text-muted-foreground sm:text-[11px]">
                {formatDailyTime(note.created_at)}
              </div>
              <div className="relative pb-1">
                {index < sortedItems.length - 1 ? <div className="absolute -left-[12px] top-8 bottom-[-14px] w-px bg-emerald-500/20 sm:-left-[17px] sm:bottom-[-18px]" /> : null}
                <div className="absolute -left-[16px] top-5 h-2.5 w-2.5 rounded-full bg-emerald-500 shadow-[0_0_0_4px_rgba(16,185,129,0.10)] sm:-left-[21px]" />
                <NoteCard
                  note={note}
                  selected={selectedNoteId === note.id}
                  query={visibleQuery}
                  batchMode={batchMode}
                  batchSelected={batchSelectedIds.includes(note.id)}
                  onSelect={() => onSelectNote(note.id)}
                  onTagSelect={(tagId) => onTagToggle(tagId)}
                  onShare={onShareNote ? () => onShareNote(note.id) : undefined}
                  onExport={onExportNote ? (format) => onExportNote(note.id, format) : undefined}
                  onToggleBatch={() => onToggleBatchNote(note.id)}
                  onQuickDelete={onQuickDelete ? () => onQuickDelete(note.id) : undefined}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
