import { AiActionExecutionResultSchema, type AiActionExecutionResult, type AiActionStatus } from "@nexus/contracts";

import {
  type AiToolRepositoryPort,
  type InsertProposalInput,
  type ProposalMutationInput,
  type StoredAiActionProposal,
} from "./ai-tool-model";
import { validateAiActionProposal } from "./ai-tool-model";

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

interface ProposalRow {
  id: string;
  user_id: string;
  workspace_id: string;
  tool: StoredAiActionProposal["tool"];
  input_json: string;
  status: AiActionStatus;
  requires_confirmation: number;
  idempotency_key: string;
  revision: number;
  expires_at: string;
  created_at: string;
  updated_at: string;
  result_json: string | null;
  error_code: string | null;
  error_message: string | null;
  error_status: number | null;
  execution_claim_token: string | null;
  execution_lease_until: string | null;
}

const proposalColumns = `id, user_id, workspace_id, tool, input_json, status,
  requires_confirmation, idempotency_key, revision, expires_at, created_at, updated_at,
  result_json, error_code, error_message, error_status, execution_claim_token, execution_lease_until`;

function parseStoredProposal(row: ProposalRow): StoredAiActionProposal {
  const validated = validateAiActionProposal(
    row.id,
    row.tool,
    JSON.parse(row.input_json),
    row.expires_at,
    summaryForTool(row.tool),
    Boolean(row.requires_confirmation),
  );
  const executionResult = row.result_json
    ? AiActionExecutionResultSchema.parse(JSON.parse(row.result_json))
    : null;
  const base = {
    action_id: row.id,
    user_id: row.user_id,
    workspace_id: row.workspace_id,
    status: row.status,
    requires_confirmation: Boolean(row.requires_confirmation),
    idempotency_key: row.idempotency_key,
    revision: row.revision,
    expires_at: row.expires_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    execution_result: executionResult,
    error_code: row.error_code,
    error_message: row.error_message,
    error_status: row.error_status,
    execution_claim_token: row.execution_claim_token,
    execution_lease_until: row.execution_lease_until,
  };
  switch (validated.tool) {
    case "create_note":
      return { ...base, tool: validated.tool, input: validated.input };
    case "create_reminder":
      return { ...base, tool: validated.tool, input: validated.input };
    case "create_notification":
      return { ...base, tool: validated.tool, input: validated.input };
    case "send_email":
      return { ...base, tool: validated.tool, input: validated.input };
    case "update_note":
      return { ...base, tool: validated.tool, input: validated.input };
    case "move_note":
      return { ...base, tool: validated.tool, input: validated.input };
    case "archive_note":
      return { ...base, tool: validated.tool, input: validated.input };
    case "restore_note":
      return { ...base, tool: validated.tool, input: validated.input };
    case "delete_note":
      return { ...base, tool: validated.tool, input: validated.input };
    case "create_folder":
      return { ...base, tool: validated.tool, input: validated.input };
    case "apply_tag":
      return { ...base, tool: validated.tool, input: validated.input };
    case "create_database_record":
      return { ...base, tool: validated.tool, input: validated.input };
    case "update_database_record":
      return { ...base, tool: validated.tool, input: validated.input };
    case "apply_template":
      return { ...base, tool: validated.tool, input: validated.input };
  }
}

export class D1AiToolRepository implements AiToolRepositoryPort {
  private readonly createId: () => string;

  constructor(
    private readonly db: D1Database,
    createId: () => string = () => crypto.randomUUID(),
  ) {
    this.createId = createId;
  }

  async getOwned(userId: string, workspaceId: string, actionId: string) {
    const row = await this.db.prepare(
      `SELECT ${proposalColumns}
       FROM ai_action_proposals
       WHERE user_id = ? AND workspace_id = ? AND id = ?
       LIMIT 1`,
    ).bind(userId, workspaceId, actionId).first<ProposalRow>();
    return row ? parseStoredProposal(row) : null;
  }

