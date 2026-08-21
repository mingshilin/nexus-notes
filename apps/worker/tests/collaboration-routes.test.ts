import { afterEach, describe, expect, it } from "vitest";

import type { WorkspaceContext } from "@nexus/contracts";
import { createTestD1, seedTenants } from "./helpers/d1";

const now = "2026-08-22T00:00:00.000Z";
const secret = "route-security-secret-at-least-32-characters";
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
      "INSERT INTO users (id, email, password_hash, display_name, status, created_at, updated_at) VALUES ('user-4', 'invitee@example.test', 'hash', 'Invitee', 'active', ?, ?)",
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
      `INSERT INTO notes
       (id, workspace_id, created_by, updated_by, title, content, status, revision, created_at, updated_at)
       VALUES ('note-1', 'ws-1', 'user-1', 'user-1', 'Shared plan', 'Public body', 'active', 3, ?, ?)`,
    ).bind(now, now),
  ]);

  const worker = await import("../src/index") as Record<string, any>;
  expect(worker.registerCollaborationRoutes).toBeTypeOf("function");
  if (typeof worker.registerCollaborationRoutes !== "function") return { worker, db: testDb.db };

  const tokens = new worker.SecureTokenService(`collaboration:${secret}`);
  let currentTime = new Date(now);
  const repository = new worker.D1CollaborationRepository(testDb.db, {
    tokens,
    password: new worker.WebCryptoPasswordHasher({ iterations: 1_000 }),
    clock: () => new Date(currentTime),
    memberLimit: 5,
  });
  const registry = worker.createRouteRegistry({
    requestId: () => "req-route",
    authenticate: async ({ request }: { request: Request }) => {
      const userId = request.headers.get("x-test-user");
      return userId ? { userId, sessionId: `session-${userId}` } : null;
    },
    authorizeWorkspace: async (principal: { userId: string }, workspaceId: string) => {
      const row = await testDb.db.prepare(
        "SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?",
      ).bind(workspaceId, principal.userId).first<{ role: WorkspaceContext["role"] }>();
      return row ? { workspaceId, userId: principal.userId, role: row.role, capabilities: new Set() } : null;
    },
  });
  worker.registerCollaborationRoutes(registry, {
    createRepository: () => repository,
    hashToken: (_env: unknown, token: string) => tokens.hash(token),
    consumePublicSharePasswordAttempt: async () => undefined,
  });
  return {
    worker,
    db: testDb.db,
    repository,
    registry,
    setNow(value: string) { currentTime = new Date(value); },
  };
}

