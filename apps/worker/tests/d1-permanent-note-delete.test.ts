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
  return { db: testD1.db, worker, repository: new worker.D1NoteRepository(testD1.db, () => `delete-id-${++id}`) };
}

async function seedNoteGraph(db: D1Database, status = "trashed", revision = 2) {
  await db.batch([
    db.prepare("INSERT INTO notes (id, workspace_id, created_by, updated_by, title, content, status, revision, created_at, updated_at) VALUES ('note-1', 'ws-1', 'user-1', 'user-1', 'Trash me', 'body', ?, ?, ?, ?)").bind(status, revision, now, now),
    db.prepare("INSERT INTO note_revisions (id, workspace_id, note_id, revision, title, content, source, created_by, created_at) VALUES ('revision-1', 'ws-1', 'note-1', 1, 'Trash me', 'body', 'manual', 'user-1', ?)").bind(now),
    db.prepare("INSERT INTO tags (id, workspace_id, name, created_at, updated_at) VALUES ('tag-1', 'ws-1', 'Trash tag', ?, ?)").bind(now, now),
    db.prepare("INSERT INTO note_tags (workspace_id, note_id, tag_id, created_at) VALUES ('ws-1', 'note-1', 'tag-1', ?)").bind(now),
    db.prepare("INSERT INTO notes (id, workspace_id, created_by, updated_by, title, content, status, revision, created_at, updated_at) VALUES ('linked-note', 'ws-1', 'user-1', 'user-1', 'Linked', '', 'active', 1, ?, ?)").bind(now, now),
    db.prepare("INSERT INTO note_links (id, workspace_id, source_note_id, target_note_id, created_at) VALUES ('link-1', 'ws-1', 'note-1', 'linked-note', ?)").bind(now),
    db.prepare("INSERT INTO reminders (id, workspace_id, note_id, user_id, remind_at, created_at, updated_at) VALUES ('reminder-1', 'ws-1', 'note-1', 'user-1', ?, ?, ?)").bind(now, now, now),
    db.prepare("INSERT INTO comments (id, workspace_id, entity_type, entity_id, author_user_id, body, created_at, updated_at) VALUES ('comment-1', 'ws-1', 'note', 'note-1', 'user-1', 'comment', ?, ?)").bind(now, now),
    db.prepare("INSERT INTO mentions (id, workspace_id, note_id, mentioned_user_id, created_at) VALUES ('mention-1', 'ws-1', 'note-1', 'user-1', ?)").bind(now),
    db.prepare("INSERT INTO public_shares (id, workspace_id, entity_type, entity_id, token_hash, created_by, created_at, updated_at) VALUES ('share-1', 'ws-1', 'note', 'note-1', 'token-hash-1', 'user-1', ?, ?)").bind(now, now),
    db.prepare("INSERT INTO search_documents (id, workspace_id, entity_type, entity_id, title, content, revision, updated_at) VALUES ('search:note:note-1', 'ws-1', 'note', 'note-1', 'Trash me', 'body', ?, ?)").bind(revision, now),
    db.prepare("INSERT INTO attachments (id, workspace_id, note_id, r2_key, filename, mime_type, size_bytes, created_by, created_at, updated_at) VALUES ('attachment-1', 'ws-1', 'note-1', 'r2/note-1', 'a.txt', 'text/plain', 1, 'user-1', ?, ?)").bind(now, now),
    db.prepare("INSERT INTO databases (id, workspace_id, name, created_by, created_at, updated_at) VALUES ('database-1', 'ws-1', 'Database', 'user-1', ?, ?)").bind(now, now),
    db.prepare("INSERT INTO database_records (id, workspace_id, database_id, note_id, created_by, updated_by, created_at, updated_at) VALUES ('record-1', 'ws-1', 'database-1', 'note-1', 'user-1', 'user-1', ?, ?)").bind(now, now),
    db.prepare("INSERT INTO activity_logs (id, workspace_id, actor_user_id, action, entity_type, entity_id, metadata_json, created_at) VALUES ('history-activity', 'ws-1', 'user-1', 'note.created', 'note', 'note-1', '{}', ?)").bind(now),
    db.prepare("INSERT INTO audit_logs (id, workspace_id, actor_user_id, request_id, action, target_type, target_id, outcome, metadata_json, created_at) VALUES ('history-audit', 'ws-1', 'user-1', 'history-request', 'note.created', 'note', 'note-1', 'success', '{}', ?)").bind(now),
  ]);
}

afterEach(async () => { await Promise.all(disposers.splice(0).map((dispose) => dispose())); });

