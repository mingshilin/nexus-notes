import {
  PresenceClientMessageSchema,
  PresenceServerMessageSchema,
  PresenceParticipantSchema,
  type PresenceParticipant,
} from "@nexus/contracts";

import { SecureTokenService } from "../auth/crypto";
import { presenceCommandPayload } from "./presence-dispatcher";

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
  membershipEpoch: number;
}

interface PresenceSocket extends WebSocket {
  serializeAttachment(value: PresenceAttachment): void;
  deserializeAttachment(): PresenceAttachment | null;
}

interface PresenceRoomEnv {
  RATE_LIMIT_SECRET: string;
  DB?: D1Database;
}

interface PresenceMembershipState {
  membershipEpoch: number;
  active: boolean;
}

interface PresenceIdentity {
  workspaceId: string;
  userId: string;
  displayName: string;
  membershipEpoch: number;
  signature: string;
}

export interface PresenceRoomDependencies {
  clock(): Date;
  verifyIdentity(env: PresenceRoomEnv, identity: PresenceIdentity): Promise<boolean>;
  verifyCommand(env: PresenceRoomEnv, workspaceId: string, body: string, signature: string): Promise<boolean>;
  readMembershipState(
    env: PresenceRoomEnv,
    workspaceId: string,
    userId: string,
  ): Promise<PresenceMembershipState | null | undefined>;
  createWebSocketPair(): { client: WebSocket; server: PresenceSocket };
  createUpgradeResponse(client: WebSocket): Response;
}

function identityPayload(identity: Omit<PresenceIdentity, "signature">) {
  return `${identity.workspaceId}\n${identity.userId}\n${identity.displayName}\n${identity.membershipEpoch}`;
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
  async verifyCommand(env, workspaceId, body, signature) {
    if (!env.RATE_LIMIT_SECRET || env.RATE_LIMIT_SECRET.length < 32) return false;
    const expected = await new SecureTokenService(`presence-command:${env.RATE_LIMIT_SECRET}`).hash(
      presenceCommandPayload(workspaceId, body),
    );
    return equalText(expected, signature);
  },
  async readMembershipState(env, workspaceId, userId) {
    if (!env.DB) return undefined;
    const row = await env.DB.prepare(
      `SELECT membership_epoch, is_active FROM workspace_membership_epochs
       WHERE workspace_id = ? AND user_id = ? LIMIT 1`,
    ).bind(workspaceId, userId).first<{ membership_epoch: number; is_active: number }>();
    return row ? { membershipEpoch: row.membership_epoch, active: row.is_active === 1 } : null;
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
  const membershipEpoch = Number(request.headers.get("x-presence-membership-epoch"));
  const signature = request.headers.get("x-presence-signature") ?? "";
  const parsed = PresenceParticipantSchema.pick({ user_id: true, display_name: true }).safeParse({
    user_id: userId,
    display_name: displayName,
  });
  if (!parsed.success || !workspaceId || workspaceId.length > 128 || !signature || signature.length > 256
    || !Number.isInteger(membershipEpoch) || membershipEpoch < 1) return null;
  return { workspaceId, userId: parsed.data.user_id, displayName: parsed.data.display_name, membershipEpoch, signature };
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
    if (request.method === "POST") return this.control(request);
    const identity = readIdentity(request);
    if (!identity || !await this.dependencies.verifyIdentity(this.env, identity)) return response(403, "FORBIDDEN");
    const existingWorkspace = this.sockets().map((socket) => socket.deserializeAttachment()?.workspaceId).find(Boolean);
    if (existingWorkspace && existingWorkspace !== identity.workspaceId) return response(403, "FORBIDDEN");

    if (request.method !== "GET" || request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return response(426, "WEBSOCKET_REQUIRED");
    }

    await this.cleanupExpired();
    if (await this.isMembershipRevoked(identity.workspaceId, identity.userId, identity.membershipEpoch)) {
      return response(403, "FORBIDDEN");
    }
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
      membershipEpoch: identity.membershipEpoch,
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
    if (await this.isMembershipRevoked(current.workspaceId, current.userId, current.membershipEpoch)) {
      this.disconnect(socket, 4003, "Membership revoked");
      return;
    }
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

  private async control(request: Request) {
    const text = await request.text();
    if (encoder.encode(text).byteLength > MAX_MESSAGE_BYTES) return response(413, "MESSAGE_TOO_LARGE");
    const workspaceId = request.headers.get("x-presence-workspace-id") ?? "";
    const signature = request.headers.get("x-presence-command-signature") ?? "";
    if (!workspaceId || workspaceId.length > 128 || !signature || signature.length > 256
      || !await this.dependencies.verifyCommand(this.env, workspaceId, text, signature)) {
      return response(403, "FORBIDDEN");
    }
    const existingWorkspace = this.sockets().map((socket) => socket.deserializeAttachment()?.workspaceId).find(Boolean);
    if (existingWorkspace && existingWorkspace !== workspaceId) return response(403, "FORBIDDEN");
    let input: unknown;
    try {
      input = JSON.parse(text);
    } catch {
      return response(400, "INVALID_MESSAGE");
    }
    const parsed = PresenceServerMessageSchema.safeParse(input);
    if (parsed.success && parsed.data.type === "entity.invalidated") {
      this.broadcast(parsed.data);
      return response(204);
    }
    if (!this.isMembershipRevocation(input)) return response(400, "INVALID_MESSAGE");
    const key = this.membershipEpochKey(input.user_id);
    const current = await this.revokedMembershipEpoch(input.user_id);
    const membershipEpoch = Math.max(current, input.membership_epoch);
    await this.state.storage.put(key, membershipEpoch);
    for (const socket of this.sockets()) {
      const attachment = socket.deserializeAttachment();
      if (attachment?.connected && attachment.userId === input.user_id
        && attachment.membershipEpoch < membershipEpoch) {
        this.disconnect(socket, 4003, "Membership revoked");
      }
    }
    return response(204);
  }

  private isMembershipRevocation(input: unknown): input is {
    type: "membership.revoked";
    user_id: string;
    membership_epoch: number;
  } {
    if (!input || typeof input !== "object" || Array.isArray(input)) return false;
    const command = input as Record<string, unknown>;
    return Object.keys(command).length === 3
      && command.type === "membership.revoked"
      && typeof command.user_id === "string"
      && command.user_id.length > 0
      && command.user_id.length <= 128
      && Number.isInteger(command.membership_epoch)
      && Number(command.membership_epoch) > 0;
  }

  private membershipEpochKey(userId: string) {
    return `membership-epoch:${userId}`;
  }

  private async revokedMembershipEpoch(userId: string) {
    return await this.state.storage.get<number>(this.membershipEpochKey(userId)) ?? 0;
  }

  private async isMembershipRevoked(workspaceId: string, userId: string, membershipEpoch: number) {
    const durable = await this.dependencies.readMembershipState(this.env, workspaceId, userId);
    if (durable !== undefined) return !durable || !durable.active || membershipEpoch < durable.membershipEpoch;
    return membershipEpoch < await this.revokedMembershipEpoch(userId);
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
