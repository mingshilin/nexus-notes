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

async function createRepository() {
  const worker = await import("../src/index") as Record<string, any>;
  expect(worker.D1DatabaseRepository).toBeTypeOf("function");
  let nextId = 0;
  return new worker.D1DatabaseRepository(db, {
    createId: () => `generated-${String(++nextId).padStart(4, "0")}`,
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
});
