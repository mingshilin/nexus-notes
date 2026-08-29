import { describe, expect, it } from "vitest";
import type { WorkspaceContext } from "@nexus/contracts";

import { D1DatabaseRepository, createTaskNotificationWriter } from "../src";
import { createTestD1, seedTenants } from "./helpers/d1";

const now = "2026-08-29T00:00:00.000Z";

function context(overrides: Partial<WorkspaceContext> = {}): WorkspaceContext {
  return {
    workspaceId: "ws-1",
    userId: "user-1",
    role: "owner",
    capabilities: new Set<string>(),
    ...overrides,
  };
}

async function setup() {
  const test = await createTestD1();
  await seedTenants(test.db);
  await test.db.batch([
    test.db.prepare(
      "INSERT INTO users (id, email, password_hash, display_name, status, created_at, updated_at) VALUES ('user-3', 'three@example.test', 'hash', 'Three', 'active', ?, ?)",
    ).bind(now, now),
    test.db.prepare(
      "INSERT INTO workspace_members (workspace_id, user_id, role, revision, joined_at, updated_at) VALUES ('ws-1', 'user-1', 'owner', 1, ?, ?)",
    ).bind(now, now),
    test.db.prepare(
      "INSERT INTO workspace_members (workspace_id, user_id, role, revision, joined_at, updated_at) VALUES ('ws-1', 'user-2', 'editor', 1, ?, ?)",
    ).bind(now, now),
    test.db.prepare(
      "INSERT INTO workspace_members (workspace_id, user_id, role, revision, joined_at, updated_at) VALUES ('ws-1', 'user-3', 'viewer', 1, ?, ?)",
    ).bind(now, now),
  ]);
  const repository = new D1DatabaseRepository(test.db, { clock: () => new Date(now) });
  const owner = context();
  const database = await repository.createDatabase(owner, { name: "任务管理", description: "团队任务" });
  const title = await repository.createProperty(owner, database.id, {
    name: "任务名称", type: "text", config: { max_length: 500 }, position: 0,
  });
  const status = await repository.createProperty(owner, database.id, {
    name: "状态", type: "select", config: {
      options: [
        { id: "todo", name: "待处理", color: "" },
        { id: "in-progress", name: "进行中", color: "" },
        { id: "done", name: "已完成", color: "" },
        { id: "cancelled", name: "已取消", color: "" },
      ],
    }, position: 1,
  });
  const priority = await repository.createProperty(owner, database.id, {
    name: "优先级", type: "select", config: {
      options: [
        { id: "low", name: "低", color: "" },
        { id: "medium", name: "中", color: "" },
        { id: "high", name: "高", color: "" },
      ],
    }, position: 2,
  });
  const assignee = await repository.createProperty(owner, database.id, {
    name: "负责人", type: "member", config: { allow_multiple: false }, position: 3,
  });
  const dueDate = await repository.createProperty(owner, database.id, {
    name: "截止日期", type: "date", config: {}, position: 4,
  });
  const description = await repository.createProperty(owner, database.id, {
    name: "描述", type: "text", config: { max_length: 20_000 }, position: 5,
  });
  return { test, repository, owner, database, title, status, priority, assignee, dueDate, description };
}

async function notifications(db: D1Database) {
  const result = await db.prepare(
    `SELECT workspace_id, user_id, type, payload_json, dedupe_key, deep_link
     FROM notifications ORDER BY created_at, id`,
  ).all<{
    workspace_id: string;
    user_id: string;
    type: string;
    payload_json: string;
    dedupe_key: string | null;
    deep_link: string;
  }>();
  return result.results ?? [];
}

