import { afterEach, describe, expect, it, vi } from "vitest";

import { createTestD1, seedTenants } from "./helpers/d1";

const now = "2026-08-22T00:00:00.000Z";
const secret = "presence-route-secret-at-least-32-characters";
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
      "INSERT INTO workspace_members (workspace_id, user_id, role, revision, joined_at, updated_at) VALUES ('ws-1', 'user-1', 'owner', 1, ?, ?)",
    ).bind(now, now),
    testDb.db.prepare(
      `INSERT INTO notes
       (id, workspace_id, created_by, updated_by, title, content, status, revision, created_at, updated_at)
       VALUES ('note-1', 'ws-1', 'user-1', 'user-1', 'Draft', 'Body', 'active', 1, ?, ?)`,
    ).bind(now, now),
  ]);
  const worker = await import("../src/index") as Record<string, any>;
  expect(worker.registerPresenceRoute).toBeTypeOf("function");
  if (typeof worker.registerPresenceRoute !== "function") return { worker, db: testDb.db };
  const rawSession = "session-token";
  const authTokens = new worker.SecureTokenService(`auth:${secret}`);
  const tokenHash = await authTokens.hash(rawSession);
  await testDb.db.prepare(
    "INSERT INTO sessions (id, user_id, token_hash, expires_at, last_seen_at, created_at) VALUES ('session-1', 'user-1', ?, '2026-08-23T00:00:00.000Z', ?, ?)",
  ).bind(tokenHash, now, now).run();
  return { worker, db: testDb.db, rawSession };
}

function presenceRequest(session: string) {
  return new Request("https://beta.test/api/v2/presence", {
    headers: {
      cookie: `nexus_session=${session}`,
      upgrade: "websocket",
      "x-workspace-id": "ws-1",
    },
  });
}

describe("authenticated Presence proxy", () => {
  it("verifies current membership and forwards only signed derived identity headers", async () => {
    const state = await setup();
    if (!("rawSession" in state)) return;
    let forwarded: Request | undefined;
    const room = { fetch: vi.fn(async (request: Request) => {
      forwarded = request;
      return new Response(null, { status: 204 });
    }) };
    const namespace = { idFromName: vi.fn(() => "room-ws-1"), get: vi.fn(() => room) };
    const betaWorker = state.worker.createBetaWorker();
    const response = await betaWorker.fetch(presenceRequest(state.rawSession), {
      DB: state.db, PRESENCE: namespace, APP_BASE_URL: "https://beta.test", RATE_LIMIT_SECRET: secret,
      TURNSTILE_SECRET_KEY: "turnstile", RESEND_API_KEY: "resend", EMAIL_FROM: "Nexus <nexus@example.test>",
    });

    expect(response.status).toBe(204);
    expect(namespace.idFromName).toHaveBeenCalledWith("ws-1");
    expect(forwarded?.headers.get("x-presence-workspace-id")).toBe("ws-1");
    expect(forwarded?.headers.get("x-presence-user-id")).toBe("user-1");
    expect(forwarded?.headers.get("x-presence-display-name")).toBe("One");
    expect(forwarded?.headers.get("x-presence-signature")).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(forwarded?.headers.get("cookie")).toBeNull();

    await state.db.prepare("DELETE FROM workspace_members WHERE workspace_id = 'ws-1' AND user_id = 'user-1'").run();
    const denied = await betaWorker.fetch(presenceRequest(state.rawSession), {
      DB: state.db, PRESENCE: namespace, APP_BASE_URL: "https://beta.test", RATE_LIMIT_SECRET: secret,
      TURNSTILE_SECRET_KEY: "turnstile", RESEND_API_KEY: "resend", EMAIL_FROM: "Nexus <nexus@example.test>",
    });
    expect(denied.status).toBe(403);
    expect(room.fetch).toHaveBeenCalledOnce();
  });

  it("degrades missing or throwing DO bindings without affecting D1 editing routes", async () => {
    const state = await setup();
    if (!("rawSession" in state)) return;
    const betaWorker = state.worker.createBetaWorker();
    const baseEnv = {
      DB: state.db, APP_BASE_URL: "https://beta.test", RATE_LIMIT_SECRET: secret,
      TURNSTILE_SECRET_KEY: "turnstile", RESEND_API_KEY: "resend", EMAIL_FROM: "Nexus <nexus@example.test>",
    };
    const missing = await betaWorker.fetch(presenceRequest(state.rawSession), baseEnv);
    expect(missing.status).toBe(503);
    expect(await missing.json()).toMatchObject({ error: { code: "PRESENCE_UNAVAILABLE", retryable: true } });

    const throwing = await betaWorker.fetch(presenceRequest(state.rawSession), {
      ...baseEnv,
      PRESENCE: { idFromName: () => "room", get: () => ({ fetch: async () => { throw new Error("DO offline"); } }) },
    });
    expect(throwing.status).toBe(503);

    const note = await betaWorker.fetch(new Request("https://beta.test/api/v2/notes/note-1", {
      headers: { cookie: `nexus_session=${state.rawSession}`, "x-workspace-id": "ws-1" },
    }), baseEnv);
    expect(note.status).toBe(200);
    expect(await note.json()).toMatchObject({ data: { note: { id: "note-1", content: "Body" } } });
  });
});