describe("D1 permanent note deletion", () => {
  it("deletes only a same-workspace trashed note at its exact revision", async () => {
    const { db, repository } = await fixture();
    await seedNoteGraph(db);

    await expect(repository.deletePermanently({ workspaceId: "ws-1", userId: "user-1", noteId: "note-1", baseRevision: 2, now, requestId: "req-delete" })).resolves.toMatchObject({ deleted: true });
    expect(await db.prepare("SELECT id FROM notes WHERE id = 'note-1'").first()).toBeNull();
  });

  it("leaves every guarded side effect unchanged when permanent deletion loses its CAS", async () => {
    const { db, repository } = await fixture();
    await seedNoteGraph(db, "trashed", 3);

    await expect(repository.deletePermanently({ workspaceId: "ws-1", userId: "user-1", noteId: "note-1", baseRevision: 2, now, requestId: "req-stale" })).resolves.toMatchObject({ deleted: false, state: "conflict" });
    for (const [table, condition] of [
      ["notes", "id = 'note-1'"], ["comments", "entity_id = 'note-1'"], ["public_shares", "entity_id = 'note-1'"],
      ["search_documents", "entity_id = 'note-1'"], ["attachments", "id = 'attachment-1'"], ["database_records", "id = 'record-1'"],
    ]) {
      expect(await db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${condition}`).first<{ count: number }>()).toMatchObject({ count: 1 });
    }
    expect(await db.prepare("SELECT COUNT(*) AS count FROM sync_changes WHERE kind = 'delete'").first()).toMatchObject({ count: 0 });
    expect(await db.prepare("SELECT COUNT(*) AS count FROM activity_logs WHERE request_id = 'req-stale'").first()).toMatchObject({ count: 0 });
    expect(await db.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE request_id = 'req-stale'").first()).toMatchObject({ count: 0 });
    expect(await db.prepare("SELECT note_id FROM attachments WHERE id = 'attachment-1'").first()).toMatchObject({ note_id: "note-1" });
    expect(await db.prepare("SELECT note_id FROM database_records WHERE id = 'record-1'").first()).toMatchObject({ note_id: "note-1" });
  });

  it("does not expose cross-workspace notes and rejects active notes without mutation", async () => {
    const { db, repository } = await fixture();
    await seedNoteGraph(db, "active");
    await db.prepare("INSERT INTO notes (id, workspace_id, created_by, updated_by, title, content, status, revision, created_at, updated_at) VALUES ('cross-note', 'ws-2', 'user-2', 'user-2', 'Cross', '', 'trashed', 2, ?, ?)").bind(now, now).run();

    await expect(repository.deletePermanently({ workspaceId: "ws-1", userId: "user-1", noteId: "cross-note", baseRevision: 2, now, requestId: "req-cross" })).resolves.toMatchObject({ deleted: false, state: "not_found" });
    await expect(repository.deletePermanently({ workspaceId: "ws-1", userId: "user-1", noteId: "note-1", baseRevision: 2, now, requestId: "req-active" })).resolves.toMatchObject({ deleted: false, state: "not_trashed" });
    expect(await db.prepare("SELECT status FROM notes WHERE id = 'note-1'").first()).toMatchObject({ status: "active" });
    expect(await db.prepare("SELECT id FROM notes WHERE id = 'cross-note'").first()).toMatchObject({ id: "cross-note" });
  });

  it("keeps the committed delete when Presence invalidation fails", async () => {
    const { db, worker } = await fixture();
    await seedNoteGraph(db);
    const repository = new worker.D1NoteRepository(db, () => "presence-id", {
      presence: { invalidate: async () => { throw new Error("presence unavailable"); } },
    });

    await expect(repository.deletePermanently({ workspaceId: "ws-1", userId: "user-1", noteId: "note-1", baseRevision: 2, now, requestId: "req-presence" })).resolves.toMatchObject({ deleted: true });
    expect(await db.prepare("SELECT id FROM notes WHERE id = 'note-1'").first()).toBeNull();
  });

  it("removes polymorphic remnants, retains history, detaches links, and records one committed delete", async () => {
    const { db, repository } = await fixture();
    await seedNoteGraph(db);

    await repository.deletePermanently({ workspaceId: "ws-1", userId: "user-1", noteId: "note-1", baseRevision: 2, now, requestId: "req-delete" });
    for (const [table, condition] of [
      ["notes", "id = 'note-1'"], ["note_revisions", "note_id = 'note-1'"], ["note_tags", "note_id = 'note-1'"],
      ["note_links", "source_note_id = 'note-1' OR target_note_id = 'note-1'"], ["reminders", "note_id = 'note-1'"],
      ["mentions", "note_id = 'note-1'"], ["comments", "entity_id = 'note-1'"], ["public_shares", "entity_id = 'note-1'"],
      ["search_documents", "entity_id = 'note-1'"],
    ]) {
      expect(await db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${condition}`).first<{ count: number }>()).toMatchObject({ count: 0 });
    }
    expect(await db.prepare("SELECT COUNT(*) AS count FROM search_documents_fts").first()).toMatchObject({ count: 0 });
    expect(await db.prepare("SELECT note_id FROM attachments WHERE id = 'attachment-1'").first()).toMatchObject({ note_id: null });
    expect(await db.prepare("SELECT note_id FROM database_records WHERE id = 'record-1'").first()).toMatchObject({ note_id: null });
    expect(await db.prepare("SELECT COUNT(*) AS count FROM activity_logs WHERE id = 'history-activity'").first()).toMatchObject({ count: 1 });
    expect(await db.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE id = 'history-audit'").first()).toMatchObject({ count: 1 });
    expect(await db.prepare("SELECT COUNT(*) AS count FROM sync_changes WHERE entity_id = 'note-1' AND kind = 'delete'").first()).toMatchObject({ count: 1 });
    expect(await db.prepare("SELECT COUNT(*) AS count FROM activity_logs WHERE request_id = 'req-delete' AND action = 'note.permanently_deleted'").first()).toMatchObject({ count: 1 });
    expect(await db.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE request_id = 'req-delete' AND action = 'note.permanently_deleted'").first()).toMatchObject({ count: 1 });
  });
});
