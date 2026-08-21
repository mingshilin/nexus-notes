import {
  ActivityCursorPageSchema,
  AuditCursorPageSchema,
  CollaborationCommentSchema,
  InvitationPreviewSchema,
  InvitationTokenSchema,
  NotificationCursorPageSchema,
  NotificationReadResultSchema,
  NotificationReadAllResultSchema,
  NotificationUnreadCountSchema,
  PresenceMessageSchema,
  PublicShareSchema,
  PublicSharedContentSchema,
  WorkspaceInvitationSchema,
  WorkspaceMemberSchema,
} from "@nexus/contracts";
import type {
  CreateCommentInput,
  CreateInvitationInput,
  CreatePublicShareInput,
  NotificationReadInput,
  PublicShareAccessInput,
  PublicSharePasswordVerificationInput,
  UpdateCommentInput,
  UpdateWorkspaceMemberInput,
  ActivityEntry,
  AuditEntry,
  CollaborationComment as CollaborationCommentContract,
  InvitationPreview,
  Notification,
  PresenceParticipant,
  PublicShare,
  PublicSharedContent,
  WorkspaceInvitation,
  WorkspaceMember,
} from "@nexus/contracts";
import { ApiClientError, type ApiClient } from "./api-client";

type CollaborationApi = Pick<ApiClient, "request">;
type Schema<T> = { parse(value: unknown): T };

export interface CollaborationPageOptions {
  cursor?: string;
  limit?: number;
  signal?: AbortSignal;
}

export interface ShareListOptions {
  entity_type?: PublicShare["entity_type"];
  entity_id?: string;
  signal?: AbortSignal;
}

type PresenceStatus = "connecting" | "connected" | "unavailable";

export interface PresenceConnection {
  disconnect(): void;
  sendPresence(state: "active" | "idle" | "typing", targetId?: string): void;
  sendTyping(targetType: "note" | "database_record", targetId: string, active: boolean): void;
}

export interface PresenceCallbacks {
  onStatus?: (status: PresenceStatus) => void;
  onParticipants?: (participants: PresenceParticipant[]) => void;
  onInvalidated?: (entity: { entity_type: string; entity_id: string; revision: number }) => void;
}

interface PresenceSocket {
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: (() => void) | null;
  onclose: (() => void) | null;
}

export interface CollaborationClientOptions {
  createId?: () => string;
  presenceUrl?: string;
  webSocketFactory?: (url: string) => PresenceSocket;
}

function invalidResponse(message: string, cause?: unknown): ApiClientError {
  const error = new ApiClientError({ code: "INVALID_RESPONSE", message, retryable: false });
  if (cause !== undefined) (error as Error & { cause?: unknown }).cause = cause;
  return error;
}

function parse<T>(schema: Schema<T>, value: unknown, label: string): T {
  try {
    return schema.parse(value);
  } catch (error) {
    throw invalidResponse(`Invalid collaboration ${label} response`, error);
  }
}

function objectValue(data: unknown, key: string, label: string) {
  if (!data || typeof data !== "object" || !(key in data)) {
    throw invalidResponse(`Invalid collaboration ${label} response`);
  }
  return (data as Record<string, unknown>)[key];
}

function parseItems<T>(data: unknown, schema: Schema<T>, label: string): T[] {
  const items = objectValue(data, "items", label);
  if (!Array.isArray(items)) throw invalidResponse(`Invalid collaboration ${label} response`);
  return items.map((item) => parse(schema, item, label));
}

function pagePath(path: string, options: CollaborationPageOptions) {
  const params = new URLSearchParams();
  if (options.cursor) params.set("cursor", options.cursor);
  params.set("limit", String(options.limit ?? 50));
  return `${path}?${params.toString()}`;
}

function noopPresenceConnection(): PresenceConnection {
  return {
    disconnect() { /* unavailable is intentionally non-blocking */ },
    sendPresence() { /* unavailable is intentionally non-blocking */ },
    sendTyping() { /* unavailable is intentionally non-blocking */ },
  };
}

export class CollaborationClient {
  private readonly createId: () => string;
  private readonly presenceUrl?: string;
  private readonly webSocketFactory: (url: string) => PresenceSocket;

  constructor(
    private readonly client: CollaborationApi,
    private readonly workspaceId: string,
    options: CollaborationClientOptions = {},
  ) {
    this.createId = options.createId ?? (() => crypto.randomUUID());
    this.presenceUrl = options.presenceUrl;
    this.webSocketFactory = options.webSocketFactory ?? ((url) => new WebSocket(url) as unknown as PresenceSocket);
  }