  async insertProposal(input: InsertProposalInput) {
    const [proposal] = await this.insertProposals([input]);
    return proposal;
  }

  async insertProposals(inputs: InsertProposalInput[]) {
    if (inputs.length === 0) return [];
    const results = await this.db.batch(inputs.map((input) => this.db.prepare(
       `INSERT INTO ai_action_proposals (
         id, user_id, workspace_id, tool, input_json, status, idempotency_key,
         revision, expires_at, created_at, updated_at, requires_confirmation
       ) VALUES (?, ?, ?, ?, ?, 'proposed', ?, 1, ?, ?, ?, ?)
       RETURNING ${proposalColumns}`,
    ).bind(
      input.actionId,
      input.userId,
      input.workspaceId,
      input.tool,
      JSON.stringify(input.input),
      `ai-action:${input.userId}:${input.actionId}`,
      input.expiresAt,
      input.now,
      input.now,
      Number(input.requiresConfirmation ?? true),
    )));
    return results.map((result) => {
      const row = result.results?.[0] as ProposalRow | undefined;
      if (!row) throw new Error("AI_ACTION_INSERT_FAILED");
      return parseStoredProposal(row);
    });
  }

  async claimConfirmation(input: ProposalMutationInput) {
    const row = await this.db.prepare(
      `UPDATE ai_action_proposals
       SET status = CASE WHEN expires_at <= ? THEN 'expired' ELSE 'confirmed' END,
           revision = revision + 1,
           updated_at = ?
       WHERE user_id = ? AND workspace_id = ? AND id = ? AND revision = ? AND status = 'proposed'
       RETURNING ${proposalColumns}`,
    ).bind(
      input.now,
      input.now,
      input.userId,
      input.workspaceId,
      input.actionId,
      input.baseRevision,
    ).first<ProposalRow>();
    return row ? parseStoredProposal(row) : null;
  }

  async claimExecution(input: ProposalMutationInput) {
    const claimToken = this.createId();
    const leaseUntil = new Date(Date.parse(input.now) + 30_000).toISOString();
    const row = await this.db.prepare(
      `UPDATE ai_action_proposals
       SET status = 'executing', execution_claim_token = ?, execution_lease_until = ?,
           revision = revision + 1, updated_at = ?
       WHERE user_id = ? AND workspace_id = ? AND id = ? AND (
         (status = 'confirmed' AND revision = ?)
         OR (status = 'executing' AND (execution_lease_until IS NULL OR execution_lease_until <= ?)
             AND revision = ?)
       )
       RETURNING ${proposalColumns}`,
    ).bind(
      claimToken,
      leaseUntil,
      input.now,
      input.userId,
      input.workspaceId,
      input.actionId,
      input.baseRevision,
      input.now,
      input.baseRevision,
    ).first<ProposalRow>();
    return row ? parseStoredProposal(row) : null;
  }

  markCompleted(input: ProposalMutationInput, result?: AiActionExecutionResult) {
    return this.updateExecutionStatus(input, "executed", result);
  }

