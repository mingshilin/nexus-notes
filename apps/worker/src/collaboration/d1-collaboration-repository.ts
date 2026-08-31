import type {
  ActivityEntry,
  AppendActivityAuditInput,
  AuditEntry,
  CollaborationComment,
  CreateCommentInput,
  CreateInvitationInput,
  CreatePublicShareInput,
  InvitationPreview,
  Notification,
  NotificationReadInput,
  PublicShare,
  PublicSharePasswordVerificationInput,
  PublicSharedContent,
  SafeAuditMetadata,
  UpdateCommentInput,
  UpdateWorkspaceMemberInput,
  WorkspaceContext,
  WorkspaceInvitation,
  WorkspaceMember,
} from "@nexus/contracts";
import {
  DEFAULT_BETA_QUOTAS,
  canManageWorkspaceMember,
  canMutateComment,
  canPerformCollaborationAction,
  filterPublicShareContent,
  normalizeEmail,
  redactAuditMetadata,
} from "@nexus/domain";

import { D1DatabaseAccess } from "../databases/d1-database-access";
import type { PresenceNotifier } from "../presence/presence-dispatcher";

interface TokenService {
  createSessionToken(): string;
  hash(value: string): Promise<string>;
}

interface PasswordService {
  hash(value: string): Promise<string>;
  verify(value: string, encoded: string): Promise<boolean>;
}

export interface PublicTokenHashContext {
  tokenHash: string;
}

export interface InvitationAcceptanceContext extends PublicTokenHashContext {
  userId: string;
}

export interface CollaborationRepositoryOptions {
  tokens: TokenService;
  password: PasswordService;
  createId(): string;
  clock(): Date;
  memberLimit: number;
  presence?: PresenceNotifier;
}

interface InvitationRow extends WorkspaceInvitation {}

interface MemberRow extends WorkspaceMember {}

interface CommentRow {
  id: string;
  workspace_id: string;
  target_type: CollaborationComment["target_type"];
  target_id: string;
  author_user_id: string;
  author_display_name: string;
  parent_id: string | null;
  body: string;
  revision: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  idempotency_key: string | null;
  idempotency_fingerprint: string | null;
}

interface NotificationRow {
  id: string;
  workspace_id: string;
  user_id: string;
  type: string;
  payload_json: string;
  deep_link: string;
  read_at: string | null;
  revision: number;
  created_at: string;
}

interface ActivityRow {
  id: string;
  workspace_id: string;
  actor_user_id: string | null;
  request_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  entity_type: string;
  entity_id: string | null;
  metadata_json: string;
  created_at: string;
}

interface AuditRow {
  id: string;
  workspace_id: string;
  actor_user_id: string | null;
  request_id: string;
  action: string;
  target_type: string;
  target_id: string | null;
  outcome: AuditEntry["outcome"];
  metadata_json: string;
  created_at: string;
}

interface ShareRow {
  id: string;
  workspace_id: string;
  entity_type: PublicShare["entity_type"];
  entity_id: string;
  token_hash: string;
  password_hash: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  status: PublicShare["status"];
  revision: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export class CollaborationRepositoryError extends Error {
  readonly retryable = false;

  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "CollaborationRepositoryError";
  }
}

