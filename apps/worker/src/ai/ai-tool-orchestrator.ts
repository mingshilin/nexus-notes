import { evaluateAiToolPolicy } from "@nexus/domain";
import { AI_ACTION_PROPOSAL_TTL_MS, type AiActionExecutionResult, type QueueJob, type WorkspaceContext } from "@nexus/contracts";

import {
  AiToolError,
  aiActionTargetId,
  assertAiToolName,
  type AiToolInput,
  type AiToolCall,
  type AiToolRepositoryPort,
  type StoredAiActionProposal,
} from "./ai-tool-model";
import { validateAiActionProposal } from "./ai-tool-model";
import { isAiOrganizationTool, normalizeAiOrganizationInput, type AiOrganizationTools } from "./ai-organization-tools";

interface AiToolOrchestratorDependencies {
  repository: AiToolRepositoryPort;
  assertFreshPermission(context: WorkspaceContext, proposal: StoredAiActionProposal): Promise<void> | void;
  createId?: () => string;
  clock?: () => Date;
}

interface AiActionPolicy {
  trusted?: boolean;
}

interface AiToolExecutionDependencies {
  noteService: {
    create(context: WorkspaceContext & { requestId?: string; targetId?: string }, input: unknown): Promise<unknown>;
    update(context: WorkspaceContext & { requestId?: string; targetId?: string }, noteId: string, input: unknown): Promise<unknown>;
    get(context: WorkspaceContext, noteId: string): Promise<unknown>;
  };
  knowledgeService: {
    createReminder(context: { workspaceId: string; userId: string; targetId?: string }, input: unknown): Promise<unknown>;
  };
  collaborationRepository: {
    createNotification(
      context: WorkspaceContext,
      input: {
        notificationId: string;
        userId: string;
        title: string;
        summary: string;
        deepLink: string;
        now: string;
        requestId?: string;
      },
    ): Promise<unknown>;
  };
  emailOutboxRepository: {
    enqueue(input: {
      actionId: string;
      userId: string;
      workspaceId: string;
      toEmail: string;
      subject: string;
      bodyText: string;
      now: string;
    }): Promise<{ id: string; action_id: string; to_email: string; subject: string; body_text: string }>;
  };
  organization?: AiOrganizationTools;
  queue?: {
    send(message: QueueJob): Promise<unknown>;
  };
  requestId?: string;
  clock?: () => Date;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function pickInput(source: Record<string, unknown>, keys: readonly string[]) {
  const target: Record<string, unknown> = {};
  for (const key of keys) {
    if (key in source) target[key] = source[key];
  }
  return target;
}

function assertAllowedKeys(source: Record<string, unknown>, allowed: readonly string[]) {
  const allowedKeys = new Set(allowed);
  if (Object.keys(source).some((key) => !allowedKeys.has(key))) {
    throw new AiToolError("AI_ACTION_TOOL_INVALID", "AI tool input contains an unknown field", 400);
  }
}

function summaryForTool(tool: StoredAiActionProposal["tool"]) {
  switch (tool) {
    case "create_note":
      return "创建笔记待确认";
    case "create_reminder":
      return "创建提醒待确认";
    case "create_notification":
      return "创建通知待确认";
    case "send_email":
      return "发送邮件待确认";
    case "update_note":
      return "更新笔记待确认";
    case "move_note":
      return "移动笔记待确认";
    case "archive_note":
      return "归档笔记待确认";
    case "restore_note":
      return "恢复笔记待确认";
    case "delete_note":
      return "移入回收站待确认";
    case "create_folder":
      return "创建文件夹待确认";
    case "apply_tag":
      return "整理笔记标签待确认";
    case "create_database_record":
      return "创建数据库记录待确认";
    case "update_database_record":
      return "更新数据库记录待确认";
    case "apply_template":
      return "应用数据库模板待确认";
  }
}

function proposalExpiry(clock: () => Date) {
  return new Date(clock().getTime() + AI_ACTION_PROPOSAL_TTL_MS).toISOString();
}

function requireWorkspaceContext(context: WorkspaceContext) {
  if (!context.workspaceId || !context.userId) {
    throw new AiToolError("AI_ACTION_CONTEXT_INVALID", "Workspace context is required", 400);
  }
  return context;
}

const EXECUTION_POLL_INTERVAL_MS = 25;
const EXECUTION_POLL_TIMEOUT_MS = 8_000;

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function requiredCapability(tool: StoredAiActionProposal["tool"]) {
  switch (tool) {
    case "create_note":
    case "update_note":
    case "move_note":
    case "archive_note":
    case "restore_note":
    case "delete_note":
      return "notes.write";
    case "create_reminder":
      return "reminders.write";
    case "create_notification":
      return "notifications.write";
    case "send_email":
      return "email.write";
    case "create_folder":
    case "apply_tag":
      return "notes.write";
    case "create_database_record":
    case "update_database_record":
    case "apply_template":
      return "databases.write";
  }
}

function assertActionPermission(context: WorkspaceContext, tool: StoredAiActionProposal["tool"]) {
  if (context.role === "viewer") {
    throw new AiToolError("AI_ACTION_PERMISSION_DENIED", "Viewer permission is insufficient", 403);
  }
  const capability = requiredCapability(tool);
  if (context.role !== "owner" && !context.capabilities.has(capability)) {
    throw new AiToolError("AI_ACTION_PERMISSION_DENIED", "AI action capability is unavailable", 403);
  }
}

function normalizedInput(name: string, raw: unknown): { tool: ReturnType<typeof assertAiToolName>; input: AiToolInput } {
  const tool = assertAiToolName(name);
  if (!isPlainObject(raw)) {
    throw new AiToolError("AI_ACTION_TOOL_INVALID", "AI tool arguments must be an object", 400);
  }
  const argumentsObject = raw;
  if (isAiOrganizationTool(tool)) {
    try {
      return normalizeAiOrganizationInput(tool, argumentsObject);
    } catch {
      throw new AiToolError("AI_ACTION_TOOL_INVALID", "AI organization tool input is invalid", 400);
    }
  }
  const commonKeys = ["workspace_id"] as const;
  const allowedKeys = tool === "create_note"
    ? [...commonKeys, "title", "content", "folder_id", "database_id", "daily_date"]
    : tool === "create_reminder"
      ? [...commonKeys, "note_id", "title", "remind_at", "timezone"]
      : tool === "create_notification"
        ? [...commonKeys, "title", "body_text"]
        : tool === "send_email"
          ? [...commonKeys, "to_email", "subject", "body_text"]
          : [...commonKeys, "target_note_id", "base_revision", "patch"];
  assertAllowedKeys(argumentsObject, allowedKeys);
  if (["update_note", "move_note"].includes(tool)) {
    if (!isPlainObject(argumentsObject.patch)) {
      throw new AiToolError("AI_ACTION_TOOL_INVALID", "AI note update requires a patch object", 400);
    }
    const allowedPatchKeys = tool === "move_note"
      ? ["folder_id"]
      : ["title", "content", "folder_id", "database_id", "daily_date", "is_favorite", "is_pinned"];
    assertAllowedKeys(argumentsObject.patch, allowedPatchKeys);
  } else if (["archive_note", "restore_note", "delete_note"].includes(tool) && "patch" in argumentsObject) {
    throw new AiToolError("AI_ACTION_TOOL_INVALID", "Lifecycle status is derived from the selected tool", 400);
  }
  const input = tool === "create_note"
    ? pickInput(argumentsObject, ["title", "content", "folder_id", "database_id", "daily_date"])
    : tool === "create_reminder"
      ? pickInput(argumentsObject, ["note_id", "title", "remind_at", "timezone"])
      : tool === "create_notification"
        ? pickInput(argumentsObject, ["title", "body_text"])
        : tool === "send_email"
          ? pickInput(argumentsObject, ["to_email", "subject", "body_text"])
          : (() => {
            const target = pickInput(argumentsObject, ["target_note_id", "base_revision"]);
            const rawPatch = isPlainObject(argumentsObject.patch) ? argumentsObject.patch : {};
            if (tool === "update_note") return { ...target, patch: pickInput(rawPatch, ["title", "content", "folder_id", "database_id", "daily_date", "is_favorite", "is_pinned", "status"]) };
            if (tool === "move_note") return { ...target, patch: pickInput(rawPatch, ["folder_id"]) };
            const status = tool === "archive_note" ? "archived" : tool === "delete_note" ? "trashed" : "active";
            return { ...target, patch: { status } };
          })();
  try {
    const validated = validateAiActionProposal("normalize", tool, input, "2026-08-25T00:10:00.000Z", summaryForTool(tool));
    return { tool, input: validated.input };
  } catch {
    throw new AiToolError("AI_ACTION_TOOL_INVALID", "AI tool input is invalid", 400);
  }
}

export class AiToolOrchestrator {
  private readonly createId: () => string;
  private readonly clock: () => Date;

