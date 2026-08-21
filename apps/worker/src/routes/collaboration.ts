import {
  ActivityCursorPageSchema,
  AuditCursorPageSchema,
  CollaborationCommentSchema,
  CollaborationCursorQuerySchema,
  CreateCommentSchema,
  CreateInvitationSchema,
  CreatePublicShareSchema,
  InvitationPreviewSchema,
  InvitationTokenSchema,
  NotificationCursorPageSchema,
  NotificationReadAllResultSchema,
  NotificationReadResultSchema,
  NotificationReadSchema,
  NotificationUnreadCountSchema,
  PublicShareEntityTypeSchema,
  PublicShareAccessSchema,
  PublicSharePasswordVerificationSchema,
  PublicShareSchema,
  PublicSharedContentSchema,
  UpdateCommentSchema,
  UpdateWorkspaceMemberSchema,
  WorkspaceInvitationSchema,
  WorkspaceMemberSchema,
  type PublicShare,
} from "@nexus/contracts";
import { z } from "zod";

import type { D1CollaborationRepository } from "../collaboration/d1-collaboration-repository";
import type { RouteDefinition } from "../http/route-registry";

interface CollaborationRegistry<TEnv> {
  register<TBody, TData>(definition: RouteDefinition<TEnv, TBody, TData>): void;
}

type CollaborationRouteRepository = Pick<D1CollaborationRepository,
  | "createInvitation" | "previewInvitation" | "acceptInvitation" | "listInvitations" | "revokeInvitation"
  | "listMembers" | "updateMemberRole" | "removeMember"
  | "createComment" | "listComments" | "updateComment" | "deleteComment"
  | "listNotifications" | "unreadCount" | "readNotifications" | "readAllNotifications"
  | "listActivity" | "listAudit"
  | "createPublicShare" | "listPublicShares" | "accessPublicShare" | "revokePublicShare"
>;

export interface CollaborationRouteDependencies<TEnv> {
  createRepository(env: TEnv): CollaborationRouteRepository;
  hashToken(env: TEnv, token: string): Promise<string>;
  consumePublicSharePasswordAttempt(env: TEnv, request: Request, token: string): Promise<void>;
}

const RevisionBodySchema = z.object({ base_revision: z.number().int().positive() }).strict();
const TargetTypeSchema = z.enum(["note", "database_record"]);
const ShareQuerySchema = z.object({
  entity_type: PublicShareEntityTypeSchema.optional(),
  entity_id: z.string().trim().min(1).max(128).optional(),
}).strict().superRefine((value, context) => {
  if (Boolean(value.entity_type) !== Boolean(value.entity_id)) {
    context.addIssue({ code: "custom", message: "entity_type and entity_id must be provided together" });
  }
});

class CollaborationRouteError extends Error {
  readonly retryable = false;

  constructor(readonly code: string, message: string, readonly status: number) {
    super(message);
    this.name = "CollaborationRouteError";
  }
}

class PublicShareUnavailableError extends CollaborationRouteError {
  constructor() {
    super("PUBLIC_SHARE_UNAVAILABLE", "Shared content is unavailable", 404);
  }
}

function cursorOptions(request: Request) {
  const search = new URL(request.url).searchParams;
  const rawLimit = search.get("limit");
  const parsed = CollaborationCursorQuerySchema.safeParse({
    cursor: search.get("cursor") ?? undefined,
    limit: rawLimit === null ? undefined : Number(rawLimit),
  });
  if (!parsed.success) throw new CollaborationRouteError("INVALID_QUERY", "Pagination query is invalid", 400);
  return parsed.data;
}

function shareOptions(request: Request) {
  const search = new URL(request.url).searchParams;
  const parsed = ShareQuerySchema.safeParse({
    entity_type: search.get("entity_type") ?? undefined,
    entity_id: search.get("entity_id") ?? undefined,
  });
  if (!parsed.success) throw new CollaborationRouteError("INVALID_QUERY", "Share query is invalid", 400);
  return parsed.data;
}

function publicToken(token: string) {
  const parsed = z.string().regex(/^[A-Za-z0-9_-]{43,256}$/u).safeParse(token);
  if (!parsed.success) throw new PublicShareUnavailableError();
  return parsed.data;
}

async function accessPublicShare<TEnv>(
  env: TEnv,
  requestId: string,
  request: Request,
  tokenValue: string,
  password: string | undefined,
  dependencies: CollaborationRouteDependencies<TEnv>,
  passwordAttempt: boolean,
) {
  const token = publicToken(tokenValue);
  if (passwordAttempt) await dependencies.consumePublicSharePasswordAttempt(env, request, token);
  try {
    const tokenHash = await dependencies.hashToken(env, token);
    const content = await dependencies.createRepository(env).accessPublicShare({ tokenHash }, { password }, requestId);
    return PublicSharedContentSchema.parse(content);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "RATE_LIMITED") throw error;
    throw new PublicShareUnavailableError();
  }
}

