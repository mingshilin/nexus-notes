import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../worker/db/queries", () => ({
  deleteDatabaseViewById: vi.fn(),
  getDatabaseById: vi.fn(),
  getDatabaseFieldPermission: vi.fn(),
  getDatabasePropertyById: vi.fn(),
  getDatabaseViewById: vi.fn(),
  getNoteById: vi.fn(),
  insertActivityLog: vi.fn(),
  insertDatabaseView: vi.fn(),
  insertDatabase: vi.fn(),
  insertDatabaseProperty: vi.fn(),
  listDatabaseViews: vi.fn(),
  listDatabaseNotes: vi.fn(),
  listDatabaseProperties: vi.fn(),
  listDatabases: vi.fn(),
  listDatabasePermissions: vi.fn(),
  listWorkspaceMembers: vi.fn(),
  replaceDatabasePermissions: vi.fn(),
  updateDatabaseViewById: vi.fn(),
  updateDatabaseById: vi.fn(),
  updateDatabasePropertyById: vi.fn(),
  updateNoteById: vi.fn(),
  upsertDatabaseFieldPermission: vi.fn(),
  upsertNotePropertyValues: vi.fn(),
  detachNotesFromDatabase: vi.fn(),
  deleteDatabaseById: vi.fn(),
  deleteDatabasePropertyById: vi.fn(),
  insertNote: vi.fn(),
}));

import {
  handleCreateDatabase,
  handleCreateDatabaseProperty,
  handleCreateDatabaseView,
  handleBatchDatabaseNotes,
  handleDeleteDatabase,
  handleDeleteDatabaseProperty,
  handleExportDatabaseCsv,
  handleImportDatabaseCsv,
  handleListDatabases,
  handleListDatabaseNotes,
  handleUpdateDatabasePermissions,
  handleUpdateFieldPermissions,
  handleUpdateDatabase,
  handleUpdateDatabaseNoteValues,
} from "../../worker/routes/databases";
import {
  getDatabaseById,
  getDatabaseFieldPermission,
  getDatabasePropertyById,
  getNoteById,
  deleteDatabaseById,
  deleteDatabasePropertyById,
  detachNotesFromDatabase,
  insertActivityLog,
  insertDatabaseView,
  insertDatabase,
  insertDatabaseProperty,
  listDatabaseViews,
  listDatabaseNotes,
  listDatabasePermissions,
  listDatabaseProperties,
  listDatabases,
  listWorkspaceMembers,
  replaceDatabasePermissions,
  updateDatabaseById,
  updateDatabasePropertyById,
  upsertDatabaseFieldPermission,
  upsertNotePropertyValues,
} from "../../worker/db/queries";

function createBatchDb() {
  const batch = vi.fn(() => Promise.resolve([]));
  const prepare = vi.fn((sql: string) => ({
    bind: vi.fn((...bindings: unknown[]) => ({ sql, bindings })),
  }));
  return { db: { prepare, batch } as unknown as D1Database, batch, prepare };
}

