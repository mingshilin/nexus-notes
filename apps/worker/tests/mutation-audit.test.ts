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
});
