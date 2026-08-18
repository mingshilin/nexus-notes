import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { DatabasePage } from "@/components/database/DatabasePage";
import type { DatabaseProperty } from "@/types/database";
import type { NoteWithTags } from "@/types/note";

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
  },
}));

const database = {
  id: "db-1",
  workspace_id: "ws-1",
  name: "Projects",
  description: "Track work",
  icon: "DB",
  created_by_user_id: "u1",
  board_property_id: "prop-status",
  calendar_property_id: "prop-date",
  created_at: "x",
  updated_at: "x",
};

const properties: DatabaseProperty[] = [
  { id: "prop-title", database_id: "db-1", name: "Title", type: "title", config: {}, sort_order: 0, created_at: "x", updated_at: "x" },
  {
    id: "prop-status",
    database_id: "db-1",
    name: "Status",
    type: "single_select",
    config: { options: [{ id: "todo", name: "Todo", color: "#6B9EFF" }] },
    sort_order: 1,
    created_at: "x",
    updated_at: "x",
  },
  { id: "prop-date", database_id: "db-1", name: "Date", type: "date", config: {}, sort_order: 2, created_at: "x", updated_at: "x" },
  { id: "prop-effort", database_id: "db-1", name: "Effort", type: "number", config: {}, sort_order: 3, created_at: "x", updated_at: "x" },
  { id: "prop-done", database_id: "db-1", name: "Done", type: "checkbox", config: {}, sort_order: 4, created_at: "x", updated_at: "x" },
  {
    id: "prop-tags",
    database_id: "db-1",
    name: "Tags",
    type: "multi_select",
    config: { options: [{ id: "frontend", name: "Frontend", color: "#34C759" }, { id: "urgent", name: "Urgent", color: "#FF9500" }] },
    sort_order: 5,
    created_at: "x",
    updated_at: "x",
  },
];

const notes: NoteWithTags[] = [
  {
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
    updated_at: "2026-05-10T00:00:00.000Z",
    deleted_at: null,
    archived_at: null,
    last_opened_at: null,
    tags: [],
    folder: null,
    database_values: {
      "prop-status": { property_id: "prop-status", type: "single_select", value_json: ["todo"] },
      "prop-date": { property_id: "prop-date", type: "date", value_date: "2026-05-10" },
      "prop-effort": { property_id: "prop-effort", type: "number", value_number: 3 },
    },
  },
];

function makeDatabaseNote(index: number, overrides: Partial<NoteWithTags> = {}): NoteWithTags {
  return {
    id: `note-${index}`,
    folder_id: null,
    database_id: "db-1",
    title: `Record ${index}`,
    content: "",
    is_favorite: false,
    is_pinned: false,
    is_daily: false,
    daily_date: null,
    created_at: "2026-05-10T00:00:00.000Z",
    updated_at: "2026-05-10T00:00:00.000Z",
    deleted_at: null,
    archived_at: null,
    last_opened_at: null,
    tags: [],
    folder: null,
    database_values: {
      "prop-status": { property_id: "prop-status", type: "single_select", value_json: ["todo"] },
      "prop-date": { property_id: "prop-date", type: "date", value_date: "2026-05-10" },
      "prop-effort": { property_id: "prop-effort", type: "number", value_number: index },
    },
    ...overrides,
  };
}

function renderPage(overrides: Partial<React.ComponentProps<typeof DatabasePage>> = {}) {
  const props = {
    database,
    properties,
    notes,
    workspaceMembers: [],
    activeView: "table" as const,
    selectedNoteId: null,
    onViewChange: vi.fn(),
    onPreferenceChange: vi.fn(),
    onSelectNote: vi.fn(),
    onCreateNote: vi.fn(),
    onRequestDeleteDatabase: vi.fn(),
    onUpdateDatabaseInfo: vi.fn(),
    onUpdateDatabaseField: vi.fn(),
    onCreateProperty: vi.fn(),
    onUpdateProperty: vi.fn(),
    onDeleteProperty: vi.fn(),
    onUpdateNoteTitle: vi.fn(),
    onUpdateNoteValue: vi.fn(),
    ...overrides,
  };
  render(<DatabasePage {...props} />);
  return props;
}

afterEach(() => {
  vi.clearAllMocks();
  cleanup();
});

