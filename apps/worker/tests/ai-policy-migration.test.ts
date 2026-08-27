import { afterEach, describe, expect, it } from "vitest";

import { applyMigration, createTestD1, seedTenants } from "./helpers/d1";

const disposals: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(disposals.splice(0).map((dispose) => dispose()));
});

describe("AI trusted mode additive migration", () => {
  it("stores only workspace-scoped policy state and preserves existing AI proposals", async () => {
    const test = await createTestD1({ through: 20 });
    disposals.push(test.dispose);
    await seedTenants(test.db);
    const now = "2026-08-28T00:00:00.000Z";
    await test.db.prepare(
      "INSERT INTO ai_action_proposals (id,user_id,workspace_id,tool,input_json,status,idempotency_key,revision,expires_at,created_at,updated_at) VALUES ('a1','user-1','ws-1','create_note','{}','proposed','ai-action:user-1:a1',1,?,?,?)",
    ).bind("2026-08-28T00:10:00.000Z", now, now).run();

    await applyMigration(test.db, "../../migrations/0021_ai_trusted_mode.sql");
    const columns = await test.db.prepare("PRAGMA table_info(ai_trusted_modes)").all<{ name: string }>();
    expect(columns.results.map((column) => column.name)).toEqual([
      "workspace_id", "enabled", "expires_at", "revision",
    ]);
    const table = await test.db.prepare(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='ai_trusted_modes'",
    ).first<{ sql: string }>();
    expect(table?.sql).not.toMatch(/prompt|body|api_key|token|user_id/iu);
    expect(await test.db.prepare("SELECT id FROM ai_action_proposals WHERE id='a1'").first()).toEqual({ id: "a1" });
  });

  it("enforces expiry shape and revision compare-and-swap", async () => {
    const test = await createTestD1({ through: 20 });
    disposals.push(test.dispose);
    await seedTenants(test.db);
    await applyMigration(test.db, "../../migrations/0021_ai_trusted_mode.sql");

    await expect(test.db.prepare(
      "INSERT INTO ai_trusted_modes (workspace_id,enabled,expires_at,revision) VALUES ('ws-1',1,NULL,1)",
    ).run()).rejects.toThrow();
    await test.db.prepare(
      "INSERT INTO ai_trusted_modes (workspace_id,enabled,expires_at,revision) VALUES ('ws-1',1,'2026-08-29T00:00:00.000Z',1)",
    ).run();

    const first = await test.db.prepare(
      "UPDATE ai_trusted_modes SET enabled=0,expires_at=NULL,revision=revision+1 WHERE workspace_id='ws-1' AND revision=1",
    ).run();
    const stale = await test.db.prepare(
      "UPDATE ai_trusted_modes SET enabled=1,expires_at='2026-08-30T00:00:00.000Z',revision=revision+1 WHERE workspace_id='ws-1' AND revision=1",
    ).run();
    expect(first.meta.changes).toBe(1);
    expect(stale.meta.changes).toBe(0);
    expect(await test.db.prepare("SELECT enabled,expires_at,revision FROM ai_trusted_modes WHERE workspace_id='ws-1'").first()).toEqual({
      enabled: 0,
      expires_at: null,
      revision: 2,
    });
  });

  it("enforces the workspace foreign key and cascades policy state with its workspace", async () => {
    const test = await createTestD1({ through: 20 });
    disposals.push(test.dispose);
    await seedTenants(test.db);
    await applyMigration(test.db, "../../migrations/0021_ai_trusted_mode.sql");

    await expect(test.db.prepare(
      "INSERT INTO ai_trusted_modes (workspace_id,enabled,expires_at,revision) VALUES ('missing',1,'2026-08-29T00:00:00.000Z',1)",
    ).run()).rejects.toThrow();
    await test.db.prepare(
      "INSERT INTO ai_trusted_modes (workspace_id,enabled,expires_at,revision) VALUES ('ws-1',1,'2026-08-29T00:00:00.000Z',1)",
    ).run();
    await test.db.prepare("DELETE FROM workspaces WHERE id='ws-1'").run();
    expect(await test.db.prepare("SELECT workspace_id FROM ai_trusted_modes WHERE workspace_id='ws-1'").first()).toBeNull();
  });
});
