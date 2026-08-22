import { afterEach, describe, expect, it, vi } from "vitest";

import { createTestD1, seedTenants } from "./helpers/d1";

const now = "2026-08-22T00:00:00.000Z";
const disposers: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(disposers.splice(0).map((dispose) => dispose()));
});

async function setup() {
  const testDb = await createTestD1();
  disposers.push(testDb.dispose);
  await seedTenants(testDb.db);
  await testDb.db.prepare(
    `INSERT INTO workspace_members (workspace_id, user_id, role, revision, joined_at, updated_at)
     VALUES ('ws-1', 'user-1', 'owner', 1, ?, ?)`,
  ).bind(now, now).run();
  const worker = await import("../src/index") as Record<string, any>;
  return { ...testDb, worker };
}

function auditFault(db: D1Database) {
  const auditStatements = new WeakSet<object>();
  return new Proxy(db, {
    get(target, property, receiver) {
      if (property === "prepare") {
        return (sql: string) => {
          const statement = db.prepare(sql);
          if (/INSERT INTO audit_logs/iu.test(sql)) {
            auditStatements.add(statement as object);
            return new Proxy(statement, {
              get(prepared, preparedProperty) {
                if (preparedProperty === "bind") {
                  return (...values: unknown[]) => {
                    const bound = prepared.bind(...values);
                    auditStatements.add(bound as object);
                    return bound;
                  };
                }
                return Reflect.get(prepared, preparedProperty, prepared);
              },
            });
          }
          return statement;
        };
      }
      if (property === "batch") {
        return (statements: D1PreparedStatement[]) => {
          const injected = [...statements];
          const auditIndex = injected.findIndex((statement) => auditStatements.has(statement as object));
          if (auditIndex >= 0) {
            injected[auditIndex] = db.prepare("INSERT INTO missing_audit_fault (id) VALUES ('fault')");
          }
          return db.batch(injected);
        };
      }
      return Reflect.get(target, property, receiver);
    },
  }) as D1Database;
}

async function loggedActions(db: D1Database, requestIds: string[]) {
  const placeholders = requestIds.map(() => "?").join(", ");
  const activity = await db.prepare(
    `SELECT request_id, action, target_type, target_id, metadata_json
     FROM activity_logs WHERE request_id IN (${placeholders}) ORDER BY request_id`,
  ).bind(...requestIds).all<Record<string, unknown>>();
  const audit = await db.prepare(
    `SELECT request_id, action, target_type, target_id, metadata_json
     FROM audit_logs WHERE request_id IN (${placeholders}) ORDER BY request_id`,
  ).bind(...requestIds).all<Record<string, unknown>>();
  return { activity: activity.results, audit: audit.results };
}