describe("DatabasePage", () => {
  it("renders table view and can switch to board", () => {
    const props = renderPage();

    expect(screen.getByRole("heading", { name: /Projects/ })).toBeInTheDocument();
    expect(screen.getByDisplayValue("Launch")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "看板" }));
    expect(props.onViewChange).toHaveBeenCalledWith("board");
  });

  it("edits a table property value inline", () => {
    const props = renderPage();

    fireEvent.change(screen.getByDisplayValue("3"), { target: { value: "5" } });

    expect(props.onUpdateNoteValue).toHaveBeenCalledWith("note-1", {
      property_id: "prop-effort",
      value_number: 5,
    });
  });

  it("updates a card when dropped onto a board column", () => {
    const props = renderPage({ activeView: "board" });
    const dataTransfer = {
      setData: vi.fn(),
      getData: vi.fn(() => "note-1"),
    };

    fireEvent.dragStart(screen.getByRole("button", { name: /Launch/ }), { dataTransfer });
    fireEvent.drop(screen.getByLabelText("board-column-todo"), { dataTransfer });

    expect(props.onUpdateNoteValue).toHaveBeenCalledWith("note-1", {
      property_id: "prop-status",
      value_json: ["todo"],
    });
  });

  it("shows a rollback toast when a board move fails", async () => {
    const props = renderPage({ activeView: "board", onUpdateNoteValue: vi.fn(() => Promise.reject(new Error("failed"))) });
    const dataTransfer = {
      setData: vi.fn(),
      getData: vi.fn(() => "note-1"),
    };

    fireEvent.dragStart(screen.getByRole("button", { name: /Launch/ }), { dataTransfer });
    fireEvent.drop(screen.getByLabelText("board-column-todo"), { dataTransfer });

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("看板移动失败，已回滚");
    });
    expect(props.onUpdateNoteValue).toHaveBeenCalledWith("note-1", {
      property_id: "prop-status",
      value_json: ["todo"],
    });
  });

  it("rolls back failed board moves for member groups", async () => {
    const memberProperty: DatabaseProperty = {
      id: "prop-owner",
      database_id: "db-1",
      name: "Owner",
      type: "member",
      config: {},
      sort_order: 6,
      created_at: "x",
      updated_at: "x",
    };
    const props = renderPage({
      activeView: "board",
      database: { ...database, board_property_id: "prop-owner" },
      properties: [...properties, memberProperty],
      workspaceMembers: [{
        id: "member-2",
        workspace_id: "ws-1",
        user_id: "u2",
        role: "editor",
        created_at: "x",
        updated_at: "x",
        email: "owner@example.com",
        display_name: "Owner",
        avatar_url: null,
      }],
      onUpdateNoteValue: vi.fn(() => Promise.reject(new Error("failed"))),
    });
    const dataTransfer = {
      setData: vi.fn(),
      getData: vi.fn(() => "note-1"),
    };

    fireEvent.dragStart(screen.getByRole("button", { name: /Launch/ }), { dataTransfer });
    fireEvent.drop(screen.getByLabelText("board-column-u2"), { dataTransfer });

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("看板移动失败，已回滚");
    });
    expect(props.onUpdateNoteValue).toHaveBeenCalledWith("note-1", {
      property_id: "prop-owner",
      value_json: ["u2"],
    });
  });

  it("rolls back failed board moves for checkbox groups", async () => {
    const props = renderPage({
      activeView: "board",
      database: { ...database, board_property_id: "prop-done" },
      onUpdateNoteValue: vi.fn(() => Promise.reject(new Error("failed"))),
    });
    const dataTransfer = {
      setData: vi.fn(),
      getData: vi.fn(() => "note-1"),
    };

    fireEvent.dragStart(screen.getByRole("button", { name: /Launch/ }), { dataTransfer });
    fireEvent.drop(screen.getByLabelText("board-column-true"), { dataTransfer });

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("看板移动失败，已回滚");
    });
    expect(props.onUpdateNoteValue).toHaveBeenCalledWith("note-1", {
      property_id: "prop-done",
      value_boolean: true,
    });
  });

  it("updates the date when dropped onto a calendar day", () => {
    const props = renderPage({ activeView: "calendar" });
    const dataTransfer = {
      setData: vi.fn(),
      getData: vi.fn(() => "note-1"),
    };

    fireEvent.dragStart(screen.getByRole("button", { name: "Launch" }), { dataTransfer });
    fireEvent.drop(screen.getByLabelText("calendar-day-2026-05-11"), { dataTransfer });

    expect(props.onUpdateNoteValue).toHaveBeenCalledWith("note-1", {
      property_id: "prop-date",
      value_date: "2026-05-11",
    });
  });

  it("assigns undated records directly from the calendar panel", () => {
    const undatedNote = makeDatabaseNote(99, {
      id: "note-undated",
      title: "No Date",
      database_values: {
        "prop-status": { property_id: "prop-status", type: "single_select", value_json: ["todo"] },
        "prop-effort": { property_id: "prop-effort", type: "number", value_number: 99 },
      },
    });
    const props = renderPage({ activeView: "calendar", notes: [...notes, undatedNote] });

    expect(screen.getByLabelText("calendar-undated-panel")).toBeInTheDocument();
    expect(screen.getByText("No Date")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("assign-calendar-date-note-undated"), { target: { value: "2026-05-12" } });
    fireEvent.click(screen.getByLabelText("assign-calendar-date-submit-note-undated"));

    expect(props.onUpdateNoteValue).toHaveBeenCalledWith("note-undated", {
      property_id: "prop-date",
      value_date: "2026-05-12",
    });
  });

  it("edits select options without prompt", async () => {
    const props = renderPage();

    fireEvent.click(screen.getByRole("button", { name: "manage-properties" }));
    fireEvent.click(screen.getByRole("button", { name: "edit-options-prop-status" }));
    fireEvent.change(screen.getAllByDisplayValue("Todo")[0], { target: { value: "Backlog" } });
    fireEvent.click(screen.getByRole("button", { name: "保存选项" }));

    await waitFor(() => {
      expect(props.onUpdateProperty).toHaveBeenCalledWith(
        "prop-status",
        expect.objectContaining({
          config: expect.objectContaining({
            options: [expect.objectContaining({ id: "todo", name: "Backlog" })],
          }),
        }),
      );
    });
  });

  it("confirms property deletion with impact details", async () => {
    const props = renderPage();

    fireEvent.click(screen.getByRole("button", { name: "manage-properties" }));
    fireEvent.click(screen.getByRole("button", { name: "delete-property-prop-status" }));

    expect(screen.getByLabelText("property-delete-impact")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "confirm-delete-property" }));

    await waitFor(() => {
      expect(props.onDeleteProperty).toHaveBeenCalledWith("prop-status");
    });
  });

  it("saves, applies, and deletes a local database view", () => {
    const props = renderPage({
      viewPreference: {
      view: "table",
      visibleColumnIds: ["prop-status", "prop-date"],
      filterQuery: "Launch",
      filterPropertyId: "prop-status",
      filterPropertyValue: "todo",
      advancedFilter: { mode: "and", rules: [] },
      sortField: "prop-date",
      sortDirection: "asc",
      savedViews: [],
      activeSavedViewId: null,
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "视图" }));
    fireEvent.change(screen.getByPlaceholderText("例如：本周任务"), { target: { value: "This week" } });
    fireEvent.click(screen.getByRole("button", { name: "另存为新视图" }));

    expect(props.onPreferenceChange).toHaveBeenCalledWith(expect.objectContaining({
      activeSavedViewId: expect.any(String),
      savedViews: [
        expect.objectContaining({
          name: "This week",
          view: "table",
          filterQuery: "Launch",
          filterPropertyId: "prop-status",
          filterPropertyValue: "todo",
          sortField: "prop-date",
          sortDirection: "asc",
          visibleColumnIds: ["prop-status", "prop-date"],
        }),
      ],
    }));
  });

  it("applies and deletes an existing saved database view", () => {
    const props = renderPage({
      viewPreference: {
        view: "table",
        visibleColumnIds: [],
        filterQuery: "",
        filterPropertyId: "",
        filterPropertyValue: "",
        advancedFilter: { mode: "and", rules: [] },
        sortField: "updated_at",
        sortDirection: "desc",
        activeSavedViewId: null,
        savedViews: [{
          id: "view-1",
          database_id: "db-1",
          name: "Board focus",
          created_by_user_id: "u1",
          created_at: "2026-05-14T00:00:00.000Z",
          updated_at: "2026-05-14T00:00:00.000Z",
          view: "board",
          visibleColumnIds: ["prop-status"],
          filterQuery: "Launch",
          filterPropertyId: "prop-status",
          filterPropertyValue: "todo",
          advancedFilter: { mode: "and", rules: [] },
          sortField: "title",
          sortDirection: "asc",
        }],
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "视图" }));
    fireEvent.click(screen.getByRole("button", { name: "Board focus" }));

    expect(props.onViewChange).toHaveBeenCalledWith("board");
    expect(props.onPreferenceChange).toHaveBeenCalledWith(expect.objectContaining({
      activeSavedViewId: "view-1",
      view: "board",
      filterQuery: "Launch",
    }));

    fireEvent.click(screen.getByRole("button", { name: "delete-saved-view-view-1" }));
    expect(screen.getByRole("dialog", { name: "删除保存视图" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "删除视图" }));
    expect(props.onPreferenceChange).toHaveBeenCalledWith({
      savedViews: [],
      activeSavedViewId: null,
    });
  });

  it("updates the active saved database view", () => {
    const onUpdateSavedView = vi.fn();
    renderPage({
      onUpdateSavedView,
      viewPreference: {
        view: "table",
        visibleColumnIds: ["prop-status"],
        filterQuery: "Launch",
        filterPropertyId: "",
        filterPropertyValue: "",
        advancedFilter: { mode: "and", rules: [] },
        sortField: "updated_at",
        sortDirection: "desc",
        activeSavedViewId: "view-1",
        savedViews: [{
          id: "view-1",
          database_id: "db-1",
          name: "Active",
          created_by_user_id: "u1",
          created_at: "x",
          updated_at: "x",
          view: "table",
          visibleColumnIds: ["prop-status"],
          filterQuery: "",
          filterPropertyId: "",
          filterPropertyValue: "",
          advancedFilter: { mode: "and", rules: [] },
          sortField: "updated_at",
          sortDirection: "desc",
        }],
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "视图" }));
    fireEvent.click(screen.getByRole("button", { name: "更新当前视图" }));

    expect(onUpdateSavedView).toHaveBeenCalledWith("view-1", expect.objectContaining({
      filterQuery: "Launch",
      visibleColumnIds: ["prop-status"],
    }));
  });

  it("creates a template with typed default property values", async () => {
    const onCreateTemplate = vi.fn().mockResolvedValue(undefined);
    renderPage({ onCreateTemplate });

    fireEvent.change(screen.getByPlaceholderText("模板名"), { target: { value: "Bug" } });
    fireEvent.change(screen.getByPlaceholderText("默认标题"), { target: { value: "Fix bug" } });
    fireEvent.change(screen.getByLabelText("template-default-single-prop-status"), { target: { value: "todo" } });
    fireEvent.change(screen.getByLabelText("template-default-date-prop-date"), { target: { value: "2026-05-12" } });
    fireEvent.change(screen.getByLabelText("template-default-number-prop-effort"), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText("template-default-checkbox-prop-done"), { target: { value: "true" } });
    fireEvent.click(screen.getByLabelText("template-default-option-prop-tags-frontend"));
    fireEvent.click(screen.getByRole("button", { name: "保存模板" }));

    await waitFor(() => {
      expect(onCreateTemplate).toHaveBeenCalledWith(expect.objectContaining({
        name: "Bug",
        title: "Fix bug",
        default_values: expect.arrayContaining([
          { property_id: "prop-status", value_json: ["todo"] },
          { property_id: "prop-date", value_date: "2026-05-12" },
          { property_id: "prop-effort", value_number: 5 },
          { property_id: "prop-done", value_boolean: true },
          { property_id: "prop-tags", value_json: ["frontend"] },
        ]),
      }));
    });
  });

  it("loads an existing template for editing default values", async () => {
    const onUpdateTemplate = vi.fn().mockResolvedValue(undefined);
    renderPage({
      onUpdateTemplate,
      templates: [{
        id: "template-1",
        database_id: "db-1",
        name: "Bug",
        title: "Fix bug",
        content: "Steps",
        default_values: [{ property_id: "prop-effort", value_number: 3 }],
        created_by_user_id: "u1",
        created_at: "x",
        updated_at: "x",
      }],
    });

    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    expect(screen.getByLabelText("template-default-number-prop-effort")).toHaveValue(3);

    fireEvent.change(screen.getByLabelText("template-default-number-prop-effort"), { target: { value: "8" } });
    fireEvent.change(screen.getByLabelText("template-default-checkbox-prop-done"), { target: { value: "false" } });
    fireEvent.click(screen.getByRole("button", { name: "更新模板" }));

    await waitFor(() => {
      expect(onUpdateTemplate).toHaveBeenCalledWith("template-1", expect.objectContaining({
        name: "Bug",
        title: "Fix bug",
        content: "Steps",
        default_values: expect.arrayContaining([
          { property_id: "prop-effort", value_number: 8 },
          { property_id: "prop-done", value_boolean: false },
        ]),
      }));
    });
  });

  it("paginates table records and can select the whole filtered result", async () => {
    const onBatchNotes = vi.fn().mockResolvedValue(undefined);
    const manyNotes = Array.from({ length: 105 }, (_, index) => makeDatabaseNote(index + 1));
    renderPage({ notes: manyNotes, onBatchNotes });

    expect(screen.getByText(/显示 1-100 \/ 105 条/)).toBeInTheDocument();
    expect(screen.getByDisplayValue("Record 1")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Record 105")).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("database-table-next-page"));
    expect(screen.getByText(/显示 101-105 \/ 105 条/)).toBeInTheDocument();
    expect(screen.getByDisplayValue("Record 105")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("select-all-records"));
    fireEvent.click(screen.getByRole("button", { name: "全选当前筛选结果（105）" }));
    fireEvent.click(screen.getByRole("button", { name: /复制/ }));

    await waitFor(() => {
      expect(onBatchNotes).toHaveBeenCalledWith(expect.objectContaining({
        action: "duplicate",
        note_ids: manyNotes.map((note) => note.id),
      }));
    });
  });

  it("uses type-aware inputs for batch property edits", async () => {
    const onBatchNotes = vi.fn().mockResolvedValue(undefined);
    renderPage({ onBatchNotes });

    fireEvent.click(screen.getByLabelText("select-all-records"));
    fireEvent.change(screen.getByLabelText("batch-property-select"), { target: { value: "prop-done" } });
    fireEvent.change(screen.getByLabelText("batch-value-checkbox"), { target: { value: "true" } });
    fireEvent.click(screen.getByRole("button", { name: "应用" }));

    await waitFor(() => {
      expect(onBatchNotes).toHaveBeenCalledWith(expect.objectContaining({
        action: "update_values",
        values: [{ property_id: "prop-done", value_boolean: true }],
      }));
    });

    fireEvent.click(screen.getByLabelText("select-all-records"));
    fireEvent.change(screen.getByLabelText("batch-property-select"), { target: { value: "prop-tags" } });
    fireEvent.click(screen.getByLabelText("Frontend"));
    fireEvent.click(screen.getByLabelText("Urgent"));
    fireEvent.click(screen.getByRole("button", { name: "应用" }));

    await waitFor(() => {
      expect(onBatchNotes).toHaveBeenCalledWith(expect.objectContaining({
        action: "update_values",
        values: [{ property_id: "prop-tags", value_json: ["frontend", "urgent"] }],
      }));
    });
  });

  it("opens mobile database tools for filters, sorting, columns, and batch edits", async () => {
    const onBatchNotes = vi.fn().mockResolvedValue(undefined);
    const props = renderPage({ onBatchNotes });

    fireEvent.click(screen.getByLabelText("select-record-mobile-note-1"));
    fireEvent.click(screen.getByLabelText("open-mobile-database-tools"));

    expect(screen.getByLabelText("mobile-database-tools")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("mobile-filter-query"), { target: { value: "Launch" } });
    expect(props.onPreferenceChange).toHaveBeenCalledWith({ filterQuery: "Launch" });

    fireEvent.change(screen.getByLabelText("mobile-sort-field"), { target: { value: "prop-date" } });
    expect(props.onPreferenceChange).toHaveBeenCalledWith({ sortField: "prop-date" });

    fireEvent.click(screen.getByLabelText("mobile-toggle-column-prop-tags"));
    expect(props.onPreferenceChange).toHaveBeenCalledWith(expect.objectContaining({
      visibleColumnIds: expect.not.arrayContaining(["prop-tags"]),
    }));

    fireEvent.change(screen.getByLabelText("mobile-batch-property-select"), { target: { value: "prop-done" } });
    fireEvent.change(screen.getByLabelText("mobile-batch-value-checkbox"), { target: { value: "false" } });
    fireEvent.click(screen.getByRole("button", { name: "应用批量修改" }));

    await waitFor(() => {
      expect(onBatchNotes).toHaveBeenCalledWith(expect.objectContaining({
        action: "update_values",
        values: [{ property_id: "prop-done", value_boolean: false }],
      }));
    });
  });

  it("persists table pagination in the database view preference", () => {
    const manyNotes = Array.from({ length: 205 }, (_, index) => makeDatabaseNote(index + 1));
    const props = renderPage({
      notes: manyNotes,
      viewPreference: {
        view: "table",
        visibleColumnIds: [],
        filterQuery: "",
        filterPropertyId: "",
        filterPropertyValue: "",
        advancedFilter: { mode: "and", rules: [] },
        sortField: "updated_at",
        sortDirection: "desc",
        savedViews: [],
        activeSavedViewId: null,
        tablePage: 2,
        tablePageSize: 100,
      },
    });

    expect(screen.getByText(/101-200 \/ 205/)).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("database-table-next-page"));
    expect(props.onPreferenceChange).toHaveBeenCalledWith({ tablePage: 3 });

    fireEvent.change(screen.getByLabelText("database-table-page-size"), { target: { value: "200" } });
    expect(props.onPreferenceChange).toHaveBeenCalledWith({ tablePage: 1, tablePageSize: 200 });
  });

  it("windows large board columns and pages cards on demand", () => {
    const manyNotes = Array.from({ length: 505 }, (_, index) => makeDatabaseNote(index + 1));
    renderPage({ activeView: "board", notes: manyNotes });

    expect(screen.getByText("Record 1")).toBeInTheDocument();
    expect(screen.queryByText("Record 51")).not.toBeInTheDocument();
    expect(screen.queryByText("Record 505")).not.toBeInTheDocument();
    expect(screen.getByLabelText("board-column-window-todo")).toHaveTextContent("1-50 / 505");

    fireEvent.click(screen.getByLabelText("board-column-next-todo"));

    expect(screen.queryByText("Record 1")).not.toBeInTheDocument();
    expect(screen.getByText("Record 51")).toBeInTheDocument();
    expect(screen.getByLabelText("board-column-window-todo")).toHaveTextContent("51-100 / 505");

    fireEvent.click(screen.getByLabelText("board-column-prev-todo"));

    expect(screen.getByText("Record 1")).toBeInTheDocument();
    expect(screen.getByLabelText("board-column-window-todo")).toHaveTextContent("1-50 / 505");
  });

  it("keeps 500-record table and calendar interactions bounded", () => {
    const manyNotes = Array.from({ length: 500 }, (_, index) => makeDatabaseNote(index + 1, { title: `Scale ${index + 1}` }));
    const tableProps = renderPage({ notes: manyNotes });

    expect(screen.getByDisplayValue("Scale 1")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Scale 100")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Scale 101")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("database-table-page-size"), { target: { value: "200" } });
    expect(tableProps.onPreferenceChange).toHaveBeenCalledWith(expect.objectContaining({ tablePageSize: 200 }));

    cleanup();
    renderPage({ activeView: "calendar", notes: manyNotes });

    expect(screen.getByText("Scale 1")).toBeInTheDocument();
    expect(screen.queryByText("Scale 6")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "还有 495 条" }));
    expect(screen.getByText("2026-05-10 的全部记录")).toBeInTheDocument();
    expect(screen.getByText("Scale 500")).toBeInTheDocument();
  });

  it("keeps mobile table cards selectable for batch workflows", () => {
    renderPage();

    fireEvent.click(screen.getByLabelText("select-record-mobile-note-1"));

    expect(screen.getAllByText("已选择 1 条").length).toBeGreaterThan(0);
  });

  it("collapses busy calendar days behind a more button", () => {
    const calendarNotes = Array.from({ length: 7 }, (_, index) => makeDatabaseNote(index + 1, { title: `Calendar ${index + 1}` }));
    renderPage({ activeView: "calendar", notes: calendarNotes });

    expect(screen.getByText("Calendar 1")).toBeInTheDocument();
    expect(screen.queryByText("Calendar 7")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "还有 2 条" }));

    expect(screen.getByText("2026-05-10 的全部记录")).toBeInTheDocument();
    expect(screen.getByText("Calendar 7")).toBeInTheDocument();
  });

  it("drags records from the expanded calendar panel onto another day", () => {
    const calendarNotes = Array.from({ length: 7 }, (_, index) => makeDatabaseNote(index + 1, { title: `Calendar ${index + 1}` }));
    const props = renderPage({ activeView: "calendar", notes: calendarNotes });
    const dataTransfer = {
      setData: vi.fn(),
      getData: vi.fn(() => "note-7"),
    };

    fireEvent.click(screen.getByRole("button", { name: "还有 2 条" }));
    fireEvent.dragStart(screen.getByLabelText("expanded-calendar-note-note-7"), { dataTransfer });
    fireEvent.drop(screen.getByLabelText("calendar-day-2026-05-11"), { dataTransfer });

    expect(dataTransfer.setData).toHaveBeenCalledWith("text/plain", "note-7");
    expect(props.onUpdateNoteValue).toHaveBeenCalledWith("note-7", {
      property_id: "prop-date",
      value_date: "2026-05-11",
    });
  });
});