export function registerCollaborationRoutes<TEnv>(
  registry: CollaborationRegistry<TEnv>,
  dependencies: CollaborationRouteDependencies<TEnv>,
) {
  registry.register({
    method: "POST", path: "/api/v2/invitations", auth: "workspace", minimumRole: "owner",
    body: CreateInvitationSchema,
    handler: async ({ env, workspace, body, requestId }) => {
      const result = await dependencies.createRepository(env).createInvitation(workspace!, body, requestId);
      return {
        status: 201,
        data: {
          invitation: WorkspaceInvitationSchema.parse(result.invitation),
          token: InvitationTokenSchema.parse({ token: result.token }).token,
        },
      };
    },
  });
  registry.register({
    method: "GET", path: "/api/v2/invitations", auth: "workspace", minimumRole: "owner",
    handler: async ({ env, workspace }) => ({
      data: { items: z.array(WorkspaceInvitationSchema).parse(await dependencies.createRepository(env).listInvitations(workspace!)) },
    }),
  });
  registry.register({
    method: "POST", path: "/api/v2/invitations/preview", auth: "public", body: InvitationTokenSchema,
    handler: async ({ env, body }) => ({
      data: {
        invitation: InvitationPreviewSchema.parse(await dependencies.createRepository(env).previewInvitation({
          tokenHash: await dependencies.hashToken(env, body.token),
        })),
      },
    }),
  });
  registry.register({
    method: "POST", path: "/api/v2/invitations/accept", auth: "session", body: InvitationTokenSchema,
    handler: async ({ env, body, principal, requestId }) => ({
      data: {
        member: WorkspaceMemberSchema.parse(await dependencies.createRepository(env).acceptInvitation({
          userId: principal!.userId,
          tokenHash: await dependencies.hashToken(env, body.token),
        }, requestId)),
      },
    }),
  });
  registry.register({
    method: "DELETE", path: "/api/v2/invitations/:invitationId", auth: "workspace", minimumRole: "owner",
    body: RevisionBodySchema,
    handler: async ({ env, workspace, params, body, requestId }) => ({
      data: { invitation: WorkspaceInvitationSchema.parse(await dependencies.createRepository(env).revokeInvitation(
        workspace!, params.invitationId!, body.base_revision, requestId,
      )) },
    }),
  });

  registry.register({
    method: "GET", path: "/api/v2/members", auth: "workspace",
    handler: async ({ env, workspace }) => ({
      data: { items: z.array(WorkspaceMemberSchema).parse(await dependencies.createRepository(env).listMembers(workspace!)) },
    }),
  });
  registry.register({
    method: "PATCH", path: "/api/v2/members/:userId", auth: "workspace", minimumRole: "owner",
    body: UpdateWorkspaceMemberSchema,
    handler: async ({ env, workspace, params, body, requestId }) => ({
      data: { member: WorkspaceMemberSchema.parse(await dependencies.createRepository(env).updateMemberRole(
        workspace!, params.userId!, body, requestId,
      )) },
    }),
  });
  registry.register({
    method: "DELETE", path: "/api/v2/members/:userId", auth: "workspace", minimumRole: "owner",
    body: RevisionBodySchema,
    handler: async ({ env, workspace, params, body, requestId }) => ({
      data: await dependencies.createRepository(env).removeMember(workspace!, params.userId!, body.base_revision, requestId),
    }),
  });
  registry.register({
    method: "POST", path: "/api/v2/members/:userId/ownership", auth: "workspace", minimumRole: "owner",
    body: RevisionBodySchema,
    handler: async ({ env, workspace, params, body, requestId }) => ({
      data: { member: WorkspaceMemberSchema.parse(await dependencies.createRepository(env).updateMemberRole(
        workspace!, params.userId!, { role: "owner", base_revision: body.base_revision }, requestId,
      )) },
    }),
  });

  registry.register({
    method: "POST", path: "/api/v2/comments", auth: "workspace", minimumRole: "editor", body: CreateCommentSchema,
    handler: async ({ env, workspace, body, requestId }) => ({
      status: 201,
      data: { comment: CollaborationCommentSchema.parse(await dependencies.createRepository(env).createComment(workspace!, body, requestId)) },
    }),
  });
  registry.register({
    method: "GET", path: "/api/v2/comments/:targetType/:targetId", auth: "workspace",
    handler: async ({ env, workspace, params }) => {
      const targetType = TargetTypeSchema.safeParse(params.targetType);
      if (!targetType.success) throw new CollaborationRouteError("INVALID_COMMENT_TARGET", "Comment target type is invalid", 400);
      const items = await dependencies.createRepository(env).listComments(workspace!, targetType.data, params.targetId!);
      return { data: { items: z.array(CollaborationCommentSchema).parse(items) } };
    },
  });
  registry.register({
    method: "PATCH", path: "/api/v2/comments/:commentId", auth: "workspace", minimumRole: "editor", body: UpdateCommentSchema,
    handler: async ({ env, workspace, params, body, requestId }) => ({
      data: { comment: CollaborationCommentSchema.parse(await dependencies.createRepository(env).updateComment(
        workspace!, params.commentId!, body, requestId,
      )) },
    }),
  });
  registry.register({
    method: "DELETE", path: "/api/v2/comments/:commentId", auth: "workspace", minimumRole: "editor", body: RevisionBodySchema,
    handler: async ({ env, workspace, params, body, requestId }) => ({
      data: await dependencies.createRepository(env).deleteComment(workspace!, params.commentId!, body.base_revision, requestId),
    }),
  });

  registry.register({
    method: "GET", path: "/api/v2/notifications", auth: "workspace",
    handler: async ({ request, env, workspace }) => ({
      data: NotificationCursorPageSchema.parse(await dependencies.createRepository(env).listNotifications(workspace!, cursorOptions(request))),
    }),
  });
  registry.register({
    method: "GET", path: "/api/v2/notifications/unread", auth: "workspace",
    handler: async ({ env, workspace }) => ({
      data: NotificationUnreadCountSchema.parse(await dependencies.createRepository(env).unreadCount(workspace!)),
    }),
  });
  registry.register({
    method: "POST", path: "/api/v2/notifications/:notificationId/read", auth: "workspace", body: RevisionBodySchema,
    handler: async ({ env, workspace, params, body }) => ({
      data: NotificationReadResultSchema.parse(await dependencies.createRepository(env).readNotifications(workspace!, {
        notification_ids: [params.notificationId!],
        base_revisions: { [params.notificationId!]: body.base_revision },
      })),
    }),
  });
  registry.register({
    method: "POST", path: "/api/v2/notifications/read", auth: "workspace", body: NotificationReadSchema,
    handler: async ({ env, workspace, body }) => ({
      data: NotificationReadResultSchema.parse(await dependencies.createRepository(env).readNotifications(workspace!, body)),
    }),
  });
  registry.register({
    method: "POST", path: "/api/v2/notifications/read-all", auth: "workspace",
    handler: async ({ env, workspace }) => ({
      data: NotificationReadAllResultSchema.parse(await dependencies.createRepository(env).readAllNotifications(workspace!)),
    }),
  });

  registry.register({
    method: "GET", path: "/api/v2/activity", auth: "workspace",
    handler: async ({ request, env, workspace }) => ({
      data: ActivityCursorPageSchema.parse(await dependencies.createRepository(env).listActivity(workspace!, cursorOptions(request))),
    }),
  });
  registry.register({
    method: "GET", path: "/api/v2/audit", auth: "workspace", minimumRole: "owner",
    handler: async ({ request, env, workspace }) => ({
      data: AuditCursorPageSchema.parse(await dependencies.createRepository(env).listAudit(workspace!, cursorOptions(request))),
    }),
  });

  registry.register({
    method: "POST", path: "/api/v2/shares", auth: "workspace", minimumRole: "editor", body: CreatePublicShareSchema,
    handler: async ({ env, workspace, body, requestId }) => {
      const result = await dependencies.createRepository(env).createPublicShare(workspace!, body, requestId);
      return {
        status: 201,
        data: {
          share: PublicShareSchema.parse(result.share),
          token: PublicShareAccessSchema.parse({ token: result.token }).token,
        },
      };
    },
  });
  registry.register({
    method: "GET", path: "/api/v2/shares", auth: "workspace", minimumRole: "editor",
    handler: async ({ request, env, workspace }) => {
      const options = shareOptions(request);
      const items = await dependencies.createRepository(env).listPublicShares(
        workspace!, options.entity_type as PublicShare["entity_type"] | undefined, options.entity_id,
      );
      return { data: { items: z.array(PublicShareSchema).parse(items) } };
    },
  });
  registry.register({
    method: "DELETE", path: "/api/v2/shares/:shareId", auth: "workspace", minimumRole: "editor", body: RevisionBodySchema,
    handler: async ({ env, workspace, params, body, requestId }) => ({
      data: { share: PublicShareSchema.parse(await dependencies.createRepository(env).revokePublicShare(
        workspace!, params.shareId!, body.base_revision, requestId,
      )) },
    }),
  });

  registry.register({
    method: "GET", path: "/api/v2/public/shares/:token", auth: "public",
    handler: async ({ env, requestId, request, params }) => ({
      data: await accessPublicShare(env, requestId, request, params.token!, undefined, dependencies, false),
    }),
  });
  registry.register({
    method: "POST", path: "/api/v2/public/shares/:token", auth: "public", body: PublicSharePasswordVerificationSchema,
    handler: async ({ env, requestId, request, params, body }) => ({
      data: await accessPublicShare(env, requestId, request, params.token!, body.password, dependencies, true),
    }),
  });
}