function parseMetadata(value: string): SafeAuditMetadata {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? redactAuditMetadata(parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export interface ActivityAuditStatementInput {
  workspaceId: string;
  actorUserId: string | null;
  requestId: string;
  action: string;
  targetType: string;
  targetId: string | null;
  metadata?: Record<string, unknown>;
  createdAt: string;
  condition?: string;
  conditionBindings?: unknown[];
}

export function prepareActivityAndAuditStatements(
  db: D1Database,
  createId: () => string,
  input: ActivityAuditStatementInput,
) {
  const metadata = JSON.stringify(redactAuditMetadata(input.metadata ?? {}));
  const condition = input.condition ?? "1 = 1";
  const conditionBindings = input.conditionBindings ?? [];
  return [
    db.prepare(
      `INSERT INTO activity_logs
       (id, workspace_id, actor_user_id, request_id, action, entity_type, entity_id, target_type, target_id, metadata_json, created_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${condition}`,
    ).bind(
      createId(), input.workspaceId, input.actorUserId, input.requestId, input.action,
      input.targetType, input.targetId, input.targetType, input.targetId, metadata, input.createdAt,
      ...conditionBindings,
    ),
    db.prepare(
      `INSERT INTO audit_logs
       (id, workspace_id, actor_user_id, request_id, action, target_type, target_id, outcome, metadata_json, created_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, 'success', ?, ? WHERE ${condition}`,
    ).bind(
      createId(), input.workspaceId, input.actorUserId, input.requestId, input.action,
      input.targetType, input.targetId, metadata, input.createdAt, ...conditionBindings,
    ),
  ];
}

function encodeCursor(input: { created_at: string; id: string }) {
  return encodeURIComponent(`${input.created_at}\n${input.id}`);
}

function decodeCursor(cursor: string) {
  try {
    if (cursor.length > 1_024) throw new Error("invalid");
    const decoded = decodeURIComponent(cursor);
    const separator = decoded.indexOf("\n");
    if (separator <= 0 || separator === decoded.length - 1) throw new Error("invalid");
    const createdAt = decoded.slice(0, separator);
    const id = decoded.slice(separator + 1);
    if (!Number.isFinite(Date.parse(createdAt)) || id.length > 128 || id.includes("\n")) throw new Error("invalid");
    return { createdAt, id };
  } catch {
    throw new CollaborationRepositoryError("INVALID_CURSOR", "Cursor is invalid", 400);
  }
}

function invitationStatus(row: InvitationRow, now: string): WorkspaceInvitation["status"] {
  return row.status === "pending" && row.expires_at <= now ? "expired" : row.status;
}

function toShare(row: ShareRow, now: string): PublicShare {
  const status = row.status === "active" && row.expires_at && row.expires_at <= now ? "expired" : row.status;
  return {
    id: row.id,
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    status,
    password_required: Boolean(row.password_hash),
    expires_at: row.expires_at,
    revision: row.revision,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function toActivity(row: ActivityRow): ActivityEntry {
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    actor_user_id: row.actor_user_id,
    request_id: row.request_id ?? "",
    action: row.action,
    target_type: row.target_type ?? row.entity_type,
    target_id: row.target_id ?? row.entity_id,
    metadata: parseMetadata(row.metadata_json),
    created_at: row.created_at,
  };
}

function toAudit(row: AuditRow): AuditEntry {
  const { metadata_json, ...entry } = row;
  return { ...entry, metadata: parseMetadata(metadata_json) };
}

const invitationColumns = `id, workspace_id, email, role, status, revision, expires_at,
  created_by, created_at, updated_at`;
const memberColumns = `m.user_id, u.email, u.display_name, m.role, m.revision, m.joined_at, m.updated_at`;
const commentColumns = `c.id, c.workspace_id, c.entity_type AS target_type, c.entity_id AS target_id,
  c.author_user_id, u.display_name AS author_display_name, c.parent_id, c.body,
  c.revision, c.created_at, c.updated_at, c.deleted_at, c.idempotency_key, c.idempotency_fingerprint`;
const notificationColumns = `id, workspace_id, user_id, type, payload_json, deep_link, read_at, revision, created_at`;
const shareColumns = `id, workspace_id, entity_type, entity_id, token_hash, password_hash,
  expires_at, revoked_at, status, revision, created_by, created_at, updated_at`;

export class D1CollaborationRepository {
  private readonly options: CollaborationRepositoryOptions;
  private readonly databaseAccess: D1DatabaseAccess;

  constructor(db: D1Database, options: Partial<CollaborationRepositoryOptions> & Pick<CollaborationRepositoryOptions, "tokens" | "password">) {
    this.db = db;
    this.options = {
      createId: () => crypto.randomUUID(),
      clock: () => new Date(),
      memberLimit: DEFAULT_BETA_QUOTAS.members,
      ...options,
    };
    this.databaseAccess = new D1DatabaseAccess(db);
  }

  private readonly db: D1Database;

  async createInvitation(context: WorkspaceContext, input: CreateInvitationInput, requestId: string) {
    if (context.role !== "owner") {
      throw new CollaborationRepositoryError("MEMBER_MANAGEMENT_DENIED", "Owner permission required", 403);
    }
    const id = this.options.createId();
    const token = this.options.tokens.createSessionToken();
    const tokenHash = await this.options.tokens.hash(token);
    const email = normalizeEmail(input.email);
    const createdAt = this.now();
    const expiresAt = new Date(this.options.clock().getTime() + input.expires_in_hours * 3_600_000).toISOString();
    const expireStale = this.db.prepare(
      `UPDATE workspace_invitations
       SET status = 'expired', revision = revision + 1, updated_at = ?
       WHERE workspace_id = ? AND status = 'pending' AND consumed_at IS NULL AND expires_at <= ?`,
    ).bind(createdAt, context.workspaceId, createdAt);
    const operationId = this.options.createId();
    const operationStart = this.operationStart(
      operationId,
      "invitation.create",
      context.workspaceId,
      id,
      `NOT EXISTS (
         SELECT 1 FROM workspace_members m JOIN users u ON u.id = m.user_id
         WHERE m.workspace_id = ? AND lower(u.email) = lower(?)
       ) AND (
         (SELECT COUNT(*) FROM workspace_members WHERE workspace_id = ?)
         + (SELECT COUNT(*) FROM workspace_invitations
            WHERE workspace_id = ? AND status = 'pending' AND consumed_at IS NULL AND expires_at > ?)
       ) < COALESCE(
         (SELECT limit_value FROM workspace_quotas WHERE workspace_id = ? AND quota_key = 'members'), ?
       )`,
      [
        context.workspaceId, email, context.workspaceId, context.workspaceId, createdAt,
        context.workspaceId, this.options.memberLimit,
      ],
    );
    const insert = this.db.prepare(
      `INSERT INTO workspace_invitations
       (id, workspace_id, email, role, token_hash, status, revision, expires_at, consumed_at, created_by, created_at, updated_at)
       SELECT ?, ?, ?, ?, ?, 'pending', 1, ?, NULL, ?, ?, ?
       WHERE NOT EXISTS (
         SELECT 1 FROM workspace_members m JOIN users u ON u.id = m.user_id
         WHERE m.workspace_id = ? AND lower(u.email) = lower(?)
       ) AND (
         (SELECT COUNT(*) FROM workspace_members WHERE workspace_id = ?)
         + (SELECT COUNT(*) FROM workspace_invitations
            WHERE workspace_id = ? AND status = 'pending' AND consumed_at IS NULL AND expires_at > ?)
       ) < COALESCE(
         (SELECT limit_value FROM workspace_quotas WHERE workspace_id = ? AND quota_key = 'members'), ?
       )
       RETURNING ${invitationColumns}`,
    ).bind(
      id, context.workspaceId, email, input.role, tokenHash, expiresAt, context.userId, createdAt, createdAt,
      context.workspaceId, email, context.workspaceId, context.workspaceId, createdAt,
      context.workspaceId, this.options.memberLimit,
    );
    try {
      const results = await this.db.batch<InvitationRow>([
        expireStale,
        ...operationStart,
        insert,
        ...this.logStatements(context.workspaceId, context.userId, requestId, "invitation.created", "workspace_invitation", id, {
          role: input.role,
        }, this.operationCondition(operationId)),
        this.operationCleanup(operationId),
      ]);
      const invitation = results[3]?.results?.[0];
      if (!invitation) {
        const existingMember = await this.db.prepare(
          `SELECT 1 AS found FROM workspace_members m JOIN users u ON u.id = m.user_id
           WHERE m.workspace_id = ? AND lower(u.email) = lower(?) LIMIT 1`,
        ).bind(context.workspaceId, email).first();
        if (existingMember) throw new CollaborationRepositoryError("MEMBER_ALREADY_EXISTS", "User is already a member", 409);
        throw new CollaborationRepositoryError("MEMBER_QUOTA_EXCEEDED", "Workspace member quota exceeded", 403);
      }
      return { invitation: { ...invitation, status: invitationStatus(invitation, createdAt) }, token };
    } catch (error) {
      if (error instanceof CollaborationRepositoryError) throw error;
      if (this.isOperationGuardError(error)) {
        const existingMember = await this.db.prepare(
          `SELECT 1 AS found FROM workspace_members m JOIN users u ON u.id = m.user_id
           WHERE m.workspace_id = ? AND lower(u.email) = lower(?) LIMIT 1`,
        ).bind(context.workspaceId, email).first();
        if (existingMember) throw new CollaborationRepositoryError("MEMBER_ALREADY_EXISTS", "User is already a member", 409);
        throw new CollaborationRepositoryError("MEMBER_QUOTA_EXCEEDED", "Workspace member quota exceeded", 403);
      }
      if (error instanceof Error && /workspace_invitations_pending_email|UNIQUE constraint failed/iu.test(error.message)) {
        throw new CollaborationRepositoryError("INVITATION_ALREADY_PENDING", "An invitation is already pending", 409);
      }
      throw error;
    }
  }

  async previewInvitation(context: PublicTokenHashContext): Promise<InvitationPreview> {
    const now = this.now();
    const row = await this.db.prepare(
      `SELECT i.email, i.role, i.status, i.expires_at, w.name AS workspace_name,
              u.display_name AS inviter_display_name
       FROM workspace_invitations i
       JOIN workspaces w ON w.id = i.workspace_id
       JOIN users u ON u.id = i.created_by
       WHERE i.token_hash = ? LIMIT 1`,
    ).bind(context.tokenHash).first<InvitationPreview>();
    if (!row) throw new CollaborationRepositoryError("INVITATION_UNAVAILABLE", "Invitation is unavailable", 404);
    return {
      ...row,
      status: row.status === "pending" && row.expires_at <= now ? "expired" : row.status,
    };
  }

  async acceptInvitation(context: InvitationAcceptanceContext, requestId: string) {
    const now = this.now();
    const consumptionId = this.options.createId();
    const operationId = this.options.createId();
    const marker = this.db.prepare(
      `INSERT INTO collaboration_operation_results
       (operation_id, workspace_id, operation_type, target_id, created_at)
       SELECT ?, workspace_id, 'invitation.accept', id, ?
       FROM workspace_invitations
       WHERE token_hash = ? AND status = 'pending' AND consumed_at IS NULL AND expires_at > ?
         AND lower(email) = lower((SELECT email FROM users WHERE id = ?))
         AND NOT EXISTS (
           SELECT 1 FROM workspace_members m
           WHERE m.workspace_id = workspace_invitations.workspace_id AND m.user_id = ?
         )
         AND (SELECT COUNT(*) FROM workspace_members m WHERE m.workspace_id = workspace_invitations.workspace_id)
           < COALESCE(
             (SELECT limit_value FROM workspace_quotas q
              WHERE q.workspace_id = workspace_invitations.workspace_id AND q.quota_key = 'members'), ?
           )`,
    ).bind(operationId, now, context.tokenHash, now, context.userId, context.userId, this.options.memberLimit);
    const update = this.db.prepare(
      `UPDATE workspace_invitations
       SET status = 'accepted', consumed_at = ?, consumption_id = ?, consumed_by_user_id = ?,
           revision = revision + 1, updated_at = ?
       WHERE token_hash = ? AND status = 'pending' AND consumed_at IS NULL AND expires_at > ?
         AND lower(email) = lower((SELECT email FROM users WHERE id = ?))
         AND NOT EXISTS (
           SELECT 1 FROM workspace_members m
           WHERE m.workspace_id = workspace_invitations.workspace_id AND m.user_id = ?
         )
         AND (SELECT COUNT(*) FROM workspace_members m WHERE m.workspace_id = workspace_invitations.workspace_id)
           < COALESCE(
             (SELECT limit_value FROM workspace_quotas q
              WHERE q.workspace_id = workspace_invitations.workspace_id AND q.quota_key = 'members'), ?
           )
       RETURNING ${invitationColumns}`,
    ).bind(
      now, consumptionId, context.userId, now, context.tokenHash, now,
      context.userId, context.userId, this.options.memberLimit,
    );
    const insertMember = this.db.prepare(
      `INSERT INTO workspace_members (workspace_id, user_id, role, revision, joined_at, updated_at)
       SELECT workspace_id, ?, role, 1, ?, ? FROM workspace_invitations
       WHERE consumption_id = ? AND status = 'accepted' AND consumed_by_user_id = ?`,
    ).bind(context.userId, now, now, consumptionId, context.userId);
    const activityId = this.options.createId();
    const auditId = this.options.createId();
    let results: D1Result<InvitationRow>[];
    try {
      results = await this.db.batch<InvitationRow>([
      marker,
      this.operationGuard(operationId),
      update,
      insertMember,
      this.db.prepare(
        `INSERT INTO activity_logs
         (id, workspace_id, actor_user_id, request_id, action, entity_type, entity_id, target_type, target_id, metadata_json, created_at)
         SELECT ?, workspace_id, ?, ?, 'invitation.accepted', 'workspace_invitation', id,
                'workspace_member', ?, '{}', ?
         FROM workspace_invitations WHERE consumption_id = ? AND consumed_by_user_id = ?`,
      ).bind(activityId, context.userId, requestId, context.userId, now, consumptionId, context.userId),
      this.db.prepare(
        `INSERT INTO audit_logs
         (id, workspace_id, actor_user_id, request_id, action, target_type, target_id, outcome, metadata_json, created_at)
         SELECT ?, workspace_id, ?, ?, 'invitation.accepted', 'workspace_member', ?, 'success', '{}', ?
         FROM workspace_invitations WHERE consumption_id = ? AND consumed_by_user_id = ?`,
      ).bind(auditId, context.userId, requestId, context.userId, now, consumptionId, context.userId),
      this.operationCleanup(operationId),
    ]);
    } catch (error) {
      if (this.isOperationGuardError(error)) {
        throw new CollaborationRepositoryError("INVITATION_UNAVAILABLE", "Invitation is invalid, expired, or already used", 410);
      }
      throw error;
    }
    if (!results[2]?.results?.[0]) {
      throw new CollaborationRepositoryError("INVITATION_UNAVAILABLE", "Invitation is invalid, expired, or already used", 410);
    }
    const invitation = results[2].results[0];
    const member = await this.member(invitation.workspace_id, context.userId);
    if (!member) throw new CollaborationRepositoryError("INVITATION_UNAVAILABLE", "Invitation could not be accepted", 409);
    return member;
  }

  async listInvitations(context: WorkspaceContext) {
    if (context.role !== "owner") throw new CollaborationRepositoryError("MEMBER_MANAGEMENT_DENIED", "Owner permission required", 403);
    const now = this.now();
    const result = await this.db.prepare(
      `SELECT ${invitationColumns} FROM workspace_invitations
       WHERE workspace_id = ? ORDER BY created_at DESC, id DESC`,
    ).bind(context.workspaceId).all<InvitationRow>();
    return (result.results ?? []).map((row) => ({ ...row, status: invitationStatus(row, now) }));
  }

  async revokeInvitation(context: WorkspaceContext, invitationId: string, baseRevision: number, requestId: string) {
    if (context.role !== "owner") throw new CollaborationRepositoryError("MEMBER_MANAGEMENT_DENIED", "Owner permission required", 403);
    const now = this.now();
    const operationId = this.options.createId();
    let results: D1Result<InvitationRow>[];
    try {
      results = await this.db.batch<InvitationRow>([
      ...this.operationStart(operationId, "invitation.revoke", context.workspaceId, invitationId,
        `EXISTS (SELECT 1 FROM workspace_invitations
         WHERE workspace_id = ? AND id = ? AND revision = ? AND status = 'pending' AND consumed_at IS NULL)`,
        [context.workspaceId, invitationId, baseRevision]),
      this.db.prepare(
        `UPDATE workspace_invitations SET status = 'revoked', revision = revision + 1, updated_at = ?
         WHERE workspace_id = ? AND id = ? AND revision = ? AND status = 'pending' AND consumed_at IS NULL
         RETURNING ${invitationColumns}`,
      ).bind(now, context.workspaceId, invitationId, baseRevision),
      ...this.logStatements(context.workspaceId, context.userId, requestId, "invitation.revoked", "workspace_invitation", invitationId, {},
        this.operationCondition(operationId)),
      this.operationCleanup(operationId),
    ]);
    } catch (error) {
      if (this.isOperationGuardError(error)) {
        throw new CollaborationRepositoryError("INVITATION_CONFLICT", "Invitation is unavailable or changed", 409);
      }
      throw error;
    }
    const row = results[2]?.results?.[0];
    if (!row) throw new CollaborationRepositoryError("INVITATION_CONFLICT", "Invitation is unavailable or changed", 409);
    return { ...row, status: invitationStatus(row, now) };
  }

  async listMembers(context: WorkspaceContext) {
    const result = await this.db.prepare(
      `SELECT ${memberColumns} FROM workspace_members m JOIN users u ON u.id = m.user_id
       WHERE m.workspace_id = ? ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'editor' THEN 1 ELSE 2 END, u.display_name, m.user_id`,
    ).bind(context.workspaceId).all<MemberRow>();
    return result.results ?? [];
  }

  async updateMemberRole(context: WorkspaceContext, userId: string, input: UpdateWorkspaceMemberInput, requestId: string) {
    const current = await this.member(context.workspaceId, userId);
    const ownerCount = current?.role === "owner" ? await this.ownerCount(context.workspaceId) : 0;
    if (!current || !canManageWorkspaceMember(context.role, current.role, input.role, ownerCount)) {
      if (current?.role === "owner" && input.role !== "owner" && context.role === "owner" && ownerCount <= 1) {
        throw new CollaborationRepositoryError("LAST_OWNER_REQUIRED", "Workspace must retain an owner", 409);
      }
      throw new CollaborationRepositoryError("MEMBER_MANAGEMENT_DENIED", "Member role cannot be changed", 403);
    }
    if (current.revision !== input.base_revision) throw this.revisionConflict(current.revision, input.base_revision);
    const now = this.now();
    const operationId = this.options.createId();
    let results: D1Result<MemberRow>[];
    try {
      results = await this.db.batch<MemberRow>([
      ...this.operationStart(operationId, "member.role", context.workspaceId, userId,
        `EXISTS (SELECT 1 FROM workspace_members
         WHERE workspace_id = ? AND user_id = ? AND revision = ?
           AND (role <> 'owner' OR ? = 'owner' OR (
             SELECT COUNT(*) FROM workspace_members owners
             WHERE owners.workspace_id = workspace_members.workspace_id AND owners.role = 'owner'
           ) > 1))`,
        [context.workspaceId, userId, input.base_revision, input.role]),
      this.db.prepare(
        `UPDATE workspace_members SET role = ?, revision = revision + 1, updated_at = ?
         WHERE workspace_id = ? AND user_id = ? AND revision = ?
           AND (role <> 'owner' OR ? = 'owner' OR (
             SELECT COUNT(*) FROM workspace_members owners
             WHERE owners.workspace_id = workspace_members.workspace_id AND owners.role = 'owner'
           ) > 1)
         RETURNING user_id, '' AS email, '' AS display_name, role, revision, joined_at, updated_at`,
      ).bind(input.role, now, context.workspaceId, userId, input.base_revision, input.role),
      ...this.logStatements(context.workspaceId, context.userId, requestId, "member.role_changed", "workspace_member", userId, {
        role: input.role,
      }, this.operationCondition(operationId)),
      this.operationCleanup(operationId),
    ]);
    } catch (error) {
      if (!this.isOperationGuardError(error)) throw error;
      if (current.role === "owner" && input.role !== "owner" && await this.ownerCount(context.workspaceId) <= 1) {
        throw new CollaborationRepositoryError("LAST_OWNER_REQUIRED", "Workspace must retain an owner", 409);
      }
      const latest = await this.member(context.workspaceId, userId);
      throw this.revisionConflict(latest?.revision ?? current.revision, input.base_revision);
    }
    if (!results[2]?.results?.[0]) {
      if (current.role === "owner" && input.role !== "owner" && await this.ownerCount(context.workspaceId) <= 1) {
        throw new CollaborationRepositoryError("LAST_OWNER_REQUIRED", "Workspace must retain an owner", 409);
      }
      throw this.revisionConflict(current.revision, input.base_revision);
    }
    const member = await this.member(context.workspaceId, userId);
    if (!member) throw new CollaborationRepositoryError("MEMBER_NOT_FOUND", "Member not found", 404);
    return member;
  }

  async removeMember(context: WorkspaceContext, userId: string, baseRevision: number, requestId: string) {
    const current = await this.member(context.workspaceId, userId);
    const ownerCount = current?.role === "owner" ? await this.ownerCount(context.workspaceId) : 0;
    if (!current || !canManageWorkspaceMember(context.role, current.role, null, ownerCount)) {
      if (current?.role === "owner" && context.role === "owner" && ownerCount <= 1) {
        throw new CollaborationRepositoryError("LAST_OWNER_REQUIRED", "Workspace must retain an owner", 409);
      }
      throw new CollaborationRepositoryError("MEMBER_MANAGEMENT_DENIED", "Member cannot be removed", 403);
    }
    if (current.revision !== baseRevision) throw this.revisionConflict(current.revision, baseRevision);
    const now = this.now();
    const operationId = this.options.createId();
    try {
      await this.db.batch([
      ...this.operationStart(operationId, "member.remove", context.workspaceId, userId,
        `EXISTS (SELECT 1 FROM workspace_members
         WHERE workspace_id = ? AND user_id = ? AND revision = ?
           AND (role <> 'owner' OR (
             SELECT COUNT(*) FROM workspace_members owners
             WHERE owners.workspace_id = workspace_members.workspace_id AND owners.role = 'owner'
           ) > 1))`,
        [context.workspaceId, userId, baseRevision]),
      this.db.prepare(
        `DELETE FROM workspace_members WHERE workspace_id = ? AND user_id = ? AND revision = ?
         AND (role <> 'owner' OR (
           SELECT COUNT(*) FROM workspace_members owners
           WHERE owners.workspace_id = workspace_members.workspace_id AND owners.role = 'owner'
         ) > 1)`,
      ).bind(context.workspaceId, userId, baseRevision),
      ...this.logStatements(context.workspaceId, context.userId, requestId, "member.removed", "workspace_member", userId, {
        previous_role: current.role,
      }, this.operationCondition(operationId)),
      this.operationCleanup(operationId),
    ]);
    } catch (error) {
      if (!this.isOperationGuardError(error)) throw error;
      const latest = await this.member(context.workspaceId, userId);
      if (latest?.role === "owner" && await this.ownerCount(context.workspaceId) <= 1) {
        throw new CollaborationRepositoryError("LAST_OWNER_REQUIRED", "Workspace must retain an owner", 409);
      }
      throw this.revisionConflict(latest?.revision ?? current.revision, baseRevision);
    }
    const stillPresent = await this.member(context.workspaceId, userId);
    if (stillPresent) {
      if (stillPresent.role === "owner" && await this.ownerCount(context.workspaceId) <= 1) {
        throw new CollaborationRepositoryError("LAST_OWNER_REQUIRED", "Workspace must retain an owner", 409);
      }
      throw this.revisionConflict(stillPresent.revision, baseRevision);
    }
    const epoch = await this.db.prepare(
      `SELECT membership_epoch FROM workspace_membership_epochs
       WHERE workspace_id = ? AND user_id = ?`,
    ).bind(context.workspaceId, userId).first<{ membership_epoch: number }>();
    await this.notifyPresence(() => this.options.presence?.revoke({
      workspaceId: context.workspaceId,
      userId,
      membershipEpoch: epoch?.membership_epoch ?? baseRevision + 1,
    }));
    return { user_id: userId };
  }

  async createComment(context: WorkspaceContext, input: CreateCommentInput, requestId: string) {
    if (!canMutateComment(context.role, true)) {
      throw new CollaborationRepositoryError("COMMENT_WRITE_DENIED", "Comment permission denied", 403);
    }
    await this.assertTarget(context, input.target_type, input.target_id, "write");
    await this.assertCommentParent(context, input.target_type, input.target_id, input.parent_id ?? null);
    await this.assertMentionTargets(context.workspaceId, input.mention_user_ids);
    const existing = await this.commentByIdempotency(context.workspaceId, context.userId, input.idempotency_key);
    if (existing) return this.resolveCommentReplay(existing, context.userId, input);

    const id = this.options.createId();
    const operationId = this.options.createId();
    const createdAt = this.now();
    const idempotencyFingerprint = this.commentFingerprint(context.userId, input);
    const statements: D1PreparedStatement[] = [...this.operationStart(
      operationId,
      "comment.create",
      context.workspaceId,
      id,
      `EXISTS (SELECT 1 FROM workspace_members WHERE workspace_id = ? AND user_id = ?)
       AND NOT EXISTS (
         SELECT 1 FROM json_each(?) requested
         WHERE NOT EXISTS (
           SELECT 1 FROM workspace_members member
           WHERE member.workspace_id = ? AND member.user_id = requested.value
         )
       )`,
      [context.workspaceId, context.userId, JSON.stringify(input.mention_user_ids), context.workspaceId],
    ), this.db.prepare(
      `INSERT INTO comments
       (id, workspace_id, entity_type, entity_id, author_user_id, parent_id, body, revision, created_at, updated_at, idempotency_key, idempotency_fingerprint)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
    ).bind(
      id, context.workspaceId, input.target_type, input.target_id, context.userId,
      input.parent_id ?? null, input.body.trim(), createdAt, createdAt, input.idempotency_key, idempotencyFingerprint,
    )];
    statements.push(...this.mentionAndNotificationStatements(context, id, 1, input.target_type, input.target_id, input.mention_user_ids, createdAt));
    statements.push(...this.logStatements(context.workspaceId, context.userId, requestId, "comment.created", "comment", id, {
      target_type: input.target_type,
      mention_count: input.mention_user_ids.length,
    }, this.operationCondition(operationId)));
    statements.push(this.operationCleanup(operationId));
    try {
      await this.db.batch(statements);
    } catch (error) {
      if (this.isOperationGuardError(error)) {
        await this.assertMentionTargets(context.workspaceId, input.mention_user_ids);
        throw new CollaborationRepositoryError("COMMENT_WRITE_DENIED", "Comment membership changed", 403);
      }
      if (error instanceof Error && /comments_actor_idempotency|UNIQUE constraint failed: comments.workspace_id, comments.author_user_id, comments.idempotency_key/iu.test(error.message)) {
        const replay = await this.commentByIdempotency(context.workspaceId, context.userId, input.idempotency_key);
        if (replay) return this.resolveCommentReplay(replay, context.userId, input);
      }
      throw error;
    }
    const comment = await this.requireComment(context.workspaceId, id);
    await this.notifyPresence(() => this.options.presence?.invalidate({
      workspaceId: context.workspaceId, entityType: "comment", entityId: id, revision: comment.revision,
    }));
    return comment;
  }

  async createNotification(context: WorkspaceContext, input: {
    notificationId: string;
    userId: string;
    title: string;
    summary: string;
    deepLink: string;
    now: string;
    requestId?: string;
  }) {
    const member = await this.member(context.workspaceId, input.userId);
    if (!member) {
      throw new CollaborationRepositoryError("NOTIFICATION_TARGET_NOT_FOUND", "Notification target not found", 404);
    }
    const payloadMetadata = redactAuditMetadata({
      notification_id: input.notificationId,
      source: "ai_action",
      title: input.title,
      summary: input.summary,
    });
    const payload = JSON.stringify(payloadMetadata);
    await this.db.prepare(
      `INSERT INTO notifications
       (id, workspace_id, user_id, type, payload_json, deep_link, read_at, revision, created_at, updated_at)
       VALUES (?, ?, ?, 'ai_action', ?, ?, NULL, 1, ?, ?)
       ON CONFLICT(id) DO NOTHING`,
    ).bind(
      input.notificationId,
      context.workspaceId,
      input.userId,
      payload,
      input.deepLink,
      input.now,
      input.now,
    ).run();
    const row = await this.db.prepare(
      `SELECT ${notificationColumns} FROM notifications
       WHERE id = ? AND workspace_id = ? AND user_id = ? LIMIT 1`,
    ).bind(input.notificationId, context.workspaceId, input.userId).first<NotificationRow>();
    if (!row) {
      const collision = await this.db.prepare(
        "SELECT 1 AS present FROM notifications WHERE id = ? LIMIT 1",
      ).bind(input.notificationId).first<{ present: number }>();
      if (collision) {
        throw new CollaborationRepositoryError("NOTIFICATION_IDEMPOTENCY_CONFLICT", "Notification request conflicts with an existing request", 409);
      }
      throw new CollaborationRepositoryError("NOTIFICATION_CREATE_FAILED", "Notification could not be created", 500);
    }
    if (JSON.stringify(parseMetadata(row.payload_json)) !== JSON.stringify(payloadMetadata)) {
      throw new CollaborationRepositoryError("NOTIFICATION_IDEMPOTENCY_CONFLICT", "Notification request conflicts with an existing request", 409);
    }
    return this.toNotification(row);
  }

  async listComments(context: WorkspaceContext, targetType: CollaborationComment["target_type"], targetId: string) {
    await this.assertTarget(context, targetType, targetId, "read");
    const result = await this.db.prepare(
      `SELECT ${commentColumns} FROM comments c JOIN users u ON u.id = c.author_user_id
       WHERE c.workspace_id = ? AND c.entity_type = ? AND c.entity_id = ? AND c.deleted_at IS NULL
       ORDER BY c.created_at, c.id`,
    ).bind(context.workspaceId, targetType, targetId).all<CommentRow>();
    return Promise.all((result.results ?? []).map((row) => this.toComment(row)));
  }

  async updateComment(context: WorkspaceContext, commentId: string, input: UpdateCommentInput, requestId: string) {
    const current = await this.requireComment(context.workspaceId, commentId);
    if (!canMutateComment(context.role, current.author_user_id === context.userId)) {
      throw new CollaborationRepositoryError("COMMENT_WRITE_DENIED", "Comment permission denied", 403);
    }
    await this.assertTarget(context, current.target_type, current.target_id, "write");
    await this.assertMentionTargets(context.workspaceId, input.mention_user_ids);
    if (current.revision !== input.base_revision) throw this.revisionConflict(current.revision, input.base_revision);
    const now = this.now();
    const nextRevision = input.base_revision + 1;
    const operationId = this.options.createId();
    const statements: D1PreparedStatement[] = [...this.operationStart(
      operationId,
      "comment.update",
      context.workspaceId,
      commentId,
      `EXISTS (SELECT 1 FROM comments WHERE workspace_id = ? AND id = ? AND revision = ? AND deleted_at IS NULL)
       AND EXISTS (SELECT 1 FROM workspace_members WHERE workspace_id = ? AND user_id = ?)
       AND NOT EXISTS (
         SELECT 1 FROM json_each(?) requested
         WHERE NOT EXISTS (
           SELECT 1 FROM workspace_members member
           WHERE member.workspace_id = ? AND member.user_id = requested.value
         )
       )`,
      [
        context.workspaceId, commentId, input.base_revision, context.workspaceId, context.userId,
        JSON.stringify(input.mention_user_ids), context.workspaceId,
      ],
    ), this.db.prepare(
      `UPDATE comments SET body = ?, revision = revision + 1, updated_at = ?
       WHERE workspace_id = ? AND id = ? AND revision = ? AND deleted_at IS NULL
       RETURNING id`,
    ).bind(input.body.trim(), now, context.workspaceId, commentId, input.base_revision)];
    statements.push(this.db.prepare(
      `DELETE FROM mentions WHERE comment_id = ? AND EXISTS (
         SELECT 1 FROM comments WHERE workspace_id = ? AND id = ? AND revision = ? AND updated_at = ?
       )`,
    ).bind(commentId, context.workspaceId, commentId, nextRevision, now));
    statements.push(...this.mentionAndNotificationStatements(context, commentId, nextRevision, current.target_type, current.target_id, input.mention_user_ids, now));
    statements.push(...this.logStatements(context.workspaceId, context.userId, requestId, "comment.updated", "comment", commentId, {
      revision: nextRevision,
      mention_count: input.mention_user_ids.length,
    }, this.operationCondition(operationId)));
    statements.push(this.operationCleanup(operationId));
    let results: D1Result[];
    try {
      results = await this.db.batch(statements);
    } catch (error) {
      if (!this.isOperationGuardError(error)) throw error;
      await this.assertMentionTargets(context.workspaceId, input.mention_user_ids);
      const latest = await this.commentRow(context.workspaceId, commentId);
      throw this.revisionConflict(latest?.revision ?? current.revision, input.base_revision);
    }
    if ((results[2]?.meta.changes ?? 0) === 0) throw this.revisionConflict(current.revision, input.base_revision);
    const comment = await this.requireComment(context.workspaceId, commentId);
    await this.notifyPresence(() => this.options.presence?.invalidate({
      workspaceId: context.workspaceId, entityType: "comment", entityId: commentId, revision: comment.revision,
    }));
    return comment;
  }

  async deleteComment(context: WorkspaceContext, commentId: string, baseRevision: number, requestId: string) {
    const current = await this.requireComment(context.workspaceId, commentId);
    if (!canMutateComment(context.role, current.author_user_id === context.userId)) {
      throw new CollaborationRepositoryError("COMMENT_WRITE_DENIED", "Comment permission denied", 403);
    }
    await this.assertTarget(context, current.target_type, current.target_id, "write");
    if (current.revision !== baseRevision) throw this.revisionConflict(current.revision, baseRevision);
    const now = this.now();
    const operationId = this.options.createId();
    let results: D1Result[];
    try {
      results = await this.db.batch([
      ...this.operationStart(operationId, "comment.delete", context.workspaceId, commentId,
        `EXISTS (SELECT 1 FROM comments
         WHERE workspace_id = ? AND id = ? AND revision = ? AND deleted_at IS NULL)`,
        [context.workspaceId, commentId, baseRevision]),
      this.db.prepare(
        `UPDATE comments SET deleted_at = ?, revision = revision + 1, updated_at = ?
         WHERE workspace_id = ? AND id = ? AND revision = ? AND deleted_at IS NULL RETURNING id`,
      ).bind(now, now, context.workspaceId, commentId, baseRevision),
      ...this.logStatements(context.workspaceId, context.userId, requestId, "comment.deleted", "comment", commentId, {
        revision: baseRevision + 1,
      }, this.operationCondition(operationId)),
      this.operationCleanup(operationId),
    ]);
    } catch (error) {
      if (!this.isOperationGuardError(error)) throw error;
      const latest = await this.commentRow(context.workspaceId, commentId);
      throw this.revisionConflict(latest?.revision ?? current.revision, baseRevision);
    }
    if ((results[2]?.meta.changes ?? 0) === 0) throw this.revisionConflict(current.revision, baseRevision);
    await this.notifyPresence(() => this.options.presence?.invalidate({
      workspaceId: context.workspaceId, entityType: "comment", entityId: commentId, revision: baseRevision + 1,
    }));
    return { id: commentId };
  }

  async listNotifications(context: WorkspaceContext, options: { cursor?: string; limit: number }) {
    const limit = Math.max(1, Math.min(options.limit, 100));
    const conditions = ["workspace_id = ?", "user_id = ?"];
    const bindings: unknown[] = [context.workspaceId, context.userId];
    if (options.cursor) {
      const cursor = decodeCursor(options.cursor);
      conditions.push("(created_at < ? OR (created_at = ? AND id < ?))");
      bindings.push(cursor.createdAt, cursor.createdAt, cursor.id);
    }
    const result = await this.db.prepare(
      `SELECT ${notificationColumns} FROM notifications
       WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC, id DESC LIMIT ?`,
    ).bind(...bindings, limit + 1).all<NotificationRow>();
    const rows = result.results ?? [];
    const pageRows = rows.slice(0, limit);
    return {
      items: pageRows.map((row) => this.toNotification(row)),
      next_cursor: rows.length > limit && pageRows.length > 0 ? encodeCursor(pageRows.at(-1)!) : null,
    };
  }

  async unreadCount(context: WorkspaceContext) {
    const row = await this.db.prepare(
      "SELECT COUNT(*) AS count FROM notifications WHERE workspace_id = ? AND user_id = ? AND read_at IS NULL",
    ).bind(context.workspaceId, context.userId).first<{ count: number }>();
    return { unread_count: Number(row?.count ?? 0) };
  }

  async readNotifications(context: WorkspaceContext, input: NotificationReadInput) {
    const rows = await this.db.prepare(
      `SELECT id, revision FROM notifications
       WHERE workspace_id = ? AND user_id = ? AND id IN (SELECT value FROM json_each(?))`,
    ).bind(context.workspaceId, context.userId, JSON.stringify(input.notification_ids)).all<{ id: string; revision: number }>();
    if ((rows.results ?? []).length !== input.notification_ids.length) {
      throw new CollaborationRepositoryError("NOTIFICATION_NOT_FOUND", "Notification not found", 404);
    }
    const now = this.now();
    const result = await this.db.prepare(
      `WITH requested(id, expected_revision) AS (
         SELECT key, CAST(value AS INTEGER) FROM json_each(?)
       )
       UPDATE notifications
       SET read_at = COALESCE(read_at, ?), revision = revision + 1, updated_at = ?
       WHERE workspace_id = ?
         AND user_id = ?
         AND id IN (SELECT id FROM requested)
         AND (
           SELECT COUNT(*) FROM notifications current
           JOIN requested ON requested.id = current.id AND requested.expected_revision = current.revision
           WHERE current.workspace_id = ? AND current.user_id = ?
         ) = (SELECT COUNT(*) FROM requested)
       RETURNING id, revision`,
    ).bind(JSON.stringify(input.base_revisions), now, now, context.workspaceId, context.userId, context.workspaceId, context.userId).all<{ id: string; revision: number }>();
    if ((result.results ?? []).length !== input.notification_ids.length) {
      const currentRows = await this.db.prepare(
        `SELECT id, revision FROM notifications
         WHERE workspace_id = ? AND user_id = ? AND id IN (SELECT value FROM json_each(?))`,
      ).bind(context.workspaceId, context.userId, JSON.stringify(input.notification_ids)).all<{ id: string; revision: number }>();
      const currentById = new Map((currentRows.results ?? []).map((row) => [row.id, row.revision]));
      const missingId = input.notification_ids.find((id) => !currentById.has(id));
      if (missingId) throw new CollaborationRepositoryError("NOTIFICATION_NOT_FOUND", "Notification not found", 404);
      const staleId = input.notification_ids.find((id) => currentById.get(id) !== input.base_revisions[id]);
      if (staleId) throw this.revisionConflict(currentById.get(staleId)!, input.base_revisions[staleId] ?? 0);
      throw new CollaborationRepositoryError("NOTIFICATION_CONFLICT", "Notification state changed", 409);
    }
    return { notification_ids: input.notification_ids, read_at: now };
  }

  async readAllNotifications(context: WorkspaceContext) {
    const now = this.now();
    const result = await this.db.prepare(
      `UPDATE notifications SET read_at = ?, revision = revision + 1, updated_at = ?
       WHERE workspace_id = ? AND user_id = ? AND read_at IS NULL`,
    ).bind(now, now, context.workspaceId, context.userId).run();
    return { count: result.meta.changes, read_at: now };
  }

  listActivity(context: WorkspaceContext, options: { cursor?: string; limit: number }) {
    return this.activityPage(context.workspaceId, options);
  }

  async listAudit(context: WorkspaceContext, options: { cursor?: string; limit: number }) {
    if (context.role !== "owner") throw new CollaborationRepositoryError("AUDIT_READ_DENIED", "Owner permission required", 403);
    const page = this.pageQuery(options, ["workspace_id = ?"], [context.workspaceId]);
    const result = await this.db.prepare(
      `SELECT id, workspace_id, actor_user_id, request_id, action, target_type, target_id, outcome, metadata_json, created_at
       FROM audit_logs WHERE ${page.conditions.join(" AND ")}
       ORDER BY created_at DESC, id DESC LIMIT ?`,
    ).bind(...page.bindings, page.limit + 1).all<AuditRow>();
    const rows = result.results ?? [];
    const pageRows = rows.slice(0, page.limit);
    return {
      items: pageRows.map(toAudit),
      next_cursor: rows.length > page.limit && pageRows.length > 0 ? encodeCursor(pageRows.at(-1)!) : null,
    };
  }

  async appendActivityAndAudit(context: WorkspaceContext, input: AppendActivityAuditInput) {
    const now = this.now();
    const activityId = this.options.createId();
    const auditId = this.options.createId();
    const metadata = JSON.stringify(redactAuditMetadata(input.metadata));
    const results = await this.db.batch([
      this.db.prepare(
        `INSERT INTO activity_logs
         (id, workspace_id, actor_user_id, request_id, action, entity_type, entity_id, target_type, target_id, metadata_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING id, workspace_id, actor_user_id, request_id, action, target_type, target_id,
                   entity_type, entity_id, metadata_json, created_at`,
      ).bind(
        activityId, context.workspaceId, context.userId, input.request_id, input.action,
        input.target_type, input.target_id, input.target_type, input.target_id, metadata, now,
      ),
      this.db.prepare(
        `INSERT INTO audit_logs
         (id, workspace_id, actor_user_id, request_id, action, target_type, target_id, outcome, metadata_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING id, workspace_id, actor_user_id, request_id, action, target_type, target_id,
                   outcome, metadata_json, created_at`,
      ).bind(
        auditId, context.workspaceId, context.userId, input.request_id, input.action,
        input.target_type, input.target_id, input.outcome, metadata, now,
      ),
    ]);
    const activity = results[0]?.results?.[0] as ActivityRow | undefined;
    const audit = results[1]?.results?.[0] as AuditRow | undefined;
    if (!activity || !audit) throw new CollaborationRepositoryError("AUDIT_APPEND_FAILED", "Activity and audit append failed", 500);
    return { activity: toActivity(activity), audit: toAudit(audit) };
  }

  async createPublicShare(context: WorkspaceContext, input: CreatePublicShareInput, requestId: string) {
    if (context.role === "viewer") throw new CollaborationRepositoryError("SHARE_WRITE_DENIED", "Share permission denied", 403);
    await this.assertShareTarget(context, input.entity_type, input.entity_id);
    const token = this.options.tokens.createSessionToken();
    const tokenHash = await this.options.tokens.hash(token);
    const passwordHash = input.password ? await this.options.password.hash(input.password) : null;
    const now = this.now();
    const expiresAt = input.expires_in_hours
      ? new Date(this.options.clock().getTime() + input.expires_in_hours * 3_600_000).toISOString()
      : null;
    const id = this.options.createId();
    const results = await this.db.batch<ShareRow>([
      this.db.prepare(
        `INSERT INTO public_shares
         (id, workspace_id, entity_type, entity_id, token_hash, password_hash, password_salt,
          expires_at, revoked_at, revision, created_by, created_at, updated_at, status)
         VALUES (?, ?, ?, ?, ?, ?, NULL, ?, NULL, 1, ?, ?, ?, 'active')
         RETURNING ${shareColumns}`,
      ).bind(id, context.workspaceId, input.entity_type, input.entity_id, tokenHash, passwordHash, expiresAt, context.userId, now, now),
      ...this.logStatements(context.workspaceId, context.userId, requestId, "public_share.created", "public_share", id, {
        entity_type: input.entity_type,
        password_required: Boolean(passwordHash),
        expires: Boolean(expiresAt),
      }),
    ]);
    const row = results[0]?.results?.[0];
    if (!row) throw new CollaborationRepositoryError("SHARE_CREATE_FAILED", "Share could not be created", 500);
    return { share: toShare(row, now), token };
  }

  async listPublicShares(context: WorkspaceContext, entityType?: PublicShare["entity_type"], entityId?: string) {
    if (!canPerformCollaborationAction(context.role, "create_share")) {
      throw new CollaborationRepositoryError("SHARE_READ_DENIED", "Share metadata permission denied", 403);
    }
    const conditions = ["workspace_id = ?"];
    const bindings: unknown[] = [context.workspaceId];
    if (entityType) {
      conditions.push("entity_type = ?");
      bindings.push(entityType);
    }
    if (entityId) {
      conditions.push("entity_id = ?");
      bindings.push(entityId);
    }
    const result = await this.db.prepare(
      `SELECT ${shareColumns} FROM public_shares WHERE ${conditions.join(" AND ")}
       ORDER BY created_at DESC, id DESC`,
    ).bind(...bindings).all<ShareRow>();
    const now = this.now();
    return (result.results ?? []).map((row) => toShare(row, now));
  }

  async accessPublicShare(
    context: PublicTokenHashContext,
    input: PublicSharePasswordVerificationInput,
    requestId: string,
  ): Promise<PublicSharedContent> {
    const now = this.now();
    const row = await this.db.prepare(
      `SELECT ${shareColumns} FROM public_shares WHERE token_hash = ? LIMIT 1`,
    ).bind(context.tokenHash).first<ShareRow>();
    if (!row || row.status !== "active" || row.revoked_at || (row.expires_at && row.expires_at <= now)) {
      if (row) await this.appendPublicEvent(row, requestId, "public_share.accessed", "denied", { reason: "unavailable" });
      throw new CollaborationRepositoryError("PUBLIC_SHARE_UNAVAILABLE", "Shared content is unavailable", 404);
    }
    if (row.password_hash) {
      if (!input.password || !await this.options.password.verify(input.password, row.password_hash)) {
        await this.appendPublicEvent(row, requestId, "public_share.password_attempt", "denied", { password_required: true });
        throw new CollaborationRepositoryError("PUBLIC_SHARE_PASSWORD_INVALID", "Share password is invalid", 401);
      }
      await this.appendPublicEvent(row, requestId, "public_share.password_attempt", "success", { password_required: true });
    }
    if (row.entity_type === "note") {
      const note = await this.db.prepare(
        `SELECT title, content, revision, updated_at FROM notes
         WHERE workspace_id = ? AND id = ? AND status <> 'trashed' AND deleted_at IS NULL LIMIT 1`,
      ).bind(row.workspace_id, row.entity_id).first<{ title: string; content: string; revision: number; updated_at: string }>();
      if (!note) {
        await this.appendPublicEvent(row, requestId, "public_share.accessed", "failure", { reason: "target_unavailable" });
        throw new CollaborationRepositoryError("PUBLIC_SHARE_UNAVAILABLE", "Shared content is unavailable", 404);
      }
      await this.appendPublicEvent(row, requestId, "public_share.accessed", "success", { entity_type: "note" });
      return filterPublicShareContent({ share_id: row.id, entity_type: "note", ...note }) as PublicSharedContent;
    }
    const view = await this.db.prepare(
      `SELECT v.name AS title, v.revision, v.updated_at FROM database_views v
       WHERE v.workspace_id = ? AND v.id = ? LIMIT 1`,
    ).bind(row.workspace_id, row.entity_id).first<{ title: string; revision: number; updated_at: string }>();
    if (!view) {
      await this.appendPublicEvent(row, requestId, "public_share.accessed", "failure", { reason: "target_unavailable" });
      throw new CollaborationRepositoryError("PUBLIC_SHARE_UNAVAILABLE", "Shared content is unavailable", 404);
    }
    await this.appendPublicEvent(row, requestId, "public_share.accessed", "success", { entity_type: "database_view" });
    return filterPublicShareContent({ share_id: row.id, entity_type: "database_view", ...view }) as PublicSharedContent;
  }

  async revokePublicShare(context: WorkspaceContext, shareId: string, baseRevision: number, requestId: string) {
    const current = await this.db.prepare(
      `SELECT ${shareColumns} FROM public_shares WHERE workspace_id = ? AND id = ? LIMIT 1`,
    ).bind(context.workspaceId, shareId).first<ShareRow>();
    if (!current || (context.role !== "owner" && current.created_by !== context.userId)) {
      throw new CollaborationRepositoryError("SHARE_WRITE_DENIED", "Share permission denied", 403);
    }
    if (current.revision !== baseRevision) throw this.revisionConflict(current.revision, baseRevision);
    const now = this.now();
    const operationId = this.options.createId();
    let results: D1Result<ShareRow>[];
    try {
      results = await this.db.batch<ShareRow>([
      ...this.operationStart(operationId, "public_share.revoke", context.workspaceId, shareId,
        `EXISTS (SELECT 1 FROM public_shares
         WHERE workspace_id = ? AND id = ? AND revision = ? AND status = 'active')`,
        [context.workspaceId, shareId, baseRevision]),
      this.db.prepare(
        `UPDATE public_shares SET status = 'revoked', revoked_at = ?, revision = revision + 1, updated_at = ?
         WHERE workspace_id = ? AND id = ? AND revision = ? AND status = 'active'
         RETURNING ${shareColumns}`,
      ).bind(now, now, context.workspaceId, shareId, baseRevision),
      ...this.logStatements(context.workspaceId, context.userId, requestId, "public_share.revoked", "public_share", shareId, {},
        this.operationCondition(operationId)),
      this.operationCleanup(operationId),
    ]);
    } catch (error) {
      if (this.isOperationGuardError(error)) {
        throw new CollaborationRepositoryError("SHARE_CONFLICT", "Share is unavailable or changed", 409);
      }
      throw error;
    }
    const row = results[2]?.results?.[0];
    if (!row) throw new CollaborationRepositoryError("SHARE_CONFLICT", "Share is unavailable or changed", 409);
    return toShare(row, now);
  }

  private now() {
    return this.options.clock().toISOString();
  }

  private revisionConflict(current: number, expected: number) {
    return new CollaborationRepositoryError("REVISION_CONFLICT", "Entity revision changed", 409, {
      current_revision: current,
      expected_revision: expected,
    });
  }

  private member(workspaceId: string, userId: string) {
    return this.db.prepare(
      `SELECT ${memberColumns} FROM workspace_members m JOIN users u ON u.id = m.user_id
       WHERE m.workspace_id = ? AND m.user_id = ? LIMIT 1`,
    ).bind(workspaceId, userId).first<MemberRow>();
  }

  private async ownerCount(workspaceId: string) {
    const row = await this.db.prepare(
      "SELECT COUNT(*) AS count FROM workspace_members WHERE workspace_id = ? AND role = 'owner'",
    ).bind(workspaceId).first<{ count: number }>();
    return Number(row?.count ?? 0);
  }

  private async assertTarget(
    context: WorkspaceContext,
    targetType: CollaborationComment["target_type"],
    targetId: string,
    mode: "read" | "write",
  ) {
    if (targetType === "note") {
      const note = await this.db.prepare(
        "SELECT 1 AS found FROM notes WHERE workspace_id = ? AND id = ? AND deleted_at IS NULL LIMIT 1",
      ).bind(context.workspaceId, targetId).first();
      if (!note) throw new CollaborationRepositoryError("COMMENT_TARGET_NOT_FOUND", "Comment target not found", 404);
      return;
    }
    const record = await this.db.prepare(
      `SELECT database_id FROM database_records
       WHERE workspace_id = ? AND id = ? AND deleted_at IS NULL LIMIT 1`,
    ).bind(context.workspaceId, targetId).first<{ database_id: string }>();
    if (!record) throw new CollaborationRepositoryError("COMMENT_TARGET_NOT_FOUND", "Comment target not found", 404);
    await this.databaseAccess.assert(context, record.database_id, mode);
  }

  private async assertMentionTargets(workspaceId: string, userIds: string[]) {
    if (userIds.length === 0) return;
    const invalid = await this.db.prepare(
      `SELECT value AS user_id FROM json_each(?) requested
       WHERE NOT EXISTS (
         SELECT 1 FROM workspace_members m WHERE m.workspace_id = ? AND m.user_id = requested.value
       ) LIMIT 1`,
    ).bind(JSON.stringify(userIds), workspaceId).first<{ user_id: string }>();
    if (invalid) {
      throw new CollaborationRepositoryError("MENTION_TARGET_INVALID", "Mention target is not a current member", 400, {
        user_id: invalid.user_id,
      });
    }
  }

  private async assertCommentParent(
    context: WorkspaceContext,
    targetType: CollaborationComment["target_type"],
    targetId: string,
    parentId: string | null,
  ) {
    if (!parentId) return;
    const parent = await this.db.prepare(
      `SELECT 1 AS found FROM comments
       WHERE workspace_id = ? AND id = ? AND entity_type = ? AND entity_id = ? AND deleted_at IS NULL LIMIT 1`,
    ).bind(context.workspaceId, parentId, targetType, targetId).first();
    if (!parent) throw new CollaborationRepositoryError("COMMENT_PARENT_INVALID", "Comment parent is invalid", 400);
  }

  private mentionAndNotificationStatements(
    context: WorkspaceContext,
    commentId: string,
    revision: number,
    targetType: CollaborationComment["target_type"],
    targetId: string,
    userIds: string[],
    now: string,
  ) {
    const deepLink = targetType === "note"
      ? `/notes/${encodeURIComponent(targetId)}?comment=${encodeURIComponent(commentId)}`
      : `/databases/records/${encodeURIComponent(targetId)}?comment=${encodeURIComponent(commentId)}`;
    const statements: D1PreparedStatement[] = [];
    for (const userId of userIds) {
      statements.push(this.db.prepare(
        `INSERT INTO mentions (id, workspace_id, comment_id, note_id, mentioned_user_id, created_at, source_revision)
         SELECT ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (
           SELECT 1 FROM comments WHERE workspace_id = ? AND id = ? AND revision = ? AND deleted_at IS NULL
         )`,
      ).bind(
        this.options.createId(), context.workspaceId, commentId, targetType === "note" ? targetId : null,
        userId, now, revision, context.workspaceId, commentId, revision,
      ));
      const dedupeKey = `comment:${commentId}:revision:${revision}:mention:${userId}`;
      const payload = JSON.stringify(redactAuditMetadata({
        actor_user_id: context.userId,
        target_type: targetType,
        target_id: targetId,
        comment_id: commentId,
      }));
      statements.push(this.db.prepare(
        `INSERT OR IGNORE INTO notifications
         (id, workspace_id, user_id, type, payload_json, read_at, revision, created_at, dedupe_key, deep_link, updated_at)
         SELECT ?, ?, ?, 'mention', ?, NULL, 1, ?, ?, ?, ? WHERE EXISTS (
           SELECT 1 FROM comments WHERE workspace_id = ? AND id = ? AND revision = ? AND deleted_at IS NULL
         )`,
      ).bind(
        this.options.createId(), context.workspaceId, userId, payload, now, dedupeKey, deepLink, now,
        context.workspaceId, commentId, revision,
      ));
    }
    return statements;
  }

  private async commentByIdempotency(workspaceId: string, actorUserId: string, idempotencyKey: string) {
    const row = await this.db.prepare(
      `SELECT ${commentColumns} FROM comments c JOIN users u ON u.id = c.author_user_id
       WHERE c.workspace_id = ? AND c.author_user_id = ? AND c.idempotency_key = ? LIMIT 1`,
    ).bind(workspaceId, actorUserId, idempotencyKey).first<CommentRow>();
    if (!row) return null;
    return { row, comment: await this.toComment(row) };
  }

  private async commentRow(workspaceId: string, commentId: string) {
    return this.db.prepare(
      `SELECT ${commentColumns} FROM comments c JOIN users u ON u.id = c.author_user_id
       WHERE c.workspace_id = ? AND c.id = ? LIMIT 1`,
    ).bind(workspaceId, commentId).first<CommentRow>();
  }

  private resolveCommentReplay(
    existing: { row: CommentRow; comment: CollaborationComment },
    actorUserId: string,
    input: CreateCommentInput,
  ) {
    const expected = this.commentFingerprint(actorUserId, input);
    const actual = existing.row.idempotency_fingerprint ?? this.commentFingerprint(existing.row.author_user_id, {
      target_type: existing.row.target_type,
      target_id: existing.row.target_id,
      ...(existing.row.parent_id ? { parent_id: existing.row.parent_id } : {}),
      body: existing.row.body,
      mention_user_ids: existing.comment.mention_user_ids,
      idempotency_key: input.idempotency_key,
    });
    if (actual !== expected) {
      throw new CollaborationRepositoryError("IDEMPOTENCY_CONFLICT", "Idempotency key payload does not match", 409);
    }
    if (existing.row.deleted_at) {
      throw new CollaborationRepositoryError("IDEMPOTENCY_TOMBSTONE", "Idempotent comment was deleted", 409);
    }
    return existing.comment;
  }

  private commentFingerprint(actorUserId: string, input: CreateCommentInput) {
    return JSON.stringify({
      actor_user_id: actorUserId,
      target_type: input.target_type,
      target_id: input.target_id,
      parent_id: input.parent_id ?? null,
      body: input.body.trim(),
      mention_user_ids: [...input.mention_user_ids].sort(),
    });
  }

  private async requireComment(workspaceId: string, commentId: string) {
    const row = await this.db.prepare(
      `SELECT ${commentColumns} FROM comments c JOIN users u ON u.id = c.author_user_id
       WHERE c.workspace_id = ? AND c.id = ? AND c.deleted_at IS NULL LIMIT 1`,
    ).bind(workspaceId, commentId).first<CommentRow>();
    if (!row) throw new CollaborationRepositoryError("COMMENT_NOT_FOUND", "Comment not found", 404);
    return this.toComment(row);
  }

  private async toComment(row: CommentRow): Promise<CollaborationComment> {
    const mentions = await this.db.prepare(
      "SELECT mentioned_user_id FROM mentions WHERE workspace_id = ? AND comment_id = ? ORDER BY mentioned_user_id",
    ).bind(row.workspace_id, row.id).all<{ mentioned_user_id: string }>();
    const { deleted_at: _deletedAt, idempotency_key: _idempotencyKey, idempotency_fingerprint: _idempotencyFingerprint, ...comment } = row;
    return { ...comment, mention_user_ids: (mentions.results ?? []).map((mention) => mention.mentioned_user_id) };
  }

  private toNotification(row: NotificationRow): Notification {
    const { payload_json, ...notification } = row;
    return { ...notification, payload: parseMetadata(payload_json) };
  }

  private pageQuery(options: { cursor?: string; limit: number }, conditions: string[], bindings: unknown[]) {
    const limit = Math.max(1, Math.min(options.limit, 100));
    if (options.cursor) {
      const cursor = decodeCursor(options.cursor);
      conditions.push("(created_at < ? OR (created_at = ? AND id < ?))");
      bindings.push(cursor.createdAt, cursor.createdAt, cursor.id);
    }
    return { conditions, bindings, limit };
  }

  private async activityPage(workspaceId: string, options: { cursor?: string; limit: number }) {
    const page = this.pageQuery(options, ["workspace_id = ?"], [workspaceId]);
    const result = await this.db.prepare(
      `SELECT id, workspace_id, actor_user_id, request_id, action, target_type, target_id,
              entity_type, entity_id, metadata_json, created_at
       FROM activity_logs WHERE ${page.conditions.join(" AND ")}
       ORDER BY created_at DESC, id DESC LIMIT ?`,
    ).bind(...page.bindings, page.limit + 1).all<ActivityRow>();
    const rows = result.results ?? [];
    const pageRows = rows.slice(0, page.limit);
    return {
      items: pageRows.map(toActivity),
      next_cursor: rows.length > page.limit && pageRows.length > 0 ? encodeCursor(pageRows.at(-1)!) : null,
    };
  }

  private async assertShareTarget(context: WorkspaceContext, entityType: PublicShare["entity_type"], entityId: string) {
    if (entityType === "note") {
      const note = await this.db.prepare(
        "SELECT 1 AS found FROM notes WHERE workspace_id = ? AND id = ? AND deleted_at IS NULL LIMIT 1",
      ).bind(context.workspaceId, entityId).first();
      if (!note) throw new CollaborationRepositoryError("SHARE_TARGET_NOT_FOUND", "Share target not found", 404);
      return;
    }
    const view = await this.db.prepare(
      "SELECT database_id FROM database_views WHERE workspace_id = ? AND id = ? LIMIT 1",
    ).bind(context.workspaceId, entityId).first<{ database_id: string }>();
    if (!view) throw new CollaborationRepositoryError("SHARE_TARGET_NOT_FOUND", "Share target not found", 404);
    await this.databaseAccess.assert(context, view.database_id, "read");
  }

  private async appendPublicEvent(
    share: ShareRow,
    requestId: string,
    action: string,
    outcome: AuditEntry["outcome"],
    metadata: Record<string, unknown>,
  ) {
    const now = this.now();
    const safeMetadata = JSON.stringify(redactAuditMetadata(metadata));
    await this.db.batch([
      this.db.prepare(
        `INSERT INTO activity_logs
         (id, workspace_id, actor_user_id, request_id, action, entity_type, entity_id, target_type, target_id, metadata_json, created_at)
         VALUES (?, ?, NULL, ?, ?, 'public_share', ?, 'public_share', ?, ?, ?)`,
      ).bind(this.options.createId(), share.workspace_id, requestId, action, share.id, share.id, safeMetadata, now),
      this.db.prepare(
        `INSERT INTO audit_logs
         (id, workspace_id, actor_user_id, request_id, action, target_type, target_id, outcome, metadata_json, created_at)
         VALUES (?, ?, NULL, ?, ?, 'public_share', ?, ?, ?, ?)`,
      ).bind(this.options.createId(), share.workspace_id, requestId, action, share.id, outcome, safeMetadata, now),
    ]);
  }

  private logStatements(
    workspaceId: string,
    actorUserId: string | null,
    requestId: string,
    action: string,
    targetType: string,
    targetId: string | null,
    metadata: Record<string, unknown>,
    condition = "1 = 1",
  ) {
    return prepareActivityAndAuditStatements(this.db, this.options.createId, {
      workspaceId,
      actorUserId,
      requestId,
      action,
      targetType,
      targetId,
      metadata,
      createdAt: this.now(),
      condition,
    });
  }

  private operationStart(
    operationId: string,
    operationType: string,
    workspaceId: string,
    targetId: string | null,
    condition: string,
    bindings: unknown[],
  ) {
    return [
      this.db.prepare(
        `INSERT INTO collaboration_operation_results
         (operation_id, workspace_id, operation_type, target_id, created_at)
         SELECT ?, ?, ?, ?, ? WHERE ${condition}`,
      ).bind(operationId, workspaceId, operationType, targetId, this.now(), ...bindings),
      this.operationGuard(operationId),
    ];
  }

  private operationGuard(operationId: string) {
    return this.db.prepare(
      `INSERT INTO collaboration_operation_guard (id)
       SELECT 1 WHERE NOT EXISTS (
         SELECT 1 FROM collaboration_operation_results WHERE operation_id = ?
       )`,
    ).bind(operationId);
  }

  private operationCleanup(operationId: string) {
    return this.db.prepare(
      "DELETE FROM collaboration_operation_results WHERE operation_id = ?",
    ).bind(operationId);
  }

  private operationCondition(operationId: string) {
    return `EXISTS (SELECT 1 FROM collaboration_operation_results WHERE operation_id = '${operationId.replaceAll("'", "''")}')`;
  }

  private isOperationGuardError(error: unknown) {
    return error instanceof Error
      && /UNIQUE constraint failed: collaboration_operation_guard\.id/iu.test(error.message);
  }

  private async notifyPresence(callback: () => Promise<void> | undefined) {
    try {
      await callback();
    } catch {
      // Presence is advisory; D1 remains authoritative after a successful commit.
    }
  }
}
