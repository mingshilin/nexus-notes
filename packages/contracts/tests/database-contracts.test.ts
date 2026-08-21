import { describe, expect, it } from "vitest";

type Schema = { safeParse(value: unknown): { success: boolean; data?: unknown } };
type ContractExports = Record<string, Schema | unknown>;

async function loadContracts() {
  return (await import("../src/index")) as ContractExports;
}

const now = "2026-08-21T00:00:00.000Z";

describe("structured database contracts", () => {
  it("exports tenant-scoped revisioned database, property, record, view, template, and comment schemas", async () => {
    const contracts = await loadContracts();
    const fixtures: Array<[string, unknown]> = [
      ["DatabaseSchema", {
        id: "db-1", workspace_id: "ws-1", name: "Projects", description: "Delivery",
        created_by: "user-1", revision: 1, created_at: now, updated_at: now,
      }],
      ["DatabasePropertySchema", {
        id: "prop-1", workspace_id: "ws-1", database_id: "db-1", name: "Status",
        type: "select", config: { options: [{ id: "todo", name: "Todo", color: "blue" }] },
        position: 0, hidden: false, read_only: false, revision: 1, created_at: now, updated_at: now,
      }],
      ["DatabaseRecordSchema", {
        id: "record-1", workspace_id: "ws-1", database_id: "db-1", note_id: "note-1",
        values: { "prop-1": "todo" }, created_by: "user-1", updated_by: "user-1",
        revision: 1, created_at: now, updated_at: now,
      }],
      ["DatabaseViewSchema", {
        id: "view-1", workspace_id: "ws-1", database_id: "db-1", name: "Board", type: "board",
        config: {
          filters: [], sorts: [{ property_id: "prop-1", direction: "asc" }], grouping: { property_id: "prop-1" },
          visible_columns: ["prop-1"], page_size: 50,
          settings: { card_properties: ["prop-1"], hide_empty_groups: false },
        },
        position: 0, revision: 1, created_at: now, updated_at: now,
      }],
      ["DatabaseTemplateSchema", {
        id: "template-1", workspace_id: "ws-1", database_id: "db-1", name: "Launch",
        default_values: { "prop-1": "todo" }, revision: 1, created_at: now, updated_at: now,
      }],
      ["DatabaseCommentSchema", {
        id: "comment-1", workspace_id: "ws-1", database_id: "db-1", record_id: "record-1",
        author_user_id: "user-1", parent_id: null, body: "Check owner", revision: 1,
        created_at: now, updated_at: now,
      }],
    ];

    for (const [name, fixture] of fixtures) {
      expect(contracts[name], name).toBeDefined();
      expect((contracts[name] as Schema).safeParse(fixture).success, name).toBe(true);
      expect((contracts[name] as Schema).safeParse({ ...fixture as object, workspace_id: "", revision: 0 }).success, name).toBe(false);
    }
  });

  it("supports exactly the ten Beta property types and bounded cursor pages", async () => {
    const contracts = await loadContracts();
    const typeSchema = contracts.DatabasePropertyTypeSchema as Schema;
    const pageSchema = contracts.DatabaseRecordCursorPageSchema as Schema;
    expect(typeSchema).toBeDefined();

    for (const type of ["text", "number", "checkbox", "select", "multi_select", "date", "url", "email", "member", "relation"]) {
      expect(typeSchema.safeParse(type).success, type).toBe(true);
    }
    for (const type of ["title", "file", "formula", "status"]) {
      expect(typeSchema.safeParse(type).success, type).toBe(false);
    }
    expect(pageSchema.safeParse({ items: [], next_cursor: null }).success).toBe(true);
    expect(pageSchema.safeParse({ items: [], next_cursor: "" }).success).toBe(false);
  });

  it("does not advertise unsupported date-time configuration", async () => {
    const contracts = await loadContracts();
    const schema = contracts.CreateDatabasePropertyInputSchema as Schema;

    expect(schema.safeParse({ name: "Due", type: "date", config: { include_time: true }, position: 0 }).success).toBe(false);
    expect(schema.safeParse({ name: "Due", type: "date", config: {}, position: 0 }).success).toBe(true);
  });

  it("exports strict CRUD, permission, atomic mutation, board, calendar, template, and CSV inputs", async () => {
    const contracts = await loadContracts();
    const fixtures: Array<[string, unknown, unknown]> = [
      ["CreateDatabaseInputSchema", { name: "Projects", description: "" }, { name: "Projects", unknown: true }],
      ["UpdateDatabaseInputSchema", { base_revision: 1, name: "Roadmap" }, { base_revision: 0, name: "Roadmap" }],
      ["CreateDatabasePropertyInputSchema", { name: "Due", type: "date", config: {}, position: 1 }, { name: "Due", type: "formula" }],
      ["UpdateDatabasePropertyInputSchema", { base_revision: 1, hidden: true }, { base_revision: 1 }],
      ["CreateDatabaseRecordInputSchema", { values: { "prop-1": "todo" }, note_id: null }, { values: [], note_id: null }],
      ["UpdateDatabaseRecordInputSchema", { base_revision: 1, values: { "prop-1": "done" } }, { base_revision: 1, values: {} }],
      ["CreateDatabaseViewInputSchema", { name: "All", type: "table", config: { filters: [], sorts: [], grouping: null, visible_columns: [], page_size: 50, settings: {} } }, { name: "All", type: "gallery", config: {} }],
      ["UpdateDatabaseViewInputSchema", { base_revision: 1, config: { filters: [], sorts: [], grouping: null, visible_columns: [], page_size: 25, settings: {} } }, { base_revision: 1, config: { page_size: 0 } }],
      ["CreateDatabaseTemplateInputSchema", { name: "Default", default_values: { "prop-1": false } }, { name: "Default", default_values: [] }],
      ["UpdateDatabaseTemplateInputSchema", { base_revision: 1, default_values: { "prop-1": true } }, { base_revision: 1 }],
      ["CreateDatabaseCommentInputSchema", { record_id: "record-1", body: "Review" }, { record_id: "record-1", body: "" }],
      ["UpdateDatabaseCommentInputSchema", { base_revision: 1, body: "Resolved" }, { base_revision: 1, body: "" }],
      ["SetDatabasePermissionInputSchema", { subject_type: "user", subject_id: "user-2", role: "editor", base_revision: 1 }, { subject_type: "user", subject_id: "user-2", role: "admin" }],
      ["SetFieldPermissionInputSchema", { subject_type: "role", subject_id: "viewer", can_read: true, can_write: false, base_revision: 1 }, { subject_type: "role", subject_id: "viewer", can_read: false, can_write: true, base_revision: 1 }],
      ["BulkEditRecordsInputSchema", { mutations: [{ record_id: "record-1", base_revision: 1, values: { "prop-1": "done" } }] }, { mutations: [] }],
      ["BoardMoveInputSchema", { record_id: "record-1", property_id: "prop-1", option_id: "done", base_revision: 1 }, { record_id: "record-1", property_id: "prop-1", option_id: ["done"], base_revision: 1 }],
      ["CalendarAssignmentInputSchema", { record_id: "record-1", property_id: "due", date: "2026-08-22", base_revision: 1 }, { record_id: "record-1", property_id: "due", date: "22/08/2026", base_revision: 1 }],
      ["ApplyDatabaseTemplateInputSchema", { template_id: "template-1", records: [{ record_id: "record-1", base_revision: 1 }] }, { template_id: "template-1", records: [] }],
      ["CsvImportInputSchema", { csv: "Name,Due\r\nOne,2026-08-21", header_property_ids: { Name: "name" } }, { csv: "", header_property_ids: {} }],
      ["CsvExportInputSchema", { property_ids: ["prop-1"], cursor: null, page_size: 100 }, { property_ids: [], page_size: 5001 }],
    ];

    for (const [name, valid, invalid] of fixtures) {
      expect(contracts[name], name).toBeDefined();
      expect((contracts[name] as Schema).safeParse(valid).success, `${name} valid`).toBe(true);
      expect((contracts[name] as Schema).safeParse(invalid).success, `${name} invalid`).toBe(false);
    }
  });
});
