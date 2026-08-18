import { useMemo, type ReactNode } from "react";
import type { DatabaseProperty } from "@/types/database";
import type { NoteWithTags } from "@/types/note";
import type { WorkspaceMember } from "@/types/workspace";
import { Button } from "@/components/ui/button";
import {
  createDatabaseTableColumns,
  DatabaseTableBodyCell,
  DatabaseTableHeaderCell,
} from "@/components/database/DatabaseTableColumns";
import { cn, decodeEscapedUnicode } from "@/lib/utils";

interface DatabaseTableViewProps {
  notes: NoteWithTags[];
  sortedNotes: NoteWithTags[];
  pagedTableNotes: NoteWithTags[];
  visibleProperties: DatabaseProperty[];
  selectedNoteId: string | null;
  selectedRecordIds: string[];
  allPagedSelected: boolean;
  selectedSortedCount: number;
  tablePageStart: number;
  tablePageSize: number;
  tablePageSizes: readonly number[];
  normalizedTablePage: number;
  tableTotalPages: number;
  workspaceMembers: WorkspaceMember[];
  onSelectNote: (id: string) => void;
  onUpdateNoteTitle: (noteId: string, title: string) => Promise<void> | void;
  onSetTablePageSize: (size: number) => void;
  onSetTablePage: (updater: (page: number) => number) => void;
  onSetCurrentPageSelection: (checked: boolean) => void;
  onToggleRecordSelection: (noteId: string) => void;
  renderTableCell: (note: NoteWithTags, property: DatabaseProperty) => ReactNode;
  formatValue: (note: NoteWithTags, property: DatabaseProperty, members: WorkspaceMember[]) => string;
}

export function DatabaseTableView({
  notes,
  sortedNotes,
  pagedTableNotes,
  visibleProperties,
  selectedNoteId,
  selectedRecordIds,
  allPagedSelected,
  selectedSortedCount,
  tablePageStart,
  tablePageSize,
  tablePageSizes,
  normalizedTablePage,
  tableTotalPages,
  workspaceMembers,
  onSelectNote,
  onUpdateNoteTitle,
  onSetTablePageSize,
  onSetTablePage,
  onSetCurrentPageSelection,
  onToggleRecordSelection,
  renderTableCell,
  formatValue,
}: DatabaseTableViewProps) {
  const columns = useMemo(() => createDatabaseTableColumns(visibleProperties), [visibleProperties]);

  return (
    <div className="rounded-[18px] border border-border/70 bg-white/70 dark:bg-white/[0.04]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 px-3 py-2 text-xs text-muted-foreground">
        <div>
          显示 {sortedNotes.length === 0 ? 0 : tablePageStart + 1}-{Math.min(tablePageStart + pagedTableNotes.length, sortedNotes.length)} / {sortedNotes.length} 条
          {selectedSortedCount > 0 ? ` · 当前筛选已选 ${selectedSortedCount} 条` : ""}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span>每页</span>
          <select
            value={tablePageSize}
            onChange={(event) => onSetTablePageSize(Number(event.target.value))}
            className="h-8 rounded-[10px] border border-input bg-background/80 px-2 text-xs outline-none"
            aria-label="database-table-page-size"
          >
            {tablePageSizes.map((size) => (
              <option key={size} value={size}>{size}</option>
            ))}
          </select>
          <Button
            size="sm"
            variant="outline"
            className="h-8 rounded-[10px]"
            disabled={normalizedTablePage <= 1}
            onClick={() => onSetTablePage((page) => Math.max(1, page - 1))}
            aria-label="database-table-prev-page"
          >
            上一页
          </Button>
          <span>{normalizedTablePage}/{tableTotalPages}</span>
          <Button
            size="sm"
            variant="outline"
            className="h-8 rounded-[10px]"
            disabled={normalizedTablePage >= tableTotalPages}
            onClick={() => onSetTablePage((page) => Math.min(tableTotalPages, page + 1))}
            aria-label="database-table-next-page"
          >
            下一页
          </Button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="hidden min-w-full text-sm md:table">
          <thead className="bg-black/[0.03] dark:bg-white/[0.03]">
            <tr>
              {columns.map((column) => (
                <DatabaseTableHeaderCell
                  key={column.id}
                  column={column}
                  allPagedSelected={allPagedSelected}
                  onSetCurrentPageSelection={onSetCurrentPageSelection}
                />
              ))}
            </tr>
          </thead>
          <tbody>
            {pagedTableNotes.map((note) => (
              <tr key={note.id} className={cn("border-t border-border/60", selectedNoteId === note.id && "bg-[#007aff]/[0.05]")}>
                {columns.map((column) => (
                  <DatabaseTableBodyCell
                    key={column.id}
                    column={column}
                    note={note}
                    selectedRecordIds={selectedRecordIds}
                    onToggleRecordSelection={onToggleRecordSelection}
                    onSelectNote={onSelectNote}
                    onUpdateNoteTitle={onUpdateNoteTitle}
                    renderPropertyCell={renderTableCell}
                  />
                ))}
              </tr>
            ))}
            {sortedNotes.length === 0 ? (
              <tr>
                <td className="px-3 py-10 text-center text-muted-foreground" colSpan={columns.length}>
                  {notes.length === 0 ? "这个数据库还没有记录。" : "没有符合当前筛选条件的记录。"}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <div className="space-y-3 md:hidden">
        {pagedTableNotes.map((note) => (
          <div
            key={note.id}
            className={cn(
              "w-full rounded-[18px] border border-border/70 bg-white/80 p-4 text-left shadow-sm dark:bg-white/[0.05]",
              selectedNoteId === note.id && "border-[#007aff]/30 bg-[#007aff]/[0.06]",
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <button type="button" onClick={() => onSelectNote(note.id)} className="min-w-0 flex-1 text-left">
                <div className="line-clamp-2 font-semibold">{decodeEscapedUnicode(note.title || "无标题")}</div>
                <div className="mt-1 text-xs text-muted-foreground">{new Date(note.updated_at).toLocaleDateString("zh-CN")} 更新</div>
              </button>
              <label className="flex shrink-0 items-center gap-2 rounded-full bg-[#007aff]/10 px-2 py-1 text-[11px] font-medium text-[#007aff]">
                <input
                  type="checkbox"
                  checked={selectedRecordIds.includes(note.id)}
                  onChange={() => onToggleRecordSelection(note.id)}
                  aria-label={`select-record-mobile-${note.id}`}
                />
                选择
              </label>
            </div>
            {visibleProperties.length > 0 ? (
              <div className="mt-3 grid gap-2">
                {visibleProperties.slice(0, 6).map((property) => (
                  <div key={property.id} className="flex items-center justify-between gap-3 rounded-[12px] bg-black/[0.03] px-3 py-2 text-xs dark:bg-white/[0.04]">
                    <span className="shrink-0 text-muted-foreground">{property.name}</span>
                    <span className="min-w-0 truncate font-medium">{formatValue(note, property, workspaceMembers) || "-"}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ))}
        {sortedNotes.length === 0 ? (
          <div className="rounded-[18px] border border-dashed border-border/70 bg-white/70 p-6 text-center text-sm text-muted-foreground dark:bg-white/[0.04]">
            {notes.length === 0 ? "这个数据库还没有记录。" : "没有符合当前筛选条件的记录。"}
          </div>
        ) : null}
      </div>
    </div>
  );
}
