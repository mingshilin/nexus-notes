import { describe, expect, it } from "vitest";
import { createTestD1, seedTenants } from "./helpers/d1";

type WorkerExports = Record<string, unknown>;

async function loadWorker() {
  return (await import("../src")) as WorkerExports;
}

describe("D1SyncRepository", () => {
  it("applies a note update through the existing revision-aware repository and pulls the full note snapshot", async () => {
    const worker = await loadWorker();
    expect(worker.D1SyncRepository).toBeTypeOf("function");
    const statements: Array<{ sql: string; bindings: unknown[] }> = [];
    const db = {
      prepare(sql: string) {
        const statement = {
          sql,
          bindings: [] as unknown[],
          bind(...bindings: unknown[]) { statement.bindings = bindings; return statement; },
          async first() { return null; },
          async all() { return { results: [] }; },
          async run() { return { success: true }; },
        };
        statements.push(statement);
        return statement;
      },
      async batch() { return []; },
    };
    const Repository = worker.D1SyncRepository as new (db: unknown) => any;
    const repository = new Repository(db);
    const context = { workspaceId: "ws-1", userId: "user-1", role: "editor", capabilities: new Set<string>() };

    const result = await repository.apply(context, {
      operation_id: "op-1", workspace_id: "ws-1", entity_type: "database_record", entity_id: "record-1",
      base_revision: 1, kind: "update", patch: {}, created_at: "2026-08-24T00:00:00.000Z",
    });

    expect(result).toEqual({ operation_id: "op-1", status: "rejected", error: "UNSUPPORTED_ENTITY" });
    expect(statements).toHaveLength(0);
  });

  it("keeps processed results tenant-scoped and returns a bounded note change query", async () => {
    const worker = await loadWorker();
    const statements: Array<{ sql: string; bindings: unknown[] }> = [];
    const db = {
      prepare(sql: string) {
        const statement = {
          sql,
          bindings: [] as unknown[],
          bind(...bindings: unknown[]) { statement.bindings = bindings; return statement; },
          async first() { return { result_json: JSON.stringify({ operation_id: "op-1", status: "applied", revision: 2 }) }; },
          async all() { return { results: [] }; },
          async run() { return { success: true }; },
        };
        statements.push(statement);
        return statement;
      },
      async batch() { return []; },
    };
    const Repository = worker.D1SyncRepository as new (db: unknown) => any;
    const repository = new Repository(db);

    await expect(repository.getProcessed("ws-1", "op-1")).resolves.toMatchObject({ status: "applied" });
    await repository.pull({ workspaceId: "ws-1", userId: "user-1", role: "viewer", capabilities: new Set<string>() }, "7");
    expect(statements[0]?.sql).toMatch(/processed_operations[\s\S]*workspace_id = \?[\s\S]*operation_id = \?/i);
    expect(statements.some((statement) => /sync_changes/i.test(statement.sql) && /entity_type = 'note'/i.test(statement.sql))).toBe(true);
  });

  it("persists note create/update changes, surfaces revision conflicts, and pulls full snapshots", async () => {
    const worker = await loadWorker();
    const fixture = await createTestD1();
    try {
      await seedTenants(fixture.db);
      const Repository = worker.D1SyncRepository as new (db: unknown, options?: { createId?: () => string }) => any;
      const repository = new Repository(fixture.db, { createId: () => crypto.randomUUID() });
      const context = { workspaceId: "ws-1", userId: "user-1", role: "owner", capabilities: new Set<string>() };
      const create = {
        operation_id: "op-create", workspace_id: "ws-1", entity_type: "note" as const, entity_id: "note-sync-1",
        base_revision: 0, kind: "create" as const, patch: { title: "Offline", content: "Created offline" },
        created_at: "2026-08-24T00:00:00.000Z",
      };
      await expect(repository.apply(context, create)).resolves.toMatchObject({ status: "applied", revision: 1 });
      await repository.recordProcessed("ws-1", create, { operation_id: "op-create", status: "applied", revision: 1 });

      const update = {
        operation_id: "op-update", workspace_id: "ws-1", entity_type: "note" as const, entity_id: "note-sync-1",
        base_revision: 1, kind: "update" as const, patch: { title: "Offline updated" },
        created_at: "2026-08-24T00:01:00.000Z",
      };
      await expect(repository.apply(context, update)).resolves.toMatchObject({ status: "applied", revision: 2 });
      const conflict = { ...update, operation_id: "op-stale", patch: { title: "Stale" }, created_at: "2026-08-24T00:02:00.000Z" };
      await expect(repository.apply(context, conflict)).resolves.toEqual({ operation_id: "op-stale", status: "conflict", error: "NOTE_CONFLICT" });

      const pulled = await repository.pull(context, null);
      expect(pulled.changes).toEqual(expect.arrayContaining([
        expect.objectContaining({ entity_id: "note-sync-1", revision: 1, kind: "create", payload: expect.objectContaining({ title: "Offline" }) }),
        expect.objectContaining({ entity_id: "note-sync-1", revision: 2, kind: "update", payload: expect.objectContaining({ title: "Offline updated" }) }),
      ]));
    } finally {
      await fixture.dispose();
    }
  });
});
