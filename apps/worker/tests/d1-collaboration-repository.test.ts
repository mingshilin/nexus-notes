import { afterEach, describe, expect, it, vi } from "vitest";

import type { WorkspaceContext } from "@nexus/contracts";
import { createTestD1, seedTenants } from "./helpers/d1";

const now = "2026-08-22T00:00:00.000Z";
const owner: WorkspaceContext = { workspaceId: "ws-1", userId: "user-1", role: "owner", capabilities: new Set() };
const editor: WorkspaceContext = { workspaceId: "ws-1", userId: "user-2", role: "editor", capabilities: new Set() };
const viewer: WorkspaceContext = { workspaceId: "ws-1", userId: "user-3", role: "viewer", capabilities: new Set() };
const ownerWs2: WorkspaceContext = { workspaceId: "ws-2", userId: "user-2", role: "owner", capabilities: new Set() };

const disposers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(disposers.splice(0).map((dispose) => dispose()));
});

async function setup() {
  const testDb = await createTestD1();
  disposers.push(testDb.dispose);
  await seedTenants(testDb.db);
  await testDb.db.batch([
    testDb.db.prepare(
      "INSERT INTO users (id, email, password_hash, display_name, status, created_at, updated_at) VALUES ('user-3', 'three@example.test', 'hash', 'Three', 'active', ?, ?)",
    ).bind(now, now),
    testDb.db.prepare(
      "INSERT INTO workspace_members (workspace_id, user_id, role, revision, joined_at, updated_at) VALUES ('ws-1', 'user-1', 'owner', 1, ?, ?)",
    ).bind(now, now),
    testDb.db.prepare(
      "INSERT INTO workspace_members (workspace_id, user_id, role, revision, joined_at, updated_at) VALUES ('ws-1', 'user-2', 'editor', 1, ?, ?)",
    ).bind(now, now),
    testDb.db.prepare(
      "INSERT INTO workspace_members (workspace_id, user_id, role, revision, joined_at, updated_at) VALUES ('ws-1', 'user-3', 'viewer', 1, ?, ?)",
    ).bind(now, now),
    testDb.db.prepare(
      "INSERT INTO workspace_members (workspace_id, user_id, role, revision, joined_at, updated_at) VALUES ('ws-2', 'user-2', 'owner', 1, ?, ?)",
    ).bind(now, now),
    testDb.db.prepare(
      `INSERT INTO notes
       (id, workspace_id, created_by, updated_by, title, content, status, revision, created_at, updated_at)
       VALUES ('note-1', 'ws-1', 'user-1', 'user-1', 'Shared plan', 'Private body', 'active', 3, ?, ?)`,
    ).bind(now, now),
  ]);
  const worker = await import("../src/index") as Record<string, any>;
  let id = 0;
  let currentTime = new Date(now);
  const tokenHashes: string[] = [];
  const tokens = {
    createSessionToken: vi.fn(() => `T${"a".repeat(42 - String(id).length)}${id++}`),
    hash: vi.fn(async (value: string) => {
      const hash = `hash:${value}`;
      tokenHashes.push(hash);
      return hash;
    }),
  };
  const Repository = worker.D1CollaborationRepository as new (db: D1Database, options: Record<string, unknown>) => any;
  expect(Repository).toBeTypeOf("function");
  const createRepository = (repositoryDb: D1Database = testDb.db, extraOptions: Record<string, unknown> = {}) => new Repository(repositoryDb, {
    tokens,
    password: new worker.WebCryptoPasswordHasher({ iterations: 1_000 }),
    createId: () => `id-${++id}`,
    clock: () => new Date(currentTime),
    memberLimit: 5,
    ...extraOptions,
  });
  const repository = createRepository();
  return {
    ...testDb,
    repository,
    createRepository,
    tokens,
    tokenHashes,
    setNow(value: string) {
      currentTime = new Date(value);
    },
    async tokenContext(token: string) {
      return { tokenHash: await tokens.hash(token) };
    },
  };
}

