import { z } from "zod";

const IdentifierSchema = z.string().trim().min(1).max(128);
export const CollaborationRevisionSchema = z.number().int().positive();
const DateTimeSchema = z.string().datetime({ offset: true });
export const WorkspaceRoleSchema = z.enum(["owner", "editor", "viewer"]);
export const WorkspaceMemberRoleSchema = z.enum(["editor", "viewer"]);
export const InvitationStatusSchema = z.enum(["pending", "accepted", "revoked", "expired"]);
export const PublicShareStatusSchema = z.enum(["active", "revoked", "expired"]);
export const CommentTargetTypeSchema = z.enum(["note", "database_record"]);
export const PublicShareEntityTypeSchema = z.enum(["note", "database_view"]);

const strictCursorPage = <T extends z.ZodType>(item: T) => z.object({
  items: z.array(item).max(100),
  next_cursor: z.string().trim().min(1).max(1_024).nullable(),
}).strict();

export const CollaborationCursorQuerySchema = z.object({
  cursor: z.string().trim().min(1).max(1_024).optional(),
  limit: z.number().int().min(1).max(100).default(50),
}).strict();

export const CreateInvitationSchema = z.object({
  email: z.string().trim().email().max(320),
  role: WorkspaceMemberRoleSchema,
  expires_in_hours: z.number().int().min(1).max(24 * 30).default(72),
}).strict();

export const InvitationTokenSchema = z.object({ token: z.string().min(32).max(256) }).strict();

export const UpdateWorkspaceMemberSchema = z.object({
  role: WorkspaceRoleSchema,
  base_revision: CollaborationRevisionSchema,
}).strict();

export const CreateCommentSchema = z.object({
  target_type: CommentTargetTypeSchema,
  target_id: IdentifierSchema,
  body: z.string().trim().min(1).max(10_000),
  parent_id: IdentifierSchema.nullish(),
  mention_user_ids: z.array(IdentifierSchema).max(50).default([]),
  idempotency_key: z.string().trim().min(1).max(128),
}).strict().superRefine((value, context) => {
  if (new Set(value.mention_user_ids).size !== value.mention_user_ids.length) {
    context.addIssue({ code: "custom", path: ["mention_user_ids"], message: "Mention targets must be unique" });
  }
});

export const UpdateCommentSchema = z.object({
  body: z.string().trim().min(1).max(10_000),
  mention_user_ids: z.array(IdentifierSchema).max(50).default([]),
  base_revision: CollaborationRevisionSchema,
}).strict().superRefine((value, context) => {
  if (new Set(value.mention_user_ids).size !== value.mention_user_ids.length) {
    context.addIssue({ code: "custom", path: ["mention_user_ids"], message: "Mention targets must be unique" });
  }
});

export const DeleteCommentSchema = z.object({ base_revision: CollaborationRevisionSchema }).strict();

export const NotificationReadSchema = z.object({
  notification_ids: z.array(IdentifierSchema).min(1).max(100),
  base_revisions: z.record(IdentifierSchema, CollaborationRevisionSchema),
}).strict().superRefine((value, context) => {
  const notificationIds = new Set(value.notification_ids);
  const revisionIds = Object.keys(value.base_revisions);
  if (notificationIds.size !== value.notification_ids.length) {
    context.addIssue({ code: "custom", path: ["notification_ids"], message: "Notification IDs must be unique" });
  }
  if (revisionIds.length !== notificationIds.size || revisionIds.some((id) => !notificationIds.has(id))) {
    context.addIssue({ code: "custom", path: ["base_revisions"], message: "Every notification must have exactly one base revision" });
  }
});

export const CreatePublicShareSchema = z.object({
  entity_type: PublicShareEntityTypeSchema,
  entity_id: IdentifierSchema,
  password: z.string().min(8).max(128).optional(),
  expires_in_hours: z.number().int().min(1).max(24 * 365).optional(),
}).strict();

export const PublicShareAccessSchema = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{43,256}$/u),
  password: z.string().min(1).max(128).optional(),
}).strict();

export const PublicSharePasswordVerificationSchema = z.object({
  password: z.string().min(1).max(128).optional(),
}).strict();

