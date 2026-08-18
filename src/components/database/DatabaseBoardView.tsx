import type { DatabaseProperty, SelectOption } from "@/types/database";
import type { NoteWithTags } from "@/types/note";
import type { WorkspaceMember } from "@/types/workspace";
import { Button } from "@/components/ui/button";
import { cn, decodeEscapedUnicode } from "@/lib/utils";

interface DatabaseValuePayload {
  property_id: string;
  value_boolean?: boolean | null;
  value_json?: string[] | null;
}

interface DatabaseBoardViewProps {
  boardProperty: DatabaseProperty | null;
  boardOptions: SelectOption[];
  ungroupedBoardId: string;
  notesByBoard: Map<string, NoteWithTags[]>;
  nonTitleProperties: DatabaseProperty[];
  selectedNoteId: string | null;
  workspaceMembers: WorkspaceMember[];
  boardColumnLimits: Record<string, number>;
  boardInitialColumnLimit: number;
  onSelectNote: (id: string) => void;
  onSetBoardColumnLimits: (updater: (current: Record<string, number>) => Record<string, number>) => void;
  onCommitNoteValue: (noteId: string, property: DatabaseProperty, payload: DatabaseValuePayload, failureMessage?: string) => void;
  formatValue: (note: NoteWithTags, property: DatabaseProperty, members: WorkspaceMember[]) => string;
}

export function DatabaseBoardView({
  boardProperty,
  boardOptions,
  ungroupedBoardId,
  notesByBoard,
  nonTitleProperties,
  selectedNoteId,
  workspaceMembers,
  boardColumnLimits,
  boardInitialColumnLimit,
  onSelectNote,
  onSetBoardColumnLimits,
  onCommitNoteValue,
  formatValue,
}: DatabaseBoardViewProps) {
  if (!boardProperty) {
    return (
      <div className="rounded-[18px] border border-border/70 bg-white/70 p-6 text-sm text-muted-foreground dark:bg-white/[0.04]">
        先在属性管理里选择一个看板分组字段。
      </div>
    );
  }

  return (
    <div className="grid auto-cols-[minmax(260px,1fr)] grid-flow-col gap-3 overflow-x-auto pb-2 xl:grid-flow-row xl:grid-cols-4">
      {[...boardOptions, { id: ungroupedBoardId, name: "未分类", color: "#8E8E93" }].map((option) => {
        const columnNotes = notesByBoard.get(option.id) ?? [];
        const columnWindowSize = Math.max(1, boardInitialColumnLimit);
        const maxColumnStart = columnNotes.length > 0
          ? Math.floor((columnNotes.length - 1) / columnWindowSize) * columnWindowSize
          : 0;
        const columnStart = Math.min(Math.max(boardColumnLimits[option.id] ?? 0, 0), maxColumnStart);
        const visibleColumnNotes = columnNotes.slice(columnStart, columnStart + columnWindowSize);
        const rangeStart = columnNotes.length === 0 ? 0 : columnStart + 1;
        const rangeEnd = columnStart + visibleColumnNotes.length;
        const hasPreviousWindow = columnStart > 0;
        const hasNextWindow = rangeEnd < columnNotes.length;

        return (
          <div
            key={option.id}
            aria-label={`board-column-${option.id}`}
            className="min-h-[260px] rounded-[18px] border border-border/70 bg-white/70 p-3 dark:bg-white/[0.04]"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              const noteId = event.dataTransfer.getData("text/plain");
              if (!noteId) return;
              if (boardProperty.type === "checkbox") {
                onCommitNoteValue(noteId, boardProperty, {
                  property_id: boardProperty.id,
                  value_boolean: option.id === "true" ? true : option.id === "false" ? false : null,
                }, "看板移动失败，已回滚");
              } else {
                onCommitNoteValue(noteId, boardProperty, {
                  property_id: boardProperty.id,
                  value_json: option.id === ungroupedBoardId ? [] : [option.id],
                }, "看板移动失败，已回滚");
              }
            }}
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2 font-semibold">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: option.color }} />
                <span className="truncate">{option.name}</span>
              </div>
              <div className="shrink-0 text-right text-xs text-muted-foreground">
                <div>{columnNotes.length}</div>
                {columnNotes.length > columnWindowSize ? (
                  <div aria-label={`board-column-window-${option.id}`}>{rangeStart}-{rangeEnd} / {columnNotes.length}</div>
                ) : null}
              </div>
            </div>
            <div className="max-h-[64vh] space-y-2 overflow-y-auto pr-1">
              {visibleColumnNotes.map((note) => (
                <button
                  key={note.id}
                  draggable
                  onDragStart={(event) => event.dataTransfer.setData("text/plain", note.id)}
                  onClick={() => onSelectNote(note.id)}
                  className={cn(
                    "min-h-[118px] w-full rounded-[14px] border border-border/70 bg-white/85 px-3 py-3 text-left shadow-sm dark:bg-white/[0.06]",
                    selectedNoteId === note.id && "border-[#007aff]/30 bg-[#007aff]/[0.06]",
                  )}
                >
                  <div className="line-clamp-2 font-medium">{decodeEscapedUnicode(note.title || "无标题")}</div>
                  <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                    {nonTitleProperties.slice(0, 3).map((property) => (
                      <div key={property.id} className="flex gap-1">
                        <span className="shrink-0">{property.name}:</span>
                        <span className="truncate">{formatValue(note, property, workspaceMembers) || "-"}</span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-2 text-[11px] text-muted-foreground">{new Date(note.updated_at).toLocaleDateString("zh-CN")}</div>
                </button>
              ))}
              {columnNotes.length > columnWindowSize ? (
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="rounded-[12px]"
                    disabled={!hasPreviousWindow}
                    aria-label={`board-column-prev-${option.id}`}
                    onClick={() => onSetBoardColumnLimits((current) => ({
                      ...current,
                      [option.id]: Math.max(0, columnStart - columnWindowSize),
                    }))}
                  >
                    上一段
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="rounded-[12px]"
                    disabled={!hasNextWindow}
                    aria-label={`board-column-next-${option.id}`}
                    onClick={() => onSetBoardColumnLimits((current) => ({
                      ...current,
                      [option.id]: columnStart + columnWindowSize,
                    }))}
                  >
                    下一段
                  </Button>
                </div>
              ) : null}
              {columnNotes.length === 0 ? <p className="rounded-[12px] border border-dashed border-border/70 p-3 text-xs text-muted-foreground">暂无记录</p> : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
