import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDatabaseTableColumns,
  DatabaseTableBodyCell,
  DatabaseTableHeaderCell,
} from "@/components/database/DatabaseTableColumns";
import type { DatabaseProperty } from "@/types/database";
import type { NoteWithTags } from "@/types/note";

const property: DatabaseProperty = {
  id: "prop-effort",
  database_id: "db-1",
  name: "Effort",
  type: "number",
  config: {},
  sort_order: 1,
  created_at: "x",
  updated_at: "x",
};

const note: NoteWithTags = {
  id: "note-1",
  folder_id: null,
  database_id: "db-1",
  title: "Launch",
  content: "",
  is_favorite: false,
  is_pinned: false,
  is_daily: false,
  daily_date: null,
  created_at: "2026-05-10T00:00:00.000Z",
  updated_at: "2026-05-11T00:00:00.000Z",
  deleted_at: null,
  archived_at: null,
  last_opened_at: null,
  tags: [],
  folder: null,
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("DatabaseTableColumns", () => {
  it("creates title, property, and system columns in stable order", () => {
    expect(createDatabaseTableColumns([property])).toEqual([
      { id: "title", kind: "title", label: "标题" },
      { id: "property:prop-effort", kind: "property", label: "Effort", property },
      { id: "updated_at", kind: "system", label: "更新于", system: "updated_at" },
    ]);
  });

  it("renders title header selection and title editor cells", () => {
    const columns = createDatabaseTableColumns([property]);
    const onSetCurrentPageSelection = vi.fn();
    const onToggleRecordSelection = vi.fn();
    const onSelectNote = vi.fn();
    const onUpdateNoteTitle = vi.fn();

    render(
      <table>
        <thead>
          <tr>
            <DatabaseTableHeaderCell
              column={columns[0]}
              allPagedSelected={false}
              onSetCurrentPageSelection={onSetCurrentPageSelection}
            />
          </tr>
        </thead>
        <tbody>
          <tr>
            <DatabaseTableBodyCell
              column={columns[0]}
              note={note}
              selectedRecordIds={[]}
              onToggleRecordSelection={onToggleRecordSelection}
              onSelectNote={onSelectNote}
              onUpdateNoteTitle={onUpdateNoteTitle}
              renderPropertyCell={() => null}
            />
          </tr>
        </tbody>
      </table>,
    );

    fireEvent.click(screen.getByLabelText("select-all-records"));
    expect(onSetCurrentPageSelection).toHaveBeenCalledWith(true);

    fireEvent.click(screen.getByLabelText("select-record-note-1"));
    expect(onToggleRecordSelection).toHaveBeenCalledWith("note-1");

    fireEvent.focus(screen.getByDisplayValue("Launch"));
    expect(onSelectNote).toHaveBeenCalledWith("note-1");

    fireEvent.change(screen.getByDisplayValue("Launch"), { target: { value: "Ship" } });
    expect(onUpdateNoteTitle).toHaveBeenCalledWith("note-1", "Ship");
  });

  it("renders property and updated-at system cells through the shared renderer", () => {
    const columns = createDatabaseTableColumns([property]);

    render(
      <table>
        <tbody>
          <tr>
            <DatabaseTableBodyCell
              column={columns[1]}
              note={note}
              selectedRecordIds={[]}
              onToggleRecordSelection={vi.fn()}
              onSelectNote={vi.fn()}
              onUpdateNoteTitle={vi.fn()}
              renderPropertyCell={(_, currentProperty) => <span>{currentProperty.name}: 3</span>}
            />
            <DatabaseTableBodyCell
              column={columns[2]}
              note={note}
              selectedRecordIds={[]}
              onToggleRecordSelection={vi.fn()}
              onSelectNote={vi.fn()}
              onUpdateNoteTitle={vi.fn()}
              renderPropertyCell={() => null}
            />
          </tr>
        </tbody>
      </table>,
    );

    expect(screen.getByText("Effort: 3")).toBeInTheDocument();
    expect(screen.getByText("2026/5/11")).toBeInTheDocument();
  });
});