const sensitiveAuditKey = /(content|password|token|code|cookie|authorization|attachment.*bytes|body|secret)/iu;
const AuditScalarSchema = z.union([z.string().max(256), z.number().finite(), z.boolean(), z.null()]);
export const SafeAuditMetadataSchema = z.record(z.string().min(1).max(64), AuditScalarSchema)
  .superRefine((value, context) => {
    for (const key of Object.keys(value)) {
      if (sensitiveAuditKey.test(key)) {
        context.addIssue({ code: "custom", path: [key], message: "Sensitive audit metadata is not allowed" });
      }
    }
  });

export const WorkspaceInvitationSchema = z.object({
  id: IdentifierSchema,
  workspace_id: IdentifierSchema,
  email: z.string().trim().email().max(320),
  role: WorkspaceMemberRoleSchema,
  status: InvitationStatusSchema,
  revision: CollaborationRevisionSchema,
  expires_at: DateTimeSchema,
  created_by: IdentifierSchema,
  created_at: DateTimeSchema,
  updated_at: DateTimeSchema,
}).strict();

export const InvitationPreviewSchema = z.object({
  workspace_name: z.string().trim().min(1).max(160),
  inviter_display_name: z.string().trim().min(1).max(160),
  email: z.string().trim().email().max(320),
  role: WorkspaceMemberRoleSchema,
  expires_at: DateTimeSchema,
  status: InvitationStatusSchema,
}).strict();

export const WorkspaceMemberSchema = z.object({
  user_id: IdentifierSchema,
  email: z.string().trim().email().max(320),
  display_name: z.string().trim().min(1).max(160),
  role: WorkspaceRoleSchema,
  revision: CollaborationRevisionSchema,
  joined_at: DateTimeSchema,
  updated_at: DateTimeSchema,
}).strict();

export const CollaborationCommentSchema = z.object({
  id: IdentifierSchema,
  workspace_id: IdentifierSchema,
  target_type: CommentTargetTypeSchema,
  target_id: IdentifierSchema,
  author_user_id: IdentifierSchema,
  author_display_name: z.string().trim().min(1).max(160),
  parent_id: IdentifierSchema.nullable(),
  body: z.string().trim().min(1).max(10_000),
  mention_user_ids: z.array(IdentifierSchema).max(50),
  revision: CollaborationRevisionSchema,
  created_at: DateTimeSchema,
  updated_at: DateTimeSchema,
}).strict();

export const MentionSchema = z.object({
  id: IdentifierSchema,
  workspace_id: IdentifierSchema,
  comment_id: IdentifierSchema.nullable(),
  note_id: IdentifierSchema.nullable(),
  mentioned_user_id: IdentifierSchema,
  source_revision: CollaborationRevisionSchema,
  created_at: DateTimeSchema,
}).strict();

export const NotificationSchema = z.object({
  id: IdentifierSchema,
  workspace_id: IdentifierSchema,
  user_id: IdentifierSchema,
  type: z.string().trim().min(1).max(128),
  deep_link: z.string().trim().startsWith("/").max(2_048),
  payload: SafeAuditMetadataSchema,
  read_at: DateTimeSchema.nullable(),
  revision: CollaborationRevisionSchema,
  created_at: DateTimeSchema,
}).strict();

export const NotificationCursorPageSchema = strictCursorPage(NotificationSchema);
export const NotificationUnreadCountSchema = z.object({ unread_count: z.number().int().nonnegative() }).strict();
export const NotificationReadResultSchema = z.object({
  notification_ids: z.array(IdentifierSchema).min(1).max(100),
  read_at: DateTimeSchema,
}).strict();
export const NotificationReadAllResultSchema = z.object({
  count: z.number().int().nonnegative(),
  read_at: DateTimeSchema,
}).strict();

export const ActivityEntrySchema = z.object({
  id: IdentifierSchema,
  workspace_id: IdentifierSchema,
  actor_user_id: IdentifierSchema.nullable(),
  request_id: IdentifierSchema,
  action: z.string().trim().min(1).max(128),
  target_type: z.string().trim().min(1).max(128),
  target_id: IdentifierSchema.nullable(),
  metadata: SafeAuditMetadataSchema,
  created_at: DateTimeSchema,
}).strict();

export const AuditEntrySchema = ActivityEntrySchema.extend({
  outcome: z.enum(["success", "denied", "failure"]),
}).strict();
export const ActivityCursorPageSchema = strictCursorPage(ActivityEntrySchema);
export const AuditCursorPageSchema = strictCursorPage(AuditEntrySchema);

