import { renderHook, act } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useDatabaseMutations } from "@/hooks/useDatabaseMutations";
import type { Database, DatabaseProperty, DatabaseRecordTemplate, DatabaseView } from "@/types/database";
import type { NoteWithTags } from "@/types/note";

const databasesApi = vi.hoisted(() => ({
  batchDatabaseNotes: vi.fn(),
  createDatabase: vi.fn(),
  createDatabaseNote: vi.fn(),
  createDatabaseProperty: vi.fn(),
  createDatabaseTemplate: vi.fn(),
  createDatabaseView: vi.fn(),
  deleteDatabase: vi.fn(),
  deleteDatabaseProperty: vi.fn(),
  deleteDatabaseTemplate: vi.fn(),
  deleteDatabaseView: vi.fn(),
  exportDatabaseCsv: vi.fn(),
  getDatabaseDuplicateGroups: vi.fn(),
  importDatabaseCsv: vi.fn(),
  updateDatabase: vi.fn(),
  updateDatabaseProperty: vi.fn(),
  updateDatabaseTemplate: vi.fn(),
  updateDatabaseView: vi.fn(),
  updateNoteDatabaseMembership: vi.fn(),
  updateNoteDatabaseValues: vi.fn(),
}));

const notesApi = vi.hoisted(() => ({
  updateNote: vi.fn(),
}));

vi.mock("@/api/databases", () => databasesApi);
vi.mock("@/api/notes", () => notesApi);
vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

function makeDatabase(overrides: Partial<Database> = {}): Database {
  return {
    id: overrides.id ?? "db-1",
    workspace_id: overrides.workspace_id ?? "ws-1",
    name: overrides.name ?? "Projects",
    description: overrides.description ?? "",
    icon: overrides.icon ?? "📌",
    created_by_user_id: overrides.created_by_user_id ?? "u1",
    board_property_id: overrides.board_property_id ?? null,
    calendar_property_id: overrides.calendar_property_id ?? null,
    created_at: overrides.created_at ?? "2026-05-20T00:00:00.000Z",
    updated_at: overrides.updated_at ?? "2026-05-20T00:00:00.000Z",
  };
}

function makeNote(overrides: Partial<NoteWithTags> = {}): NoteWithTags {
  return {
    id: overrides.id ?? "note-1",
    folder_id: overrides.folder_id ?? null,
    database_id: overrides.database_id ?? "db-1",
    title: overrides.title ?? "Record",
    content: overrides.content ?? "",
    is_favorite: overrides.is_favorite ?? false,
    is_pinned: overrides.is_pinned ?? false,
    is_daily: overrides.is_daily ?? false,
    daily_date: overrides.daily_date ?? null,
    created_at: overrides.created_at ?? "2026-05-20T00:00:00.000Z",
    updated_at: overrides.updated_at ?? "2026-05-20T00:00:00.000Z",
    deleted_at: overrides.deleted_at ?? null,
    archived_at: overrides.archived_at ?? null,
    last_opened_at: overrides.last_opened_at ?? null,
    tags: overrides.tags ?? [],
    folder: overrides.folder ?? null,
    database_values: overrides.database_values,
  };
}

function makeProperty(overrides: Partial<DatabaseProperty> = {}): DatabaseProperty {
  return {
    id: overrides.id ?? "prop-1",
    database_id: overrides.database_id ?? "db-1",
    name: overrides.name ?? "Status",
    type: overrides.type ?? "single_select",
    config_json: overrides.config_json ?? { options: [] },
    sort_order: overrides.sort_order ?? 1,
    created_at: overrides.created_at ?? "",
    updated_at: overrides.updated_at ?? "",
  };
}

function makeView(overrides: Partial<DatabaseView> = {}): DatabaseView {
  return {
    id: overrides.id ?? "view-1",
    database_id: overrides.database_id ?? "db-1",
    name: overrides.name ?? "Table",
    view: overrides.view ?? "table",
    snapshot_json: overrides.snapshot_json ?? {
      view: "table",
      visibleColumnIds: [],
      filterQuery: "",
      filterPropertyId: "",
      filterPropertyValue: "",
      advancedFilter: { mode: "and", rules: [] },
      sortField: "updated_at",
      sortDirection: "desc",
    },
    created_at: overrides.created_at ?? "",
    updated_at: overrides.updated_at ?? "",
  };
}

function makeTemplate(overrides: Partial<DatabaseRecordTemplate> = {}): DatabaseRecordTemplate {
  return {
    id: overrides.id ?? "tpl-1",
    database_id: overrides.database_id ?? "db-1",
    name: overrides.name ?? "Default",
    title: overrides.title ?? "",
    content: overrides.content ?? "",
    default_values_json: overrides.default_values_json ?? [],
    created_at: overrides.created_at ?? "",
    updated_at: overrides.updated_at ?? "",
  };
}

