import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import { prepareLegacyBetaMigration } from "../../scripts/prepare-legacy-beta-migration.mjs";

const directories: string[] = [];

afterEach(() => {
  while (directories.length) rmSync(directories.pop()!, { recursive: true, force: true });
});

describe("legacy to Beta migration", () => {
  it("preserves normal and orphaned notes, converts password hashes, and revokes unportable shares", () => {
    const directory = mkdtempSync(join(tmpdir(), "nexus-legacy-beta-"));
    directories.push(directory);
    const input = join(directory, "legacy.sql");
    const output = join(directory, "beta-data.sql");
    writeFileSync(input, `
      PRAGMA foreign_keys = OFF;
      CREATE TABLE users (id TEXT PRIMARY KEY,email TEXT,password_hash TEXT,email_verified_at TEXT,created_at TEXT,updated_at TEXT,display_name TEXT,bio TEXT,avatar_url TEXT);
      CREATE TABLE workspaces (id TEXT PRIMARY KEY,name TEXT,owner_user_id TEXT,created_at TEXT,updated_at TEXT);
      CREATE TABLE workspace_members (id TEXT PRIMARY KEY,workspace_id TEXT,user_id TEXT,role TEXT,created_at TEXT,updated_at TEXT);
      CREATE TABLE notes (id TEXT PRIMARY KEY,user_id TEXT,title TEXT,content TEXT,is_favorite INTEGER,created_at TEXT,updated_at TEXT,deleted_at TEXT,folder_id TEXT,is_pinned INTEGER,archived_at TEXT,last_opened_at TEXT,is_daily INTEGER,daily_date TEXT,workspace_id TEXT,database_id TEXT);
      CREATE TABLE note_versions (id TEXT PRIMARY KEY,note_id TEXT,user_id TEXT,title TEXT,content TEXT,created_at TEXT,workspace_id TEXT);
      CREATE TABLE note_public_shares (id TEXT PRIMARY KEY,note_id TEXT,workspace_id TEXT,creator_user_id TEXT,access_mode TEXT,access_token_hash TEXT,expires_at TEXT,revoked_at TEXT,created_at TEXT,updated_at TEXT,password_hash TEXT);
      INSERT INTO users VALUES ('user-1','one@example.test','pbkdf2$100000$salt$hash','2026-08-25T00:00:00Z','2026-08-25T00:00:00Z','2026-08-25T00:00:00Z','One','','');
      INSERT INTO workspaces VALUES ('ws-1','Personal','user-1','2026-08-25T00:00:00Z','2026-08-25T00:00:00Z');
      INSERT INTO workspace_members VALUES ('member-1','ws-1','user-1','owner','2026-08-25T00:00:00Z','2026-08-25T00:00:00Z');
      INSERT INTO notes VALUES ('note-1','user-1','Normal','Body',0,'2026-08-25T00:00:00Z','2026-08-25T00:00:00Z',NULL,NULL,0,NULL,NULL,0,NULL,'ws-1',NULL);
      INSERT INTO notes VALUES ('orphan',NULL,'Orphan','Preserve me',0,'2026-08-25T00:00:00Z','2026-08-25T00:00:00Z',NULL,NULL,0,NULL,NULL,0,NULL,NULL,NULL);
      INSERT INTO note_public_shares VALUES ('share-1','note-1','ws-1','user-1','read','legacy-hash',NULL,NULL,'2026-08-25T00:00:00Z','2026-08-25T00:00:00Z',NULL);
    `);

    const report = prepareLegacyBetaMigration({ input, output });
    expect(report.counts.notes).toBe(2);
    expect(report.warnings).toContain("Quarantined 1 orphaned legacy note(s) in legacy-recovery-workspace");

    const db = new DatabaseSync(":memory:");
    for (const name of readdirSync(join(process.cwd(), "apps/worker/migrations")).filter((file) => /^\d+_.+\.sql$/u.test(file)).sort()) {
      db.exec(readFileSync(join(process.cwd(), "apps/worker/migrations", name), "utf8"));
    }
    db.exec(readFileSync(output, "utf8"));
    expect(db.prepare("SELECT password_hash FROM users WHERE id = 'user-1'").get()).toEqual({ password_hash: "pbkdf2_sha256$100000$salt$hash" });
    expect(db.prepare("SELECT workspace_id, created_by, content FROM notes WHERE id = 'orphan'").get()).toEqual({
      workspace_id: "legacy-recovery-workspace", created_by: "legacy-recovery-user", content: "Preserve me",
    });
    expect(db.prepare("SELECT status, revoked_at FROM public_shares WHERE id = 'share-1'").get()).toMatchObject({ status: "revoked" });
  });
});
