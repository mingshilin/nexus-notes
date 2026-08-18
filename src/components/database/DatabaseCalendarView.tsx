import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { DatabaseProperty } from "@/types/database";
import type { NoteWithTags } from "@/types/note";
import { Button } from "@/components/ui/button";
import { cn, decodeEscapedUnicode } from "@/lib/utils";

interface DatabaseValuePayload {
  property_id: string;
  value_date?: string | null;
}

interface DatabaseCalendarViewProps {
  calendarProperty: DatabaseProperty | null;
  calendarMonth: Date;
  calendarCells: Date[];
  sortedNotes: NoteWithTags[];
  notesWithoutCalendarDate: NoteWithTags[];
  expandedCalendarDate: string | null;
  selectedNoteId: string | null;
  calendarVisibleNotesPerDay: number;
  onSetCalendarMonth: (date: Date) => void;
  onSetExpandedCalendarDate: (date: string | null) => void;
  onSelectNote: (id: string) => void;
  onCommitNoteValue: (noteId: string, property: DatabaseProperty, payload: DatabaseValuePayload, failureMessage?: string) => void;
  getDateValue: (note: NoteWithTags, property: DatabaseProperty) => string;
}

function toLocalDateInputValue(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function DatabaseCalendarView({
  calendarProperty,
  calendarMonth,
  calendarCells,
  sortedNotes,
  notesWithoutCalendarDate,
  expandedCalendarDate,
  selectedNoteId,
  calendarVisibleNotesPerDay,
  onSetCalendarMonth,
  onSetExpandedCalendarDate,
  onSelectNote,
  onCommitNoteValue,
  getDateValue,
}: DatabaseCalendarViewProps) {
  const [undatedDrafts, setUndatedDrafts] = useState<Record<string, string>>({});

  if (!calendarProperty) {
    return (
      <div className="rounded-[18px] border border-border/70 bg-white/70 p-6 text-sm text-muted-foreground dark:bg-white/[0.04]">
        先在属性管理里选择一个日期字段作为日历字段。
      </div>
    );
  }

  const activeCalendarProperty = calendarProperty;

  function assignUndatedNote(noteId: string) {
    const value = undatedDrafts[noteId];
    if (!value) return;
    onCommitNoteValue(noteId, activeCalendarProperty, { property_id: activeCalendarProperty.id, value_date: value }, "日历分配日期失败，已回滚");
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button size="sm" variant="outline" className="rounded-[12px]" onClick={() => onSetCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1))}>
          <ChevronLeft className="h-4 w-4" />
          上个月
        </Button>
        <div className="text-sm font-semibold">
          {calendarMonth.getFullYear()} 年 {calendarMonth.getMonth() + 1} 月
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="rounded-[12px]" onClick={() => onSetCalendarMonth(new Date())}>
            今天
          </Button>
          <Button size="sm" variant="outline" className="rounded-[12px]" onClick={() => onSetCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1))}>
            下个月
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {notesWithoutCalendarDate.length > 0 ? (
        <div className="rounded-[14px] border border-border/70 bg-white/70 p-3 dark:bg-white/[0.04]" aria-label="calendar-undated-panel">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-sm font-semibold">无日期记录</div>
              <p className="text-xs text-muted-foreground">{notesWithoutCalendarDate.length} 条记录没有日期，可直接分配到日历。</p>
            </div>
          </div>
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {notesWithoutCalendarDate.map((note) => (
              <div key={note.id} className="rounded-[12px] border border-border/70 bg-background/80 p-3">
                <button
                  type="button"
                  className="mb-2 block w-full truncate text-left text-sm font-medium"
                  onClick={() => onSelectNote(note.id)}
                >
                  {decodeEscapedUnicode(note.title || "无标题")}
                </button>
                <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                  <input
                    type="date"
                    value={undatedDrafts[note.id] ?? ""}
                    aria-label={`assign-calendar-date-${note.id}`}
                    onChange={(event) => setUndatedDrafts((current) => ({ ...current, [note.id]: event.target.value }))}
                    className="min-w-0 rounded-[10px] border border-input bg-background/80 px-3 py-2 text-xs outline-none"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    className="rounded-[10px]"
                    disabled={!undatedDrafts[note.id]}
                    aria-label={`assign-calendar-date-submit-${note.id}`}
                    onClick={() => assignUndatedNote(note.id)}
                  >
                    分配日期
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {expandedCalendarDate ? (
        <div className="rounded-[14px] border border-[#007aff]/20 bg-[#007aff]/[0.06] p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="text-sm font-semibold">{expandedCalendarDate} 的全部记录</div>
            <Button size="sm" variant="ghost" className="h-8 rounded-[10px]" onClick={() => onSetExpandedCalendarDate(null)}>
              收起
            </Button>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {sortedNotes
              .filter((note) => getDateValue(note, activeCalendarProperty) === expandedCalendarDate)
              .map((note) => (
                <button
                  key={note.id}
                  type="button"
                  draggable
                  aria-label={`expanded-calendar-note-${note.id}`}
                  onDragStart={(event) => event.dataTransfer.setData("text/plain", note.id)}
                  onClick={() => onSelectNote(note.id)}
                  className="rounded-[12px] border border-border/70 bg-white/80 px-3 py-2 text-left text-xs font-medium dark:bg-white/[0.05]"
                >
                  {decodeEscapedUnicode(note.title || "无标题")}
                </button>
              ))}
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-7 gap-2 text-xs text-muted-foreground">
        {["一", "二", "三", "四", "五", "六", "日"].map((label) => (
          <div key={label} className="px-2 py-1 text-center">
            {label}
          </div>
        ))}
        {calendarCells.map((date) => {
          const iso = toLocalDateInputValue(date);
          const dayNotes = sortedNotes.filter((note) => getDateValue(note, activeCalendarProperty) === iso);
          const visibleDayNotes = dayNotes.slice(0, calendarVisibleNotesPerDay);
          const hiddenDayCount = Math.max(0, dayNotes.length - visibleDayNotes.length);
          const inMonth = date.getMonth() === calendarMonth.getMonth();
          return (
            <div
              key={iso}
              aria-label={`calendar-day-${iso}`}
              className={cn(
                "min-h-[120px] rounded-[14px] border border-border/60 bg-white/70 p-2 dark:bg-white/[0.04]",
                !inMonth && "opacity-45",
              )}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                const noteId = event.dataTransfer.getData("text/plain");
                if (!noteId) return;
                onCommitNoteValue(noteId, activeCalendarProperty, { property_id: activeCalendarProperty.id, value_date: iso }, "日历移动失败，已回滚");
              }}
            >
              <div className="mb-2 text-xs font-semibold">{date.getDate()}</div>
              <div className="space-y-1">
                {visibleDayNotes.map((note) => (
                  <button
                    key={note.id}
                    draggable
                    onDragStart={(event) => event.dataTransfer.setData("text/plain", note.id)}
                    onClick={() => onSelectNote(note.id)}
                    className={cn(
                      "block w-full rounded-[10px] bg-[#007aff]/10 px-2 py-1 text-left text-xs text-[#007aff]",
                      selectedNoteId === note.id && "bg-[#007aff]/20",
                    )}
                  >
                    {decodeEscapedUnicode(note.title || "无标题")}
                  </button>
                ))}
                {hiddenDayCount > 0 ? (
                  <button
                    type="button"
                    className="block w-full rounded-[10px] border border-dashed border-[#007aff]/30 px-2 py-1 text-left text-xs text-[#007aff]"
                    onClick={() => onSetExpandedCalendarDate(iso)}
                  >
                    还有 {hiddenDayCount} 条
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