  async completeEmailAction(
    input: ProposalMutationInput,
    outbox: {
      actionId: string;
      userId: string;
      workspaceId: string;
      toEmail: string;
      subject: string;
      bodyText: string;
      now: string;
    },
  ) {
    const id = `ai-email:${outbox.actionId}`;
    const update = this.db.prepare(
      `UPDATE ai_action_proposals
       SET status = 'executed', revision = revision + 1, updated_at = ?,
           execution_claim_token = NULL, execution_lease_until = NULL,
           result_json = ?, error_code = NULL, error_message = NULL, error_status = NULL
       WHERE user_id = ? AND workspace_id = ? AND id = ? AND revision = ? AND status = 'executing'
         AND execution_claim_token = ?
       RETURNING ${proposalColumns}`,
    ).bind(
      input.now,
      JSON.stringify({ action_id: input.actionId, status: "executed", entity_id: id }),
      input.userId,
      input.workspaceId,
      input.actionId,
      input.baseRevision,
      input.executionClaimToken ?? "",
    );
    const insertOutbox = this.db.prepare(
      `INSERT INTO ai_email_outbox (
         id, action_id, user_id, workspace_id, to_email, subject, body_text,
         status, attempt_count, available_at, sent_at, last_error_code, created_at, updated_at
       )
       SELECT ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, NULL, NULL, ?, ?
       WHERE EXISTS (
         SELECT 1 FROM ai_action_proposals
         WHERE id = ? AND user_id = ? AND workspace_id = ?
           AND status = 'executed' AND revision = ?
       )
       ON CONFLICT(id) DO NOTHING`,
    ).bind(
      id,
      outbox.actionId,
      outbox.userId,
      outbox.workspaceId,
      outbox.toEmail,
      outbox.subject,
      outbox.bodyText,
      outbox.now,
      outbox.now,
      outbox.now,
      input.actionId,
      input.userId,
      input.workspaceId,
      input.baseRevision + 1,
    );
    const results = await this.db.batch<ProposalRow>([update, insertOutbox]);
    const row = results[0]?.results?.[0];
    return row ? parseStoredProposal(row) : null;
  }

  markRejected(input: ProposalMutationInput) {
    return this.updateOwnedStatus(input, "rejected", "proposed");
  }

  markFailed(input: ProposalMutationInput, error?: { code: string; message: string; status: number }) {
    return this.updateExecutionStatus(input, "failed", undefined, error);
  }

  markConflict(input: ProposalMutationInput, error?: { code: string; message: string; status: number }) {
    return this.updateExecutionStatus(input, "conflict", undefined, error);
  }

  private async updateExecutionStatus(
    input: ProposalMutationInput,
    nextStatus: "executed" | "failed" | "conflict",
    result?: AiActionExecutionResult,
    error?: { code: string; message: string; status: number },
  ) {
    const executionResult = result ?? {
      action_id: input.actionId,
      status: nextStatus,
      ...(error ? { error } : {}),
    } satisfies AiActionExecutionResult;
    const row = await this.db.prepare(
      `UPDATE ai_action_proposals
       SET status = ?, revision = revision + 1, updated_at = ?, result_json = ?,
           execution_claim_token = NULL, execution_lease_until = NULL,
           error_code = ?, error_message = ?, error_status = ?
       WHERE user_id = ? AND workspace_id = ? AND id = ? AND revision = ? AND status = 'executing'
         AND execution_claim_token = ?
       RETURNING ${proposalColumns}`,
    ).bind(
      nextStatus,
      input.now,
      JSON.stringify(executionResult),
      error?.code ?? null,
      error?.message.slice(0, 500) ?? null,
      error?.status ?? null,
      input.userId,
      input.workspaceId,
      input.actionId,
      input.baseRevision,
      input.executionClaimToken ?? "",
    ).first<ProposalRow>();
    return row ? parseStoredProposal(row) : null;
  }

  private async updateOwnedStatus(
    input: ProposalMutationInput,
    nextStatus: AiActionStatus,
    expectedStatus: AiActionStatus,
    extraCondition = "1 = 1",
    extraBindings: unknown[] = [],
  ) {
    const row = await this.db.prepare(
      `UPDATE ai_action_proposals
       SET status = ?, revision = revision + 1, updated_at = ?
       WHERE user_id = ? AND workspace_id = ? AND id = ? AND revision = ? AND status = ?
         AND ${extraCondition}
       RETURNING ${proposalColumns}`,
    ).bind(
      nextStatus,
      input.now,
      input.userId,
      input.workspaceId,
      input.actionId,
      input.baseRevision,
      expectedStatus,
      ...extraBindings,
    ).first<ProposalRow>();
    return row ? parseStoredProposal(row) : null;
  }
}
