import { afterEach, describe, expect, it } from "vitest";

import { createTestD1, seedTenants } from "./helpers/d1";

const now = "2026-08-23T00:00:00.000Z";
const disposers: Array<() => Promise<void>> = [];

async function fixture() {
  const testD1 = await createTestD1();
  disposers.push(testD1.dispose);
  await seedTenants(testD1.db);
  await testD1.db.prepare(
    "INSERT INTO workspace_members (workspace_id, user_id, role, revision, joined_at, updated_at) VALUES ('ws-1', 'user-1', 'owner', 1, ?, ?)",
  ).bind(now, now).run();
  const worker = await import("../src");
  let id = 0;
  return { db: testD1.db, repository: new worker.D1NoteRepository(testD1.db, () => `daily-side-effect-${++id}`) };
}

function dailyInput(workspaceId = "ws-1", userId = "user-1") {
  return {
    id: `daily-${workspaceId}`,
    workspaceId,
    userId,
    title: "Daily Note 2026-08-23",
    content: "",
    folderId: null,
    databaseId: null,
    dailyDate: "2026-08-23",
    isFavorite: false,
    isPinned: false,
    source: "manual" as const,
    now,
    requestId: `req-${workspaceId}`,
  };
}

afterEach(async () => { await Promise.all(disposers.splice(0).map((dispose) => dispose())); });

describe("D1 daily notes", () => {
  it("creates once per workspace/date, returns the existing active note, and records normal side effects", async () => {
    const { db, repository } = await fixture();

    const [created, concurrent] = await Promise.all([
      repository.openOrCreateDaily(dailyInput()),
      repository.openOrCreateDaily({ ...dailyInput(), id: "daily-concurrent-call", requestId: "req-concurrent" }),
    ]);
    const repeated = await repository.openOrCreateDaily({ ...dailyInput(), id: "daily-second-call", requestId: "req-repeat" });

    expect(concurrent).toEqual(created);
    expect(repeated).toEqual(created);
    expect(await db.prepare("SELECT COUNT(*) AS count FROM notes WHERE workspace_id = ? AND daily_date = ? AND status = 'active' AND deleted_at IS NULL").bind("ws-1", "2026-08-23").first<{ count: number }>()).toEqual({ count: 1 });
    const winnerId = created.id;
    expect(await db.prepare("SELECT COUNT(*) AS count FROM note_revisions WHERE workspace_id = ? AND note_id = ? AND revision = 1").bind("ws-1", winnerId).first<{ count: number }>()).toEqual({ count: 1 });
    expect(await db.prepare("SELECT COUNT(*) AS count FROM sync_changes WHERE workspace_id = ? AND entity_id = ? AND kind = 'create'").bind("ws-1", winnerId).first<{ count: number }>()).toEqual({ count: 1 });
    expect(await db.prepare("SELECT COUNT(*) AS count FROM search_documents WHERE workspace_id = ? AND entity_id = ? AND revision = 1").bind("ws-1", winnerId).first<{ count: number }>()).toEqual({ count: 1 });
    const winnerRequestId = created.id === dailyInput().id ? "req-ws-1" : "req-concurrent";
    expect(await db.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE workspace_id = ? AND request_id = ? AND action = 'note.created'").bind("ws-1", winnerRequestId).first<{ count: number }>()).toEqual({ count: 1 });
  });

  it("never returns a same-date note from another workspace", async () => {
    const { db, repository } = await fixture();
    await db.prepare("INSERT INTO notes (id, workspace_id, created_by, updated_by, title, content, status, daily_date, revision, created_at, updated_at) VALUES ('foreign-daily', 'ws-2', 'user-2', 'user-2', 'Foreign', '', 'active', '2026-08-23', 1, ?, ?)").bind(now, now).run();

    const own = await repository.openOrCreateDaily(dailyInput());

    expect(own).toMatchObject({ workspace_id: "ws-1", daily_date: "2026-08-23" });
    expect(own.id).not.toBe("foreign-daily");
  });
});
