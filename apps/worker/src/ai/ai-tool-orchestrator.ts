import { AI_ACTION_PROPOSAL_TTL_MS, type QueueJob, type WorkspaceContext } from "@nexus/contracts";

import {
  AiToolError,
  assertAiToolName,
  type AiToolInput,
  type AiToolCall,
  type AiToolRepositoryPort,
  type StoredAiActionProposal,
} from "./ai-tool-model";
import { validateAiActionProposal } from "./ai-tool-model";

interface AiToolOrchestratorDependencies {
  repository: AiToolRepositoryPort;
  assertFreshPermission(context: WorkspaceContext, proposal: StoredAiActionProposal): Promise<void> | void;
  createId?: () => string;
  clock?: () => Date;
}

interface AiToolExecutionDependencies {
  noteService: {
    create(context: WorkspaceContext & { requestId?: string; targetId?: string }, input: unknown): Promise<unknown>;
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
  queue?: {
    send(message: QueueJob): Promise<unknown>;
  };
  requestId?: string;
  clock?: () => Date;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pickInput(source: Record<string, unknown>, keys: readonly string[]) {
  const target: Record<string, unknown> = {};
  for (const key of keys) {
    if (key in source) target[key] = source[key];
  }
  return target;
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
  }
}

function proposalExpiry(clock: () => Date) {
  return new Date(clock().getTime() + AI_ACTION_PROPOSAL_TTL_MS).toISOString();
}

function targetIdFor(tool: StoredAiActionProposal["tool"], actionId: string) {
  return `${tool.replaceAll("_", "-")}:${actionId}`;
}

function requireWorkspaceContext(context: WorkspaceContext) {
  if (!context.workspaceId || !context.userId) {
    throw new AiToolError("AI_ACTION_CONTEXT_INVALID", "Workspace context is required", 400);
  }
  return context;
}

function normalizedInput(name: string, raw: unknown): { tool: ReturnType<typeof assertAiToolName>; input: AiToolInput } {
  const tool = assertAiToolName(name);
  const argumentsObject = isPlainObject(raw) ? raw : {};
  const input = tool === "create_note"
    ? pickInput(argumentsObject, ["title", "content", "folder_id", "daily_date"])
    : tool === "create_reminder"
      ? pickInput(argumentsObject, ["note_id", "title", "remind_at", "timezone"])
      : tool === "create_notification"
        ? pickInput(argumentsObject, ["title", "body_text"])
        : pickInput(argumentsObject, ["to_email", "subject", "body_text"]);
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

  async propose(context: Parameters<typeof requireWorkspaceContext>[0], toolCall: AiToolCall) {
    const [proposal] = await this.proposeMany(context, [toolCall]);
    return proposal;
  }

  async proposeMany(context: Parameters<typeof requireWorkspaceContext>[0], toolCalls: AiToolCall[]) {
    const actor = requireWorkspaceContext(context);
    const prepared = toolCalls.map((toolCall) => {
      const argumentsObject = isPlainObject(toolCall.arguments) ? toolCall.arguments : {};
      const requestedWorkspace = typeof argumentsObject.workspace_id === "string" ? argumentsObject.workspace_id : null;
      if (requestedWorkspace && requestedWorkspace !== actor.workspaceId) {
        throw new AiToolError("AI_ACTION_WORKSPACE_DENIED", "AI action cannot target another workspace", 403);
      }
      return normalizedInput(toolCall.name, toolCall.arguments);
    });

    const now = this.clock().toISOString();
    const expiresAt = proposalExpiry(this.clock);
    const proposals = prepared.map(({ tool, input }) => {
      const actionId = this.createId();
      const proposal = validateAiActionProposal(actionId, tool, input, expiresAt, summaryForTool(tool));
      return {
        proposal,
        actionId,
        userId: actor.userId,
        workspaceId: actor.workspaceId,
        tool,
        input: proposal.input,
        expiresAt,
        now,
      };
    });
    await this.dependencies.repository.insertProposals(proposals.map(({ proposal: _proposal, ...input }) => input));
    return proposals.map(({ proposal }) => proposal);
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

  async execute(context: Parameters<typeof requireWorkspaceContext>[0], actionId: string, dependencies: AiToolExecutionDependencies) {
    const actor = requireWorkspaceContext(context);
    const now = (dependencies.clock ?? this.clock)().toISOString();
    const proposal = await this.dependencies.repository.getOwned(actor.userId, actor.workspaceId, actionId);
    if (!proposal) throw new AiToolError("AI_ACTION_NOT_FOUND", "AI action was not found", 404);
    if (proposal.status === "executed") return proposal;
    if (proposal.status !== "confirmed") {
      if (proposal.status === "expired") throw new AiToolError("AI_ACTION_EXPIRED", "AI action proposal expired", 409);
      throw new AiToolError("AI_ACTION_CONFLICT", "AI action proposal changed before execution", 409);
    }
    await this.dependencies.assertFreshPermission(actor, proposal);

    const requestId = dependencies.requestId ?? proposal.action_id;
    try {
      switch (proposal.tool) {
        case "create_note":
          await dependencies.noteService.create(
            { ...actor, requestId, targetId: targetIdFor("create_note", proposal.action_id) },
            proposal.input,
          );
          break;
        case "create_reminder":
          await dependencies.knowledgeService.createReminder(
            { workspaceId: actor.workspaceId, userId: actor.userId, targetId: targetIdFor("create_reminder", proposal.action_id) },
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
          return completed;
        }
      }
    } catch (error) {
      const failed = await this.dependencies.repository.markFailed({
        userId: actor.userId,
        workspaceId: actor.workspaceId,
        actionId,
        baseRevision: proposal.revision,
        now,
      });
      if (!failed) throw new AiToolError("AI_ACTION_CONFLICT", "AI action proposal changed before failure could be recorded", 409);
      throw error;
    }

    let completed = await this.dependencies.repository.markCompleted({
      userId: actor.userId,
      workspaceId: actor.workspaceId,
      actionId,
      baseRevision: proposal.revision,
      now,
    });
    if (!completed) {
      const current = await this.dependencies.repository.getOwned(actor.userId, actor.workspaceId, actionId);
      if (current?.status === "executed") return current;
      if (current?.status === "confirmed") {
        completed = await this.dependencies.repository.markCompleted({
          userId: actor.userId,
          workspaceId: actor.workspaceId,
          actionId,
          baseRevision: current.revision,
          now,
        });
      }
    }
    if (!completed) throw new AiToolError("AI_ACTION_CONFLICT", "AI action proposal changed before completion could be recorded", 409);
    return completed;
  }
}
