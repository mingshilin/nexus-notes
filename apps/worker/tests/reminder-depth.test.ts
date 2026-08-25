import { describe, expect, it } from "vitest";
import { D1ReminderDeliveryRepository } from "../src/knowledge/d1-reminder-delivery-repository";
import { D1ReminderRepository } from "../src/knowledge/d1-reminder-repository";
import { createTestD1 } from "./helpers/d1";

const now = "2026-08-25T01:00:00.000Z";

async function seed(db: D1Database) {
  await db.batch([
    db.prepare("INSERT INTO users (id,email,password_hash,display_name,status,created_at,updated_at) VALUES ('user-1','one@example.test','hash','One','active',?,?)").bind(now, now),
    db.prepare("INSERT INTO workspaces (id,owner_user_id,slug,name,created_at,updated_at) VALUES ('ws-1','user-1','one','One',?,?)").bind(now, now),
    db.prepare("INSERT INTO workspace_members (workspace_id,user_id,role,joined_at,updated_at,revision) VALUES ('ws-1','user-1','owner',?,?,1)").bind(now, now),
  ]);
}

describe("reminder depth", () => {
  it("persists advanced reminder fields and supports snooze plus soft deletion", async () => {
    const test = await createTestD1();
    try {
      await seed(test.db);
      const repository = new D1ReminderRepository(test.db, () => "reminder-1");
      const created = await repository.createReminder({
        workspaceId: "ws-1", userId: "user-1", now,
        input: {
          note_id: null,
          title: "两周一次复盘",
          remind_at: "2026-08-25T02:00:00.000Z",
          timezone: "Asia/Shanghai",
          channels: ["in_app", "push"],
          recurrence: { frequency: "weekly", interval: 2, weekdays: ["MO", "WE"], ends: { type: "count", count: 6 } },
          delivery_enabled: true,
        },
      });
      expect(created).toMatchObject({
        title: "两周一次复盘", timezone: "Asia/Shanghai", channels: ["in_app", "push"],
        recurrence: { frequency: "weekly", interval: 2 }, delivery_enabled_at: now,
      });
      const snoozed = await repository.snoozeReminder({
        workspaceId: "ws-1", userId: "user-1", reminderId: "reminder-1", baseRevision: 1, minutes: 60, now,
      });
      expect(snoozed.reminder).toMatchObject({ remind_at: "2026-08-25T02:00:00.000Z", snoozed_until: "2026-08-25T02:00:00.000Z", revision: 2 });
      expect(await repository.deleteReminder({ workspaceId: "ws-1", userId: "user-1", reminderId: "reminder-1", baseRevision: 2, now })).toBe(true);
      expect(await repository.listReminders("ws-1", "user-1", true)).toEqual([]);
    } finally {
      await test.dispose();
    }
  });

  it("claims only armed reminders and creates one delivery per enabled channel", async () => {
    const test = await createTestD1();
    try {
      await seed(test.db);
      await test.db.prepare(
        `INSERT INTO user_preferences (user_id,push_reminders,email_reminders,in_app_reminders,updated_at)
         VALUES ('user-1',1,0,1,?)`,
      ).bind(now).run();
      await test.db.batch([
        test.db.prepare(
          `INSERT INTO reminders (id,workspace_id,note_id,user_id,remind_at,status,revision,created_at,updated_at,title,timezone,channels_json,recurrence_json,recurrence_anchor_local,occurrence_count,delivery_enabled_at)
           VALUES ('armed','ws-1',NULL,'user-1',?,'pending',1,?,?, 'Due','Asia/Shanghai','["in_app","email","push"]',NULL,NULL,0,?)`,
        ).bind(now, now, now, now),
        test.db.prepare(
          `INSERT INTO reminders (id,workspace_id,note_id,user_id,remind_at,status,revision,created_at,updated_at,title,timezone,channels_json,occurrence_count,delivery_enabled_at)
           VALUES ('legacy','ws-1',NULL,'user-1',?,'pending',1,?,?, 'Legacy','UTC','["in_app"]',0,NULL)`,
        ).bind(now, now, now),
      ]);
      const repository = new D1ReminderDeliveryRepository(test.db, { createId: (() => { let id = 0; return () => `delivery-${++id}`; })() });
      const result = await repository.prepareDue(now, 10);
      expect(result).toEqual({ claimed: 1, deliveries: 2 });
      const deliveries = await test.db.prepare("SELECT channel FROM reminder_deliveries ORDER BY channel").all<{ channel: string }>();
      expect(deliveries.results.map((row) => row.channel)).toEqual(["in_app", "push"]);
      expect(await repository.prepareDue(now, 10)).toEqual({ claimed: 0, deliveries: 0 });
    } finally {
      await test.dispose();
    }
  });
});