function request(path: string, options: { method?: string; userId?: string; body?: unknown; ip?: string } = {}) {
  const headers = new Headers({ "x-workspace-id": "ws-1" });
  if (options.userId) headers.set("x-test-user", options.userId);
  if (options.ip) headers.set("cf-connecting-ip", options.ip);
  if (options.body !== undefined) headers.set("content-type", "application/json");
  return new Request(`https://beta.test${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

describe("v2 collaboration routes", () => {
  it("registers invitation and member routes with role, replay, expiry, quota, and request-id semantics", async () => {
    const state = await setup();
    if (!("registry" in state)) return;

    const denied = await state.registry.fetch(request("/api/v2/invitations", {
      method: "POST", userId: "user-2", body: { email: "invitee@example.test", role: "viewer", expires_in_hours: 24 },
    }), {});
    expect(denied.status).toBe(403);

    const created = await state.registry.fetch(request("/api/v2/invitations", {
      method: "POST", userId: "user-1", body: { email: "invitee@example.test", role: "editor", expires_in_hours: 24 },
    }), {});
    const createdBody = await created.json() as any;
    expect(created.status).toBe(201);
    expect(createdBody).toMatchObject({ success: true, request_id: "req-route", data: { invitation: { status: "pending" } } });
    expect(createdBody.data.token).toMatch(/^[A-Za-z0-9_-]{43}$/u);

    const preview = await state.registry.fetch(request("/api/v2/invitations/preview", {
      method: "POST", body: { token: createdBody.data.token },
    }), {});
    expect(await preview.json()).toMatchObject({ success: true, data: { invitation: { workspace_name: "One" } } });

    const accepted = await state.registry.fetch(request("/api/v2/invitations/accept", {
      method: "POST", userId: "user-4", body: { token: createdBody.data.token },
    }), {});
    expect(await accepted.json()).toMatchObject({ success: true, data: { member: { user_id: "user-4", role: "editor" } } });
    const replay = await state.registry.fetch(request("/api/v2/invitations/accept", {
      method: "POST", userId: "user-4", body: { token: createdBody.data.token },
    }), {});
    expect(replay.status).toBe(410);

    const members = await state.registry.fetch(request("/api/v2/members", { userId: "user-3" }), {});
    expect((await members.json() as any).data.items).toHaveLength(4);
    const transfer = await state.registry.fetch(request("/api/v2/members/user-2/ownership", {
      method: "POST", userId: "user-1", body: { base_revision: 1 },
    }), {});
    expect(await transfer.json()).toMatchObject({ success: true, data: { member: { role: "owner", revision: 2 } } });

    await state.db.prepare(
      "INSERT INTO workspace_quotas (workspace_id, quota_key, limit_value, updated_at) VALUES ('ws-1', 'members', 4, ?)",
    ).bind(now).run();
    const quota = await state.registry.fetch(request("/api/v2/invitations", {
      method: "POST", userId: "user-1", body: { email: "full@example.test", role: "viewer", expires_in_hours: 1 },
    }), {});
    expect(quota.status).toBe(403);
    expect(await quota.json()).toMatchObject({ error: { code: "MEMBER_QUOTA_EXCEEDED" } });
  });

  it("routes note and database-record comments through member mention and idempotent notification policies", async () => {
    const state = await setup();
    if (!("registry" in state)) return;

    const input = {
      target_type: "note", target_id: "note-1", body: "Please review",
      mention_user_ids: ["user-3"], idempotency_key: "route-comment-1",
    };
    const first = await state.registry.fetch(request("/api/v2/comments", { method: "POST", userId: "user-2", body: input }), {});
    const replay = await state.registry.fetch(request("/api/v2/comments", { method: "POST", userId: "user-2", body: input }), {});
    const firstBody = await first.json() as any;
    expect(first.status).toBe(201);
    expect((await replay.json() as any).data.comment.id).toBe(firstBody.data.comment.id);

    const invalidMention = await state.registry.fetch(request("/api/v2/comments", {
      method: "POST", userId: "user-2", body: { ...input, idempotency_key: "route-comment-2", mention_user_ids: ["missing"] },
    }), {});
    expect(invalidMention.status).toBe(400);
    expect(await invalidMention.json()).toMatchObject({ error: { code: "MENTION_TARGET_INVALID" } });

    const inbox = await state.registry.fetch(request("/api/v2/notifications?limit=10", { userId: "user-3" }), {});
    const inboxBody = await inbox.json() as any;
    expect(inboxBody.data.items).toHaveLength(1);
    const notification = inboxBody.data.items[0];
    const foreignRead = await state.registry.fetch(request(`/api/v2/notifications/${notification.id}/read`, {
      method: "POST", userId: "user-2", body: { base_revision: notification.revision },
    }), {});
    expect(foreignRead.status).toBe(404);
    const ownRead = await state.registry.fetch(request(`/api/v2/notifications/${notification.id}/read`, {
      method: "POST", userId: "user-3", body: { base_revision: notification.revision },
    }), {});
    expect(ownRead.status).toBe(200);
    const unread = await state.registry.fetch(request("/api/v2/notifications/unread", { userId: "user-3" }), {});
    expect(await unread.json()).toMatchObject({ data: { unread_count: 0 } });
  });

  it("returns owner-only redacted audit pages and authenticated share summaries", async () => {
    const state = await setup();
    if (!("registry" in state)) return;
    await state.repository.appendActivityAndAudit({
      workspaceId: "ws-1", userId: "user-1", role: "owner", capabilities: new Set(),
    }, {
      request_id: "req-safe", action: "security.checked", target_type: "workspace", target_id: "ws-1",
      outcome: "success", metadata: { token: "secret", reason: "policy" },
    });

    const activity = await state.registry.fetch(request("/api/v2/activity?limit=10", { userId: "user-2" }), {});
    expect((await activity.json() as any).data.items[0].metadata).toEqual({ reason: "policy" });
    const deniedAudit = await state.registry.fetch(request("/api/v2/audit", { userId: "user-2" }), {});
    expect(deniedAudit.status).toBe(403);
    const audit = await state.registry.fetch(request("/api/v2/audit", { userId: "user-1" }), {});
    expect((await audit.json() as any).data.items[0]).toMatchObject({ request_id: "req-safe", metadata: { reason: "policy" } });

    const share = await state.registry.fetch(request("/api/v2/shares", {
      method: "POST", userId: "user-2", body: { entity_type: "note", entity_id: "note-1", password: "correct-password" },
    }), {});
    const shareBody = await share.json() as any;
    expect(share.status).toBe(201);
    expect(shareBody.data).toMatchObject({ share: { password_required: true }, token: expect.any(String) });
    const summaries = await state.registry.fetch(request("/api/v2/shares?entity_type=note&entity_id=note-1", { userId: "user-2" }), {});
    expect((await summaries.json() as any).data.items[0]).not.toHaveProperty("token_hash");
  });
});

describe("public share route isolation", () => {
  it("keeps tokens in the path, passwords in POST bodies, public fields bounded, and errors indistinguishable", async () => {
    const state = await setup();
    if (!("registry" in state)) return;
    const created = await state.registry.fetch(request("/api/v2/shares", {
      method: "POST", userId: "user-2", body: { entity_type: "note", entity_id: "note-1", password: "correct-password" },
    }), {});
    const { share, token } = (await created.json() as any).data;
    const passwordRow = await state.db.prepare("SELECT password_hash FROM public_shares WHERE id = ?")
      .bind(share.id).first<{ password_hash: string }>();
    expect(passwordRow?.password_hash).toMatch(/^pbkdf2_sha256\$1000\$/u);

    const passwordInQuery = await state.registry.fetch(request(`/api/v2/public/shares/${token}?password=correct-password`), {});
    const wrong = await state.registry.fetch(request(`/api/v2/public/shares/${token}`, {
      method: "POST", body: { password: "wrong-password" }, ip: "203.0.113.10",
    }), {});
    const missing = await state.registry.fetch(request(`/api/v2/public/shares/${"z".repeat(43)}`, {
      method: "POST", body: { password: "wrong-password" }, ip: "203.0.113.11",
    }), {});
    expect(passwordInQuery.status).toBe(404);
    expect(wrong.status).toBe(404);
    expect(missing.status).toBe(404);
    const publicError = (body: any) => ({ success: body.success, error: body.error });
    const missingError = publicError(await missing.json());
    expect(publicError(await wrong.json())).toEqual(missingError);

    const access = await state.registry.fetch(request(`/api/v2/public/shares/${token}`, {
      method: "POST", body: { password: "correct-password" }, ip: "203.0.113.12",
    }), {});
    expect(await access.json()).toEqual({
      success: true,
      data: { share_id: share.id, entity_type: "note", title: "Shared plan", content: "Public body", revision: 3, updated_at: now },
      request_id: "req-route",
    });

    const revoked = await state.registry.fetch(request(`/api/v2/shares/${share.id}`, {
      method: "DELETE", userId: "user-2", body: { base_revision: share.revision },
    }), {});
    expect(revoked.status).toBe(200);
    const unavailable = await state.registry.fetch(request(`/api/v2/public/shares/${token}`, {
      method: "POST", body: { password: "correct-password" },
    }), {});
    expect(unavailable.status).toBe(404);
    expect(publicError(await unavailable.json())).toEqual(missingError);
  });

  it("applies the default real-D1 token password-attempt limiter independently of client IP", async () => {
    const state = await setup();
    if (!("repository" in state)) return;
    const owner: WorkspaceContext = { workspaceId: "ws-1", userId: "user-1", role: "owner", capabilities: new Set() };
    const created = await state.repository.createPublicShare(owner, {
      entity_type: "note", entity_id: "note-1", password: "correct-password",
    }, "req-create-rate-limit");
    const betaWorker = state.worker.createBetaWorker();
    const env = {
      DB: state.db, APP_BASE_URL: "https://beta.test", RATE_LIMIT_SECRET: secret,
      TURNSTILE_SECRET_KEY: "turnstile", RESEND_API_KEY: "resend", EMAIL_FROM: "Nexus <nexus@example.test>",
    };
    const responses = [];
    for (let attempt = 0; attempt < 6; attempt += 1) {
      responses.push(await betaWorker.fetch(request(`/api/v2/public/shares/${created.token}`, {
        method: "POST", body: { password: "wrong-password" }, ip: `203.0.113.${attempt + 1}`,
      }), env));
    }
    expect(responses.slice(0, 5).map((response) => response.status)).toEqual([404, 404, 404, 404, 404]);
    expect(responses[5].status).toBe(429);
    expect(await responses[5].json()).toMatchObject({ error: { code: "RATE_LIMITED" } });
  });
});