function beforeFirstBatch(db: D1Database, action: () => Promise<unknown>) {
  let armed = true;
  return new Proxy(db, {
    get(target, property, receiver) {
      if (property === "batch") {
        return async (statements: D1PreparedStatement[]) => {
          if (armed) {
            armed = false;
            await action();
          }
          return db.batch(statements);
        };
      }
      return Reflect.get(target, property, receiver);
    },
  }) as D1Database;
}

async function expectNoSuccessSideEffects(db: D1Database, requestId: string) {
  expect(await db.prepare(
    "SELECT COUNT(*) AS count FROM activity_logs WHERE request_id = ?",
  ).bind(requestId).first<{ count: number }>()).toEqual({ count: 0 });
  expect(await db.prepare(
    "SELECT COUNT(*) AS count FROM audit_logs WHERE request_id = ?",
  ).bind(requestId).first<{ count: number }>()).toEqual({ count: 0 });
}

describe("D1CollaborationRepository invitations and members", () => {
  it("stores only a token hash and atomically consumes an email-bound invitation once", async () => {
    const { db, repository, tokenContext } = await setup();
    await db.prepare(
      "INSERT INTO users (id, email, password_hash, display_name, status, created_at, updated_at) VALUES ('user-4', 'invitee@example.test', 'hash', 'Invitee', 'active', ?, ?)",
    ).bind(now, now).run();

    const created = await repository.createInvitation(owner, {
      email: "Invitee@Example.Test",
      role: "editor",
      expires_in_hours: 48,
    }, "req-invite");
    expect(created.token).toMatch(/^[A-Za-z0-9_-]{43,}$/);
    expect(JSON.stringify(created.invitation)).not.toContain(created.token);
    const stored = await db.prepare("SELECT token_hash, status, revision FROM workspace_invitations WHERE id = ?")
      .bind(created.invitation.id).first<{ token_hash: string; status: string; revision: number }>();
    expect(stored).toEqual({ token_hash: `hash:${created.token}`, status: "pending", revision: 1 });

    const publicToken = await tokenContext(created.token);
    const preview = await repository.previewInvitation(publicToken);
    expect(preview).toMatchObject({ workspace_name: "One", email: "invitee@example.test", role: "editor", status: "pending" });
    await expect(repository.acceptInvitation({ userId: "user-4", ...publicToken }, "req-accept")).resolves.toMatchObject({ role: "editor" });
    await expect(repository.acceptInvitation({ userId: "user-4", ...publicToken }, "req-replay")).rejects.toMatchObject({ code: "INVITATION_UNAVAILABLE" });
    expect(await db.prepare("SELECT COUNT(*) AS count FROM workspace_members WHERE workspace_id = 'ws-1' AND user_id = 'user-4'").first<{ count: number }>()).toEqual({ count: 1 });
    expect(await db.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'invitation.accepted' AND target_id = 'user-4'").first<{ count: number }>()).toEqual({ count: 1 });
  });

  it("allows exactly one concurrent invitation consumer and records explicit consumption state", async () => {
    const { db, repository, tokenContext } = await setup();
    await db.prepare(
      "INSERT INTO users (id, email, password_hash, display_name, status, created_at, updated_at) VALUES ('user-4', 'invitee@example.test', 'hash', 'Invitee', 'active', ?, ?)",
    ).bind(now, now).run();
    const created = await repository.createInvitation(owner, {
      email: "invitee@example.test", role: "viewer", expires_in_hours: 48,
    }, "req-create-concurrent");
    const publicToken = await tokenContext(created.token);
    const attempts = await Promise.allSettled([
      repository.acceptInvitation({ userId: "user-4", ...publicToken }, "req-concurrent-a"),
      repository.acceptInvitation({ userId: "user-4", ...publicToken }, "req-concurrent-b"),
    ]);
    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter((attempt) => attempt.status === "rejected")).toHaveLength(1);
    expect((attempts.find((attempt) => attempt.status === "rejected") as PromiseRejectedResult).reason)
      .toMatchObject({ code: "INVITATION_UNAVAILABLE" });
    expect(await db.prepare(
      "SELECT status, consumed_at, consumed_by_user_id, consumption_id FROM workspace_invitations WHERE id = ?",
    ).bind(created.invitation.id).first()).toMatchObject({
      status: "accepted", consumed_at: now, consumed_by_user_id: "user-4", consumption_id: expect.any(String),
    });
  });

  it("expires stale invitations before re-inviting and blocks revoked or email-mismatched acceptance", async () => {
    const { db, repository, setNow, tokenContext } = await setup();
    await db.batch([
      db.prepare("INSERT INTO users (id, email, password_hash, display_name, status, created_at, updated_at) VALUES ('user-4', 'invitee@example.test', 'hash', 'Invitee', 'active', ?, ?)").bind(now, now),
      db.prepare("INSERT INTO users (id, email, password_hash, display_name, status, created_at, updated_at) VALUES ('user-5', 'other@example.test', 'hash', 'Other', 'active', ?, ?)").bind(now, now),
    ]);
    const expired = await repository.createInvitation(owner, {
      email: "invitee@example.test", role: "viewer", expires_in_hours: 1,
    }, "req-expiring");
    const expiredToken = await tokenContext(expired.token);
    await expect(repository.acceptInvitation({ userId: "user-5", ...expiredToken }, "req-wrong-email"))
      .rejects.toMatchObject({ code: "INVITATION_UNAVAILABLE" });
    setNow("2026-08-22T02:00:00.000Z");
    const replacement = await repository.createInvitation(owner, {
      email: "invitee@example.test", role: "editor", expires_in_hours: 24,
    }, "req-replacement");
    expect(replacement.invitation.id).not.toBe(expired.invitation.id);
    expect(await db.prepare("SELECT status FROM workspace_invitations WHERE id = ?").bind(expired.invitation.id).first())
      .toEqual({ status: "expired" });
    await repository.revokeInvitation(owner, replacement.invitation.id, 1, "req-revoke-invite");
    await expect(repository.acceptInvitation({ userId: "user-4", ...await tokenContext(replacement.token) }, "req-revoked"))
      .rejects.toMatchObject({ code: "INVITATION_UNAVAILABLE" });
  });

  it("enforces reserved member quota, expiry, and owner-only role management", async () => {
    const { db, repository } = await setup();
    await expect(repository.createInvitation(editor, { email: "x@example.test", role: "viewer", expires_in_hours: 24 }, "req-denied"))
      .rejects.toMatchObject({ code: "MEMBER_MANAGEMENT_DENIED" });
    await db.prepare("INSERT INTO workspace_quotas (workspace_id, quota_key, limit_value, updated_at) VALUES ('ws-1', 'members', 3, ?)").bind(now).run();
    await expect(repository.createInvitation(owner, { email: "full@example.test", role: "viewer", expires_in_hours: 24 }, "req-full"))
      .rejects.toMatchObject({ code: "MEMBER_QUOTA_EXCEEDED" });

    await expect(repository.updateMemberRole(owner, "user-2", { role: "viewer", base_revision: 1 }, "req-role"))
      .resolves.toMatchObject({ user_id: "user-2", role: "viewer", revision: 2 });
    await expect(repository.updateMemberRole(owner, "user-1", { role: "viewer", base_revision: 1 }, "req-owner"))
      .rejects.toMatchObject({ code: "LAST_OWNER_REQUIRED" });
    await expect(repository.removeMember(owner, "user-3", 1, "req-remove")).resolves.toEqual({ user_id: "user-3" });
    await expect(repository.listMembers(viewer)).resolves.toHaveLength(2);
  });

  it("supports ownership transfer while protecting the last owner with a database guard", async () => {
    const { repository } = await setup();
    await expect(repository.updateMemberRole(owner, "user-1", { role: "viewer", base_revision: 1 }, "req-last-owner"))
      .rejects.toMatchObject({ code: "LAST_OWNER_REQUIRED" });
    await expect(repository.updateMemberRole(owner, "user-2", { role: "owner", base_revision: 1 }, "req-promote"))
      .resolves.toMatchObject({ role: "owner", revision: 2 });
    await expect(repository.updateMemberRole(owner, "user-1", { role: "viewer", base_revision: 1 }, "req-transfer"))
      .resolves.toMatchObject({ role: "viewer", revision: 2 });
    const ownerTwo = { ...owner, userId: "user-2" };
    await expect(repository.removeMember(ownerTwo, "user-2", 2, "req-remove-last"))
      .rejects.toMatchObject({ code: "LAST_OWNER_REQUIRED" });
  });

  it("aborts guarded invitation and membership batches before success side effects on stale CAS", async () => {
    const state = await setup();
    const invitation = await state.repository.createInvitation(owner, {
      email: "stale@example.test", role: "viewer", expires_in_hours: 24,
    }, "req-stale-create");
    const staleInvitationRepository = state.createRepository(beforeFirstBatch(state.db, () => state.db.prepare(
      "UPDATE workspace_invitations SET revision = 2 WHERE id = ?",
    ).bind(invitation.invitation.id).run()));
    await expect(staleInvitationRepository.revokeInvitation(
      owner, invitation.invitation.id, 1, "req-stale-invitation",
    )).rejects.toMatchObject({ code: "INVITATION_CONFLICT" });
    await expectNoSuccessSideEffects(state.db, "req-stale-invitation");

    const staleRoleRepository = state.createRepository(beforeFirstBatch(state.db, () => state.db.prepare(
      "UPDATE workspace_members SET revision = 2 WHERE workspace_id = 'ws-1' AND user_id = 'user-2'",
    ).run()));
    await expect(staleRoleRepository.updateMemberRole(
      owner, "user-2", { role: "viewer", base_revision: 1 }, "req-stale-role",
    )).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    await expectNoSuccessSideEffects(state.db, "req-stale-role");

    const staleRemoveRepository = state.createRepository(beforeFirstBatch(state.db, () => state.db.prepare(
      "UPDATE workspace_members SET revision = 2 WHERE workspace_id = 'ws-1' AND user_id = 'user-3'",
    ).run()));
    await expect(staleRemoveRepository.removeMember(
      owner, "user-3", 1, "req-stale-remove",
    )).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    await expectNoSuccessSideEffects(state.db, "req-stale-remove");
    expect(await state.db.prepare(
      "SELECT revision FROM workspace_members WHERE workspace_id = 'ws-1' AND user_id = 'user-3'",
    ).first()).toEqual({ revision: 2 });
  });

  it("dispatches a committed membership revocation epoch and isolates callback failure", async () => {
    const state = await setup();
    const revoke = vi.fn(async () => undefined);
    const repository = state.createRepository(state.db, { presence: { revoke } });
    await expect(repository.removeMember(owner, "user-3", 1, "req-presence-revoke"))
      .resolves.toEqual({ user_id: "user-3" });
    expect(revoke).toHaveBeenCalledWith({
      workspaceId: "ws-1", userId: "user-3", membershipEpoch: 2,
    });

    const rejecting = state.createRepository(state.db, {
      presence: { revoke: vi.fn(async () => { throw new Error("presence unavailable"); }) },
    });
    await expect(rejecting.removeMember(owner, "user-2", 1, "req-presence-revoke-failure"))
      .resolves.toEqual({ user_id: "user-2" });
    expect(await state.db.prepare(
      "SELECT COUNT(*) AS count FROM workspace_members WHERE workspace_id = 'ws-1' AND user_id IN ('user-2', 'user-3')",
    ).first()).toEqual({ count: 0 });
  });
});

