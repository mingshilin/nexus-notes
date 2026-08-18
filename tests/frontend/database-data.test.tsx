import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useDatabaseData } from "@/hooks/useDatabaseData";
import type { AuthUser } from "@/types/auth";
import type { Database, DatabaseView } from "@/types/database";
import type { DatabaseViewPreference } from "@/store/useAppStore";

const databasesApi = vi.hoisted(() => ({
  getDatabaseDuplicateGroups: vi.fn(),
  getDatabaseProperties: vi.fn(),
  getDatabaseTemplates: vi.fn(),
  getDatabaseViews: vi.fn(),
  getDatabases: vi.fn(),
}));

vi.mock("@/api/databases", () => databasesApi);

const user: AuthUser = {
  id: "u1",
  email: "user@example.com",
  email_verified_at: "2026-05-20T00:00:00.000Z",
  created_at: "2026-05-20T00:00:00.000Z",
  current_workspace: { id: "ws-1", name: "Workspace", owner_user_id: "u1", role: "owner" },
};

const database: Database = {
  id: "db-1",
  workspace_id: "ws-1",
  name: "Projects",
  description: "",
  icon: "📌",
  created_by_user_id: "u1",
  board_property_id: null,
  calendar_property_id: null,
  created_at: "2026-05-20T00:00:00.000Z",
  updated_at: "2026-05-20T00:00:00.000Z",
};

const preference: DatabaseViewPreference = {
  view: "board",
  visibleColumnIds: [],
  filterQuery: "",
  filterPropertyId: "",
  filterPropertyValue: "",
  advancedFilter: { mode: "and", rules: [] },
  sortField: "updated_at",
  sortDirection: "desc",
  savedViews: [],
  activeSavedViewId: "view-1",
};

function makeView(overrides: Partial<DatabaseView> = {}): DatabaseView {
  return {
    id: overrides.id ?? "view-1",
    database_id: overrides.database_id ?? "db-1",
    name: overrides.name ?? "Board",
    view: overrides.view ?? "board",
    snapshot_json: overrides.snapshot_json ?? {
      view: "board",
      visibleColumnIds: [],
      filterQuery: "",
      filterPropertyId: "",
      filterPropertyValue: "",
      advancedFilter: { mode: "and", rules: [] },
      sortField: "updated_at",
      sortDirection: "desc",
    },
    created_at: overrides.created_at ?? "2026-05-20T00:00:00.000Z",
    updated_at: overrides.updated_at ?? "2026-05-20T00:00:00.000Z",
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("useDatabaseData", () => {
  it("loads database list and derives the active database", async () => {
    databasesApi.getDatabases.mockResolvedValue([database]);
    const setDatabaseViewPreference = vi.fn();

    const { result } = renderHook(() => useDatabaseData({
      user,
      selectedDatabaseId: "db-1",
      databaseViewPreferences: { "db-1": preference },
      setDatabaseViewPreference,
    }));

    await act(async () => {
      await result.current.loadDatabaseList();
    });

    expect(result.current.databases).toEqual([database]);
    expect(result.current.currentDatabase).toEqual(database);
    expect(result.current.databaseView).toBe("board");
  });

  it("loads selected database properties, templates, and duplicate groups", async () => {
    const property = { id: "prop-1", database_id: "db-1", name: "Status", type: "single_select", config_json: { options: [] }, sort_order: 1, created_at: "", updated_at: "" };
    const template = { id: "tpl-1", database_id: "db-1", name: "Default", title: "", content: "", default_values_json: [], created_at: "", updated_at: "" };
    const duplicateGroup = { title: "Same", notes: [] };
    databasesApi.getDatabaseProperties.mockResolvedValue([property]);
    databasesApi.getDatabaseTemplates.mockResolvedValue([template]);
    databasesApi.getDatabaseDuplicateGroups.mockResolvedValue([duplicateGroup]);

    const { result } = renderHook(() => useDatabaseData({
      user,
      selectedDatabaseId: null,
      databaseViewPreferences: {},
      setDatabaseViewPreference: vi.fn(),
    }));

    await act(async () => {
      await result.current.loadSelectedDatabaseChrome("db-1");
    });

    expect(result.current.databaseProperties).toEqual([property]);
    expect(result.current.databaseTemplates).toEqual([template]);
    expect(result.current.databaseDuplicateGroups).toEqual([duplicateGroup]);
  });

  it("clears missing saved view selections when views are reloaded", async () => {
    databasesApi.getDatabaseViews.mockResolvedValue([makeView({ id: "other-view" })]);
    const setDatabaseViewPreference = vi.fn();

    const { result } = renderHook(() => useDatabaseData({
      user,
      selectedDatabaseId: "db-1",
      databaseViewPreferences: { "db-1": preference },
      setDatabaseViewPreference,
    }));

    await act(async () => {
      await result.current.loadSavedDatabaseViews("db-1");
    });

    expect(setDatabaseViewPreference).toHaveBeenCalledWith("db-1", {
      savedViews: [expect.objectContaining({ id: "other-view" })],
      activeSavedViewId: null,
    });
  });

  it("automatically clears selected database chrome when no database is selected", async () => {
    databasesApi.getDatabaseProperties.mockResolvedValue([{ id: "prop-1" }]);
    const { result, rerender } = renderHook(
      ({ selectedDatabaseId }) => useDatabaseData({
        user,
        selectedDatabaseId,
        databaseViewPreferences: {},
        setDatabaseViewPreference: vi.fn(),
      }),
      { initialProps: { selectedDatabaseId: "db-1" as string | null } },
    );

    await waitFor(() => expect(databasesApi.getDatabaseProperties).toHaveBeenCalledWith("db-1"));
    rerender({ selectedDatabaseId: null });

    expect(result.current.databaseProperties).toEqual([]);
    expect(result.current.databaseTemplates).toEqual([]);
    expect(result.current.databaseDuplicateGroups).toEqual([]);
  });
});