function makeParams(overrides: Partial<Parameters<typeof useDatabaseMutations>[0]> = {}) {
  const database = makeDatabase();
  const note = makeNote();
  return {
    databases: [database],
    notes: [note],
    selectedDatabaseId: "db-1",
    currentDatabase: database,
    currentDatabasePreference: { activeSavedViewId: "view-1" },
    databaseName: "New DB",
    databaseDescription: "Description",
    databaseIcon: "📚",
    databaseInitialStatus: true,
    databaseInitialDate: true,
    assertCanWrite: vi.fn(),
    setDatabases: vi.fn(),
    setDatabaseProperties: vi.fn(),
    setDatabaseTemplates: vi.fn(),
    setDatabaseDuplicateGroups: vi.fn(),
    setDatabaseDialogOpen: vi.fn(),
    setSelectedDatabaseId: vi.fn(),
    setLibraryView: vi.fn(),
    setNotes: vi.fn(),
    upsertNote: vi.fn(),
    selectNote: vi.fn(),
    refreshDataSilently: vi.fn(),
    navigateToListView: vi.fn(),
    loadSelectedDatabaseChrome: vi.fn(),
    setDatabaseViewPreference: vi.fn(),
    ...overrides,
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("useDatabaseMutations", () => {
  it("creates a database and opens it", async () => {
    const created = makeDatabase({ id: "db-new", name: "New DB" });
    databasesApi.createDatabase.mockResolvedValue(created);
    const params = makeParams({ databases: [] });

    const { result } = renderHook(() => useDatabaseMutations(params));
    await act(async () => {
      await result.current.handleCreateDatabase();
    });

    expect(databasesApi.createDatabase).toHaveBeenCalledWith({
      name: "New DB",
      description: "Description",
      icon: "📚",
      initial_status_property: true,
      initial_date_property: true,
      bind_board_property: true,
      bind_calendar_property: true,
    });
    expect(params.setDatabases).toHaveBeenCalledWith([created]);
    expect(params.navigateToListView).toHaveBeenCalledWith("database", { databaseId: "db-new" });
    expect(params.loadSelectedDatabaseChrome).toHaveBeenCalledWith("db-new");
  });

  it("deletes a database without deleting notes in the client flow", async () => {
    databasesApi.deleteDatabase.mockResolvedValue({ id: "db-1" });
    const params = makeParams({ databases: [makeDatabase({ id: "db-1" }), makeDatabase({ id: "db-2" })] });

    const { result } = renderHook(() => useDatabaseMutations(params));
    await act(async () => {
      await result.current.handleDeleteCurrentDatabase();
    });

    expect(databasesApi.deleteDatabase).toHaveBeenCalledWith("db-1");
    expect(params.setDatabases).toHaveBeenCalledWith([expect.objectContaining({ id: "db-2" })]);
    expect(params.setSelectedDatabaseId).toHaveBeenCalledWith(null);
    expect(params.setLibraryView).toHaveBeenCalledWith("all");
    expect(params.refreshDataSilently).toHaveBeenCalledWith("database-delete", false, 100);
  });

  it("creates saved database views and activates the created view", async () => {
    const view = makeView({ id: "view-new", name: "My View" });
    databasesApi.createDatabaseView.mockResolvedValue([view]);
    const params = makeParams();

    const { result } = renderHook(() => useDatabaseMutations(params));
    await act(async () => {
      await result.current.handleCreateSavedDatabaseView({
        name: "My View",
        view: "table",
        visibleColumnIds: [],
        filterQuery: "",
        filterPropertyId: "",
        filterPropertyValue: "",
        advancedFilter: { mode: "and", rules: [] },
        sortField: "updated_at",
        sortDirection: "desc",
      });
    });

    expect(params.setDatabaseViewPreference).toHaveBeenCalledWith("db-1", {
      savedViews: [view],
      activeSavedViewId: "view-new",
    });
  });

  it("imports CSV results into properties and notes", async () => {
    const property = makeProperty();
    const note = makeNote({ id: "imported" });
    databasesApi.importDatabaseCsv.mockResolvedValue({
      imported: 1,
      warnings: [],
      properties: [property],
      notes: [note],
    });
    const params = makeParams();

    const { result } = renderHook(() => useDatabaseMutations(params));
    await act(async () => {
      await result.current.handleImportCurrentDatabaseCsv(new File(["title\nA"], "records.csv", { type: "text/csv" }));
    });

    expect(params.setDatabaseProperties).toHaveBeenCalledWith([property]);
    expect(params.setNotes).toHaveBeenCalledWith([note]);
    expect(params.refreshDataSilently).toHaveBeenCalledWith("database-csv-import");
  });

  it("updates templates and database note values", async () => {
    const template = makeTemplate({ id: "tpl-2" });
    const updatedNote = makeNote({ id: "note-1", title: "Updated" });
    databasesApi.updateDatabaseTemplate.mockResolvedValue([template]);
    databasesApi.updateNoteDatabaseValues.mockResolvedValue(updatedNote);
    const params = makeParams();

    const { result } = renderHook(() => useDatabaseMutations(params));
    await act(async () => {
      await result.current.handleUpdateCurrentDatabaseTemplate("tpl-2", { name: "Updated" });
      await result.current.handleUpdateNoteDatabaseValue("note-1", { property_id: "prop-1", value_text: "Done" });
    });

    expect(params.setDatabaseTemplates).toHaveBeenCalledWith([template]);
    expect(databasesApi.updateNoteDatabaseValues).toHaveBeenCalledWith("note-1", {
      values: [{ property_id: "prop-1", value_text: "Done" }],
    });
    expect(params.upsertNote).toHaveBeenCalledWith(updatedNote);
    expect(params.setNotes).toHaveBeenCalledWith([updatedNote]);
  });
});