describe("Beta mutation audit and Presence invalidation", () => {
  it("couples note activity/audit request IDs to commits and isolates invalidation failure", async () => {
    const { db, worker } = await setup();
    const invalidate = vi.fn(async () => undefined);
    let id = 0;
    const repository = new worker.D1NoteRepository(db, () => `note-row-${++id}`, { presence: { invalidate } });
    const service = new worker.NoteService(repository, {
      createId: () => "note-audit",
      clock: () => new Date(now),
    });
    const actor = (requestId: string) => ({ workspaceId: "ws-1", userId: "user-1", requestId });

    const created = await service.create(actor("req-note-create"), { title: "Private", content: "secret body" });
    const updated = await service.update(actor("req-note-update"), created.id, {
      base_revision: 1, title: "Updated", source: "manual",
    });
    await expect(service.restore(actor("req-note-restore"), created.id, 1, {
      base_revision: updated.revision,
    })).resolves.toMatchObject({ revision: 3 });

    const logs = await loggedActions(db, ["req-note-create", "req-note-restore", "req-note-update"]);
    expect(logs.activity).toEqual([
      expect.objectContaining({ request_id: "req-note-create", action: "note.created", target_id: created.id }),
      expect.objectContaining({ request_id: "req-note-restore", action: "note.restored", target_id: created.id }),
      expect.objectContaining({ request_id: "req-note-update", action: "note.updated", target_id: created.id }),
    ]);
    expect(logs.audit).toHaveLength(3);
    expect(logs.activity.concat(logs.audit).map((entry) => entry.metadata_json).join("\n"))
      .not.toMatch(/secret body|Private|Updated/iu);
    expect(invalidate).toHaveBeenCalledTimes(3);
    expect(invalidate).toHaveBeenLastCalledWith({
      workspaceId: "ws-1", entityType: "note", entityId: created.id, revision: 3,
    });

    const rejecting = new worker.NoteService(new worker.D1NoteRepository(db, () => "rejecting-row", {
      presence: { invalidate: vi.fn(async () => { throw new Error("presence unavailable"); }) },
    }), { clock: () => new Date(now) });
    await expect(rejecting.update(actor("req-note-presence-failure"), created.id, {
      base_revision: 3, is_pinned: true,
    })).resolves.toMatchObject({ revision: 4 });
  });

  it("rolls back a note mutation when its coupled audit insert fails", async () => {
    const { db, worker } = await setup();
    const service = new worker.NoteService(new worker.D1NoteRepository(auditFault(db), () => "fault-row"), {
      createId: () => "note-audit-fault",
      clock: () => new Date(now),
    });
    await expect(service.create({ workspaceId: "ws-1", userId: "user-1", requestId: "req-note-fault" }, {
      title: "Must roll back", content: "private",
    })).rejects.toThrow(/missing_audit_fault/iu);
    expect(await db.prepare(
      "SELECT COUNT(*) AS count FROM notes WHERE id = 'note-audit-fault'",
    ).first()).toEqual({ count: 0 });
    expect(await db.prepare(
      "SELECT COUNT(*) AS count FROM activity_logs WHERE request_id = 'req-note-fault'",
    ).first()).toEqual({ count: 0 });
  });

  it("couples database mutation logs to request IDs and dispatches post-commit invalidation", async () => {
    const { db, worker } = await setup();
    const invalidate = vi.fn(async () => undefined);
    let id = 0;
    const repository = new worker.D1DatabaseRepository(db, {
      createId: () => `database-row-${++id}`,
      clock: () => new Date(now),
      presence: { invalidate },
    });
    const actor = (requestId: string) => ({
      workspaceId: "ws-1", userId: "user-1", role: "owner", capabilities: new Set<string>(), requestId,
    });

    const database = await repository.createDatabase(actor("req-db-create"), { name: "Private database", description: "secret" });
    await repository.updateDatabase(actor("req-db-update"), database.id, { base_revision: 1, description: "changed" });
    const property = await repository.createProperty(actor("req-db-property"), database.id, {
      name: "Secret field", type: "text", config: {}, position: 0,
    });
    const record = await repository.createRecord(actor("req-db-record"), database.id, {
      note_id: null, values: { [property.id]: "private value" },
    });
    await repository.updateRecord(actor("req-db-record-update"), database.id, record.id, {
      base_revision: 1, values: { [property.id]: "updated private value" },
    });

    const requestIds = ["req-db-create", "req-db-property", "req-db-record", "req-db-record-update", "req-db-update"];
    const logs = await loggedActions(db, requestIds);
    expect(logs.activity.map((entry) => entry.request_id)).toEqual(requestIds);
    expect(logs.audit).toHaveLength(requestIds.length);
    expect(JSON.stringify(logs)).not.toMatch(/Private database|secret|private value|Secret field/iu);
    expect(invalidate).toHaveBeenCalledTimes(5);
    expect(invalidate).toHaveBeenLastCalledWith({
      workspaceId: "ws-1", entityType: "database_record", entityId: record.id, revision: 2,
    });
  });

  it("rolls back a database mutation when audit fails and isolates Presence failure", async () => {
    const { db, worker } = await setup();
    const actor = { workspaceId: "ws-1", userId: "user-1", role: "owner", capabilities: new Set<string>(), requestId: "req-db-fault" };
    const faulty = new worker.D1DatabaseRepository(auditFault(db), {
      createId: () => "database-audit-fault", clock: () => new Date(now),
    });
    await expect(faulty.createDatabase(actor, { name: "Must roll back", description: "" }))
      .rejects.toThrow(/missing_audit_fault/iu);
    expect(await db.prepare(
      "SELECT COUNT(*) AS count FROM databases WHERE id = 'database-audit-fault'",
    ).first()).toEqual({ count: 0 });

    const rejecting = new worker.D1DatabaseRepository(db, {
      createId: () => "database-presence-failure", clock: () => new Date(now),
      presence: { invalidate: vi.fn(async () => { throw new Error("presence unavailable"); }) },
    });
    await expect(rejecting.createDatabase({ ...actor, requestId: "req-db-presence-failure" }, {
      name: "Committed", description: "",
    })).resolves.toMatchObject({ id: "database-presence-failure" });
  });

  it("audits and invalidates every security-relevant Beta database mutation", async () => {
    const { db, worker } = await setup();
    const invalidate = vi.fn(async () => undefined);
    let id = 0;
    const repository = new worker.D1DatabaseRepository(db, {
      createId: () => `database-wave4-${++id}`,
      clock: () => new Date(now),
      presence: { invalidate },
    });
    const actor = (requestId: string) => ({
      workspaceId: "ws-1", userId: "user-1", role: "owner", capabilities: new Set<string>(), requestId,
    });
    const config = {
      filters: [], sorts: [], grouping: null, visible_columns: [], page_size: 25, settings: {},
    };

    const database = await repository.createDatabase(actor("req-wave-database-create"), { name: "Wave database", description: "secret" });
    const property = await repository.createProperty(actor("req-wave-property-create"), database.id, {
      name: "Wave field", type: "text", config: {}, position: 0,
    });
    const record = await repository.createRecord(actor("req-wave-record-create"), database.id, {
      note_id: null, values: { [property.id]: "private value" },
    });
    const view = await repository.createView(actor("req-wave-view-create"), database.id, {
      name: "Wave view", type: "table", config: { ...config, visible_columns: [property.id] }, position: 0,
    });
    await repository.updateView(actor("req-wave-view-update"), database.id, view.id, { base_revision: 1, name: "Wave view updated" });
    await repository.deleteView(actor("req-wave-view-delete"), database.id, view.id, { base_revision: 2 });
    const template = await repository.createTemplate(actor("req-wave-template-create"), database.id, {
      name: "Wave template", default_values: {},
    });
    await repository.updateTemplate(actor("req-wave-template-update"), database.id, template.id, { base_revision: 1, name: "Wave template updated" });
    await repository.deleteTemplate(actor("req-wave-template-delete"), database.id, template.id, { base_revision: 2 });
    const databasePermission = await repository.setDatabasePermission(actor("req-wave-database-permission-set"), database.id, {
      subject_type: "user", subject_id: "user-2", role: "viewer", base_revision: 1,
    });
    await repository.deleteDatabasePermission(actor("req-wave-database-permission-delete"), database.id, databasePermission.id, { base_revision: 1 });
    const fieldPermission = await repository.setFieldPermission(actor("req-wave-field-permission-set"), database.id, property.id, {
      subject_type: "user", subject_id: "user-2", can_read: true, can_write: false, base_revision: 1,
    });
    await repository.deleteFieldPermission(actor("req-wave-field-permission-delete"), database.id, property.id, fieldPermission.id, { base_revision: 1 });
    await repository.importCsv(actor("req-wave-csv-import"), database.id, {
      csv: "Wave field\nimported",
      header_property_ids: { "Wave field": property.id },
    });
    const comment = await repository.createComment(actor("req-wave-comment-create"), database.id, {
      record_id: record.id, body: "private comment",
    });
    await repository.updateComment(actor("req-wave-comment-update"), database.id, comment.id, {
      base_revision: 1, body: "private comment updated",
    });
    await repository.deleteComment(actor("req-wave-comment-delete"), database.id, comment.id, { base_revision: 2 });
    await repository.deleteRecord(actor("req-wave-record-delete"), database.id, record.id, { base_revision: 1 });
    await repository.updateProperty(actor("req-wave-property-update"), database.id, property.id, {
      base_revision: 1, name: "Wave field updated",
    });
    await repository.deleteProperty(actor("req-wave-property-delete"), database.id, property.id, { base_revision: 2 });
    await repository.updateDatabase(actor("req-wave-database-update"), database.id, { base_revision: 1, description: "changed" });
    await repository.deleteDatabase(actor("req-wave-database-delete"), database.id, { base_revision: 2 });

    const requestIds = [
      "req-wave-comment-create", "req-wave-comment-delete", "req-wave-comment-update",
      "req-wave-csv-import", "req-wave-database-create", "req-wave-database-delete", "req-wave-database-permission-delete",
      "req-wave-database-permission-set", "req-wave-database-update", "req-wave-field-permission-delete",
      "req-wave-field-permission-set", "req-wave-property-create", "req-wave-property-delete", "req-wave-property-update",
      "req-wave-record-create", "req-wave-record-delete", "req-wave-template-create", "req-wave-template-delete",
      "req-wave-template-update", "req-wave-view-create", "req-wave-view-delete", "req-wave-view-update",
    ];
    const logs = await loggedActions(db, requestIds);
    expect(logs.activity.map((entry) => entry.request_id).sort()).toEqual([...requestIds].sort());
    expect(logs.audit).toHaveLength(requestIds.length);
    expect(JSON.stringify(logs)).not.toMatch(/secret|private value|private comment|Wave field/iu);
    expect(invalidate.mock.calls.length).toBeGreaterThanOrEqual(requestIds.length);
  });

  it("records only the winner when competing database updates share a revision and timestamp", async () => {
    const { db, worker } = await setup();
    const create = new worker.D1DatabaseRepository(db, { createId: () => "race-database", clock: () => new Date(now) });
    const database = await create.createDatabase({
      workspaceId: "ws-1", userId: "user-1", role: "owner", capabilities: new Set<string>(), requestId: "req-race-create",
    }, { name: "Race database", description: "" });
    const makeRepository = (suffix: string) => new worker.D1DatabaseRepository(db, {
      createId: () => `race-${suffix}`,
      clock: () => new Date(now),
    });
    const context = (requestId: string) => ({
      workspaceId: "ws-1", userId: "user-1", role: "owner", capabilities: new Set<string>(), requestId,
    });
    const outcomes = await Promise.allSettled([
      makeRepository("a").updateDatabase(context("req-race-a"), database.id, { base_revision: 1, description: "a" }),
      makeRepository("b").updateDatabase(context("req-race-b"), database.id, { base_revision: 1, description: "b" }),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    const logs = await loggedActions(db, ["req-race-a", "req-race-b"]);
    expect(logs.audit).toHaveLength(1);
    expect(logs.activity).toHaveLength(1);
  });
});