  constructor(private readonly dependencies: AiToolOrchestratorDependencies) {
    this.createId = dependencies.createId ?? (() => crypto.randomUUID());
    this.clock = dependencies.clock ?? (() => new Date());
  }

  async propose(context: Parameters<typeof requireWorkspaceContext>[0], toolCall: AiToolCall, policy?: AiActionPolicy) {
    const [proposal] = await this.proposeMany(context, [toolCall], policy);
    return proposal;
  }

  async proposeMany(context: Parameters<typeof requireWorkspaceContext>[0], toolCalls: AiToolCall[], policy: AiActionPolicy = {}) {
    const actor = requireWorkspaceContext(context);
    const prepared = toolCalls.map((toolCall) => {
      const argumentsObject = isPlainObject(toolCall.arguments) ? toolCall.arguments : {};
      const requestedWorkspace = typeof argumentsObject.workspace_id === "string" ? argumentsObject.workspace_id : null;
      if (requestedWorkspace && requestedWorkspace !== actor.workspaceId) {
        throw new AiToolError("AI_ACTION_WORKSPACE_DENIED", "AI action cannot target another workspace", 403);
      }
      const normalized = normalizedInput(toolCall.name, toolCall.arguments);
      assertActionPermission(actor, normalized.tool);
      const target = ["update_note", "move_note", "archive_note", "restore_note", "delete_note"].includes(normalized.tool)
        || isAiOrganizationTool(normalized.tool) && normalized.tool !== "create_folder"
        ? "selected" as const
        : "workspace" as const;
      let requiresConfirmation: boolean;
      try {
        requiresConfirmation = evaluateAiToolPolicy({
          tool: normalized.tool,
          trusted: policy.trusted === true && normalized.tool === "create_note",
          target,
          externalRecipient: normalized.tool === "send_email",
        }).requiresConfirmation;
      } catch (error) {
        throw new AiToolError("AI_ACTION_TOOL_INVALID", error instanceof Error ? error.message : "AI tool policy rejected the action", 400);
      }
      return { ...normalized, requiresConfirmation };
    });

    const now = this.clock().toISOString();
    const expiresAt = proposalExpiry(this.clock);
    const proposals = prepared.map(({ tool, input, requiresConfirmation }) => {
      const actionId = this.createId();
      const proposal = validateAiActionProposal(actionId, tool, input, expiresAt, summaryForTool(tool), requiresConfirmation);
      return {
        proposal,
        actionId,
        userId: actor.userId,
        workspaceId: actor.workspaceId,
        tool,
        input: proposal.input,
        expiresAt,
        now,
        requiresConfirmation,
      };
    });
    await this.dependencies.repository.insertProposals(proposals.map(({ proposal: _proposal, ...input }) => input));
    return proposals.map(({ proposal }) => ({ ...proposal, proposal_revision: 1 }));
  }

