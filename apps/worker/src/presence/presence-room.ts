import {
  PresenceClientMessageSchema,
  PresenceServerMessageSchema,
  PresenceParticipantSchema,
  type PresenceParticipant,
} from "@nexus/contracts";

import { SecureTokenService } from "../auth/crypto";

const CONNECTION_TTL_MS = 45_000;
const MAX_MESSAGE_BYTES = 4_096;
const encoder = new TextEncoder();

interface PresenceAttachment {
  workspaceId: string;
  userId: string;
  displayName: string;
  state: PresenceParticipant["state"];
  targetId?: string;
  expiresAt: string;
  connected: boolean;
}

interface PresenceSocket extends WebSocket {
  serializeAttachment(value: PresenceAttachment): void;
  deserializeAttachment(): PresenceAttachment | null;
}

interface PresenceRoomEnv {
  RATE_LIMIT_SECRET: string;
}

interface PresenceIdentity {
  workspaceId: string;
  userId: string;
  displayName: string;
  signature: string;
}

export interface PresenceRoomDependencies {
  clock(): Date;
  verifyIdentity(env: PresenceRoomEnv, identity: PresenceIdentity): Promise<boolean>;
  createWebSocketPair(): { client: WebSocket; server: PresenceSocket };
  createUpgradeResponse(client: WebSocket): Response;
}

function identityPayload(identity: Omit<PresenceIdentity, "signature">) {
  return `${identity.workspaceId}\n${identity.userId}\n${identity.displayName}`;
}

function equalText(left: string, right: string) {
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  if (leftBytes.length !== rightBytes.length) return false;
  let difference = 0;
  for (let index = 0; index < leftBytes.length; index += 1) difference |= leftBytes[index] ^ rightBytes[index];
  return difference === 0;
}

const defaultDependencies: PresenceRoomDependencies = {
  clock: () => new Date(),
  async verifyIdentity(env, identity) {
    if (!env.RATE_LIMIT_SECRET || env.RATE_LIMIT_SECRET.length < 32) return false;
    const expected = await new SecureTokenService(`presence:${env.RATE_LIMIT_SECRET}`).hash(identityPayload(identity));
    return equalText(expected, identity.signature);
  },
  createWebSocketPair() {
    const pair = new WebSocketPair();
    return { client: pair[0], server: pair[1] as PresenceSocket };
  },
  createUpgradeResponse(client) {
    return new Response(null, { status: 101, webSocket: client });
  },
};

