import { describe, expect, it } from "vitest";

class FakeSocket {
  attachment: unknown;
  sent: string[] = [];
  closed?: { code: number; reason: string };

  serializeAttachment(value: unknown) { this.attachment = structuredClone(value); }
  deserializeAttachment() { return structuredClone(this.attachment); }
  send(value: string) { this.sent.push(value); }
  close(code: number, reason: string) { this.closed = { code, reason }; }
}

class FakeState {
  sockets: FakeSocket[] = [];
  alarm?: number;
  acceptedTags: string[][] = [];
  stored = new Map<string, unknown>();
  storage = {
    setAlarm: async (when: number) => { this.alarm = when; },
    get: async (key: string) => structuredClone(this.stored.get(key)),
    put: async (key: string, value: unknown) => { this.stored.set(key, structuredClone(value)); },
  };

  acceptWebSocket(socket: FakeSocket, tags: string[] = []) {
    this.sockets.push(socket);
    this.acceptedTags.push(tags);
  }

  getWebSockets() {
    return this.sockets.filter((socket) => !socket.closed);
  }
}

function identityRequest(method = "GET", body?: unknown, membershipEpoch = 1) {
  return new Request("https://presence.internal/connect", {
    method,
    headers: {
      upgrade: method === "GET" ? "websocket" : "",
      "content-type": "application/json",
      "x-presence-workspace-id": "ws-1",
      "x-presence-user-id": "user-1",
      "x-presence-display-name": "One",
      "x-presence-membership-epoch": String(membershipEpoch),
      "x-presence-signature": "valid-signature",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function commandRequest(body: unknown) {
  return new Request("https://presence.internal/control", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-presence-workspace-id": "ws-1",
      "x-presence-command-signature": "valid-command-signature",
    },
    body: JSON.stringify(body),
  });
}

describe("PresenceRoom", () => {
  it("keeps bounded presence ephemeral across reconnect, heartbeat, expiry, and disconnect", async () => {
    const worker = await import("../src/index") as Record<string, any>;
    expect(worker.PresenceRoom).toBeTypeOf("function");
    if (typeof worker.PresenceRoom !== "function") return;
    const state = new FakeState();
    let now = Date.parse("2026-08-22T00:00:00.000Z");
    const pairs: Array<{ client: FakeSocket; server: FakeSocket }> = [];
    const room = new worker.PresenceRoom(state, { RATE_LIMIT_SECRET: "presence-secret-at-least-32-characters" }, {
      clock: () => new Date(now),
      verifyIdentity: async () => true,
      verifyCommand: async () => true,
      createWebSocketPair: () => {
        const pair = { client: new FakeSocket(), server: new FakeSocket() };
        pairs.push(pair);
        return pair;
      },
      createUpgradeResponse: (client: FakeSocket) => {
        const response = new Response(null, { status: 204 });
        Object.defineProperty(response, "webSocket", { value: client });
        return response;
      },
    });

    const first = await room.fetch(identityRequest());
    expect(first.status).toBe(204);
    expect(state.getWebSockets()).toHaveLength(1);
    expect(state.acceptedTags[0]).toEqual(["workspace:ws-1", "user:user-1"]);
    expect(JSON.parse(pairs[0].server.sent[0])).toMatchObject({ type: "presence.snapshot", participants: [{ user_id: "user-1" }] });

    await room.webSocketMessage(pairs[0].server, JSON.stringify({
      type: "presence.update", state: "typing", target_id: "note-1",
    }));
    expect(pairs[0].server.deserializeAttachment()).toMatchObject({ state: "typing", targetId: "note-1" });
    expect(JSON.parse(pairs[0].server.sent.at(-1)!)).toMatchObject({ type: "presence.changed", participant: { state: "typing" } });

    await room.fetch(identityRequest());
    expect(pairs[0].server.closed).toEqual({ code: 4000, reason: "Reconnected" });
    expect(state.getWebSockets()).toHaveLength(1);

    now += 46_000;
    await room.alarm();
    expect(pairs[1].server.closed).toEqual({ code: 4001, reason: "Presence expired" });
    expect(state.storage).not.toHaveProperty("participants");

    await room.fetch(identityRequest());
    const active = pairs[2].server;
    state.sockets = state.sockets.filter((socket) => socket !== active);
    await room.webSocketClose(active);
    expect(state.getWebSockets()).toHaveLength(0);
  });

  it("rejects invalid identity and authoritative or oversized messages while allowing bounded invalidation", async () => {
    const worker = await import("../src/index") as Record<string, any>;
    expect(worker.PresenceRoom).toBeTypeOf("function");
    if (typeof worker.PresenceRoom !== "function") return;
    const state = new FakeState();
    const pairs: Array<{ client: FakeSocket; server: FakeSocket }> = [];
    let identityValid = false;
    const room = new worker.PresenceRoom(state, { RATE_LIMIT_SECRET: "presence-secret-at-least-32-characters" }, {
      clock: () => new Date("2026-08-22T00:00:00.000Z"),
      verifyIdentity: async () => identityValid,
      verifyCommand: async () => identityValid,
      createWebSocketPair: () => {
        const pair = { client: new FakeSocket(), server: new FakeSocket() };
        pairs.push(pair);
        return pair;
      },
      createUpgradeResponse: (client: FakeSocket) => {
        const response = new Response(null, { status: 204 });
        Object.defineProperty(response, "webSocket", { value: client });
        return response;
      },
    });

    expect((await room.fetch(identityRequest())).status).toBe(403);
    identityValid = true;
    await room.fetch(identityRequest());
    await room.webSocketMessage(pairs[0].server, JSON.stringify({ type: "note.update", content: "authoritative" }));
    expect(pairs[0].server.closed?.code).toBe(1008);

    await room.fetch(identityRequest());
    await room.webSocketMessage(pairs[1].server, "x".repeat(4_097));
    expect(pairs[1].server.closed?.code).toBe(1009);

    await room.fetch(identityRequest());
    const invalid = await room.fetch(commandRequest({
      type: "entity.invalidated", entity_type: "note", entity_id: "note-1", revision: 4, content: "not allowed",
    }));
    expect(invalid.status).toBe(400);
    const valid = await room.fetch(commandRequest({
      type: "entity.invalidated", entity_type: "note", entity_id: "note-1", revision: 4,
    }));
    expect(valid.status).toBe(204);
    expect(JSON.parse(pairs[2].server.sent.at(-1)!)).toEqual({
      type: "entity.invalidated", entity_type: "note", entity_id: "note-1", revision: 4,
    });
  });

  it("closes revoked membership epochs and rejects stale reconnects and heartbeats", async () => {
    const worker = await import("../src/index") as Record<string, any>;
    const state = new FakeState();
    const pairs: Array<{ client: FakeSocket; server: FakeSocket }> = [];
    const room = new worker.PresenceRoom(state, { RATE_LIMIT_SECRET: "presence-secret-at-least-32-characters" }, {
      clock: () => new Date("2026-08-22T00:00:00.000Z"),
      verifyIdentity: async () => true,
      verifyCommand: async () => true,
      createWebSocketPair: () => {
        const pair = { client: new FakeSocket(), server: new FakeSocket() };
        pairs.push(pair);
        return pair;
      },
      createUpgradeResponse: (client: FakeSocket) => {
        const response = new Response(null, { status: 204 });
        Object.defineProperty(response, "webSocket", { value: client });
        return response;
      },
    });

    expect((await room.fetch(identityRequest("GET", undefined, 1))).status).toBe(204);
    const revoked = await room.fetch(commandRequest({
      type: "membership.revoked", user_id: "user-1", membership_epoch: 2,
    }));
    expect(revoked.status).toBe(204);
    expect(pairs[0].server.closed).toEqual({ code: 4003, reason: "Membership revoked" });
    expect(state.stored.get("membership-epoch:user-1")).toBe(2);
    expect((await room.fetch(identityRequest("GET", undefined, 1))).status).toBe(403);

    expect((await room.fetch(identityRequest("GET", undefined, 3))).status).toBe(204);
    state.stored.set("membership-epoch:user-1", 4);
    await room.webSocketMessage(pairs[1].server, JSON.stringify({ type: "presence.heartbeat" }));
    expect(pairs[1].server.closed).toEqual({ code: 4003, reason: "Membership revoked" });
  });
});