  async confirm(context: Parameters<typeof requireWorkspaceContext>[0], actionId: string, baseRevision: number) {
    const actor = requireWorkspaceContext(context);
    const now = this.clock().toISOString();
    const proposal = await this.dependencies.repository.getOwned(actor.userId, actor.workspaceId, actionId);
    if (!proposal) throw new AiToolError("AI_ACTION_NOT_FOUND", "AI action was not found", 404);
    if (proposal.status === "expired") throw new AiToolError("AI_ACTION_EXPIRED", "AI action proposal expired", 409);
    if (proposal.status !== "proposed") {
      throw new AiToolError("AI_ACTION_CONFLICT", "AI action proposal changed before confirmation", 409);
    }

    assertActionPermission(actor, proposal.tool);
    await this.dependencies.assertFreshPermission(actor, proposal);
    const claimed = await this.dependencies.repository.claimConfirmation({
      userId: actor.userId,
      workspaceId: actor.workspaceId,
      actionId,
      baseRevision,
      now,
    });
    if (!claimed) {
      throw new AiToolError("AI_ACTION_CONFLICT", "AI action proposal changed before confirmation", 409);
    }
    if (claimed.status === "expired") {
      throw new AiToolError("AI_ACTION_EXPIRED", "AI action proposal expired", 409);
    }
    return claimed;
  }