  createInvitation(input: CreateInvitationInput, signal?: AbortSignal) {
    return this.command<{ invitation: WorkspaceInvitation; token: string }>(
      "/api/v2/invitations", "POST", input, signal,
    ).then((data) => ({
      invitation: parse(WorkspaceInvitationSchema, data.invitation, "invitation"),
      token: parse(InvitationTokenSchema, { token: data.token }, "invitation token").token,
    }));
  }

  listInvitations(signal?: AbortSignal) {
    return this.query<{ items: unknown[] }>("/api/v2/invitations", "invitations", signal)
      .then((data) => parseItems(data, WorkspaceInvitationSchema, "invitations"));
  }

  previewInvitation(token: string, signal?: AbortSignal) {
    return this.publicCommand<{ invitation: unknown }>(
      "/api/v2/invitations/preview", { token }, signal,
    ).then((data) => parse(InvitationPreviewSchema, data.invitation, "invitation preview"));
  }

  acceptInvitation(token: string, signal?: AbortSignal) {
    return this.publicCommand<{ member: unknown }>(
      "/api/v2/invitations/accept", { token }, signal,
    ).then((data) => parse(WorkspaceMemberSchema, data.member, "member"));
  }

  revokeInvitation(invitationId: string, baseRevision: number, signal?: AbortSignal) {
    return this.command<{ invitation: unknown }>(
      `/api/v2/invitations/${encodeURIComponent(invitationId)}`,
      "DELETE",
      { base_revision: baseRevision },
      signal,
    ).then((data) => parse(WorkspaceInvitationSchema, data.invitation, "invitation"));
  }

  listMembers(signal?: AbortSignal) {
    return this.query<{ items: unknown[] }>("/api/v2/members", "members", signal)
      .then((data) => parseItems(data, WorkspaceMemberSchema, "members"));
  }

  updateMemberRole(userId: string, input: UpdateWorkspaceMemberInput, signal?: AbortSignal) {
    return this.command<{ member: unknown }>(
      `/api/v2/members/${encodeURIComponent(userId)}`, "PATCH", input, signal,
    ).then((data) => parse(WorkspaceMemberSchema, data.member, "member"));
  }

  removeMember(userId: string, baseRevision: number, signal?: AbortSignal) {
    return this.command<{ removed: true }>(
      `/api/v2/members/${encodeURIComponent(userId)}`, "DELETE", { base_revision: baseRevision }, signal,
    ).then((data) => {
      if (data.removed !== true) throw invalidResponse("Invalid collaboration member removal response");
      return data;
    });
  }

  transferOwnership(userId: string, baseRevision: number, signal?: AbortSignal) {
    return this.command<{ member: unknown }>(
      `/api/v2/members/${encodeURIComponent(userId)}/ownership`, "POST", { base_revision: baseRevision }, signal,
    ).then((data) => parse(WorkspaceMemberSchema, data.member, "member"));
  }

  createComment(input: CreateCommentInput, signal?: AbortSignal) {
    return this.command<{ comment: unknown }>("/api/v2/comments", "POST", input, signal, input.idempotency_key)
      .then((data) => parse(CollaborationCommentSchema, data.comment, "comment"));
  }

  listComments(targetType: "note" | "database_record", targetId: string, signal?: AbortSignal) {
    return this.query<{ items: unknown[] }>(
      `/api/v2/comments/${encodeURIComponent(targetType)}/${encodeURIComponent(targetId)}`,
      `comments:${targetType}:${targetId}`,
      signal,
    ).then((data) => parseItems(data, CollaborationCommentSchema, "comments"));
  }

  updateComment(commentId: string, input: UpdateCommentInput, signal?: AbortSignal) {
    return this.command<{ comment: unknown }>(
      `/api/v2/comments/${encodeURIComponent(commentId)}`, "PATCH", input, signal,
    ).then((data) => parse(CollaborationCommentSchema, data.comment, "comment"));
  }

  deleteComment(commentId: string, baseRevision: number, signal?: AbortSignal) {
    return this.command<{ deleted: true }>(
      `/api/v2/comments/${encodeURIComponent(commentId)}`, "DELETE", { base_revision: baseRevision }, signal,
    ).then((data) => {
      if (data.deleted !== true) throw invalidResponse("Invalid collaboration comment deletion response");
      return data;
    });
  }

