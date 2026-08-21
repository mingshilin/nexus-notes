import { describe, expect, it, vi } from "vitest";

type WorkerExports = Record<string, unknown>;

async function loadWorker() {
  return (await import("../src")) as WorkerExports;
}

const reminderRow = {
  id: "reminder-1", workspace_id: "ws-1", note_id: "note-1", user_id: "user-1",
  remind_at: "2026-08-22T00:00:00.000Z", status: "dismissed", revision: 2,
  created_at: "2026-08-21T00:00:00.000Z", updated_at: "2026-08-21T00:01:00.000Z",
};

describe("D1ReminderRepository", () => {
  it("creates a reminder with a sync change and lists only the owner reminders", async () => {
    const worker = await loadWorker();
    const statements: Array<{ sql: string; bindings: unknown[]; bind: any; all: any }> = [];
    const db = {
      prepare: vi.fn((sql: string) => {
        const statement = {
          sql,
          bindings: [] as unknown[],
          bind: vi.fn(),
          all: vi.fn(async () => ({ results: [reminderRow] })),
        };
        statement.bind.mockImplementation((...bindings: unknown[]) => {
          statement.bindings = bindings;
          return statement;
        });
        statements.push(statement);
        return statement;
      }),
      batch: vi.fn(async () => [{ results: [{ ...reminderRow, status: "pending", revision: 1 }] }, {}]),
    };
    const Repository = worker.D1ReminderRepository as new (db: unknown, createId: () => string) => any;
    const repository = new Repository(db, () => "reminder-1");

    const created = await repository.createReminder({
      workspaceId: "ws-1", userId: "user-1",
      input: { note_id: "note-1", remind_at: "2026-08-22T00:00:00.000Z" },
      now: "2026-08-21T00:00:00.000Z",
    });
    expect(created).toMatchObject({ id: "reminder-1", status: "pending", revision: 1 });
    await expect(repository.listReminders("ws-1", "user-1", false)).resolves.toEqual([reminderRow]);

    expect(db.batch).toHaveBeenCalledOnce();
    expect(statements[0]?.sql).toMatch(/INSERT INTO reminders/i);
    expect(statements[1]?.sql).toMatch(/INSERT INTO sync_changes/i);
    expect(statements[2]?.sql).toMatch(/FROM reminders[\s\S]*workspace_id = \?[\s\S]*user_id = \?/i);
  });

  it("updates reminders with a tenant/user/base-revision lock and syncs the result", async () => {
    const worker = await loadWorker();
    expect(worker.D1ReminderRepository).toBeTypeOf("function");
    const statements: Array<{ sql: string; bindings: unknown[]; bind: any }> = [];
    const db = {
      prepare: vi.fn((sql: string) => {
        const statement = { sql, bindings: [] as unknown[], bind: vi.fn() };
        statement.bind.mockImplementation((...bindings: unknown[]) => {
          statement.bindings = bindings;
          return statement;
        });
        statements.push(statement);
        return statement;
      }),
      batch: vi.fn(async () => [{ results: [reminderRow] }, {}]),
    };
    const Repository = worker.D1ReminderRepository as new (db: unknown) => any;
    const repository = new Repository(db);

    const result = await repository.updateReminder({
      workspaceId: "ws-1", userId: "user-1", reminderId: "reminder-1", baseRevision: 1,
      patch: { status: "dismissed" }, now: "2026-08-21T00:01:00.000Z",
    });

    expect(result.reminder).toMatchObject({ id: "reminder-1", revision: 2 });
    expect(db.batch).toHaveBeenCalledOnce();
    expect(statements[0]?.sql).toMatch(/UPDATE reminders[\s\S]*workspace_id = \?[\s\S]*user_id = \?[\s\S]*revision = \?/i);
    expect(statements[1]?.sql).toMatch(/INSERT INTO sync_changes[\s\S]*SELECT[\s\S]*updated_at = \?/i);
  });

  it("returns the owner-scoped current reminder after an optimistic conflict", async () => {
    const worker = await loadWorker();
    const statements: Array<{ sql: string; bindings: unknown[]; bind: any; first: any }> = [];
    const db = {
      prepare: vi.fn((sql: string) => {
        const statement = {
          sql,
          bindings: [] as unknown[],
          bind: vi.fn(),
          first: vi.fn(async () => reminderRow),
        };
        statement.bind.mockImplementation((...bindings: unknown[]) => {
          statement.bindings = bindings;
          return statement;
        });
        statements.push(statement);
        return statement;
      }),
      batch: vi.fn(async () => [{ results: [] }, {}]),
    };
    const Repository = worker.D1ReminderRepository as new (db: unknown) => any;
    const repository = new Repository(db);

    const result = await repository.updateReminder({
      workspaceId: "ws-1", userId: "user-1", reminderId: "reminder-1", baseRevision: 1,
      patch: { status: "dismissed" }, now: "2026-08-21T00:01:00.000Z",
    });

    expect(result).toMatchObject({ reminder: null, current: { id: "reminder-1", revision: 2 } });
    expect(statements[2]?.sql).toMatch(/FROM reminders[\s\S]*workspace_id = \?[\s\S]*user_id = \?[\s\S]*id = \?/i);
    expect(statements[2]?.bindings).toEqual(["ws-1", "user-1", "reminder-1"]);
  });
});
