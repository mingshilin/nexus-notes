import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTestD1, seedTenants } from "./helpers/d1";

type WorkspaceRole = "owner" | "editor" | "viewer";
const context = (userId: string, role: WorkspaceRole = "owner") => ({
  workspaceId: "ws-1",
  userId,
  role,
  capabilities: new Set<string>(),
});

const now = "2026-08-21T00:00:00.000Z";
let dispose: (() => Promise<void>) | undefined;
let db: D1Database;

async function createRepository(repositoryDb: D1Database = db, idPrefix = "generated") {
  const worker = await import("../src/index") as Record<string, any>;
  expect(worker.D1DatabaseRepository).toBeTypeOf("function");
  let nextId = 0;
  return new worker.D1DatabaseRepository(repositoryDb, {
    createId: () => `${idPrefix}-${String(++nextId).padStart(4, "0")}`,
    clock: () => new Date(now),
  });
}

beforeEach(async () => {
  const testD1 = await createTestD1();
  db = testD1.db;
  dispose = testD1.dispose;
  await seedTenants(db);
});

afterEach(async () => {
  await dispose?.();
  dispose = undefined;
});

describe("D1 structured database repository", () => {
  it("lists bounded database pages with workspace-bound cursors", async () => {
    const repository = await createRepository();
    const owner = context("user-1");
    const databases = [];
    for (const name of ["One", "Two", "Three"]) {
      databases.push(await repository.createDatabase(owner, { name, description: "" }));
    }

    const first = await repository.listDatabasePage(owner, { limit: 2 });
    const second = await repository.listDatabasePage(owner, { limit: 2, cursor: first.next_cursor });

    expect(first.items).toHaveLength(2);
    expect(first.next_cursor).toEqual(expect.any(String));
    expect(second.items).toHaveLength(1);
    expect(new Set([...first.items, ...second.items].map((database: any) => database.id))).toEqual(new Set(databases.map((database: any) => database.id)));
    await expect(repository.listDatabasePage({ ...owner, workspaceId: "ws-2" }, { limit: 2, cursor: first.next_cursor }))
      .rejects.toMatchObject({ code: "INVALID_CURSOR", status: 400 });
  });

  it("performs tenant CRUD with stable keyset pages and server-side field filtering", async () => {
    const repository = await createRepository();
    const owner = context("user-1");
    const viewer = context("user-2", "viewer");
    const database = await repository.createDatabase(owner, { name: "Projects", description: "Delivery" });
    const title = await repository.createProperty(owner, database.id, { name: "Title", type: "text", config: {}, position: 0 });
    const secret = await repository.createProperty(owner, database.id, { name: "Secret", type: "text", config: {}, position: 1 });
    const hidden = await repository.createProperty(owner, database.id, { name: "Hidden", type: "text", config: {}, position: 2, hidden: true });

    await repository.setFieldPermission(owner, database.id, secret.id, {
      subject_type: "role", subject_id: "viewer", can_read: false, can_write: false, base_revision: 1,
    });
    const records = [];
    for (const suffix of ["A", "B", "C"]) {
      records.push(await repository.createRecord(owner, database.id, {
        note_id: null,
        values: { [title.id]: suffix, [secret.id]: `secret-${suffix}` },
      }));
    }

    const first = await repository.listRecords(viewer, database.id, { limit: 2 });
    const second = await repository.listRecords(viewer, database.id, { limit: 2, cursor: first.next_cursor });
    expect(first.items.map((record: any) => record.id)).toEqual(records.slice().reverse().slice(0, 2).map((record: any) => record.id));
    expect(second.items.map((record: any) => record.id)).toEqual([records[0].id]);
    expect(first.items.every((record: any) => Object.keys(record.values).join() === title.id)).toBe(true);

    const bundle = await repository.getDatabase(viewer, database.id);
    expect(bundle.properties.map((property: any) => property.id)).toEqual([title.id]);
    expect(bundle.templates).toEqual([]);
    await expect(repository.createRecord(viewer, database.id, { note_id: null, values: { [title.id]: "Denied" } }))
      .rejects.toMatchObject({ code: "DATABASE_WRITE_DENIED", status: 403 });
    await expect(repository.createRecord(context("user-2", "editor"), database.id, { note_id: null, values: { [hidden.id]: "Denied" } }))
      .rejects.toMatchObject({ code: "HIDDEN_FIELD", status: 400 });
  });

  it("supports database/property/record/view/template/comment CRUD with revision conflicts", async () => {
    const repository = await createRepository();
    const owner = context("user-1");
    let database = await repository.createDatabase(owner, { name: "Projects", description: "" });
    database = await repository.updateDatabase(owner, database.id, { base_revision: 1, description: "Updated" });
    const property = await repository.createProperty(owner, database.id, { name: "Name", type: "text", config: {}, position: 0 });
    const updatedProperty = await repository.updateProperty(owner, database.id, property.id, { base_revision: 1, name: "Title" });
    let record = await repository.createRecord(owner, database.id, { note_id: null, values: { [property.id]: "One" } });
    record = await repository.updateRecord(owner, database.id, record.id, { base_revision: 1, values: { [property.id]: "Two" } });
    let view = await repository.createView(owner, database.id, {
      name: "All", type: "table", position: 0,
      config: { filters: [], sorts: [], grouping: null, visible_columns: [property.id], page_size: 50, settings: {} },
    });
    view = await repository.updateView(owner, database.id, view.id, {
      base_revision: 1,
      config: { ...view.config, page_size: 25, settings: { row_height: "compact" } },
    });
    let template = await repository.createTemplate(owner, database.id, { name: "Default", default_values: { [property.id]: "Template" } });
    template = await repository.updateTemplate(owner, database.id, template.id, { base_revision: 1, name: "Starter" });
    let comment = await repository.createComment(owner, database.id, { record_id: record.id, body: "Review" });
    comment = await repository.updateComment(owner, database.id, comment.id, { base_revision: 1, body: "Resolved" });

    expect([database.revision, updatedProperty.revision, record.revision, view.revision, template.revision, comment.revision]).toEqual([2, 2, 2, 2, 2, 2]);
    await expect(repository.updateRecord(owner, database.id, record.id, { base_revision: 1, values: { [property.id]: "Stale" } }))
      .rejects.toMatchObject({ code: "REVISION_CONFLICT", status: 409 });
    expect(await repository.listComments(owner, database.id, record.id)).toHaveLength(1);

    await repository.deleteComment(owner, database.id, comment.id, { base_revision: 2 });
    await repository.deleteTemplate(owner, database.id, template.id, { base_revision: 2 });
    await repository.deleteView(owner, database.id, view.id, { base_revision: 2 });
    await repository.deleteRecord(owner, database.id, record.id, { base_revision: 2 });
    await repository.deleteProperty(owner, database.id, property.id, { base_revision: 2 });
    expect(await repository.listComments(owner, database.id, record.id)).toEqual([]);
  });

  it("requires database manage permission for property schema mutations", async () => {
    const repository = await createRepository();
    const owner = context("user-1");
    const editor = context("user-2", "editor");
    const database = await repository.createDatabase(owner, { name: "Permissions", description: "" });
    const property = await repository.createProperty(owner, database.id, { name: "Name", type: "text", config: {}, position: 0 });

    await expect(repository.updateProperty(editor, database.id, property.id, { base_revision: 1, hidden: true }))
      .rejects.toMatchObject({ code: "DATABASE_MANAGE_DENIED", status: 403 });
    await expect(repository.deleteProperty(editor, database.id, property.id, { base_revision: 1 }))
      .rejects.toMatchObject({ code: "DATABASE_MANAGE_DENIED", status: 403 });
  });

  it("lets a database owner override an explicit field denial for schema mutations", async () => {
    const repository = await createRepository();
    const owner = context("user-1");
    const managed = context("user-2", "editor");
    const database = await repository.createDatabase(owner, { name: "Field permissions", description: "" });
    const property = await repository.createProperty(owner, database.id, { name: "Name", type: "text", config: {}, position: 0 });
    await repository.setDatabasePermission(owner, database.id, {
      subject_type: "user", subject_id: managed.userId, role: "owner", base_revision: 1,
    });
    await repository.setFieldPermission(owner, database.id, property.id, {
      subject_type: "user", subject_id: managed.userId, can_read: true, can_write: false, base_revision: 1,
    });

    const updated = await repository.updateProperty(managed, database.id, property.id, { base_revision: 1, name: "Renamed" });
    expect(updated.name).toBe("Renamed");
    await expect(repository.deleteProperty(managed, database.id, property.id, { base_revision: updated.revision }))
      .resolves.toEqual({ id: property.id });
  });

  it("uses revision CAS for database and field permission upserts", async () => {
    const repository = await createRepository();
    const owner = context("user-1");
    const database = await repository.createDatabase(owner, { name: "Permission CAS", description: "" });
    const property = await repository.createProperty(owner, database.id, { name: "Name", type: "text", config: {}, position: 0 });

    await repository.setDatabasePermission(owner, database.id, {
      subject_type: "user", subject_id: "user-2", role: "viewer", base_revision: 1,
    });
    const databaseWrites = await Promise.allSettled([
      repository.setDatabasePermission(owner, database.id, { subject_type: "user", subject_id: "user-2", role: "editor", base_revision: 1 }),
      repository.setDatabasePermission(owner, database.id, { subject_type: "user", subject_id: "user-2", role: "owner", base_revision: 1 }),
    ]);
    expect(databaseWrites.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(databaseWrites.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(databaseWrites.find((result) => result.status === "rejected")).toMatchObject({ reason: { code: "REVISION_CONFLICT" } });

    await repository.setFieldPermission(owner, database.id, property.id, {
      subject_type: "user", subject_id: "user-2", can_read: true, can_write: false, base_revision: 1,
    });
    const fieldWrites = await Promise.allSettled([
      repository.setFieldPermission(owner, database.id, property.id, { subject_type: "user", subject_id: "user-2", can_read: true, can_write: true, base_revision: 1 }),
      repository.setFieldPermission(owner, database.id, property.id, { subject_type: "user", subject_id: "user-2", can_read: false, can_write: false, base_revision: 1 }),
    ]);
    expect(fieldWrites.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(fieldWrites.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(fieldWrites.find((result) => result.status === "rejected")).toMatchObject({ reason: { code: "REVISION_CONFLICT" } });
  });

  it("lists current permission revisions in a deterministic server-safe order", async () => {
    const repository = await createRepository();
    const owner = context("user-1");
    const database = await repository.createDatabase(owner, { name: "Permission list", description: "" });
    const property = await repository.createProperty(owner, database.id, { name: "Name", type: "text", config: {}, position: 0 });

    const first = await repository.setDatabasePermission(owner, database.id, {
      subject_type: "user", subject_id: "user-2", role: "viewer", base_revision: 1,
    });
    const updated = await repository.setDatabasePermission(owner, database.id, {
      subject_type: "user", subject_id: "user-2", role: "editor", base_revision: first.revision,
    });
    const rolePermission = await repository.setDatabasePermission(owner, database.id, {
      subject_type: "role", subject_id: "editor", role: "viewer", base_revision: 1,
    });
    const field = await repository.setFieldPermission(owner, database.id, property.id, {
      subject_type: "role", subject_id: "editor", can_read: true, can_write: false, base_revision: 1,
    });

    await expect(repository.listDatabasePermissions(owner, database.id)).resolves.toEqual([
      expect.objectContaining({ id: rolePermission.id, subject_type: "role", subject_id: "editor", role: "viewer", revision: 1 }),
      expect.objectContaining({ id: updated.id, subject_type: "user", subject_id: "user-2", role: "editor", revision: 2 }),
    ]);
    await expect(repository.listFieldPermissions(owner, database.id, property.id)).resolves.toEqual([
      expect.objectContaining({ id: field.id, subject_type: "role", subject_id: "editor", can_read: true, can_write: false, revision: 1 }),
    ]);
  });

  it("deletes permissions with revision CAS and keeps them scoped to a managed database", async () => {
    const repository = await createRepository();
    const owner = context("user-1");
    const viewer = context("user-2", "viewer");
    const foreign = { ...context("user-3"), workspaceId: "ws-2" };
    const database = await repository.createDatabase(owner, { name: "Permission delete", description: "" });
    const property = await repository.createProperty(owner, database.id, { name: "Name", type: "text", config: {}, position: 0 });
    const databasePermission = await repository.setDatabasePermission(owner, database.id, {
      subject_type: "user", subject_id: "user-2", role: "viewer", base_revision: 1,
    });
    const fieldPermission = await repository.setFieldPermission(owner, database.id, property.id, {
      subject_type: "user", subject_id: "user-2", can_read: true, can_write: false, base_revision: 1,
    });

    await expect(repository.listDatabasePermissions(viewer, database.id))
      .rejects.toMatchObject({ code: "DATABASE_MANAGE_DENIED", status: 403 });
    await expect(repository.listDatabasePermissions(foreign, database.id))
      .rejects.toMatchObject({ code: "DATABASE_NOT_FOUND", status: 404 });
    await expect(repository.deleteDatabasePermission(owner, database.id, databasePermission.id, { base_revision: 2 }))
      .rejects.toMatchObject({ code: "REVISION_CONFLICT", status: 409 });
    await expect(repository.deleteDatabasePermission(owner, database.id, databasePermission.id, { base_revision: 1 }))
      .resolves.toEqual({ id: databasePermission.id });
    await expect(repository.deleteFieldPermission(owner, database.id, property.id, fieldPermission.id, { base_revision: 1 }))
      .resolves.toEqual({ id: fieldPermission.id });
    await expect(repository.listDatabasePermissions(owner, database.id)).resolves.toEqual([]);
    await expect(repository.listFieldPermissions(owner, database.id, property.id)).resolves.toEqual([]);
  });

  it("validates member membership and relation targets within the workspace", async () => {
    const repository = await createRepository();
    const owner = context("user-1");
    const database = await repository.createDatabase(owner, { name: "References", description: "" });
    const target = await repository.createDatabase(owner, { name: "Target", description: "" });
    const member = await repository.createProperty(owner, database.id, { name: "Assignee", type: "member", config: {}, position: 0 });
    const relation = await repository.createProperty(owner, database.id, { name: "Related", type: "relation", config: { target_database_id: target.id }, position: 1 });
    const targetRecord = await repository.createRecord(owner, target.id, { note_id: null, values: {} });

    await expect(repository.createRecord(owner, database.id, { note_id: null, values: { [member.id]: "missing-user" } }))
      .rejects.toMatchObject({ code: "INVALID_MEMBER_REFERENCE", status: 400 });
    await expect(repository.createRecord(owner, database.id, { note_id: null, values: { [relation.id]: "missing-record" } }))
      .rejects.toMatchObject({ code: "INVALID_RELATION_REFERENCE", status: 400 });
    await expect(repository.createRecord(owner, database.id, { note_id: null, values: { [relation.id]: targetRecord.id } }))
      .resolves.toMatchObject({ values: { [relation.id]: targetRecord.id } });
  });

  it("detaches notes before database deletion and preserves note content", async () => {
    const repository = await createRepository();
    const owner = context("user-1");
    const database = await repository.createDatabase(owner, { name: "Projects", description: "" });
    await db.prepare(
      `INSERT INTO notes
       (id, workspace_id, database_id, created_by, updated_by, title, content, created_at, updated_at)
       VALUES ('note-1', 'ws-1', ?, 'user-1', 'user-1', 'Keep', 'Preserved body', ?, ?)`,
    ).bind(database.id, now, now).run();
    await repository.createRecord(owner, database.id, { note_id: "note-1", values: {} });

    await repository.deleteDatabase(owner, database.id, { base_revision: 1 });

    expect(await db.prepare("SELECT database_id, title, content, revision FROM notes WHERE id = 'note-1'").first()).toEqual({
      database_id: null, title: "Keep", content: "Preserved body", revision: 2,
    });
    expect(await db.prepare("SELECT COUNT(*) AS count FROM database_records WHERE database_id = ?").bind(database.id).first()).toEqual({ count: 0 });
  });

  it("rolls back note and record detachments when the database delete conflicts in the transaction", async () => {
    const repository = await createRepository();
    const owner = context("user-1");
    const database = await repository.createDatabase(owner, { name: "Conflict", description: "" });
    await db.prepare(
      `INSERT INTO notes
       (id, workspace_id, database_id, created_by, updated_by, title, content, created_at, updated_at)
       VALUES ('note-conflict', 'ws-1', ?, 'user-1', 'user-1', 'Keep', 'Preserved body', ?, ?)`,
    ).bind(database.id, now, now).run();
    await repository.createRecord(owner, database.id, { note_id: "note-conflict", values: {} });
    await db.prepare(
      `CREATE TRIGGER database_delete_conflict BEFORE DELETE ON databases
       WHEN OLD.id = '${database.id}'
       BEGIN
         UPDATE databases SET revision = revision + 1 WHERE id = OLD.id;
         SELECT RAISE(IGNORE);
       END;`,
    ).run();

    await expect(repository.deleteDatabase(owner, database.id, { base_revision: 1 }))
      .rejects.toMatchObject({ code: "REVISION_CONFLICT", status: 409 });
    expect(await db.prepare("SELECT database_id, content, revision FROM notes WHERE id = 'note-conflict'").first()).toEqual({
      database_id: database.id, content: "Preserved body", revision: 1,
    });
    expect(await db.prepare("SELECT COUNT(*) AS count FROM database_records WHERE database_id = ?").bind(database.id).first()).toEqual({ count: 1 });
  });

  it("rolls back bulk, board, calendar, and template application when any record fails", async () => {
    const repository = await createRepository();
    const owner = context("user-1");
    const database = await repository.createDatabase(owner, { name: "Projects", description: "" });
    const status = await repository.createProperty(owner, database.id, {
      name: "Status", type: "select", config: { options: [{ id: "todo", name: "Todo", color: "" }, { id: "done", name: "Done", color: "" }] }, position: 0,
    });
    const due = await repository.createProperty(owner, database.id, { name: "Due", type: "date", config: {}, position: 1 });
    const first = await repository.createRecord(owner, database.id, { note_id: null, values: { [status.id]: "todo", [due.id]: null } });
    const second = await repository.createRecord(owner, database.id, { note_id: null, values: { [status.id]: "todo", [due.id]: null } });

    await expect(repository.bulkEditRecords(owner, database.id, {
      mutations: [
        { record_id: first.id, base_revision: 1, values: { [status.id]: "done" } },
        { record_id: second.id, base_revision: 1, values: { [due.id]: "2023-02-29" } },
      ],
    })).rejects.toMatchObject({ code: "INVALID_FIELD_VALUE" });
    expect((await repository.listRecords(owner, database.id, { limit: 10 })).items.map((item: any) => item.values[status.id])).toEqual(["todo", "todo"]);

    await expect(repository.boardMove(owner, database.id, { record_id: first.id, property_id: due.id, option_id: "done", base_revision: 1 }))
      .rejects.toMatchObject({ code: "INVALID_BOARD_PROPERTY" });
    await expect(repository.calendarAssign(owner, database.id, { record_id: first.id, property_id: status.id, date: "2026-08-22", base_revision: 1 }))
      .rejects.toMatchObject({ code: "INVALID_CALENDAR_PROPERTY" });

    const template = await repository.createTemplate(owner, database.id, { name: "Done", default_values: { [status.id]: "done", [due.id]: "2026-08-22" } });
    await expect(repository.applyTemplate(owner, database.id, {
      template_id: template.id,
      records: [{ record_id: first.id, base_revision: 1 }, { record_id: second.id, base_revision: 99 }],
    })).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    expect((await repository.listRecords(owner, database.id, { limit: 10 })).items.map((item: any) => item.values[status.id])).toEqual(["todo", "todo"]);

    await repository.boardMove(owner, database.id, { record_id: first.id, property_id: status.id, option_id: "done", base_revision: 1 });
    await repository.calendarAssign(owner, database.id, { record_id: second.id, property_id: due.id, date: "2026-08-22", base_revision: 1 });
  });

  it("rolls back stale concurrent record values when only one revision update wins", async () => {
    const repository = await createRepository();
    const owner = context("user-1");
    const database = await repository.createDatabase(owner, { name: "Concurrent", description: "" });
    const title = await repository.createProperty(owner, database.id, { name: "Title", type: "text", config: {}, position: 0 });
    const record = await repository.createRecord(owner, database.id, { note_id: null, values: { [title.id]: "Initial" } });

    const results = await Promise.allSettled([
      repository.updateRecord(owner, database.id, record.id, { base_revision: 1, values: { [title.id]: "Winner A" } }),
      repository.updateRecord(owner, database.id, record.id, { base_revision: 1, values: { [title.id]: "Winner B" } }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect((await repository.getRecord(owner, database.id, record.id)).values[title.id]).toMatch(/^Winner [AB]$/u);
    expect((await repository.getRecord(owner, database.id, record.id)).revision).toBe(2);
  });

  it("searches with deterministic keyset cursors", async () => {
    const repository = await createRepository();
    const owner = context("user-1");
    const database = await repository.createDatabase(owner, { name: "Search", description: "" });
    const title = await repository.createProperty(owner, database.id, { name: "Title", type: "text", config: {}, position: 0 });
    await repository.createRecord(owner, database.id, { note_id: null, values: { [title.id]: "alpha one" } });
    await repository.createRecord(owner, database.id, { note_id: null, values: { [title.id]: "alpha two" } });
    await repository.createRecord(owner, database.id, { note_id: null, values: { [title.id]: "alpha three" } });

    const first = await repository.searchRecords(owner, database.id, { query: "alpha", limit: 1, cursor: null } as any);
    expect(first.items).toHaveLength(1);
    expect(first.next_cursor).toBeTypeOf("string");
    const second = await repository.searchRecords(owner, database.id, { query: "alpha", limit: 1, cursor: first.next_cursor } as any);
    expect(second.items).toHaveLength(1);
    expect(second.items[0]?.id).not.toBe(first.items[0]?.id);
  });

  it("summarizes database contents without exposing permission override counts to viewers", async () => {
    const repository = await createRepository();
    const owner = context("user-1");
    const viewer = context("user-2", "viewer");
    const database = await repository.createDatabase(owner, { name: "Stats", description: "Overview" });
    const title = await repository.createProperty(owner, database.id, { name: "Title", type: "text", config: {}, position: 0 });
    const secret = await repository.createProperty(owner, database.id, { name: "Secret", type: "text", config: {}, position: 1 });
    const record = await repository.createRecord(owner, database.id, { note_id: null, values: { [title.id]: "Visible", [secret.id]: "Hidden" } });
    await repository.createView(owner, database.id, {
      name: "All", type: "table", position: 0,
      config: { filters: [], sorts: [], grouping: null, visible_columns: [title.id], page_size: 50, settings: {} },
    });
    await repository.createTemplate(owner, database.id, { name: "Starter", default_values: { [title.id]: "Draft" } });
    await repository.createComment(owner, database.id, { record_id: record.id, body: "Review" });
    await repository.setDatabasePermission(owner, database.id, {
      subject_type: "user", subject_id: viewer.userId, role: "viewer", base_revision: 1,
    });
    await repository.setFieldPermission(owner, database.id, secret.id, {
      subject_type: "role", subject_id: "viewer", can_read: false, can_write: false, base_revision: 1,
    });

    await expect(repository.getStats(owner, database.id)).resolves.toMatchObject({
      record_count: 1,
      property_count: 2,
      view_count: 1,
      template_count: 1,
      comment_count: 1,
      role: "owner",
      database_permission_count: 1,
      field_permission_count: 1,
    });
    await expect(repository.getStats(viewer, database.id)).resolves.toMatchObject({
      record_count: 1,
      property_count: 1,
      view_count: 1,
      template_count: 1,
      comment_count: 1,
      role: "viewer",
      database_permission_count: null,
      field_permission_count: null,
    });
  });

  it("previews CSV type errors without writing valid or invalid rows", async () => {
    const repository = await createRepository();
    const owner = context("user-1");
    const database = await repository.createDatabase(owner, { name: "Preview", description: "" });
    const name = await repository.createProperty(owner, database.id, { name: "Name", type: "text", config: {}, position: 0 });
    const amount = await repository.createProperty(owner, database.id, { name: "Amount", type: "number", config: {}, position: 1 });

    const preview = await repository.previewCsv(owner, database.id, {
      csv: "Name,Amount\r\nGood,1.5\r\nBad,not-a-number",
      header_property_ids: { Name: name.id, Amount: amount.id },
    });

    expect(preview).toMatchObject({
      headers: ["Name", "Amount"],
      total_rows: 2,
      rows: [{ row_number: 2, values: { [name.id]: "Good", [amount.id]: 1.5 } }],
      errors: [{ row_number: 3, code: "INVALID_FIELD_VALUE" }],
    });
    expect((await repository.listRecords(owner, database.id, { limit: 10 })).items).toEqual([]);
  });

  it("imports CSV atomically and exports only readable fields with formula escaping", async () => {
    const repository = await createRepository();
    const owner = context("user-1");
    const viewer = context("user-2", "viewer");
    const database = await repository.createDatabase(owner, { name: "Import", description: "" });
    const name = await repository.createProperty(owner, database.id, { name: "Name", type: "text", config: {}, position: 0 });
    const amount = await repository.createProperty(owner, database.id, { name: "Amount", type: "number", config: { precision: 2 }, position: 1 });
    const secret = await repository.createProperty(owner, database.id, { name: "Secret", type: "text", config: {}, position: 2 });
    await repository.setFieldPermission(owner, database.id, secret.id, {
      subject_type: "role", subject_id: "viewer", can_read: false, can_write: false, base_revision: 1,
    });

    await expect(repository.importCsv(owner, database.id, {
      csv: "Name,Amount\r\nGood,1.5\r\nBad,not-a-number",
      header_property_ids: { Name: name.id, Amount: amount.id },
    })).rejects.toMatchObject({ code: "INVALID_FIELD_VALUE" });
    expect((await repository.listRecords(owner, database.id, { limit: 10 })).items).toEqual([]);

    await repository.importCsv(owner, database.id, {
      csv: '\uFEFFName,Amount,Secret\r\n"=SUM(1,2)",1.5,hidden\r\nPlain,,private',
      header_property_ids: { Name: name.id, Amount: amount.id, Secret: secret.id },
    });
    const exported = await repository.exportCsv(viewer, database.id, {
      property_ids: [name.id, amount.id, secret.id], cursor: null, page_size: 100,
    });
    expect(exported.next_cursor).toBeNull();
    expect(exported.csv).toContain("Name,Amount");
    expect(exported.csv).not.toContain("Secret");
    expect(exported.csv).not.toContain("hidden");
    expect(exported.csv).toContain("'=SUM(1,2)");
  });

  it("round-trips scalar member and relation values through CSV as string IDs", async () => {
    const repository = await createRepository();
    const owner = context("user-1");
    await db.prepare(
      "INSERT INTO workspace_members (workspace_id, user_id, role, joined_at, updated_at) VALUES ('ws-1', 'user-1', 'owner', ?, ?)",
    ).bind(now, now).run();
    const target = await repository.createDatabase(owner, { name: "Target", description: "" });
    const targetRecord = await repository.createRecord(owner, target.id, { note_id: null, values: {} });
    const source = await repository.createDatabase(owner, { name: "CSV source", description: "" });
    const sourceMember = await repository.createProperty(owner, source.id, {
      name: "Member", type: "member", config: { allow_multiple: false }, position: 0,
    });
    const sourceRelation = await repository.createProperty(owner, source.id, {
      name: "Relation", type: "relation", config: { target_database_id: target.id, allow_multiple: false }, position: 1,
    });
    await repository.createRecord(owner, source.id, {
      note_id: null,
      values: { [sourceMember.id]: "user-1", [sourceRelation.id]: targetRecord.id },
    });
    const exported = await repository.exportCsv(owner, source.id, {
      property_ids: [sourceMember.id, sourceRelation.id], cursor: null, page_size: 100,
    });

    const destination = await repository.createDatabase(owner, { name: "CSV destination", description: "" });
    const destinationMember = await repository.createProperty(owner, destination.id, {
      name: "Member", type: "member", config: { allow_multiple: false }, position: 0,
    });
    const destinationRelation = await repository.createProperty(owner, destination.id, {
      name: "Relation", type: "relation", config: { target_database_id: target.id, allow_multiple: false }, position: 1,
    });
    const imported = await repository.importCsv(owner, destination.id, {
      csv: exported.csv,
      header_property_ids: { Member: destinationMember.id, Relation: destinationRelation.id },
    });

    expect(imported.items).toHaveLength(1);
    expect(imported.items[0]?.values).toEqual({
      [destinationMember.id]: "user-1",
      [destinationRelation.id]: targetRecord.id,
    });
    expect(typeof imported.items[0]?.values[destinationMember.id]).toBe("string");
    expect(typeof imported.items[0]?.values[destinationRelation.id]).toBe("string");
  });

  it("imports 500 many-column rows with bounded statements and rolls back invalid batches", async () => {
    const repository = await createRepository();
    const owner = context("user-1");
    const database = await repository.createDatabase(owner, { name: "Large import", description: "" });
    const properties = [];
    for (let index = 0; index < 8; index += 1) {
      properties.push(await repository.createProperty(owner, database.id, {
        name: `Column ${index}`, type: index === 1 ? "number" : "text", config: {}, position: index,
      }));
    }
    const header = properties.map((property: any) => property.name).join(",");
    const rows = Array.from({ length: 500 }, (_, index) => properties.map((_: any, propertyIndex: number) => propertyIndex === 1 ? String(index) : `Row ${index}-${propertyIndex}`).join(","));
    const csv = `${header}\r\n${rows.join("\r\n")}`;
    let prepareCount = 0;
    const countedDb = new Proxy(db as unknown as object, {
      get(target, property, receiver) {
        if (property === "prepare") {
          return (...args: unknown[]) => {
            prepareCount += 1;
            return (target as D1Database).prepare.bind(target)(...args as [string]);
          };
        }
        return Reflect.get(target, property, receiver);
      },
    }) as D1Database;
    const countedRepository = await createRepository(countedDb, "csv-counted");

    await expect(countedRepository.importCsv(owner, database.id, {
      csv, header_property_ids: Object.fromEntries(properties.map((property: any) => [property.name, property.id])),
    })).resolves.toMatchObject({ imported_count: 500 });
    expect(prepareCount).toBeLessThanOrEqual(12);

    const invalidRows = rows.slice();
    invalidRows[499] = invalidRows[499]!.replace(",499,", ",not-a-number,");
    await expect(countedRepository.importCsv(owner, database.id, {
      csv: `${header}\r\n${invalidRows.join("\r\n")}`,
      header_property_ids: Object.fromEntries(properties.map((property: any) => [property.name, property.id])),
    })).rejects.toMatchObject({ code: "INVALID_FIELD_VALUE" });
    expect(await db.prepare("SELECT COUNT(*) AS count FROM database_records WHERE database_id = ?").bind(database.id).first()).toEqual({ count: 500 });
  });

  it("uses bounded set-based statements for a maximum-size bulk edit", async () => {
    const repository = await createRepository();
    const owner = context("user-1");
    const database = await repository.createDatabase(owner, { name: "Bulk limit", description: "" });
    const title = await repository.createProperty(owner, database.id, { name: "Title", type: "text", config: {}, position: 0 });
    const records = Array.from({ length: 100 }, (_, index) => ({ id: `bulk-${String(index).padStart(3, "0")}`, revision: 1 }));
    await db.batch([
      db.prepare(
        `INSERT INTO database_records
         (id, workspace_id, database_id, note_id, created_by, updated_by, revision, created_at, updated_at)
         SELECT json_extract(value, '$.id'), 'ws-1', ?, NULL, 'user-1', 'user-1', 1, ?, ? FROM json_each(?)`,
      ).bind(database.id, now, now, JSON.stringify(records)),
      db.prepare(
        `INSERT INTO record_values
         (id, workspace_id, database_id, record_id, property_id, value_json, revision, updated_at)
         SELECT 'value-' || json_extract(value, '$.id'), 'ws-1', ?, json_extract(value, '$.id'), ?,
           json_quote('Before'), 1, ? FROM json_each(?)`,
      ).bind(database.id, title.id, now, JSON.stringify(records)),
    ]);
    let prepareCount = 0;
    const countedDb = new Proxy(db as unknown as object, {
      get(target, property, receiver) {
        if (property === "prepare") {
          return (...args: unknown[]) => {
            prepareCount += 1;
            return (target as D1Database).prepare.bind(target)(...args as [string]);
          };
        }
        return Reflect.get(target, property, receiver);
      },
    }) as D1Database;
    const countedRepository = await createRepository(countedDb, "bulk-counted");

    await expect(countedRepository.bulkEditRecords(owner, database.id, {
      mutations: records.map((record: any, index) => ({
        record_id: record.id, base_revision: record.revision, values: { [title.id]: `After ${index}` },
      })),
    })).resolves.toMatchObject({ items: expect.arrayContaining([expect.objectContaining({ id: records[0]!.id })]) });
    expect(prepareCount).toBeLessThanOrEqual(12);
  });

  it("imports reference-heavy 500-row CSV with bounded reference checks", async () => {
    const repository = await createRepository();
    const owner = context("user-1");
    const database = await repository.createDatabase(owner, { name: "Reference CSV", description: "" });
    const target = await repository.createDatabase(owner, { name: "Reference target", description: "" });
    await db.prepare(
      "INSERT INTO workspace_members (workspace_id, user_id, role, joined_at, updated_at) VALUES ('ws-1', 'user-1', 'owner', ?, ?)",
    ).bind(now, now).run();
    const targetRecord = await repository.createRecord(owner, target.id, { note_id: null, values: {} });
    const member = await repository.createProperty(owner, database.id, { name: "Member", type: "member", config: { allow_multiple: true }, position: 0 });
    const relation = await repository.createProperty(owner, database.id, {
      name: "Relation", type: "relation", config: { target_database_id: target.id, allow_multiple: true }, position: 1,
    });
    const csv = `Member,Relation\r\n${Array.from({ length: 500 }, () => `user-1,${targetRecord.id}`).join("\r\n")}`;
    let prepareCount = 0;
    const countedDb = new Proxy(db as unknown as object, {
      get(targetObject, property, receiver) {
        if (property === "prepare") {
          return (...args: unknown[]) => {
            prepareCount += 1;
            return (targetObject as D1Database).prepare.bind(targetObject)(...args as [string]);
          };
        }
        return Reflect.get(targetObject, property, receiver);
      },
    }) as D1Database;
    const countedRepository = await createRepository(countedDb, "reference-csv");

    await expect(countedRepository.importCsv(owner, database.id, {
      csv, header_property_ids: { Member: member.id, Relation: relation.id },
    })).resolves.toMatchObject({ imported_count: 500 });
    expect(prepareCount).toBeLessThanOrEqual(12);
  });

  it("returns REFERENCE_LIMIT before normalizing later CSV rows or bulk mutations", async () => {
    const repository = await createRepository();
    const owner = context("user-1");
    const database = await repository.createDatabase(owner, { name: "Incremental references", description: "" });
    const target = await repository.createDatabase(owner, { name: "Incremental target", description: "" });
    const relation = await repository.createProperty(owner, database.id, {
      name: "Relation", type: "relation", config: { target_database_id: target.id, allow_multiple: true }, position: 0,
    });
    const amount = await repository.createProperty(owner, database.id, { name: "Amount", type: "number", config: {}, position: 1 });
    const referenceGroups = Array.from({ length: 10 }, (_, group) => Array.from(
      { length: 100 }, (_, index) => `target-${group * 100 + index}`,
    ));
    const csvRows = [
      ...referenceGroups.map((ids) => `${ids.join(";")},1`),
      "target-1000,1",
      "target-1001,not-a-number",
    ];

    await expect(repository.importCsv(owner, database.id, {
      csv: `Relation,Amount\r\n${csvRows.join("\r\n")}`,
      header_property_ids: { Relation: relation.id, Amount: amount.id },
    })).rejects.toMatchObject({ code: "REFERENCE_LIMIT", status: 400 });

    const records = await Promise.all(Array.from({ length: 12 }, () => repository.createRecord(owner, database.id, { note_id: null, values: {} })));
    await expect(repository.bulkEditRecords(owner, database.id, {
      mutations: [
        ...referenceGroups.map((ids, index) => ({ record_id: records[index]!.id, base_revision: 1, values: { [relation.id]: ids } })),
        { record_id: records[10]!.id, base_revision: 1, values: { [relation.id]: ["target-1000"] } },
        { record_id: records[11]!.id, base_revision: 1, values: { [relation.id]: ["target-1001"], [amount.id]: "not-a-number" } },
      ],
    })).rejects.toMatchObject({ code: "REFERENCE_LIMIT", status: 400 });
  });

  it("enforces the exact distinct-reference boundary for records, templates, bulk edits, and CSV", async () => {
    const repository = await createRepository();
    const owner = context("user-1");
    const database = await repository.createDatabase(owner, { name: "Reference boundaries", description: "" });
    const target = await repository.createDatabase(owner, { name: "Boundary target", description: "" });
    const targets = Array.from({ length: 101 }, (_, index) => ({ id: `boundary-target-${index}` }));
    await db.prepare(
      `INSERT INTO database_records
       (id, workspace_id, database_id, note_id, created_by, updated_by, revision, created_at, updated_at)
       SELECT json_extract(value, '$.id'), 'ws-1', ?, NULL, 'user-1', 'user-1', 1, ?, ? FROM json_each(?)`,
    ).bind(target.id, now, now, JSON.stringify(targets)).run();
    const relations = await Promise.all(Array.from({ length: 11 }, (_, position) => repository.createProperty(owner, database.id, {
      name: `Relation ${position}`, type: "relation", config: { target_database_id: target.id, allow_multiple: true }, position,
    })));
    const references = targets.slice(0, 100).map((targetRecord) => targetRecord.id);
    const atLimit = Object.fromEntries(relations.slice(0, 10).map((property: any) => [property.id, references]));
    const overLimit = { ...atLimit, [relations[10]!.id]: [targets[100]!.id] };

    await expect(repository.createRecord(owner, database.id, { note_id: null, values: atLimit })).resolves.toMatchObject({ values: atLimit });
    await expect(repository.createRecord(owner, database.id, { note_id: null, values: overLimit }))
      .rejects.toMatchObject({ code: "REFERENCE_LIMIT", status: 400 });
    await expect(repository.createTemplate(owner, database.id, { name: "At limit", default_values: atLimit })).resolves.toMatchObject({ default_values: atLimit });
    await expect(repository.createTemplate(owner, database.id, { name: "Over limit", default_values: overLimit }))
      .rejects.toMatchObject({ code: "REFERENCE_LIMIT", status: 400 });

    const source = await repository.createRecord(owner, database.id, { note_id: null, values: {} });
    await expect(repository.bulkEditRecords(owner, database.id, {
      mutations: [{ record_id: source.id, base_revision: source.revision, values: atLimit }],
    })).resolves.toMatchObject({ items: [expect.objectContaining({ values: atLimit })] });
    await expect(repository.bulkEditRecords(owner, database.id, {
      mutations: [{ record_id: source.id, base_revision: source.revision + 1, values: overLimit }],
    })).rejects.toMatchObject({ code: "REFERENCE_LIMIT", status: 400 });

    const atLimitHeaders = relations.slice(0, 10);
    await expect(repository.importCsv(owner, database.id, {
      csv: `${atLimitHeaders.map((property: any) => property.name).join(",")}\r\n${atLimitHeaders.map(() => references.join(";")).join(",")}`,
      header_property_ids: Object.fromEntries(atLimitHeaders.map((property: any) => [property.name, property.id])),
    })).resolves.toMatchObject({ imported_count: 1 });
    await expect(repository.importCsv(owner, database.id, {
      csv: `${relations.map((property: any) => property.name).join(",")}\r\n${[...relations.slice(0, 10).map(() => references.join(";")), targets[100]!.id].join(",")}`,
      header_property_ids: Object.fromEntries(relations.map((property: any) => [property.name, property.id])),
    })).rejects.toMatchObject({ code: "REFERENCE_LIMIT", status: 400 });
  });

  it("rolls back a bulk edit when a referenced target disappears inside its transaction", async () => {
    const repository = await createRepository();
    const owner = context("user-1");
    const database = await repository.createDatabase(owner, { name: "Reference race", description: "" });
    const target = await repository.createDatabase(owner, { name: "Target", description: "" });
    const relation = await repository.createProperty(owner, database.id, {
      name: "Relation", type: "relation", config: { target_database_id: target.id }, position: 0,
    });
    const source = await repository.createRecord(owner, database.id, { note_id: null, values: {} });
    const targetRecord = await repository.createRecord(owner, target.id, { note_id: null, values: {} });
    await db.prepare(
      `CREATE TRIGGER reference_race AFTER UPDATE ON database_records
       WHEN NEW.id = '${source.id}'
       BEGIN
         UPDATE database_records SET deleted_at = '${now}' WHERE id = '${targetRecord.id}';
       END;`,
    ).run();

    await expect(repository.updateRecord(owner, database.id, source.id, {
      base_revision: 1, values: { [relation.id]: targetRecord.id },
    })).rejects.toMatchObject({ code: "INVALID_RELATION_REFERENCE", status: 400 });
    expect((await repository.getRecord(owner, database.id, source.id)).values).toEqual({});
    expect(await db.prepare("SELECT deleted_at FROM database_records WHERE id = ?").bind(targetRecord.id).first()).toEqual({ deleted_at: null });
  });

  it("classifies a transaction-time stale revision with valid relations as a revision conflict", async () => {
    const repository = await createRepository();
    const owner = context("user-1");
    const database = await repository.createDatabase(owner, { name: "Revision guard", description: "" });
    const target = await repository.createDatabase(owner, { name: "Revision target", description: "" });
    const relation = await repository.createProperty(owner, database.id, {
      name: "Relation", type: "relation", config: { target_database_id: target.id }, position: 0,
    });
    const source = await repository.createRecord(owner, database.id, { note_id: null, values: {} });
    const targetRecord = await repository.createRecord(owner, target.id, { note_id: null, values: {} });
    await db.prepare(
      `CREATE TRIGGER stale_revision_race AFTER UPDATE ON database_records
       WHEN NEW.id = '${source.id}'
       BEGIN
         UPDATE database_records SET revision = revision + 1 WHERE id = NEW.id;
       END;`,
    ).run();

    await expect(repository.bulkEditRecords(owner, database.id, {
      mutations: [{ record_id: source.id, base_revision: 1, values: { [relation.id]: targetRecord.id } }],
    })).rejects.toMatchObject({ code: "REVISION_CONFLICT", status: 409 });
    expect(await repository.getRecord(owner, database.id, source.id)).toMatchObject({ revision: 1, values: {} });
  });

  it("executes a saved view server-side with visible fields, filters, sorts, page size, and keyset cursors", async () => {
    const repository = await createRepository();
    const owner = context("user-1");
    const database = await repository.createDatabase(owner, { name: "Server view", description: "" });
    const title = await repository.createProperty(owner, database.id, { name: "Title", type: "text", config: {}, position: 0 });
    const status = await repository.createProperty(owner, database.id, {
      name: "Status", type: "select", config: { options: [{ id: "todo", name: "Todo", color: "" }, { id: "done", name: "Done", color: "" }] }, position: 1,
    });
    await repository.createRecord(owner, database.id, { note_id: null, values: { [title.id]: "Zulu", [status.id]: "todo" } });
    await repository.createRecord(owner, database.id, { note_id: null, values: { [title.id]: "Alpha", [status.id]: "todo" } });
    await repository.createRecord(owner, database.id, { note_id: null, values: { [title.id]: "Hidden", [status.id]: "done" } });
    const view = await repository.createView(owner, database.id, {
      name: "Todos", type: "table", position: 0,
      config: {
        filters: [{ property_id: status.id, operator: "equals", value: "todo" }],
        sorts: [{ property_id: title.id, direction: "asc" }], grouping: { property_id: status.id },
        visible_columns: [title.id], page_size: 1,
        settings: { row_height: "compact", frozen_property_id: title.id, hide_empty_groups: true, card_properties: [title.id], week_start: "monday" },
      },
    });

    const first = await repository.listRecords(owner, database.id, { view_id: view.id, limit: 100 });
    const second = await repository.listRecords(owner, database.id, { view_id: view.id, limit: 100, cursor: first.next_cursor });
    expect(first.items).toHaveLength(1);
    expect(first.items[0]).toMatchObject({ values: { [title.id]: "Alpha" } });
    expect(Object.keys(first.items[0]!.values)).toEqual([title.id]);
    expect(first.next_cursor).toEqual(expect.any(String));
    expect(second.items).toHaveLength(1);
    expect(second.items[0]).toMatchObject({ values: { [title.id]: "Zulu" } });
    expect(second.next_cursor).toBeNull();
  });

  it("validates and transactionally guards member and relation template defaults", async () => {
    const repository = await createRepository();
    const owner = context("user-1");
    const database = await repository.createDatabase(owner, { name: "Template references", description: "" });
    const target = await repository.createDatabase(owner, { name: "Template target", description: "" });
    await db.prepare(
      "INSERT INTO workspace_members (workspace_id, user_id, role, joined_at, updated_at) VALUES ('ws-1', 'user-1', 'owner', ?, ?)",
    ).bind(now, now).run();
    const targetRecord = await repository.createRecord(owner, target.id, { note_id: null, values: {} });
    const member = await repository.createProperty(owner, database.id, { name: "Member", type: "member", config: {}, position: 0 });
    const relation = await repository.createProperty(owner, database.id, {
      name: "Relation", type: "relation", config: { target_database_id: target.id }, position: 1,
    });

    await expect(repository.createTemplate(owner, database.id, {
      name: "Invalid", default_values: { [member.id]: "missing-user" },
    })).rejects.toMatchObject({ code: "INVALID_MEMBER_REFERENCE", status: 400 });
    const template = await repository.createTemplate(owner, database.id, {
      name: "Valid", default_values: { [member.id]: "user-1", [relation.id]: targetRecord.id },
    });
    await db.prepare(
      `CREATE TRIGGER template_reference_race BEFORE UPDATE ON database_templates
       WHEN OLD.id = '${template.id}'
       BEGIN
         UPDATE database_records SET deleted_at = '${now}' WHERE id = '${targetRecord.id}';
       END;`,
    ).run();
    await expect(repository.updateTemplate(owner, database.id, template.id, {
      base_revision: 1, default_values: { [member.id]: "user-1", [relation.id]: targetRecord.id },
    })).rejects.toMatchObject({ code: "INVALID_RELATION_REFERENCE", status: 400 });
    expect(await db.prepare("SELECT deleted_at FROM database_records WHERE id = ?").bind(targetRecord.id).first()).toEqual({ deleted_at: null });
  });

  it("does not map unrelated unique constraint failures to revision conflicts", async () => {
    const repository = await createRepository();
    const owner = context("user-1");
    const database = await repository.createDatabase(owner, { name: "Dedicated guard", description: "" });
    const title = await repository.createProperty(owner, database.id, { name: "Title", type: "text", config: {}, position: 0 });
    const record = await repository.createRecord(owner, database.id, { note_id: null, values: { [title.id]: "Before" } });
    await db.prepare(
      `CREATE TRIGGER unrelated_unique BEFORE UPDATE ON database_records
       WHEN NEW.id = '${record.id}'
       BEGIN
         INSERT INTO record_values (id, workspace_id, database_id, record_id, property_id, value_json, revision, updated_at)
         SELECT id, workspace_id, database_id, record_id, property_id, value_json, revision, updated_at
         FROM record_values WHERE record_id = '${record.id}' AND property_id = '${title.id}';
       END;`,
    ).run();

    await expect(repository.updateRecord(owner, database.id, record.id, {
      base_revision: 1, values: { [title.id]: "After" },
    })).rejects.not.toMatchObject({ code: "REVISION_CONFLICT" });
  });

  it("searches literal backslashes without treating them as LIKE escapes", async () => {
    const repository = await createRepository();
    const owner = context("user-1");
    const database = await repository.createDatabase(owner, { name: "Backslash search", description: "" });
    const title = await repository.createProperty(owner, database.id, { name: "Title", type: "text", config: {}, position: 0 });
    const escaped = await repository.createRecord(owner, database.id, { note_id: null, values: { [title.id]: "C:\\build" } });
    await repository.createRecord(owner, database.id, { note_id: null, values: { [title.id]: "Cbuild" } });

    await expect(repository.searchRecords(owner, database.id, { query: "C:\\build", limit: 10 }))
      .resolves.toMatchObject({ items: [expect.objectContaining({ id: escaped.id })] });
  });

  it("uses typed saved filters and rejects cursors from another view or search query", async () => {
    const repository = await createRepository();
    const owner = context("user-1");
    const database = await repository.createDatabase(owner, { name: "Typed filters", description: "" });
    const score = await repository.createProperty(owner, database.id, { name: "Score", type: "number", config: {}, position: 0 });
    const complete = await repository.createProperty(owner, database.id, { name: "Complete", type: "checkbox", config: {}, position: 1 });
    const tags = await repository.createProperty(owner, database.id, {
      name: "Tags", type: "multi_select", config: { options: [{ id: "a", name: "A", color: "" }, { id: "b", name: "B", color: "" }] }, position: 2,
    });
    await repository.createRecord(owner, database.id, { note_id: null, values: { [score.id]: 2, [complete.id]: false, [tags.id]: ["a", "b"] } });
    await repository.createRecord(owner, database.id, { note_id: null, values: { [score.id]: 2, [complete.id]: false, [tags.id]: ["a"] } });
    await repository.createRecord(owner, database.id, { note_id: null, values: { [score.id]: 3, [complete.id]: true, [tags.id]: ["a"] } });
    await repository.createRecord(owner, database.id, { note_id: null, values: { [score.id]: 4, [complete.id]: false, [tags.id]: null } });
    const numericView = await repository.createView(owner, database.id, {
      name: "Score", type: "table", position: 0,
      config: { filters: [{ property_id: score.id, operator: "equals", value: 2 }], sorts: [], grouping: null, visible_columns: [score.id], page_size: 1, settings: {} },
    });
    const tagsView = await repository.createView(owner, database.id, {
      name: "Tags", type: "table", position: 1,
      config: { filters: [{ property_id: tags.id, operator: "equals", value: ["a", "b"] }], sorts: [], grouping: null, visible_columns: [tags.id], page_size: 1, settings: {} },
    });
    const checkboxView = await repository.createView(owner, database.id, {
      name: "Incomplete", type: "table", position: 2,
      config: { filters: [{ property_id: complete.id, operator: "equals", value: false }], sorts: [], grouping: null, visible_columns: [complete.id], page_size: 100, settings: {} },
    });
    const emptyTagsView = await repository.createView(owner, database.id, {
      name: "No tags", type: "table", position: 3,
      config: { filters: [{ property_id: tags.id, operator: "equals", value: [] }], sorts: [], grouping: null, visible_columns: [tags.id], page_size: 100, settings: {} },
    });

    const numeric = await repository.listRecords(owner, database.id, { view_id: numericView.id, limit: 100 });
    expect(numeric.items).toHaveLength(1);
    expect(numeric.items[0]?.values[score.id]).toBe(2);
    await expect(repository.listRecords(owner, database.id, { view_id: tagsView.id, limit: 100, cursor: numeric.next_cursor }))
      .rejects.toMatchObject({ code: "INVALID_CURSOR", status: 400 });
    const revised = await repository.updateView(owner, database.id, numericView.id, {
      base_revision: numericView.revision, name: "Score revised",
    });
    await expect(repository.listRecords(owner, database.id, { view_id: revised.id, limit: 100, cursor: numeric.next_cursor }))
      .rejects.toMatchObject({ code: "INVALID_CURSOR", status: 400 });
    await expect(repository.listRecords(owner, database.id, { view_id: tagsView.id, limit: 100 })).resolves.toMatchObject({ items: [expect.objectContaining({ values: { [tags.id]: ["a", "b"] } })] });
    await expect(repository.listRecords(owner, database.id, { view_id: checkboxView.id, limit: 100 })).resolves.toMatchObject({ items: expect.arrayContaining([expect.objectContaining({ values: { [complete.id]: false } })]) });
    await expect(repository.listRecords(owner, database.id, { view_id: emptyTagsView.id, limit: 100 })).resolves.toMatchObject({ items: [expect.objectContaining({ values: { [tags.id]: null } })] });
    const search = await repository.searchRecords(owner, database.id, { query: "a", limit: 1 });
    await expect(repository.searchRecords(owner, database.id, { query: "b", limit: 1, cursor: search.next_cursor }))
      .rejects.toMatchObject({ code: "INVALID_CURSOR", status: 400 });
  });

  it("guards relation targets during single-record and template creation", async () => {
    const repository = await createRepository();
    const owner = context("user-1");
    const database = await repository.createDatabase(owner, { name: "Relation writes", description: "" });
    const target = await repository.createDatabase(owner, { name: "Relation target", description: "" });
    const relation = await repository.createProperty(owner, database.id, {
      name: "Related", type: "relation", config: { target_database_id: target.id }, position: 0,
    });
    const targetRecord = await repository.createRecord(owner, target.id, { note_id: null, values: {} });
    await db.prepare(
      `CREATE TRIGGER create_relation_race AFTER INSERT ON database_records
       WHEN NEW.database_id = '${database.id}'
       BEGIN
         UPDATE database_records SET deleted_at = '${now}' WHERE id = '${targetRecord.id}';
       END;`,
    ).run();
    await expect(repository.createRecord(owner, database.id, { note_id: null, values: { [relation.id]: targetRecord.id } }))
      .rejects.toMatchObject({ code: "INVALID_RELATION_REFERENCE", status: 400 });
    expect(await db.prepare("SELECT deleted_at FROM database_records WHERE id = ?").bind(targetRecord.id).first()).toEqual({ deleted_at: null });

    await db.prepare("DROP TRIGGER create_relation_race").run();
    await db.prepare(
      `CREATE TRIGGER create_template_relation_race BEFORE INSERT ON database_templates
       WHEN NEW.database_id = '${database.id}'
       BEGIN
         UPDATE database_records SET deleted_at = '${now}' WHERE id = '${targetRecord.id}';
       END;`,
    ).run();
    await expect(repository.createTemplate(owner, database.id, { name: "Default", default_values: { [relation.id]: targetRecord.id } }))
      .rejects.toMatchObject({ code: "INVALID_RELATION_REFERENCE", status: 400 });
    expect(await db.prepare("SELECT deleted_at FROM database_records WHERE id = ?").bind(targetRecord.id).first()).toEqual({ deleted_at: null });
  });

  it("retains member-specific failures when a member disappears inside a transaction", async () => {
    const repository = await createRepository();
    const owner = context("user-1");
    const database = await repository.createDatabase(owner, { name: "Member guard", description: "" });
    const member = await repository.createProperty(owner, database.id, {
      name: "Member", type: "member", config: {}, position: 0,
    });
    await db.prepare(
      "INSERT INTO workspace_members (workspace_id, user_id, role, joined_at, updated_at) VALUES ('ws-1', 'user-1', 'owner', ?, ?)",
    ).bind(now, now).run();
    await db.prepare(
      `CREATE TRIGGER member_reference_race AFTER INSERT ON database_records
       WHEN NEW.database_id = '${database.id}'
       BEGIN
         DELETE FROM workspace_members WHERE workspace_id = 'ws-1' AND user_id = 'user-1';
       END;`,
    ).run();

    await expect(repository.createRecord(owner, database.id, { note_id: null, values: { [member.id]: "user-1" } }))
      .rejects.toMatchObject({ code: "INVALID_MEMBER_REFERENCE", status: 400 });
    expect(await db.prepare("SELECT role FROM workspace_members WHERE workspace_id = 'ws-1' AND user_id = 'user-1'").first())
      .toEqual({ role: "owner" });
  });

  it("returns REVISION_CONFLICT when applying relation defaults to a stale record", async () => {
    const repository = await createRepository();
    const owner = context("user-1");
    const database = await repository.createDatabase(owner, { name: "Template conflict", description: "" });
    const target = await repository.createDatabase(owner, { name: "Template relation target", description: "" });
    const title = await repository.createProperty(owner, database.id, { name: "Title", type: "text", config: {}, position: 0 });
    const relation = await repository.createProperty(owner, database.id, {
      name: "Relation", type: "relation", config: { target_database_id: target.id }, position: 1,
    });
    const targetRecord = await repository.createRecord(owner, target.id, { note_id: null, values: {} });
    const source = await repository.createRecord(owner, database.id, { note_id: null, values: { [title.id]: "Initial" } });
    const template = await repository.createTemplate(owner, database.id, {
      name: "Related", default_values: { [relation.id]: targetRecord.id },
    });
    await repository.updateRecord(owner, database.id, source.id, {
      base_revision: source.revision, values: { [title.id]: "Current" },
    });

    await expect(repository.applyTemplate(owner, database.id, {
      template_id: template.id,
      records: [{ record_id: source.id, base_revision: source.revision }],
    })).rejects.toMatchObject({ code: "REVISION_CONFLICT", status: 409 });
  });

  it("omits repeated CSV headers on bounded export pages", async () => {
    const repository = await createRepository();
    const owner = context("user-1");
    const database = await repository.createDatabase(owner, { name: "CSV pages", description: "" });
    const title = await repository.createProperty(owner, database.id, { name: "Title\nwith newline", type: "text", config: {}, position: 0 });
    await repository.createRecord(owner, database.id, { note_id: null, values: { [title.id]: "First" } });
    await repository.createRecord(owner, database.id, { note_id: null, values: { [title.id]: "Second" } });
    const first = await repository.exportCsv(owner, database.id, { property_ids: [title.id], cursor: null, page_size: 1, include_header: true });
    const second = await repository.exportCsv(owner, database.id, { property_ids: [title.id], cursor: first.next_cursor, page_size: 1, include_header: false });

    expect(first.csv).toMatch(/^"Title\nwith newline"\r\n/u);
    expect(second.csv).not.toMatch(/^"Title\nwith newline"\r\n/u);
  });

  it("rejects reference-heavy CSV input before expanding unbounded guard sets", async () => {
    const repository = await createRepository();
    const owner = context("user-1");
    const database = await repository.createDatabase(owner, { name: "Reference limit", description: "" });
    const target = await repository.createDatabase(owner, { name: "Reference limit target", description: "" });
    const relation = await repository.createProperty(owner, database.id, {
      name: "Relations", type: "relation", config: { target_database_id: target.id, allow_multiple: true }, position: 0,
    });
    const rows = Array.from({ length: 500 }, (_, row) => Array.from({ length: 3 }, (_, column) => `target-${row}-${column}`).join(";"));

    await expect(repository.importCsv(owner, database.id, {
      csv: `Relations\r\n${rows.join("\r\n")}`,
      header_property_ids: { Relations: relation.id },
    })).rejects.toMatchObject({ code: "REFERENCE_LIMIT", status: 400 });
    expect(await db.prepare("SELECT COUNT(*) AS count FROM database_records WHERE workspace_id = ? AND database_id = ?").bind("ws-1", database.id).first()).toEqual({ count: 0 });
  });
});