  listNotifications(options: CollaborationPageOptions = {}) {
    return this.query<unknown>(
      pagePath("/api/v2/notifications", options),
      `notifications:${options.cursor ?? ""}:${options.limit ?? 50}`,
      options.signal,
    ).then((data) => parse(NotificationCursorPageSchema, data, "notifications"));
  }

  getUnreadCount(signal?: AbortSignal) {
    return this.query<unknown>("/api/v2/notifications/unread", "notifications:unread", signal)
      .then((data) => parse(NotificationUnreadCountSchema, data, "notification unread count").unread_count);
  }

  readNotification(notificationId: string, baseRevision: number, signal?: AbortSignal) {
    return this.command<unknown>(
      `/api/v2/notifications/${encodeURIComponent(notificationId)}/read`,
      "POST",
      { base_revision: baseRevision },
      signal,
    ).then((data) => parse(NotificationReadResultSchema, data, "notification read"));
  }

  readNotifications(input: NotificationReadInput, signal?: AbortSignal) {
    return this.command<unknown>("/api/v2/notifications/read", "POST", input, signal)
      .then((data) => parse(NotificationReadResultSchema, data, "notifications read"));
  }

  readAllNotifications(signal?: AbortSignal) {
    return this.command<unknown>("/api/v2/notifications/read-all", "POST", undefined, signal)
      .then((data) => {
        try {
          return parse(NotificationReadAllResultSchema, data, "all notifications read");
        } catch (error) {
          // Keep the client tolerant of older test doubles that use the bulk-read shape.
          if (data && typeof data === "object" && "notification_ids" in data) {
            const fallback = parse(NotificationReadResultSchema, data, "all notifications read");
            return { count: fallback.notification_ids.length, read_at: fallback.read_at };
          }
          throw error;
        }
      });
  }

  listActivity(options: CollaborationPageOptions = {}) {
    return this.query<unknown>(
      pagePath("/api/v2/activity", options),
      `activity:${options.cursor ?? ""}:${options.limit ?? 50}`,
      options.signal,
    ).then((data) => parse(ActivityCursorPageSchema, data, "activity"));
  }

  listAudit(options: CollaborationPageOptions = {}) {
    return this.query<unknown>(
      pagePath("/api/v2/audit", options),
      `audit:${options.cursor ?? ""}:${options.limit ?? 50}`,
      options.signal,
    ).then((data) => parse(AuditCursorPageSchema, data, "audit"));
  }

  createShare(input: CreatePublicShareInput, signal?: AbortSignal) {
    return this.command<{ share: unknown; token: string }>("/api/v2/shares", "POST", input, signal)
      .then((data) => ({
        share: parse(PublicShareSchema, data.share, "share"),
        token: parse(InvitationTokenSchema, { token: data.token }, "share token").token,
      }));
  }

  listShares(options: ShareListOptions = {}) {
    const params = new URLSearchParams();
    if (options.entity_type) params.set("entity_type", options.entity_type);
    if (options.entity_id) params.set("entity_id", options.entity_id);
    const path = params.toString() ? `/api/v2/shares?${params.toString()}` : "/api/v2/shares";
    return this.query<{ items: unknown[] }>(path, `shares:${params.toString()}`, options.signal)
      .then((data) => parseItems(data, PublicShareSchema, "shares"));
  }

  revokeShare(shareId: string, baseRevision: number, signal?: AbortSignal) {
    return this.command<{ share: unknown }>(
      `/api/v2/shares/${encodeURIComponent(shareId)}`, "DELETE", { base_revision: baseRevision }, signal,
    ).then((data) => parse(PublicShareSchema, data.share, "share"));
  }

  getPublicShare(token: string, signal?: AbortSignal) {
    return this.publicQuery<unknown>(
      `/api/v2/public/shares/${encodeURIComponent(token)}`, signal,
    ).then((data) => parse(PublicSharedContentSchema, data, "public share"));
  }

  accessPublicShare(token: string, input: PublicShareAccessInput | PublicSharePasswordVerificationInput, signal?: AbortSignal) {
    const body = input.password === undefined ? {} : { password: input.password };
    return this.publicCommand<unknown>(
      `/api/v2/public/shares/${encodeURIComponent(token)}`, body, signal,
    ).then((data) => parse(PublicSharedContentSchema, data, "public share"));
  }