  async reject(context: Parameters<typeof requireWorkspaceContext>[0], actionId: string, baseRevision: number) {
    const actor = requireWorkspaceContext(context);
    const now = this.clock().toISOString();
    const proposal = await this.dependencies.repository.getOwned(actor.userId, actor.workspaceId, actionId);
    if (!proposal) throw new AiToolError("AI_ACTION_NOT_FOUND", "AI action was not found", 404);
    if (proposal.status === "expired") throw new AiToolError("AI_ACTION_EXPIRED", "AI action proposal expired", 409);
    if (proposal.status !== "proposed") {
      throw new AiToolError("AI_ACTION_CONFLICT", "AI action proposal changed before rejection", 409);
    }
    const rejected = await this.dependencies.repository.markRejected({
      userId: actor.userId,
      workspaceId: actor.workspaceId,
      actionId,
      baseRevision,
      now,
    });
    if (!rejected) {
      throw new AiToolError("AI_ACTION_CONFLICT", "AI action proposal changed before rejection", 409);
    }
    return { rejected: true as const };
  }

  async execute(context: Parameters<typeof requireWorkspaceContext>[0], actionId: string, dependencies: AiToolExecutionDependencies): Promise<AiActionExecutionResult> {
    const actor = requireWorkspaceContext(context);
    const now = (dependencies.clock ?? this.clock)().toISOString();
    let proposal = await this.dependencies.repository.getOwned(actor.userId, actor.workspaceId, actionId);
    if (!proposal) throw new AiToolError("AI_ACTION_NOT_FOUND", "AI action was not found", 404);
    if (proposal.status === "executed") return proposal.execution_result ?? { action_id: proposal.action_id, status: "executed" };
    if (proposal.status === "failed" || proposal.status === "conflict") return storedExecutionResult(proposal);
    assertActionPermission(actor, proposal.tool);
    if (proposal.status === "proposed" && !proposal.requires_confirmation) {
      const claimed = await this.dependencies.repository.claimConfirmation({
        userId: actor.userId,
        workspaceId: actor.workspaceId,
        actionId,
        baseRevision: proposal.revision,
        now,
      });
      if (claimed?.status === "expired") {
        throw new AiToolError("AI_ACTION_EXPIRED", "AI action proposal expired", 409);
      }
      if (!claimed || claimed.status !== "confirmed") {
        const replay = await this.dependencies.repository.getOwned(actor.userId, actor.workspaceId, actionId);
        if (replay?.status === "executed") return replay.execution_result ?? { action_id: replay.action_id, status: "executed" };
        throw new AiToolError("AI_ACTION_CONFLICT", "AI action proposal changed before execution", 409);
      }
      proposal = claimed;
    }
    if (proposal.status !== "confirmed" && proposal.status !== "executing") {
      if (proposal.status === "expired") throw new AiToolError("AI_ACTION_EXPIRED", "AI action proposal expired", 409);
      throw new AiToolError("AI_ACTION_CONFLICT", "AI action proposal changed before execution", 409);
    }

    if (proposal.status === "executing") {
      const leaseUntil = proposal.execution_lease_until ? Date.parse(proposal.execution_lease_until) : Number.NaN;
      if (Number.isFinite(leaseUntil) && leaseUntil > Date.parse(now)) {
        return this.waitForExecutionResult(actor, actionId);
      }
    }
    const executionClaim = await this.dependencies.repository.claimExecution({
      userId: actor.userId,
      workspaceId: actor.workspaceId,
      actionId,
      baseRevision: proposal.revision,
      now,
    });
    if (!executionClaim) {
      const current = await this.dependencies.repository.getOwned(actor.userId, actor.workspaceId, actionId);
      if (current?.status === "executed" || current?.status === "failed" || current?.status === "conflict") {
        return current.status === "executed" ? (current.execution_result ?? { action_id: current.action_id, status: "executed" }) : storedExecutionResult(current);
      }
      if (current?.status === "executing") {
        return this.waitForExecutionResult(actor, actionId);
      }
      throw new AiToolError("AI_ACTION_CONFLICT", "AI action proposal changed before execution", 409);
    }
    proposal = executionClaim;
    const executionClaimToken = proposal.execution_claim_token;
    if (!executionClaimToken) {
      throw new AiToolError("AI_ACTION_CONFLICT", "AI action execution claim is invalid", 409);
    }
    const requestId = dependencies.requestId ?? proposal.action_id;
    let executionResult: AiActionExecutionResult;
    try {
      await this.dependencies.assertFreshPermission(actor, proposal);
      switch (proposal.tool) {
        case "create_note": {
          const note = await dependencies.noteService.create(
            { ...actor, requestId, targetId: aiActionTargetId("create_note", proposal.action_id) },
            proposal.input,
          );
          executionResult = noteResult(proposal.action_id, note, aiActionTargetId("create_note", proposal.action_id));
          break;
        }
        case "update_note":
        case "move_note":
        case "archive_note":
        case "restore_note":
        case "delete_note": {
          const note = await dependencies.noteService.update(
            { ...actor, requestId, targetId: aiActionTargetId(proposal.tool, proposal.action_id) },
            proposal.input.target_note_id,
            {
              ...proposal.input.patch,
              base_revision: proposal.input.base_revision,
              source: proposal.tool === "restore_note" ? "restore" : "manual",
            },
          );
          executionResult = noteResult(proposal.action_id, note, proposal.input.target_note_id);
          break;
        }
        case "create_folder":
        case "apply_tag":
        case "create_database_record":
        case "update_database_record":
        case "apply_template": {
          if (!dependencies.organization) {
            throw new AiToolError("AI_ACTION_ORGANIZATION_UNAVAILABLE", "AI organization actions are unavailable", 503);
          }
          const value = await dependencies.organization.execute(
            actor,
            proposal.tool,
            proposal.input,
            { actionId: proposal.action_id, ...(requestId ? { requestId } : {}) },
          );
          executionResult = organizationResult(proposal.action_id, proposal.tool, value);
          break;
        }
        case "create_reminder":
          await dependencies.knowledgeService.createReminder(
            { workspaceId: actor.workspaceId, userId: actor.userId, targetId: aiActionTargetId("create_reminder", proposal.action_id) },
            {
              note_id: proposal.input.note_id ?? null,
              title: proposal.input.title,
              remind_at: proposal.input.remind_at,
              timezone: proposal.input.timezone ?? "UTC",
              channels: ["in_app"],
              recurrence: null,
              delivery_enabled: true,
            },
          );
          executionResult = { action_id: proposal.action_id, status: "executed", entity_id: aiActionTargetId("create_reminder", proposal.action_id) };
          break;
        case "create_notification":
          await dependencies.collaborationRepository.createNotification(
            actor,
            {
              notificationId: `ai-notification:${proposal.action_id}`,
              userId: actor.userId,
              title: proposal.input.title,
              summary: proposal.input.body_text,
              deepLink: "/notifications",
              now,
              requestId,
            },
          );
          executionResult = { action_id: proposal.action_id, status: "executed", entity_id: `ai-notification:${proposal.action_id}` };
          break;
        case "send_email": {
          if (!dependencies.queue) {
            throw new AiToolError("AI_ACTION_QUEUE_UNAVAILABLE", "Email queue is unavailable", 503);
          }
          const completed = await this.dependencies.repository.completeEmailAction({
            userId: actor.userId,
            workspaceId: actor.workspaceId,
            actionId,
            baseRevision: proposal.revision,
            now,
            executionClaimToken,
          }, {
            actionId: proposal.action_id,
            userId: actor.userId,
            workspaceId: actor.workspaceId,
            toEmail: proposal.input.to_email,
            subject: proposal.input.subject,
            bodyText: proposal.input.body_text,
            now,
          });
          if (!completed) throw new AiToolError("AI_ACTION_CONFLICT", "AI action proposal changed before email outbox commit could be recorded", 409);
          return completed.execution_result ?? { action_id: proposal.action_id, status: "executed", entity_id: `ai-email:${proposal.action_id}` };
        }
      }
    } catch (error) {
      const actionError = error instanceof AiToolError
        ? error
        : error && typeof error === "object" && "code" in error && typeof error.code === "string"
          ? Object.assign(new AiToolError(error.code, error instanceof Error ? error.message : "AI action failed", "status" in error && typeof error.status === "number" ? error.status : 500), {})
          : new AiToolError("AI_ACTION_EXECUTION_FAILED", "AI action execution failed", 500);
      const isNoteConflict = actionError.status === 409
        && ["NOTE_CONFLICT", "AI_ACTION_NOTE_CONFLICT", "DAILY_NOTE_CONFLICT", "NOTE_IDEMPOTENCY_CONFLICT"].includes(actionError.code);
      const isOrganizationConflict = actionError.status === 409 && isAiOrganizationTool(proposal.tool);
      const isConflict = isNoteConflict || isOrganizationConflict;
      const errorRecord = {
        code: isNoteConflict
          ? "AI_ACTION_NOTE_CONFLICT"
          : isOrganizationConflict
            ? proposal.tool === "update_database_record" || proposal.tool === "apply_template"
              ? "AI_ACTION_DATABASE_CONFLICT"
              : "AI_ACTION_ORGANIZATION_CONFLICT"
            : actionError.code,
        message: isNoteConflict
          ? "The note changed before the AI action could be executed"
          : isOrganizationConflict
            ? "The organization target changed before the AI action could be executed"
            : "AI action execution failed",
        status: actionError.status,
      };
      const mark = isConflict ? this.dependencies.repository.markConflict.bind(this.dependencies.repository) : this.dependencies.repository.markFailed.bind(this.dependencies.repository);
      const stored = await mark({
        userId: actor.userId,
        workspaceId: actor.workspaceId,
        actionId,
        baseRevision: proposal.revision,
        now,
        executionClaimToken,
      }, errorRecord);
      if (!stored) {
        const current = await this.dependencies.repository.getOwned(actor.userId, actor.workspaceId, actionId);
        if (current?.status === "executed") return current.execution_result ?? { action_id: current.action_id, status: "executed" };
        if (current?.status === "conflict" || current?.status === "failed") return storedExecutionResult(current);
        throw new AiToolError("AI_ACTION_CONFLICT", "AI action proposal changed before failure could be recorded", 409);
      }
      return isConflict
        ? { action_id: proposal.action_id, status: "conflict", error: errorRecord }
        : { action_id: proposal.action_id, status: "failed", error: errorRecord };
    }

    const completedResult = executionResult!;
    let completed = await this.dependencies.repository.markCompleted({
      userId: actor.userId,
      workspaceId: actor.workspaceId,
      actionId,
      baseRevision: proposal.revision,
      now,
      executionClaimToken,
    }, completedResult);
    if (!completed) {
      const current = await this.dependencies.repository.getOwned(actor.userId, actor.workspaceId, actionId);
      if (current?.status === "executed") return current.execution_result ?? completedResult;
      if (current?.status === "confirmed") {
        completed = await this.dependencies.repository.markCompleted({
          userId: actor.userId,
          workspaceId: actor.workspaceId,
          actionId,
          baseRevision: current.revision,
          now,
          executionClaimToken,
        }, completedResult);
      }
    }
    if (!completed) {
      const current = await this.dependencies.repository.getOwned(actor.userId, actor.workspaceId, actionId);
      if (current?.status === "executed" || current?.status === "failed" || current?.status === "conflict") {
        return current.status === "executed" ? (current.execution_result ?? completedResult) : storedExecutionResult(current);
      }
      if (current?.status === "executing") {
        return this.waitForExecutionResult(actor, actionId);
      }
      throw new AiToolError("AI_ACTION_CONFLICT", "AI action proposal changed before completion could be recorded", 409);
    }
    return completed.execution_result ?? completedResult;
  }