describe("database routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("filters database list by explicit read permissions", async () => {
    const visible = {
      id: "db-visible",
      workspace_id: "ws-1",
      name: "Visible",
      description: null,
      icon: null,
      created_by_user_id: "u1",
      board_property_id: null,
      calendar_property_id: null,
      created_at: "x",
      updated_at: "x",
    };
    const hidden = { ...visible, id: "db-hidden", name: "Hidden" };
    vi.mocked(listDatabases).mockResolvedValue([visible, hidden]);
    vi.mocked(getDatabaseById).mockImplementation((_db, _workspaceId, databaseId) => Promise.resolve(databaseId === "db-visible" ? visible : hidden));
    vi.mocked(listDatabasePermissions).mockImplementation((_db, _workspaceId, databaseId) => Promise.resolve(databaseId === "db-visible"
      ? [{ id: "p1", database_id: "db-visible", subject_type: "workspace_role", subject_id: "viewer", role: "viewer", created_at: "x", updated_at: "x" }]
      : [{ id: "p2", database_id: "db-hidden", subject_type: "workspace_role", subject_id: "editor", role: "editor", created_at: "x", updated_at: "x" }]));

    const response = await handleListDatabases({} as D1Database, "u2", "ws-1", { userId: "u2", workspaceRole: "viewer" });
    const body = await response.json() as { success: boolean; data: Array<{ id: string }> };

    expect(body.data.map((database) => database.id)).toEqual(["db-visible"]);
  });

  it("removes unreadable database fields and values from records", async () => {
    vi.mocked(getDatabaseById).mockResolvedValue({
      id: "db-1",
      workspace_id: "ws-1",
      name: "Projects",
      description: null,
      icon: null,
      created_by_user_id: "u1",
      board_property_id: null,
      calendar_property_id: null,
      created_at: "x",
      updated_at: "x",
    });
    vi.mocked(listDatabasePermissions).mockResolvedValue([
      { id: "p1", database_id: "db-1", subject_type: "workspace_role", subject_id: "viewer", role: "viewer", created_at: "x", updated_at: "x" },
    ]);
    vi.mocked(listDatabaseProperties).mockResolvedValue([
      { id: "prop-public", database_id: "db-1", name: "Public", type: "text", config: {}, config_json: "{}", sort_order: 1, created_at: "x", updated_at: "x" },
      { id: "prop-private", database_id: "db-1", name: "Private", type: "text", config: {}, config_json: "{}", sort_order: 2, created_at: "x", updated_at: "x" },
    ]);
    vi.mocked(getDatabaseFieldPermission).mockImplementation((_db, _workspaceId, _databaseId, propertyId) => Promise.resolve({
      id: `fp-${propertyId}`,
      property_id: propertyId,
      viewer_roles: propertyId === "prop-private" ? ["owner", "editor"] : ["owner", "editor", "viewer"],
      editor_roles: ["owner", "editor"],
      created_at: "x",
      updated_at: "x",
    }));
    vi.mocked(listDatabaseNotes).mockResolvedValue([{
      id: "note-1",
      folder_id: null,
      database_id: "db-1",
      title: "Launch",
      content: "",
      is_favorite: false,
      is_pinned: false,
      is_daily: false,
      daily_date: null,
      created_at: "x",
      updated_at: "x",
      deleted_at: null,
      archived_at: null,
      last_opened_at: null,
      tags: [],
      folder: null,
      database_values: {
        "prop-public": { property_id: "prop-public", type: "text", value_text: "visible" },
        "prop-private": { property_id: "prop-private", type: "text", value_text: "hidden" },
      },
    }]);

    const response = await handleListDatabaseNotes({} as D1Database, "u2", "ws-1", "db-1", { userId: "u2", workspaceRole: "viewer" });
    const body = await response.json() as { success: boolean; data: Array<{ database_values: Record<string, unknown> }> };

    expect(Object.keys(body.data[0].database_values)).toEqual(["prop-public"]);
  });

  it("creates database and default title property", async () => {
    vi.mocked(insertDatabase).mockResolvedValue(undefined);
    vi.mocked(insertDatabaseProperty).mockResolvedValue(undefined);
    vi.mocked(getDatabaseById).mockResolvedValue({
      id: "db-1",
      workspace_id: "ws-1",
      name: "Projects",
      description: null,
      icon: null,
      created_by_user_id: "u1",
      board_property_id: null,
      calendar_property_id: null,
      created_at: "x",
      updated_at: "x",
    });

    const response = await handleCreateDatabase(
      {} as D1Database,
      "u1",
      "ws-1",
      new Request("http://localhost/api/databases", {
        method: "POST",
        body: JSON.stringify({ name: "Projects" }),
      }),
    );

    const body = await response.json() as { success: boolean; data: { id: string; name: string } };
    expect(response.status).toBe(201);
    expect(insertDatabase).toHaveBeenCalled();
    expect(insertDatabaseProperty).toHaveBeenCalled();
    expect(body.data.name).toBe("Projects");
  });

  it("creates optional status and date properties for a new database", async () => {
    vi.mocked(insertDatabase).mockResolvedValue(undefined);
    vi.mocked(insertDatabaseProperty).mockResolvedValue(undefined);
    vi.mocked(updateDatabaseById).mockResolvedValue(undefined);
    vi.mocked(getDatabaseById).mockResolvedValue({
      id: "db-1",
      workspace_id: "ws-1",
      name: "Projects",
      description: null,
      icon: null,
      created_by_user_id: "u1",
      board_property_id: "status-id",
      calendar_property_id: "date-id",
      created_at: "x",
      updated_at: "x",
    });

    const response = await handleCreateDatabase(
      {} as D1Database,
      "u1",
      "ws-1",
      new Request("http://localhost/api/databases", {
        method: "POST",
        body: JSON.stringify({
          name: "Projects",
          initial_status_property: true,
          initial_date_property: true,
          bind_board_property: true,
          bind_calendar_property: true,
        }),
      }),
    );

    expect(response.status).toBe(201);
    expect(insertDatabaseProperty).toHaveBeenCalledTimes(3);
    expect(updateDatabaseById).toHaveBeenCalledWith(
      {} as D1Database,
      "ws-1",
      expect.any(String),
      expect.objectContaining({
        boardPropertyId: expect.any(String),
        calendarPropertyId: expect.any(String),
      }),
    );
  });

  it("audits database structure creation", async () => {
    vi.mocked(insertDatabase).mockResolvedValue(undefined);
    vi.mocked(insertDatabaseProperty).mockResolvedValue(undefined);
    vi.mocked(getDatabaseById).mockResolvedValue({
      id: "db-1",
      workspace_id: "ws-1",
      name: "Projects",
      description: null,
      icon: null,
      created_by_user_id: "u1",
      board_property_id: null,
      calendar_property_id: null,
      created_at: "x",
      updated_at: "x",
    });

    await handleCreateDatabase(
      {} as D1Database,
      "u1",
      "ws-1",
      new Request("http://localhost/api/databases", {
        method: "POST",
        body: JSON.stringify({ name: "Projects" }),
      }),
    );

    expect(insertActivityLog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      workspaceId: "ws-1",
      actorUserId: "u1",
      action: "database.create",
      entityType: "database",
      audit: true,
    }));
  });

  it("rejects a second title property", async () => {
    vi.mocked(getDatabaseById).mockResolvedValue({
      id: "db-1",
      workspace_id: "ws-1",
      name: "Projects",
      description: null,
      icon: null,
      created_by_user_id: "u1",
      board_property_id: null,
      calendar_property_id: null,
      created_at: "x",
      updated_at: "x",
    });
    vi.mocked(listDatabaseProperties).mockResolvedValue([
      {
        id: "prop-title",
        database_id: "db-1",
        name: "标题",
        type: "title",
        config: {},
        config_json: "{}",
        sort_order: 0,
        created_at: "x",
        updated_at: "x",
      },
    ]);

    await expect(
      handleCreateDatabaseProperty(
        {} as D1Database,
        "ws-1",
        "db-1",
        new Request("http://localhost/api/databases/db-1/properties", {
          method: "POST",
          body: JSON.stringify({ name: "Another title", type: "title" }),
        }),
      ),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 400,
    });
  });

  it("validates board property type on database update", async () => {
    vi.mocked(getDatabaseById).mockResolvedValue({
      id: "db-1",
      workspace_id: "ws-1",
      name: "Projects",
      description: null,
      icon: null,
      created_by_user_id: "u1",
      board_property_id: null,
      calendar_property_id: null,
      created_at: "x",
      updated_at: "x",
    });
    vi.mocked(getDatabasePropertyById).mockResolvedValue({
      id: "prop-date",
      database_id: "db-1",
      name: "Date",
      type: "date",
      config: {},
      config_json: "{}",
      sort_order: 1,
      created_at: "x",
      updated_at: "x",
    });

    await expect(
      handleUpdateDatabase(
        {} as D1Database,
        "ws-1",
        "db-1",
        new Request("http://localhost/api/databases/db-1", {
          method: "PUT",
          body: JSON.stringify({ board_property_id: "prop-date" }),
        }),
      ),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 400,
    });

    expect(updateDatabaseById).not.toHaveBeenCalled();
  });

  it("rejects invalid single select values", async () => {
    vi.mocked(getNoteById).mockResolvedValue({
      id: "note-1",
      folder_id: null,
      database_id: "db-1",
      title: "Launch",
      content: "",
      is_favorite: false,
      is_pinned: false,
      is_daily: false,
      daily_date: null,
      created_at: "x",
      updated_at: "x",
      deleted_at: null,
      archived_at: null,
      last_opened_at: null,
      tags: [],
      folder: null,
    });
    vi.mocked(listDatabaseProperties).mockResolvedValue([
      {
        id: "prop-status",
        database_id: "db-1",
        name: "Status",
        type: "single_select",
        config: { options: [{ id: "todo", name: "Todo", color: "#6B9EFF" }] },
        config_json: "{}",
        sort_order: 1,
        created_at: "x",
        updated_at: "x",
      },
    ]);

    await expect(
      handleUpdateDatabaseNoteValues(
        {} as D1Database,
        "u1",
        "ws-1",
        "note-1",
        new Request("http://localhost/api/notes/note-1/database-values", {
          method: "PUT",
          body: JSON.stringify({ values: [{ property_id: "prop-status", value_json: ["missing"] }] }),
        }),
      ),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 400,
    });

    expect(upsertNotePropertyValues).not.toHaveBeenCalled();
  });

  it("normalizes numeric values and clears unrelated columns", async () => {
    vi.mocked(getNoteById).mockResolvedValue({
      id: "note-1",
      folder_id: null,
      database_id: "db-1",
      title: "Launch",
      content: "",
      is_favorite: false,
      is_pinned: false,
      is_daily: false,
      daily_date: null,
      created_at: "x",
      updated_at: "x",
      deleted_at: null,
      archived_at: null,
      last_opened_at: null,
      tags: [],
      folder: null,
    });
    vi.mocked(listDatabaseProperties).mockResolvedValue([
      {
        id: "prop-effort",
        database_id: "db-1",
        name: "Effort",
        type: "number",
        config: {},
        config_json: "{}",
        sort_order: 1,
        created_at: "x",
        updated_at: "x",
      },
    ]);
    vi.mocked(upsertNotePropertyValues).mockResolvedValue(undefined);

    await handleUpdateDatabaseNoteValues(
      {} as D1Database,
      "u1",
      "ws-1",
      "note-1",
      new Request("http://localhost/api/notes/note-1/database-values", {
        method: "PUT",
        body: JSON.stringify({ values: [{ property_id: "prop-effort", value_number: 5, value_text: "ignored" }] }),
      }),
    );

    expect(upsertNotePropertyValues).toHaveBeenCalledWith(
      {} as D1Database,
      "ws-1",
      "note-1",
      [
        {
          propertyId: "prop-effort",
          valueText: null,
          valueNumber: 5,
          valueBoolean: null,
          valueDate: null,
          valueJson: null,
        },
      ],
    );
  });

  it("rejects database value updates when the field is not writable", async () => {
    const property = {
      id: "prop-secret",
      database_id: "db-1",
      name: "Secret",
      type: "text" as const,
      config: {},
      config_json: "{}",
      sort_order: 1,
      created_at: "x",
      updated_at: "x",
    };
    vi.mocked(getNoteById).mockResolvedValue({
      id: "note-1",
      folder_id: null,
      database_id: "db-1",
      title: "Launch",
      content: "",
      is_favorite: false,
      is_pinned: false,
      is_daily: false,
      daily_date: null,
      created_at: "x",
      updated_at: "x",
      deleted_at: null,
      archived_at: null,
      last_opened_at: null,
      tags: [],
      folder: null,
    });
    vi.mocked(getDatabaseById).mockResolvedValue({ id: "db-1", workspace_id: "ws-1", name: "Projects", description: null, icon: null, created_by_user_id: "u1", board_property_id: null, calendar_property_id: null, created_at: "x", updated_at: "x" });
    vi.mocked(listDatabasePermissions).mockResolvedValue([{ id: "p1", database_id: "db-1", subject_type: "workspace_role", subject_id: "editor", role: "editor", created_at: "x", updated_at: "x" }]);
    vi.mocked(listDatabaseProperties).mockResolvedValue([property]);
    vi.mocked(getDatabasePropertyById).mockResolvedValue(property);
    vi.mocked(getDatabaseFieldPermission).mockResolvedValue({ id: "fp-1", property_id: "prop-secret", viewer_roles: ["owner", "editor"], editor_roles: ["owner"], created_at: "x", updated_at: "x" });

    await expect(handleUpdateDatabaseNoteValues(
      {} as D1Database,
      "u1",
      "ws-1",
      "note-1",
      new Request("http://localhost/api/notes/note-1/database-values", {
        method: "PUT",
        body: JSON.stringify({ values: [{ property_id: "prop-secret", value_text: "hidden" }] }),
      }),
      { userId: "u1", workspaceRole: "editor" },
    )).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });

    expect(upsertNotePropertyValues).not.toHaveBeenCalled();
  });

  it("creates a server-synced database view", async () => {
    vi.mocked(getDatabaseById).mockResolvedValue({
      id: "db-1",
      workspace_id: "ws-1",
      name: "Projects",
      description: null,
      icon: null,
      created_by_user_id: "u1",
      board_property_id: null,
      calendar_property_id: null,
      created_at: "x",
      updated_at: "x",
    });
    vi.mocked(insertDatabaseView).mockResolvedValue(undefined);
    vi.mocked(listDatabaseViews).mockResolvedValue([
      {
        id: "view-1",
        database_id: "db-1",
        name: "My view",
        created_by_user_id: "u1",
        created_at: "x",
        updated_at: "x",
        view: "table",
        visibleColumnIds: ["prop-status"],
        filterQuery: "Launch",
        filterPropertyId: "",
        filterPropertyValue: "",
        advancedFilter: { mode: "and", rules: [] },
        sortField: "updated_at",
        sortDirection: "desc",
      },
    ]);

    const response = await handleCreateDatabaseView(
      {} as D1Database,
      "u1",
      "ws-1",
      "db-1",
      new Request("http://localhost/api/databases/db-1/views", {
        method: "POST",
        body: JSON.stringify({ name: "My view", view: "table", visibleColumnIds: ["prop-status"], filterQuery: "Launch" }),
      }),
    );

    expect(response.status).toBe(201);
    expect(insertDatabaseView).toHaveBeenCalled();
  });

  it("audits database and field permission changes", async () => {
    vi.mocked(getDatabaseById).mockResolvedValue({
      id: "db-1",
      workspace_id: "ws-1",
      name: "Projects",
      description: null,
      icon: null,
      created_by_user_id: "u1",
      board_property_id: null,
      calendar_property_id: null,
      created_at: "x",
      updated_at: "x",
    });
    vi.mocked(replaceDatabasePermissions).mockResolvedValue(undefined);
    vi.mocked(listDatabasePermissions).mockResolvedValue([
      { id: "perm-1", database_id: "db-1", subject_type: "workspace_role", subject_id: "viewer", role: "viewer", created_at: "x", updated_at: "x" },
    ]);
    vi.mocked(upsertDatabaseFieldPermission).mockResolvedValue(undefined);
    vi.mocked(getDatabaseFieldPermission).mockResolvedValue({
      id: "field-perm-1",
      property_id: "prop-1",
      viewer_roles: ["owner", "editor"],
      editor_roles: ["owner"],
      created_at: "x",
      updated_at: "x",
    });

    await handleUpdateDatabasePermissions(
      {} as D1Database,
      "u1",
      "ws-1",
      "db-1",
      new Request("http://localhost/api/databases/db-1/permissions", {
        method: "PUT",
        body: JSON.stringify({ permissions: [{ subject_type: "workspace_role", subject_id: "viewer", role: "viewer" }] }),
      }),
    );

    await handleUpdateFieldPermissions(
      {} as D1Database,
      "u1",
      "ws-1",
      "db-1",
      "prop-1",
      new Request("http://localhost/api/databases/db-1/properties/prop-1/permissions", {
        method: "PUT",
        body: JSON.stringify({ viewer_roles: ["owner", "editor"], editor_roles: ["owner"] }),
      }),
    );

    expect(insertActivityLog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: "database_permissions.update",
      audit: true,
    }));
    expect(insertActivityLog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: "database_field_permissions.update",
      entityType: "database_property",
      audit: true,
    }));
  });

  it("audits batch database record updates", async () => {
    const property = { id: "prop-status", database_id: "db-1", name: "Status", type: "text" as const, config: {}, config_json: "{}", sort_order: 1, created_at: "x", updated_at: "x" };
    vi.mocked(getDatabaseById).mockResolvedValue({
      id: "db-1",
      workspace_id: "ws-1",
      name: "Projects",
      description: null,
      icon: null,
      created_by_user_id: "u1",
      board_property_id: null,
      calendar_property_id: null,
      created_at: "x",
      updated_at: "x",
    });
    vi.mocked(listDatabaseProperties).mockResolvedValue([property]);
    vi.mocked(getNoteById).mockResolvedValue({
      id: "note-1",
      folder_id: null,
      database_id: "db-1",
      title: "Launch",
      content: "",
      is_favorite: false,
      is_pinned: false,
      is_daily: false,
      daily_date: null,
      created_at: "x",
      updated_at: "x",
      deleted_at: null,
      archived_at: null,
      last_opened_at: null,
      tags: [],
      folder: null,
    });
    vi.mocked(upsertNotePropertyValues).mockResolvedValue(undefined);
    vi.mocked(listDatabaseNotes).mockResolvedValue([]);

    await handleBatchDatabaseNotes(
      {} as D1Database,
      "u1",
      "ws-1",
      "db-1",
      new Request("http://localhost/api/databases/db-1/notes/batch", {
        method: "POST",
        body: JSON.stringify({
          note_ids: ["note-1"],
          action: "update_values",
          values: [{ property_id: "prop-status", value_text: "Done" }],
        }),
      }),
    );

    expect(insertActivityLog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: "database_notes.update_values",
      entityType: "database",
      entityId: "db-1",
      audit: true,
      metadata: { count: 1 },
    }));
  });

  it("exports database rows to csv", async () => {
    vi.mocked(getDatabaseById).mockResolvedValue({
      id: "db-1",
      workspace_id: "ws-1",
      name: "Projects",
      description: null,
      icon: null,
      created_by_user_id: "u1",
      board_property_id: null,
      calendar_property_id: null,
      created_at: "x",
      updated_at: "x",
    });
    vi.mocked(listDatabaseProperties).mockResolvedValue([
      { id: "prop-title", database_id: "db-1", name: "Title", type: "title", config: {}, config_json: "{}", sort_order: 0, created_at: "x", updated_at: "x" },
      { id: "prop-url", database_id: "db-1", name: "Link", type: "url", config: {}, config_json: "{}", sort_order: 1, created_at: "x", updated_at: "x" },
    ]);
    vi.mocked(listDatabaseNotes).mockResolvedValue([
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
        created_at: "x",
        updated_at: "x",
        deleted_at: null,
        archived_at: null,
        last_opened_at: null,
        tags: [],
        folder: null,
        database_values: {
          "prop-url": { property_id: "prop-url", type: "url", value_text: "https://example.com" },
        },
      },
    ]);
    vi.mocked(listWorkspaceMembers).mockResolvedValue([]);

    const response = await handleExportDatabaseCsv({} as D1Database, "u1", "ws-1", "db-1");
    const text = await response.text();
    expect(text).toContain("Title,Link");
    expect(text).toContain("Launch,https://example.com");
  });

  it("imports csv rows and auto-creates missing select options", async () => {
    vi.mocked(getDatabaseById).mockResolvedValue({
      id: "db-1",
      workspace_id: "ws-1",
      name: "Projects",
      description: null,
      icon: null,
      created_by_user_id: "u1",
      board_property_id: null,
      calendar_property_id: null,
      created_at: "x",
      updated_at: "x",
    });
    vi.mocked(listDatabaseProperties).mockResolvedValue([
      { id: "prop-title", database_id: "db-1", name: "Title", type: "title", config: {}, config_json: "{}", sort_order: 0, created_at: "x", updated_at: "x" },
      { id: "prop-status", database_id: "db-1", name: "Status", type: "single_select", config: { options: [] }, config_json: "{}", sort_order: 1, created_at: "x", updated_at: "x" },
    ]);
    vi.mocked(listDatabaseNotes).mockResolvedValue([]);
    vi.mocked(listWorkspaceMembers).mockResolvedValue([]);
    vi.mocked(updateDatabasePropertyById).mockResolvedValue(undefined);
    vi.mocked(upsertNotePropertyValues).mockResolvedValue(undefined);

    const file = new File(["Title,Status\nLaunch,Todo"], "import.csv", { type: "text/csv" });
    const formData = new FormData();
    formData.append("file", file);
    const { db, batch } = createBatchDb();

    const response = await handleImportDatabaseCsv(
      db,
      "u1",
      "ws-1",
      "db-1",
      new Request("http://localhost/api/databases/db-1/import-csv", {
        method: "POST",
        body: formData,
      }),
    );

    expect(response.status).toBe(201);
    expect(batch).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ sql: expect.stringContaining("UPDATE database_properties") }),
      expect.objectContaining({ sql: expect.stringContaining("INSERT INTO notes") }),
      expect.objectContaining({ sql: expect.stringContaining("INSERT INTO note_property_values") }),
    ]));
  });

  it("rejects csv imports that write to unreadable fields", async () => {
    const property = { id: "prop-secret", database_id: "db-1", name: "Secret", type: "text" as const, config: {}, config_json: "{}", sort_order: 1, created_at: "x", updated_at: "x" };
    vi.mocked(getDatabaseById).mockResolvedValue({ id: "db-1", workspace_id: "ws-1", name: "Projects", description: null, icon: null, created_by_user_id: "u1", board_property_id: null, calendar_property_id: null, created_at: "x", updated_at: "x" });
    vi.mocked(listDatabasePermissions).mockResolvedValue([{ id: "p1", database_id: "db-1", subject_type: "workspace_role", subject_id: "editor", role: "editor", created_at: "x", updated_at: "x" }]);
    vi.mocked(listDatabaseProperties).mockResolvedValue([
      { id: "prop-title", database_id: "db-1", name: "Title", type: "title", config: {}, config_json: "{}", sort_order: 0, created_at: "x", updated_at: "x" },
      property,
    ]);
    vi.mocked(listDatabaseNotes).mockResolvedValue([]);
    vi.mocked(listWorkspaceMembers).mockResolvedValue([]);
    vi.mocked(getDatabasePropertyById).mockResolvedValue(property);
    vi.mocked(getDatabaseFieldPermission).mockResolvedValue({ id: "fp-1", property_id: "prop-secret", viewer_roles: ["owner", "editor"], editor_roles: ["owner"], created_at: "x", updated_at: "x" });
    const formData = new FormData();
    formData.append("file", new File(["Title,Secret\nLaunch,hidden"], "import.csv", { type: "text/csv" }));
    const { db, batch } = createBatchDb();

    await expect(handleImportDatabaseCsv(
      db,
      "u1",
      "ws-1",
      "db-1",
      new Request("http://localhost/api/databases/db-1/import-csv", { method: "POST", body: formData }),
      { userId: "u1", workspaceRole: "editor" },
    )).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });

    expect(batch).not.toHaveBeenCalled();
  });

  it("deletes a database by detaching notes before removing the database", async () => {
    vi.mocked(getDatabaseById).mockResolvedValue({
      id: "db-1",
      workspace_id: "ws-1",
      name: "Projects",
      description: null,
      icon: null,
      created_by_user_id: "u1",
      board_property_id: null,
      calendar_property_id: null,
      created_at: "x",
      updated_at: "x",
    });
    vi.mocked(detachNotesFromDatabase).mockResolvedValue(undefined);
    vi.mocked(deleteDatabaseById).mockResolvedValue(undefined);

    const response = await handleDeleteDatabase({} as D1Database, "ws-1", "db-1");
    const body = await response.json() as { success: boolean; data: { id: string } };

    expect(body.success).toBe(true);
    expect(body.data.id).toBe("db-1");
    expect(detachNotesFromDatabase).toHaveBeenCalledWith({} as D1Database, "ws-1", "db-1");
    expect(deleteDatabaseById).toHaveBeenCalledWith({} as D1Database, "ws-1", "db-1");
    expect(detachNotesFromDatabase.mock.invocationCallOrder[0]).toBeLessThan(deleteDatabaseById.mock.invocationCallOrder[0]);
  });

  it("rejects deleting the title property", async () => {
    vi.mocked(getDatabasePropertyById).mockResolvedValue({
      id: "prop-title",
      database_id: "db-1",
      name: "Title",
      type: "title",
      config: {},
      config_json: "{}",
      sort_order: 0,
      created_at: "x",
      updated_at: "x",
    });

    await expect(handleDeleteDatabaseProperty({} as D1Database, "ws-1", "db-1", "prop-title")).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 400,
    });
    expect(deleteDatabasePropertyById).not.toHaveBeenCalled();
  });

  it("imports quoted multiline csv cells", async () => {
    vi.mocked(getDatabaseById).mockResolvedValue({
      id: "db-1",
      workspace_id: "ws-1",
      name: "Projects",
      description: null,
      icon: null,
      created_by_user_id: "u1",
      board_property_id: null,
      calendar_property_id: null,
      created_at: "x",
      updated_at: "x",
    });
    vi.mocked(listDatabaseProperties).mockResolvedValue([
      { id: "prop-title", database_id: "db-1", name: "Title", type: "title", config: {}, config_json: "{}", sort_order: 0, created_at: "x", updated_at: "x" },
      { id: "prop-notes", database_id: "db-1", name: "Notes", type: "text", config: {}, config_json: "{}", sort_order: 1, created_at: "x", updated_at: "x" },
    ]);
    vi.mocked(listDatabaseNotes).mockResolvedValue([]);
    vi.mocked(listWorkspaceMembers).mockResolvedValue([]);
    vi.mocked(upsertNotePropertyValues).mockResolvedValue(undefined);

    const file = new File(["Title,Notes\nLaunch,\"Line one\nLine two\""], "import.csv", { type: "text/csv" });
    const formData = new FormData();
    formData.append("file", file);
    const { db, batch } = createBatchDb();

    const response = await handleImportDatabaseCsv(
      db,
      "u1",
      "ws-1",
      "db-1",
      new Request("http://localhost/api/databases/db-1/import-csv", { method: "POST", body: formData }),
    );

    expect(response.status).toBe(201);
    expect(batch).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({
        sql: expect.stringContaining("INSERT INTO note_property_values"),
        bindings: expect.arrayContaining(["Line one\nLine two"]),
      }),
    ]));
  });

  it("rejects duplicate csv headers before importing rows", async () => {
    vi.mocked(getDatabaseById).mockResolvedValue({
      id: "db-1",
      workspace_id: "ws-1",
      name: "Projects",
      description: null,
      icon: null,
      created_by_user_id: "u1",
      board_property_id: null,
      calendar_property_id: null,
      created_at: "x",
      updated_at: "x",
    });
    vi.mocked(listDatabaseProperties).mockResolvedValue([
      { id: "prop-title", database_id: "db-1", name: "Title", type: "title", config: {}, config_json: "{}", sort_order: 0, created_at: "x", updated_at: "x" },
    ]);
    vi.mocked(listDatabaseNotes).mockResolvedValue([]);
    vi.mocked(listWorkspaceMembers).mockResolvedValue([]);
    const file = new File(["Title,Title\nLaunch,Duplicate"], "import.csv", { type: "text/csv" });
    const formData = new FormData();
    formData.append("file", file);

    await expect(handleImportDatabaseCsv(
      {} as D1Database,
      "u1",
      "ws-1",
      "db-1",
      new Request("http://localhost/api/databases/db-1/import-csv", { method: "POST", body: formData }),
    )).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 400,
    });
  });

  it("rejects invalid csv number cells before committing the batch", async () => {
    vi.mocked(getDatabaseById).mockResolvedValue({
      id: "db-1",
      workspace_id: "ws-1",
      name: "Projects",
      description: null,
      icon: null,
      created_by_user_id: "u1",
      board_property_id: null,
      calendar_property_id: null,
      created_at: "x",
      updated_at: "x",
    });
    vi.mocked(listDatabaseProperties).mockResolvedValue([
      { id: "prop-title", database_id: "db-1", name: "Title", type: "title", config: {}, config_json: "{}", sort_order: 0, created_at: "x", updated_at: "x" },
      { id: "prop-score", database_id: "db-1", name: "Score", type: "number", config: {}, config_json: "{}", sort_order: 1, created_at: "x", updated_at: "x" },
    ]);
    vi.mocked(listDatabaseNotes).mockResolvedValue([]);
    vi.mocked(listWorkspaceMembers).mockResolvedValue([]);
    const formData = new FormData();
    formData.append("file", new File(["Title,Score\nLaunch,nope"], "import.csv", { type: "text/csv" }));
    const { db, batch } = createBatchDb();

    await expect(handleImportDatabaseCsv(
      db,
      "u1",
      "ws-1",
      "db-1",
      new Request("http://localhost/api/databases/db-1/import-csv", { method: "POST", body: formData }),
    )).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 400,
    });
    expect(batch).not.toHaveBeenCalled();
  });

  it("ignores unknown csv columns without writing property values", async () => {
    vi.mocked(getDatabaseById).mockResolvedValue({
      id: "db-1",
      workspace_id: "ws-1",
      name: "Projects",
      description: null,
      icon: null,
      created_by_user_id: "u1",
      board_property_id: null,
      calendar_property_id: null,
      created_at: "x",
      updated_at: "x",
    });
    vi.mocked(listDatabaseProperties).mockResolvedValue([
      { id: "prop-title", database_id: "db-1", name: "Title", type: "title", config: {}, config_json: "{}", sort_order: 0, created_at: "x", updated_at: "x" },
    ]);
    vi.mocked(listDatabaseNotes).mockResolvedValue([]);
    vi.mocked(listWorkspaceMembers).mockResolvedValue([]);
    const formData = new FormData();
    formData.append("file", new File(["Title,Unknown\nLaunch,ignored"], "import.csv", { type: "text/csv" }));
    const { db, batch } = createBatchDb();

    const response = await handleImportDatabaseCsv(
      db,
      "u1",
      "ws-1",
      "db-1",
      new Request("http://localhost/api/databases/db-1/import-csv", { method: "POST", body: formData }),
    );
    const statements = batch.mock.calls[0]?.[0] as Array<{ sql: string }> | undefined;

    expect(response.status).toBe(201);
    expect(statements?.filter((statement) => statement.sql.includes("INSERT INTO note_property_values"))).toHaveLength(0);
    expect(statements?.filter((statement) => statement.sql.includes("INSERT INTO notes"))).toHaveLength(1);
  });
});