function response(status: number, code?: string) {
  if (!code) return new Response(null, { status });
  return new Response(JSON.stringify({ error: code }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function readIdentity(request: Request): PresenceIdentity | null {
  const workspaceId = request.headers.get("x-presence-workspace-id") ?? "";
  const userId = request.headers.get("x-presence-user-id") ?? "";
  const displayName = request.headers.get("x-presence-display-name") ?? "";
  const signature = request.headers.get("x-presence-signature") ?? "";
  const parsed = PresenceParticipantSchema.pick({ user_id: true, display_name: true }).safeParse({
    user_id: userId,
    display_name: displayName,
  });
  if (!parsed.success || !workspaceId || workspaceId.length > 128 || !signature || signature.length > 256) return null;
  return { workspaceId, userId: parsed.data.user_id, displayName: parsed.data.display_name, signature };
}

export class PresenceRoom {
  private readonly dependencies: PresenceRoomDependencies;

  constructor(
    private readonly state: DurableObjectState,
    private readonly env: PresenceRoomEnv,
    dependencies: Partial<PresenceRoomDependencies> = {},
  ) {
    this.dependencies = { ...defaultDependencies, ...dependencies };
  }

  async fetch(request: Request) {
    const identity = readIdentity(request);
    if (!identity || !await this.dependencies.verifyIdentity(this.env, identity)) return response(403, "FORBIDDEN");
    const existingWorkspace = this.sockets().map((socket) => socket.deserializeAttachment()?.workspaceId).find(Boolean);
    if (existingWorkspace && existingWorkspace !== identity.workspaceId) return response(403, "FORBIDDEN");

    if (request.method === "POST") return this.invalidate(request);
    if (request.method !== "GET" || request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return response(426, "WEBSOCKET_REQUIRED");
    }

    await this.cleanupExpired();
    for (const socket of this.sockets()) {
      const attachment = socket.deserializeAttachment();
      if (attachment?.connected && attachment.userId === identity.userId) {
        socket.serializeAttachment({ ...attachment, connected: false });
        socket.close(4000, "Reconnected");
      }
    }

    const pair = this.dependencies.createWebSocketPair();
    const attachment: PresenceAttachment = {
      workspaceId: identity.workspaceId,
      userId: identity.userId,
      displayName: identity.displayName,
      state: "active",
      expiresAt: new Date(this.dependencies.clock().getTime() + CONNECTION_TTL_MS).toISOString(),
      connected: true,
    };
    pair.server.serializeAttachment(attachment);
    this.state.acceptWebSocket(pair.server, [`workspace:${identity.workspaceId}`, `user:${identity.userId}`]);
    pair.server.send(JSON.stringify({ type: "presence.snapshot", participants: this.participants() }));
    this.broadcastChanged(attachment);
    await this.scheduleAlarm();
    return this.dependencies.createUpgradeResponse(pair.client);
  }

  async webSocketMessage(socket: PresenceSocket, value: string | ArrayBuffer) {
    const text = typeof value === "string" ? value : new TextDecoder().decode(value);
    if (encoder.encode(text).byteLength > MAX_MESSAGE_BYTES) {
      this.disconnect(socket, 1009, "Message too large");
      return;
    }
    let input: unknown;
    try {
      input = JSON.parse(text);
    } catch {
      this.disconnect(socket, 1008, "Invalid presence message");
      return;
    }
    const parsed = PresenceClientMessageSchema.safeParse(input);
    if (!parsed.success) {
      this.disconnect(socket, 1008, "Invalid presence message");
      return;
    }
    const current = socket.deserializeAttachment();
    if (!current?.connected) return;
    const next: PresenceAttachment = {
      ...current,
      expiresAt: new Date(this.dependencies.clock().getTime() + CONNECTION_TTL_MS).toISOString(),
    };
    if (parsed.data.type === "presence.update") {
      next.state = parsed.data.state;
      next.targetId = parsed.data.target_id;
    } else if (parsed.data.type === "typing.update") {
      next.state = parsed.data.active ? "typing" : "active";
      next.targetId = parsed.data.active ? parsed.data.target_id : undefined;
    }
    socket.serializeAttachment(next);
    this.broadcastChanged(next);
    await this.scheduleAlarm();
  }

  async webSocketClose(socket: PresenceSocket) {
    const attachment = socket.deserializeAttachment();
    if (attachment) socket.serializeAttachment({ ...attachment, connected: false });
    this.broadcastSnapshot();
    await this.scheduleAlarm();
  }

  async webSocketError(socket: PresenceSocket) {
    this.disconnect(socket, 1011, "Presence socket error");
    await this.scheduleAlarm();
  }

  async alarm() {
    await this.cleanupExpired();
    this.broadcastSnapshot();
    await this.scheduleAlarm();
  }

  private async invalidate(request: Request) {
    const text = await request.text();
    if (encoder.encode(text).byteLength > MAX_MESSAGE_BYTES) return response(413, "MESSAGE_TOO_LARGE");
    let input: unknown;
    try {
      input = JSON.parse(text);
    } catch {
      return response(400, "INVALID_MESSAGE");
    }
    const parsed = PresenceServerMessageSchema.safeParse(input);
    if (!parsed.success || parsed.data.type !== "entity.invalidated") return response(400, "INVALID_MESSAGE");
    this.broadcast(parsed.data);
    return response(204);
  }

  private sockets() {
    return this.state.getWebSockets() as PresenceSocket[];
  }

  private participants() {
    const now = this.dependencies.clock().toISOString();
    const byUser = new Map<string, PresenceParticipant>();
    for (const socket of this.sockets()) {
      const attachment = socket.deserializeAttachment();
      if (!attachment?.connected || attachment.expiresAt <= now) continue;
      byUser.set(attachment.userId, PresenceParticipantSchema.parse({
        user_id: attachment.userId,
        display_name: attachment.displayName,
        state: attachment.state,
        ...(attachment.targetId ? { target_id: attachment.targetId } : {}),
        expires_at: attachment.expiresAt,
      }));
    }
    return [...byUser.values()].slice(0, 500);
  }

  private broadcastChanged(attachment: PresenceAttachment) {
    const participant = PresenceParticipantSchema.parse({
      user_id: attachment.userId,
      display_name: attachment.displayName,
      state: attachment.state,
      ...(attachment.targetId ? { target_id: attachment.targetId } : {}),
      expires_at: attachment.expiresAt,
    });
    this.broadcast({ type: "presence.changed", participant });
  }

  private broadcastSnapshot() {
    this.broadcast({ type: "presence.snapshot", participants: this.participants() });
  }

  private broadcast(message: unknown) {
    const encoded = JSON.stringify(PresenceServerMessageSchema.parse(message));
    for (const socket of this.sockets()) {
      if (socket.deserializeAttachment()?.connected) socket.send(encoded);
    }
  }

  private disconnect(socket: PresenceSocket, code: number, reason: string) {
    const attachment = socket.deserializeAttachment();
    if (attachment) socket.serializeAttachment({ ...attachment, connected: false });
    socket.close(code, reason);
    this.broadcastSnapshot();
  }

  private async cleanupExpired() {
    const now = this.dependencies.clock().toISOString();
    for (const socket of this.sockets()) {
      const attachment = socket.deserializeAttachment();
      if (attachment?.connected && attachment.expiresAt <= now) {
        socket.serializeAttachment({ ...attachment, connected: false });
        socket.close(4001, "Presence expired");
      }
    }
  }

  private async scheduleAlarm() {
    const expiries = this.sockets()
      .map((socket) => socket.deserializeAttachment())
      .filter((attachment): attachment is PresenceAttachment => Boolean(attachment?.connected))
      .map((attachment) => Date.parse(attachment.expiresAt))
      .filter(Number.isFinite);
    if (expiries.length > 0) await this.state.storage.setAlarm(Math.min(...expiries));
  }
}
