import { Check, Download, Pin, Share2, Star, Trash2 } from "lucide-react";
import type { NoteExportFormat } from "@/api/export";
import { MoreMenu } from "@/components/ui/MoreMenu";
import { NOTE_EXPORT_FORMATS, getExportFormatLabel } from "@/lib/noteActions";
import { cn, decodeEscapedUnicode, escapeRegExp, formatRelativeTime } from "@/lib/utils";
import type { NoteWithTags } from "@/types/note";
import { TagChip } from "./TagChip";

interface NoteCardProps {
  note: NoteWithTags;
  selected: boolean;
  compact?: boolean;
  query?: string;
  batchMode?: boolean;
  batchSelected?: boolean;
  onSelect: () => void;
  onTagSelect?: (tagId: string) => void;
  onShare?: () => void;
  onExport?: (format: NoteExportFormat) => void;
  onToggleBatch?: () => void;
  onQuickDelete?: () => void;
}

function stripMarkdown(value: string) {
  return decodeEscapedUnicode(value)
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*]\([^)]+\)/g, " ")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/^>\s?/gm, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/\[\[(.+?)\]\]/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function highlight(input: string, query?: string) {
  const value = decodeEscapedUnicode(input);
  const q = decodeEscapedUnicode(query ?? "").trim();
  if (!q) return <>{value}</>;
  const pattern = new RegExp(`(${escapeRegExp(q)})`, "ig");
  return value.split(pattern).map((part, index) =>
    part.toLowerCase() === q.toLowerCase() ? (
      <mark key={index} className="rounded-sm bg-[#007aff]/15 px-0.5 text-inherit">
        {part}
      </mark>
    ) : (
      <span key={index}>{part}</span>
    ),
  );
}

function stopCardEvent(event: React.MouseEvent<HTMLElement>) {
  event.preventDefault();
  event.stopPropagation();
}

export function NoteCard({
  note,
  selected,
  compact = false,
  query,
  batchMode = false,
  batchSelected = false,
  onSelect,
  onTagSelect,
  onShare,
  onExport,
  onToggleBatch,
  onQuickDelete,
}: NoteCardProps) {
  const preview = stripMarkdown(note.content || "") || "点击开始编辑...";

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={batchMode ? onToggleBatch : onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          (batchMode ? onToggleBatch : onSelect)?.();
        }
      }}
      className={cn(
        "group w-full rounded-[16px] border text-left transition-all duration-150 hover:-translate-y-[1px]",
        compact ? "p-3" : "p-3 sm:p-4",
        selected || batchSelected
          ? "bg-[#007aff]/8 shadow-sm dark:bg-[#409cff]/12"
          : "bg-transparent hover:bg-black/[0.035] hover:shadow-sm dark:hover:bg-white/[0.04]",
      )}
      style={{ borderColor: selected || batchSelected ? "rgba(10,132,255,0.24)" : "transparent" }}
    >
      <div className="mb-1.5 flex items-start justify-between gap-3 sm:mb-2">
        <div className="flex min-w-0 items-start gap-2">
          {batchMode ? (
            <span
              className={cn(
                "mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors",
                batchSelected
                  ? "border-[#007aff] bg-[#007aff] text-white"
                  : "border-border/80 bg-white/70 text-transparent dark:bg-white/[0.05]",
              )}
            >
              <Check className="h-3.5 w-3.5" />
            </span>
          ) : null}
          <h3 className={cn("line-clamp-1 font-semibold tracking-normal text-foreground", compact ? "text-[13px]" : "text-[15px]")}>
            {highlight(note.title || "无标题笔记", query)}
          </h3>
        </div>
        <div className="flex shrink-0 items-center gap-1 text-muted-foreground">
          {note.is_pinned ? <Pin className="h-3.5 w-3.5 fill-current text-[#ffcc00]" /> : null}
          {note.is_favorite ? <Star className="h-3.5 w-3.5 fill-current text-[#ff9500]" /> : null}
          {!batchMode && (onShare || onExport || onQuickDelete) ? (
            <div
              onClick={stopCardEvent}
              onKeyDown={(event) => event.stopPropagation()}
              className="sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100"
            >
              <MoreMenu triggerLabel="笔记操作" menuClassName="w-52">
                {onShare ? (
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm hover:bg-black/5 dark:hover:bg-white/[0.05]"
                    onClick={onShare}
                  >
                    <Share2 className="h-4 w-4" />
                    分享
                  </button>
                ) : null}
                {onExport
                  ? NOTE_EXPORT_FORMATS.map((format) => (
                      <button
                        key={format}
                        type="button"
                        className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm hover:bg-black/5 dark:hover:bg-white/[0.05]"
                        onClick={() => onExport(format)}
                      >
                        <Download className="h-4 w-4" />
                        导出 {getExportFormatLabel(format)}
                      </button>
                    ))
                  : null}
                {onQuickDelete ? (
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-destructive hover:bg-destructive/10"
                    onClick={onQuickDelete}
                  >
                    <Trash2 className="h-4 w-4" />
                    删除笔记
                  </button>
                ) : null}
              </MoreMenu>
            </div>
          ) : null}
        </div>
      </div>

      <p className={cn("text-muted-foreground", compact ? "line-clamp-2 min-h-[2.6rem] text-[11px] leading-5" : "line-clamp-1 min-h-[1.35rem] text-[12px] leading-5 sm:line-clamp-2 sm:min-h-[2.9rem]")}>
        {highlight(preview, query)}
      </p>

      <div className="mt-2 flex items-end justify-between gap-2 sm:mt-3">
        <div className="min-w-0">
          <span className="block text-[11px] text-muted-foreground">{formatRelativeTime(note.updated_at)}</span>
          {note.folder?.name ? (
            <span className="mt-1 block truncate text-[11px] text-muted-foreground/80">{decodeEscapedUnicode(note.folder.name)}</span>
          ) : null}
        </div>
        <div className="flex max-w-[58%] flex-wrap justify-end gap-1">
          {note.tags.slice(0, compact ? 1 : 2).map((tag) => (
            <TagChip key={tag.id} tag={tag} onClick={onTagSelect ? () => onTagSelect(tag.id) : undefined} />
          ))}
          {note.tags.length > (compact ? 1 : 2) ? (
            <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
              +{note.tags.length - (compact ? 1 : 2)}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
