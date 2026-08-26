import type { AiActionStatus } from "@nexus/contracts";

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
  }
}

interface ProposalRow {
  id: string;
  user_id: string;
  workspace_id: string;
  tool: StoredAiActionProposal["tool"];
  input_json: string;
  status: AiActionStatus;
  idempotency_key: string;
  revision: number;
  expires_at: string;
  created_at: string;
  updated_at: string;
}

const proposalColumns = `id, user_id, workspace_id, tool, input_json, status,
  idempotency_key, revision, expires_at, created_at, updated_at`;

function parseStoredProposal(row: ProposalRow): StoredAiActionProposal {
  const validated = validateAiActionProposal(
    row.id,
    row.tool,
    JSON.parse(row.input_json),
    row.expires_at,
    summaryForTool(row.tool),
  );
  const base = {
    action_id: row.id,
    user_id: row.user_id,
    workspace_id: row.workspace_id,
    status: row.status,
    idempotency_key: row.idempotency_key,
    revision: row.revision,
    expires_at: row.expires_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
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
  }
}

export class D1AiToolRepository implements AiToolRepositoryPort {
  constructor(private readonly db: D1Database) {}

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
         revision, expires_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, 'proposed', ?, 1, ?, ?, ?)
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

  markCompleted(input: ProposalMutationInput) {
    return this.updateOwnedStatus(input, "executed", "confirmed");
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
       SET status = 'executed', revision = revision + 1, updated_at = ?
       WHERE user_id = ? AND workspace_id = ? AND id = ? AND revision = ? AND status = 'confirmed'
       RETURNING ${proposalColumns}`,
    ).bind(
      input.now,
      input.userId,
      input.workspaceId,
      input.actionId,
      input.baseRevision,
    );
    const insertOutbox = this.db.prepare(
      `INSERT INTO ai_email_outbox (
         id, action_id, user_id, workspace_id, to_email, subject, body_text,
         status, attempt_count, available_at, sent_at, last_error_code, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, NULL, NULL, ?, ?)
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
    );
    const results = await this.db.batch<ProposalRow>([update, insertOutbox]);
    const row = results[0]?.results?.[0];
    return row ? parseStoredProposal(row) : null;
  }

  markRejected(input: ProposalMutationInput) {
    return this.updateOwnedStatus(input, "rejected", "proposed");
  }

  markFailed(input: ProposalMutationInput) {
    return this.updateOwnedStatus(input, "failed", "confirmed");
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