describe("D1CollaborationRepository comments and notifications", () => {
  it("atomically creates current-member mentions and idempotent personal notifications", async () => {
    const { db, repository } = await setup();
    const input = {
      target_type: "note",
      target_id: "note-1",
      body: "Please review",
      mention_user_ids: ["user-3"],
      idempotency_key: "comment-op-1",
    };
    const first = await repository.createComment(editor, input, "req-comment");
    const replay = await repository.createComment(editor, input, "req-comment-replay");
    expect(replay.id).toBe(first.id);
    expect(await db.prepare("SELECT COUNT(*) AS count FROM comments WHERE workspace_id = 'ws-1'").first<{ count: number }>()).toEqual({ count: 1 });
    expect(await db.prepare("SELECT COUNT(*) AS count FROM mentions WHERE workspace_id = 'ws-1'").first<{ count: number }>()).toEqual({ count: 1 });
    expect(await db.prepare("SELECT COUNT(*) AS count FROM notifications WHERE workspace_id = 'ws-1' AND user_id = 'user-3'").first<{ count: number }>()).toEqual({ count: 1 });

    await expect(repository.createComment(editor, { ...input, idempotency_key: "comment-op-2", mention_user_ids: ["missing-user"] }, "req-invalid"))
      .rejects.toMatchObject({ code: "MENTION_TARGET_INVALID" });
    await expect(repository.createComment(viewer, { ...input, idempotency_key: "comment-op-3" }, "req-viewer"))
      .rejects.toMatchObject({ code: "COMMENT_WRITE_DENIED" });
    await expect(repository.createComment(ownerWs2, { ...input, idempotency_key: "comment-op-ws2" }, "req-cross-workspace"))
      .rejects.toMatchObject({ code: "COMMENT_TARGET_NOT_FOUND" });
  });

  it("requires comment parents to belong to the same workspace target", async () => {
    const { repository } = await setup();
    const parent = await repository.createComment(editor, {
      target_type: "note", target_id: "note-1", body: "Parent", mention_user_ids: [], idempotency_key: "parent-1",
    }, "req-parent");
    await expect(repository.createComment(ownerWs2, {
      target_type: "database_record", target_id: "missing", parent_id: parent.id, body: "Cross tenant child",
      mention_user_ids: [], idempotency_key: "child-cross-tenant",
    }, "req-cross-parent")).rejects.toMatchObject({ code: "COMMENT_TARGET_NOT_FOUND" });
    await expect(repository.createComment(editor, {
      target_type: "note", target_id: "note-1", parent_id: "missing-parent", body: "Missing parent",
      mention_user_ids: [], idempotency_key: "child-missing-parent",
    }, "req-missing-parent")).rejects.toMatchObject({ code: "COMMENT_PARENT_INVALID" });
  });

  it("scopes comment idempotency by actor and rejects mismatched or deleted replays", async () => {
    const { db, repository } = await setup();
    const input = {
      target_type: "note",
      target_id: "note-1",
      body: "Original",
      mention_user_ids: ["user-3"],
      idempotency_key: "actor-operation",
    };
    const first = await repository.createComment(editor, input, "req-idempotent-first");
    await expect(repository.createComment(editor, {
      ...input, body: "Different",
    }, "req-idempotent-mismatch")).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT", status: 409 });

    const otherActor = await repository.createComment(owner, {
      ...input, body: "Owner operation", mention_user_ids: [],
    }, "req-idempotent-other-actor");
    expect(otherActor.id).not.toBe(first.id);

    await repository.deleteComment(editor, first.id, first.revision, "req-idempotent-delete");
    await expect(repository.createComment(editor, input, "req-idempotent-tombstone"))
      .rejects.toMatchObject({ code: "IDEMPOTENCY_TOMBSTONE", status: 409 });
    expect(await db.prepare(
      "SELECT COUNT(*) AS count FROM comments WHERE workspace_id = 'ws-1' AND idempotency_key = 'actor-operation'",
    ).first()).toEqual({ count: 2 });
    await expectNoSuccessSideEffects(db, "req-idempotent-mismatch");
    await expectNoSuccessSideEffects(db, "req-idempotent-tombstone");
  });

  it("rolls back comment creation when mentioned membership is removed after preflight", async () => {
    const state = await setup();
    const racingRepository = state.createRepository(beforeFirstBatch(state.db, () => state.db.prepare(
      "DELETE FROM workspace_members WHERE workspace_id = 'ws-1' AND user_id = 'user-3'",
    ).run()));
    await expect(racingRepository.createComment(editor, {
      target_type: "note", target_id: "note-1", body: "Racing mention",
      mention_user_ids: ["user-3"], idempotency_key: "membership-race-create",
    }, "req-membership-race-create")).rejects.toMatchObject({ code: "MENTION_TARGET_INVALID" });
    expect(await state.db.prepare(
      "SELECT COUNT(*) AS count FROM comments WHERE idempotency_key = 'membership-race-create'",
    ).first()).toEqual({ count: 0 });
    expect(await state.db.prepare(
      "SELECT COUNT(*) AS count FROM mentions WHERE mentioned_user_id = 'user-3'",
    ).first()).toEqual({ count: 0 });
    expect(await state.db.prepare(
      "SELECT COUNT(*) AS count FROM notifications WHERE user_id = 'user-3'",
    ).first()).toEqual({ count: 0 });
    await expectNoSuccessSideEffects(state.db, "req-membership-race-create");
  });

  it("aborts stale comment update and delete batches before mentions or success logs", async () => {
    const state = await setup();
    const updateTarget = await state.repository.createComment(editor, {
      target_type: "note", target_id: "note-1", body: "Update target",
      mention_user_ids: [], idempotency_key: "stale-comment-update",
    }, "req-stale-comment-seed-update");
    const staleUpdateRepository = state.createRepository(beforeFirstBatch(state.db, () => state.db.prepare(
      "UPDATE comments SET body = 'Concurrent', revision = revision + 1 WHERE id = ?",
    ).bind(updateTarget.id).run()));
    await expect(staleUpdateRepository.updateComment(editor, updateTarget.id, {
      body: "Stale", mention_user_ids: ["user-3"], base_revision: 1,
    }, "req-stale-comment-update")).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    expect(await state.db.prepare(
      "SELECT COUNT(*) AS count FROM mentions WHERE comment_id = ?",
    ).bind(updateTarget.id).first()).toEqual({ count: 0 });
    expect(await state.db.prepare(
      "SELECT COUNT(*) AS count FROM notifications WHERE dedupe_key LIKE ?",
    ).bind(`comment:${updateTarget.id}:%`).first()).toEqual({ count: 0 });
    await expectNoSuccessSideEffects(state.db, "req-stale-comment-update");

    const deleteTarget = await state.repository.createComment(editor, {
      target_type: "note", target_id: "note-1", body: "Delete target",
      mention_user_ids: [], idempotency_key: "stale-comment-delete",
    }, "req-stale-comment-seed-delete");
    const staleDeleteRepository = state.createRepository(beforeFirstBatch(state.db, () => state.db.prepare(
      "UPDATE comments SET deleted_at = ?, revision = revision + 1 WHERE id = ?",
    ).bind(now, deleteTarget.id).run()));
    await expect(staleDeleteRepository.deleteComment(
      editor, deleteTarget.id, 1, "req-stale-comment-delete",
    )).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    await expectNoSuccessSideEffects(state.db, "req-stale-comment-delete");
  });

  it("dispatches comment invalidation only after a successful commit and isolates failure", async () => {
    const state = await setup();
    const invalidate = vi.fn(async () => undefined);
    const repository = state.createRepository(state.db, { presence: { invalidate } });
    const comment = await repository.createComment(editor, {
      target_type: "note", target_id: "note-1", body: "Presence",
      mention_user_ids: [], idempotency_key: "presence-comment",
    }, "req-presence-comment");
    expect(invalidate).toHaveBeenLastCalledWith({
      workspaceId: "ws-1", entityType: "comment", entityId: comment.id, revision: 1,
    });

    const rejecting = state.createRepository(state.db, {
      presence: { invalidate: vi.fn(async () => { throw new Error("presence unavailable"); }) },
    });
    await expect(rejecting.updateComment(editor, comment.id, {
      body: "Presence updated", mention_user_ids: [], base_revision: 1,
    }, "req-presence-comment-update")).resolves.toMatchObject({ revision: 2 });

    const staleInvalidate = vi.fn(async () => undefined);
    const staleRepository = state.createRepository(beforeFirstBatch(state.db, () => state.db.prepare(
      "UPDATE comments SET revision = revision + 1 WHERE id = ?",
    ).bind(comment.id).run()), { presence: { invalidate: staleInvalidate } });
    await expect(staleRepository.deleteComment(editor, comment.id, 2, "req-presence-comment-stale"))
      .rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    expect(staleInvalidate).not.toHaveBeenCalled();
  });

  it("paginates the personal inbox and restricts revisioned read mutations to its owner", async () => {
    const { repository } = await setup();
    for (let index = 0; index < 3; index += 1) {
      await repository.createComment(editor, {
        target_type: "note",
        target_id: "note-1",
        body: `Message ${index}`,
        mention_user_ids: ["user-3"],
        idempotency_key: `comment-op-${index}`,
      }, `req-${index}`);
    }
    const first = await repository.listNotifications(viewer, { limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.next_cursor).toEqual(expect.any(String));
    const second = await repository.listNotifications(viewer, { limit: 2, cursor: first.next_cursor });
    expect(second.items).toHaveLength(1);
    expect(new Set([...first.items, ...second.items].map((item: { id: string }) => item.id)).size).toBe(3);
    expect(await repository.unreadCount(viewer)).toEqual({ unread_count: 3 });
    await expect(repository.readNotifications(editor, {
      notification_ids: [first.items[0].id],
      base_revisions: { [first.items[0].id]: 1 },
    })).rejects.toMatchObject({ code: "NOTIFICATION_NOT_FOUND" });
    await repository.readNotifications(viewer, {
      notification_ids: first.items.map((item: { id: string }) => item.id),
      base_revisions: Object.fromEntries(first.items.map((item: { id: string; revision: number }) => [item.id, item.revision])),
    });
    expect(await repository.unreadCount(viewer)).toEqual({ unread_count: 1 });
    const remaining = second.items[0];
    const concurrentReads = await Promise.allSettled([
      repository.readNotifications(viewer, {
        notification_ids: [remaining.id], base_revisions: { [remaining.id]: remaining.revision },
      }),
      repository.readNotifications(viewer, {
        notification_ids: [remaining.id], base_revisions: { [remaining.id]: remaining.revision },
      }),
    ]);
    expect(concurrentReads.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    expect(concurrentReads.filter((attempt) => attempt.status === "rejected")).toHaveLength(1);
    expect((concurrentReads.find((attempt) => attempt.status === "rejected") as PromiseRejectedResult).reason)
      .toMatchObject({ code: "REVISION_CONFLICT" });
    expect(await repository.readAllNotifications(viewer)).toMatchObject({ count: 0, read_at: now });
    await expect(repository.listNotifications(viewer, { limit: 2, cursor: "%".repeat(2_000) }))
      .rejects.toMatchObject({ code: "INVALID_CURSOR" });
  });
});

describe("D1CollaborationRepository audit and public shares", () => {
  it("records request-correlated redacted activity and immutable audit entries", async () => {
    const { repository } = await setup();
    await repository.updateMemberRole(owner, "user-2", { role: "viewer", base_revision: 1 }, "req-audit");
    const activity = await repository.listActivity(owner, { limit: 10 });
    const audit = await repository.listAudit(owner, { limit: 10 });
    expect(activity.items[0]).toMatchObject({ request_id: "req-audit", action: "member.role_changed", target_id: "user-2" });
    expect(audit.items[0]).toMatchObject({ request_id: "req-audit", action: "member.role_changed", outcome: "success" });
    expect(JSON.stringify(audit.items[0].metadata)).not.toMatch(/token|password|content|cookie|code/iu);
    await expect(repository.listAudit(editor, { limit: 10 })).rejects.toMatchObject({ code: "AUDIT_READ_DENIED" });
    expect((await repository.listActivity(ownerWs2, { limit: 10 })).items).toHaveLength(0);
    expect((await repository.listAudit(ownerWs2, { limit: 10 })).items).toHaveLength(0);

    await repository.appendActivityAndAudit(owner, {
      request_id: "req-explicit-audit", action: "security.checked", target_type: "workspace", target_id: "ws-1",
      outcome: "success", metadata: { count: 2, content: "private", token_hash: "private" },
    });
    const explicit = (await repository.listAudit(owner, { limit: 10 })).items
      .find((entry: { request_id: string }) => entry.request_id === "req-explicit-audit");
    expect(explicit?.metadata).toEqual({ count: 2 });
  });

  it("uses salted PBKDF2, POST-body credentials, and returns only public note fields", async () => {
    const { db, repository, tokenContext } = await setup();
    const created = await repository.createPublicShare(editor, {
      entity_type: "note",
      entity_id: "note-1",
      password: "review-only",
      expires_in_hours: 24,
    }, "req-share");
    const stored = await db.prepare("SELECT token_hash, password_hash FROM public_shares WHERE id = ?")
      .bind(created.share.id).first<{ token_hash: string; password_hash: string }>();
    expect(stored?.token_hash).toBe(`hash:${created.token}`);
    expect(stored?.password_hash).toMatch(/^pbkdf2_sha256\$1000\$/);
    expect(stored?.password_hash).not.toContain("review-only");

    const publicToken = await tokenContext(created.token);
    await expect(repository.accessPublicShare(publicToken, { password: "wrong-password" }, "req-share-denied"))
      .rejects.toMatchObject({ code: "PUBLIC_SHARE_PASSWORD_INVALID" });
    const publicContent = await repository.accessPublicShare(publicToken, { password: "review-only" }, "req-share-read");
    expect(publicContent).toEqual({
      share_id: created.share.id,
      entity_type: "note",
      title: "Shared plan",
      content: "Private body",
      revision: 3,
      updated_at: now,
    });
    expect(publicContent).not.toHaveProperty("workspace_id");
    expect(publicContent).not.toHaveProperty("attachments");
    expect(publicContent).not.toHaveProperty("comments");
    expect(publicContent).not.toHaveProperty("audit");

    const attempts = await db.prepare(
      "SELECT action, outcome, metadata_json FROM audit_logs WHERE target_id = ? AND action LIKE 'public_share.%' ORDER BY created_at, id",
    ).bind(created.share.id).all<{ action: string; outcome: string; metadata_json: string }>();
    expect(attempts.results).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: "public_share.password_attempt", outcome: "denied" }),
      expect.objectContaining({ action: "public_share.password_attempt", outcome: "success" }),
      expect.objectContaining({ action: "public_share.accessed", outcome: "success" }),
    ]));
    expect(JSON.stringify(attempts.results)).not.toContain("wrong-password");
    expect(JSON.stringify(attempts.results)).not.toContain("review-only");
    expect(JSON.stringify(attempts.results)).not.toContain(created.token);

    await repository.revokePublicShare(editor, created.share.id, created.share.revision, "req-revoke");
    await expect(repository.accessPublicShare(publicToken, { password: "review-only" }, "req-revoked-read"))
      .rejects.toMatchObject({ code: "PUBLIC_SHARE_UNAVAILABLE" });
  });

  it("isolates share metadata by workspace and computes expiry without exposing private hashes", async () => {
    const { repository, setNow } = await setup();
    const created = await repository.createPublicShare(editor, {
      entity_type: "note", entity_id: "note-1", expires_in_hours: 1,
    }, "req-expiring-share");
    await expect(repository.listPublicShares(viewer)).rejects.toMatchObject({ code: "SHARE_READ_DENIED" });
    await expect(repository.listPublicShares(ownerWs2)).resolves.toEqual([]);
    expect((await repository.listPublicShares(owner))[0]).not.toHaveProperty("token_hash");
    setNow("2026-08-22T02:00:00.000Z");
    expect((await repository.listPublicShares(owner))[0]).toMatchObject({ id: created.share.id, status: "expired" });
    await expect(repository.createPublicShare(ownerWs2, { entity_type: "note", entity_id: "note-1" }, "req-cross-share"))
      .rejects.toMatchObject({ code: "SHARE_TARGET_NOT_FOUND" });
  });

  it("aborts stale share revocation before success activity or audit", async () => {
    const state = await setup();
    const created = await state.repository.createPublicShare(editor, {
      entity_type: "note", entity_id: "note-1",
    }, "req-stale-share-create");
    const staleRepository = state.createRepository(beforeFirstBatch(state.db, () => state.db.prepare(
      "UPDATE public_shares SET revision = 2 WHERE id = ?",
    ).bind(created.share.id).run()));
    await expect(staleRepository.revokePublicShare(
      editor, created.share.id, 1, "req-stale-share-revoke",
    )).rejects.toMatchObject({ code: "SHARE_CONFLICT" });
    await expectNoSuccessSideEffects(state.db, "req-stale-share-revoke");
  });
});