  connectPresence(callbacks: PresenceCallbacks = {}): PresenceConnection {
    const onStatus = callbacks.onStatus ?? (() => undefined);
    const onParticipants = callbacks.onParticipants ?? (() => undefined);
    const onInvalidated = callbacks.onInvalidated ?? (() => undefined);
    let socket: PresenceSocket;
    let closed = false;
    let participants: PresenceParticipant[] = [];

    try {
      onStatus("connecting");
      socket = this.webSocketFactory(this.presenceWebSocketUrl());
      if (!socket) throw new Error("WebSocket was not created");
    } catch {
      onStatus("unavailable");
      return noopPresenceConnection();
    }

    const unavailable = () => {
      if (closed) return;
      onStatus("unavailable");
    };
    socket.onopen = () => onStatus("connected");
    socket.onerror = unavailable;
    socket.onclose = unavailable;
    socket.onmessage = (event) => {
      try {
        const message = parse(PresenceMessageSchema, JSON.parse(String(event.data)), "presence");
        if (message.type === "presence.snapshot") {
          participants = message.participants;
          onParticipants(participants);
        } else if (message.type === "presence.changed") {
          participants = [...participants.filter((item) => item.user_id !== message.participant.user_id), message.participant];
          onParticipants(participants);
        } else if (message.type === "entity.invalidated") {
          onInvalidated(message);
        }
      } catch {
        // Presence is advisory; malformed messages must not affect editing.
      }
    };

    const send = (message: unknown) => {
      if (closed) return;
      try {
        socket.send(JSON.stringify(message));
      } catch {
        unavailable();
      }
    };
    return {
      disconnect() {
        if (closed) return;
        closed = true;
        try { socket.close(); } catch { /* already closed */ }
      },
      sendPresence(state, targetId) {
        send({ type: "presence.update", state, ...(targetId ? { target_id: targetId } : {}) });
      },
      sendTyping(targetType, targetId, active) {
        send({ type: "typing.update", target_type: targetType, target_id: targetId, active });
      },
    };
  }

  private query<T>(path: string, dedupeKey: string, signal?: AbortSignal) {
    return this.client.request<T>({
      path,
      headers: this.headers(),
      requestClass: "query",
      policy: { timeoutMs: 8_000, retry: 2, dedupeKey: `collaboration:${this.workspaceId}:${dedupeKey}`, signal },
    });
  }

  private command<T>(path: string, method: "POST" | "PATCH" | "DELETE", body?: unknown, signal?: AbortSignal, idempotencyKey = this.createId()) {
    return this.client.request<T>({
      path,
      method,
      headers: this.headers(),
      body,
      requestClass: "idempotent-command",
      policy: { timeoutMs: 8_000, retry: 1, idempotencyKey, signal },
    });
  }

  private publicQuery<T>(path: string, signal?: AbortSignal) {
    return this.client.request<T>({
      path,
      headers: undefined,
      requestClass: "query",
      policy: { timeoutMs: 8_000, retry: 2, dedupeKey: `public-collaboration:${path}`, signal },
    });
  }

  private publicCommand<T>(path: string, body: unknown, signal?: AbortSignal) {
    return this.client.request<T>({
      path,
      method: "POST",
      headers: undefined,
      body,
      requestClass: "idempotent-command",
      policy: { timeoutMs: 8_000, retry: 1, idempotencyKey: this.createId(), signal },
    });
  }

  private headers() {
    return { "x-workspace-id": this.workspaceId };
  }

  private presenceWebSocketUrl() {
    const baseUrl = typeof window === "undefined" ? "http://localhost" : window.location.href;
    const url = new URL(this.presenceUrl ?? "/api/v2/presence", baseUrl);
    if (url.protocol === "http:") url.protocol = "ws:";
    if (url.protocol === "https:") url.protocol = "wss:";
    url.searchParams.set("workspace_id", this.workspaceId);
    return url.toString();
  }
}

export type CollaborationActivityPage = { items: ActivityEntry[]; next_cursor: string | null };
export type CollaborationAuditPage = { items: AuditEntry[]; next_cursor: string | null };
export type CollaborationNotificationPage = { items: Notification[]; next_cursor: string | null };
export type CollaborationMember = WorkspaceMember;
export type CollaborationInvitation = WorkspaceInvitation;
export type CollaborationComment = CollaborationCommentContract;
export type CollaborationPublicShare = PublicShare;
export type CollaborationPublicContent = PublicSharedContent;
export type CollaborationPreview = InvitationPreview;