describe("task template notifications", () => {
  it("notifies the new assignee and current assignee on status changes", async () => {
    const state = await setup();
    try {
      const record = await state.repository.createRecord(state.owner, state.database.id, {
        note_id: null,
        values: { [state.title.id]: "发布版本", [state.status.id]: "todo", [state.assignee.id]: "user-2" },
      });
      expect(await notifications(state.test.db)).toHaveLength(1);
      await state.test.db.prepare("DELETE FROM notifications").run();

      const reassigned = await state.repository.updateRecord(state.owner, state.database.id, record.id, {
        base_revision: record.revision,
        values: { [state.assignee.id]: "user-3" },
      });
      const assignment = await notifications(state.test.db);
      expect(assignment).toHaveLength(1);
      expect(assignment[0]).toMatchObject({
        workspace_id: "ws-1",
        user_id: "user-3",
        type: "task_assigned",
        deep_link: `/databases/${encodeURIComponent(state.database.id)}/records/${encodeURIComponent(record.id)}`,
      });
      expect(assignment[0]?.dedupe_key).toBe(`task:${state.database.id}:record:${record.id}:revision:${reassigned.revision}:assigned:user-3`);
      expect(JSON.parse(assignment[0]!.payload_json)).toEqual({
        event: "assignment",
        database_id: state.database.id,
        record_id: record.id,
        revision: reassigned.revision,
      });
      expect(assignment[0]!.payload_json).not.toContain("发布版本");
      expect(assignment[0]!.payload_json).not.toContain("user-2");

      await state.repository.updateRecord(state.owner, state.database.id, record.id, {
        base_revision: reassigned.revision,
        values: { [state.status.id]: "done" },
      });
      const changed = await notifications(state.test.db);
      expect(changed).toHaveLength(2);
      const statusNotification = changed.find((item) => item.type === "task_status_changed");
      expect(statusNotification).toMatchObject({ user_id: "user-3", type: "task_status_changed" });
      expect(JSON.parse(statusNotification!.payload_json)).toMatchObject({
        event: "status_change",
        database_id: state.database.id,
        record_id: record.id,
      });
    } finally {
      await state.test.dispose();
    }
  });

  it("does not notify when tracked values are unchanged or when an ordinary database is edited", async () => {
    const state = await setup();
    try {
      const record = await state.repository.createRecord(state.owner, state.database.id, {
        note_id: null,
        values: { [state.status.id]: "todo", [state.assignee.id]: "user-2" },
      });
      await state.test.db.prepare("DELETE FROM notifications").run();
      const unchanged = await state.repository.updateRecord(state.owner, state.database.id, record.id, {
        base_revision: record.revision,
        values: { [state.status.id]: "todo", [state.assignee.id]: "user-2" },
      });
      expect(await notifications(state.test.db)).toHaveLength(0);

      const ordinary = await state.repository.createDatabase(state.owner, { name: "普通项目", description: "" });
      const ordinaryStatus = await state.repository.createProperty(state.owner, ordinary.id, {
        name: "状态", type: "select", config: { options: [{ id: "todo", name: "Todo", color: "" }, { id: "done", name: "Done", color: "" }] }, position: 0,
      });
      const ordinaryOwner = await state.repository.createProperty(state.owner, ordinary.id, {
        name: "负责人", type: "member", config: { allow_multiple: false }, position: 1,
      });
      const ordinaryRecord = await state.repository.createRecord(state.owner, ordinary.id, {
        note_id: null, values: { [ordinaryStatus.id]: "todo", [ordinaryOwner.id]: "user-2" },
      });
      await state.repository.updateRecord(state.owner, ordinary.id, ordinaryRecord.id, {
        base_revision: ordinaryRecord.revision, values: { [ordinaryStatus.id]: "done" },
      });

      expect(unchanged.revision).toBe(record.revision + 1);
      expect(await notifications(state.test.db)).toHaveLength(0);
    } finally {
      await state.test.dispose();
    }
  });

  it("only inserts notifications for current workspace members", async () => {
    const state = await setup();
    try {
      const missingMember = "user-not-in-workspace";
      await state.test.db.prepare(
        "INSERT INTO users (id, email, password_hash, display_name, status, created_at, updated_at) VALUES (?, ?, 'hash', 'Missing', 'active', ?, ?)",
      ).bind(missingMember, "missing@example.test", now, now).run();
      const record = await state.repository.createRecord(state.owner, state.database.id, {
        note_id: null,
        values: { [state.status.id]: "todo", [state.assignee.id]: "user-2" },
      });
      await state.test.db.prepare("DELETE FROM notifications").run();

      await expect(state.repository.updateRecord(state.owner, state.database.id, record.id, {
        base_revision: record.revision,
        values: { [state.assignee.id]: missingMember },
      })).rejects.toMatchObject({ code: "INVALID_MEMBER_REFERENCE", status: 400 });
      expect(await notifications(state.test.db)).toHaveLength(0);
      expect((await state.repository.getRecord(state.owner, state.database.id, record.id)).values[state.assignee.id]).toBe("user-2");
    } finally {
      await state.test.dispose();
    }
  });

  it("rolls back the record mutation when notification insertion fails", async () => {
    const state = await setup();
    try {
      const record = await state.repository.createRecord(state.owner, state.database.id, {
        note_id: null,
        values: { [state.status.id]: "todo", [state.assignee.id]: "user-2" },
      });
      await state.test.db.prepare("DELETE FROM notifications").run();
      await state.test.db.prepare(
        `CREATE TRIGGER reject_task_notification BEFORE INSERT ON notifications
         WHEN NEW.type IN ('task_assigned', 'task_status_changed')
         BEGIN
           SELECT RAISE(ABORT, 'TASK_NOTIFICATION_FAILURE');
         END`,
      ).run();

      await expect(state.repository.updateRecord(state.owner, state.database.id, record.id, {
        base_revision: record.revision,
        values: { [state.assignee.id]: "user-3" },
      })).rejects.toThrow("TASK_NOTIFICATION_FAILURE");
      expect(await notifications(state.test.db)).toHaveLength(0);
      const unchanged = await state.repository.getRecord(state.owner, state.database.id, record.id);
      expect(unchanged.revision).toBe(record.revision);
      expect(unchanged.values[state.assignee.id]).toBe("user-2");
    } finally {
      await state.test.dispose();
    }
  });

  it("deduplicates the same deterministic task notification intent", async () => {
    const state = await setup();
    try {
      let id = 0;
      const writer = createTaskNotificationWriter(state.test.db, () => `task-notification-${++id}`);
      const input = {
        context: state.owner,
        databaseId: state.database.id,
        properties: [state.title, state.status, state.priority, state.assignee, state.dueDate, state.description],
        records: [{
          id: "record-replay",
          revision: 2,
          previousValues: { [state.assignee.id]: "user-2" },
          nextValues: { [state.assignee.id]: "user-3" },
        }],
        now,
      };
      await state.test.db.batch(writer.prepare(input));
      await state.test.db.batch(writer.prepare(input));

      const rows = await notifications(state.test.db);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.dedupe_key).toBe(`task:${state.database.id}:record:record-replay:revision:2:assigned:user-3`);
    } finally {
      await state.test.dispose();
    }
  });
});