export const AppendActivityAuditInputSchema = z.object({
  request_id: IdentifierSchema,
  action: z.string().trim().min(1).max(128),
  target_type: z.string().trim().min(1).max(128),
  target_id: IdentifierSchema.nullable(),
  outcome: z.enum(["success", "denied", "failure"]),
  metadata: SafeAuditMetadataSchema.default({}),
}).strict();

export const PublicShareSchema = z.object({
  id: IdentifierSchema,
  entity_type: PublicShareEntityTypeSchema,
  entity_id: IdentifierSchema,
  status: PublicShareStatusSchema,
  password_required: z.boolean(),
  expires_at: DateTimeSchema.nullable(),
  revision: CollaborationRevisionSchema,
  created_at: DateTimeSchema,
  updated_at: DateTimeSchema,
}).strict();

export const PublicSharedContentSchema = z.object({
  share_id: IdentifierSchema,
  entity_type: PublicShareEntityTypeSchema,
  title: z.string().max(160),
  content: z.string().max(200_000).optional(),
  revision: CollaborationRevisionSchema,
  updated_at: DateTimeSchema,
}).strict();

export const PresenceStateSchema = z.enum(["active", "idle", "typing"]);
export const PresenceParticipantSchema = z.object({
  user_id: IdentifierSchema,
  display_name: z.string().trim().min(1).max(160),
  state: PresenceStateSchema,
  target_id: IdentifierSchema.optional(),
  expires_at: DateTimeSchema,
}).strict();

export const PresenceClientMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("presence.heartbeat") }).strict(),
  z.object({ type: z.literal("presence.update"), state: PresenceStateSchema, target_id: IdentifierSchema.optional() }).strict(),
  z.object({
    type: z.literal("typing.update"), target_type: CommentTargetTypeSchema,
    target_id: IdentifierSchema, active: z.boolean(),
  }).strict(),
]);

export const PresenceServerMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("presence.snapshot"), participants: z.array(PresenceParticipantSchema).max(500) }).strict(),
  z.object({ type: z.literal("presence.changed"), participant: PresenceParticipantSchema }).strict(),
  z.object({
    type: z.literal("entity.invalidated"), entity_type: z.string().trim().min(1).max(128),
    entity_id: IdentifierSchema, revision: CollaborationRevisionSchema,
  }).strict(),
]);

export const PresenceMessageSchema = z.union([PresenceClientMessageSchema, PresenceServerMessageSchema]);

export type WorkspaceMemberRole = z.infer<typeof WorkspaceMemberRoleSchema>;
export type WorkspaceRoleContract = z.infer<typeof WorkspaceRoleSchema>;
export type CreateInvitationInput = z.infer<typeof CreateInvitationSchema>;
export type UpdateWorkspaceMemberInput = z.infer<typeof UpdateWorkspaceMemberSchema>;
export type CreateCommentInput = z.infer<typeof CreateCommentSchema>;
export type UpdateCommentInput = z.infer<typeof UpdateCommentSchema>;
export type NotificationReadInput = z.infer<typeof NotificationReadSchema>;
export type CreatePublicShareInput = z.infer<typeof CreatePublicShareSchema>;
export type PublicShareAccessInput = z.infer<typeof PublicShareAccessSchema>;
export type PublicSharePasswordVerificationInput = z.infer<typeof PublicSharePasswordVerificationSchema>;
export type SafeAuditMetadata = z.infer<typeof SafeAuditMetadataSchema>;
export type WorkspaceMember = z.infer<typeof WorkspaceMemberSchema>;
export type WorkspaceInvitation = z.infer<typeof WorkspaceInvitationSchema>;
export type InvitationPreview = z.infer<typeof InvitationPreviewSchema>;
export type CollaborationComment = z.infer<typeof CollaborationCommentSchema>;
export type Mention = z.infer<typeof MentionSchema>;
export type Notification = z.infer<typeof NotificationSchema>;
export type ActivityEntry = z.infer<typeof ActivityEntrySchema>;
export type AuditEntry = z.infer<typeof AuditEntrySchema>;
export type AppendActivityAuditInput = z.infer<typeof AppendActivityAuditInputSchema>;
export type PublicShare = z.infer<typeof PublicShareSchema>;
export type PublicSharedContent = z.infer<typeof PublicSharedContentSchema>;
export type PresenceParticipant = z.infer<typeof PresenceParticipantSchema>;
export type PresenceMessage = z.infer<typeof PresenceMessageSchema>;

export const CollaborationContractDateTimeSchema = DateTimeSchema;
