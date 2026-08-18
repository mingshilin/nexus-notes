import type { ReactNode } from "react";
import type { DatabaseProperty } from "@/types/database";
import type { NoteWithTags } from "@/types/note";
import { Input } from "@/components/ui/input";
import { decodeEscapedUnicode } from "@/lib/utils";

export type DatabaseTableColumn =
  | { id: "title"; kind: "title"; label: string }
  | { id: string; kind: "property"; label: string; property: DatabaseProperty }
  | { id: "updated_at"; kind: "system"; label: string; system: "updated_at" };

export function createDatabaseTableColumns(visibleProperties: DatabaseProperty[]): DatabaseTableColumn[] {
  return [
    { id: "title", kind: "title", label: "标题" },
    ...visibleProperties.map((property) => ({
      id: `property:${property.id}`,
      kind: "property" as const,
      label: property.name,
      property,
    })),
    { id: "updated_at", kind: "system", label: "更新于", system: "updated_at" },
  ];
}

interface DatabaseTableHeaderCellProps {
  column: DatabaseTableColumn;
  allPagedSelected: boolean;
  onSetCurrentPageSelection: (checked: boolean) => void;
}

export function DatabaseTableHeaderCell({
  column,
  allPagedSelected,
  onSetCurrentPageSelection,
}: DatabaseTableHeaderCellProps) {
  if (column.kind === "title") {
    return (
      <th className="sticky left-0 z-10 bg-black/[0.03] px-3 py-2 text-left dark:bg-[#171717]">
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={allPagedSelected}
            onChange={(event) => onSetCurrentPageSelection(event.target.checked)}
            aria-label="select-all-records"
          />
          {column.label}
        </div>
      </th>
    );
  }

  return <th className="px-3 py-2 text-left">{column.label}</th>;
}

interface DatabaseTableBodyCellProps {
  column: DatabaseTableColumn;
  note: NoteWithTags;
  selectedRecordIds: string[];
  onToggleRecordSelection: (noteId: string) => void;
  onSelectNote: (id: string) => void;
  onUpdateNoteTitle: (noteId: string, title: string) => Promise<void> | void;
  renderPropertyCell: (note: NoteWithTags, property: DatabaseProperty) => ReactNode;
}

export function DatabaseTableBodyCell({
  column,
  note,
  selectedRecordIds,
  onToggleRecordSelection,
  onSelectNote,
  onUpdateNoteTitle,
  renderPropertyCell,
}: DatabaseTableBodyCellProps) {
  if (column.kind === "title") {
    return (
      <td className="sticky left-0 z-10 bg-white/95 px-3 py-2 dark:bg-[#171717]">
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={selectedRecordIds.includes(note.id)}
            onChange={() => onToggleRecordSelection(note.id)}
            aria-label={`select-record-${note.id}`}
          />
          <Input
            value={decodeEscapedUnicode(note.title || "")}
            onChange={(event) => void onUpdateNoteTitle(note.id, event.target.value)}
            onFocus={() => onSelectNote(note.id)}
            placeholder="无标题"
            className="h-9 min-w-[220px] rounded-[10px] font-medium"
          />
        </div>
      </td>
    );
  }

  if (column.kind === "property") {
    return (
      <td className="px-3 py-2 text-muted-foreground">
        {renderPropertyCell(note, column.property)}
      </td>
    );
  }

  return (
    <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
      {new Date(note.updated_at).toLocaleDateString("zh-CN")}
    </td>
  );
}