  private async waitForExecutionResult(actor: WorkspaceContext, actionId: string): Promise<AiActionExecutionResult> {
    const deadline = Date.now() + EXECUTION_POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await wait(EXECUTION_POLL_INTERVAL_MS);
      const current = await this.dependencies.repository.getOwned(actor.userId, actor.workspaceId, actionId);
      if (!current) throw new AiToolError("AI_ACTION_NOT_FOUND", "AI action was not found", 404);
      if (current.status === "executed") return current.execution_result ?? { action_id: current.action_id, status: "executed" };
      if (current.status === "failed" || current.status === "conflict") return storedExecutionResult(current);
    }
    throw new AiToolError("AI_ACTION_IN_PROGRESS", "AI action is still executing", 409, undefined, true);
  }
}

function noteResult(actionId: string, value: unknown, fallbackEntityId: string): AiActionExecutionResult {
  const note = value && typeof value === "object" ? value as { id?: unknown; revision?: unknown } : {};
  return {
    action_id: actionId,
    status: "executed",
    entity_id: typeof note.id === "string" ? note.id : fallbackEntityId,
    ...(typeof note.revision === "number" ? { revision: note.revision } : {}),
  };
}

function organizationResult(actionId: string, tool: StoredAiActionProposal["tool"], value: unknown): AiActionExecutionResult {
  const result = value && typeof value === "object" ? value as {
    id?: unknown;
    revision?: unknown;
    entity_ids?: unknown;
    items?: unknown;
  } : {};
  const entityIds = Array.isArray(result.entity_ids)
    ? result.entity_ids.filter((id): id is string => typeof id === "string")
    : undefined;
  const items = Array.isArray(result.items) ? result.items : [];
  const firstItem = items[0] && typeof items[0] === "object" ? items[0] as { id?: unknown; revision?: unknown } : undefined;
  const entityId = typeof result.id === "string"
    ? result.id
    : typeof firstItem?.id === "string"
      ? firstItem.id
      : tool === "apply_tag" ? entityIds?.[0] : undefined;
  const revision = typeof result.revision === "number"
    ? result.revision
    : typeof firstItem?.revision === "number" ? firstItem.revision : undefined;
  return {
    action_id: actionId,
    status: "executed",
    ...(entityId ? { entity_id: entityId } : {}),
    ...(entityIds?.length ? { entity_ids: entityIds } : {}),
    ...(revision !== undefined ? { revision } : {}),
  };
}

function storedExecutionResult(proposal: StoredAiActionProposal): AiActionExecutionResult {
  if (proposal.execution_result) return proposal.execution_result;
  const status = proposal.status === "conflict" ? "conflict" : "failed";
  return {
    action_id: proposal.action_id,
    status,
    ...(proposal.error_code && proposal.error_message && proposal.error_status
      ? { error: { code: proposal.error_code, message: proposal.error_message, status: proposal.error_status } }
      : {}),
  };
}
