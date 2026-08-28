import {
  AiActionProposalSchema,
  type AiActionExecutionResult,
  AiActionToolNameSchema,
  type AiActionProposal,
  type AiActionStatus,
  type AiActionToolName,
} from "@nexus/contracts";

export interface AiToolCall {
  name: string;
  arguments: unknown;
}

export type AiToolInput = AiActionProposal["input"];
type StoredProposalBase = {
  action_id: string;
  user_id: string;
  workspace_id: string;
  status: AiActionStatus;
  requires_confirmation: boolean;
  idempotency_key: string;
  revision: number;
  expires_at: string;
  created_at: string;
  updated_at: string;
  execution_result: AiActionExecutionResult | null;
  error_code: string | null;
  error_message: string | null;
  error_status: number | null;
  execution_claim_token: string | null;
  execution_lease_until: string | null;
};

type StoredProposalByTool<TTool extends AiActionToolName> = StoredProposalBase & {
  tool: TTool;
  input: Extract<AiActionProposal, { tool: TTool }>["input"];
};

export type StoredAiActionProposal = {
  [TTool in AiActionToolName]: StoredProposalByTool<TTool>;
}[AiActionToolName];

export interface ProposalMutationInput {
  userId: string;
  workspaceId: string;
  actionId: string;
  baseRevision: number;
  now: string;
  executionClaimToken?: string;
}

export interface InsertProposalInput {
  actionId: string;
  userId: string;
  workspaceId: string;
  tool: AiActionToolName;
  input: AiToolInput;
  expiresAt: string;
  now: string;
  requiresConfirmation?: boolean;
}

export interface AiActionErrorRecord {
  code: string;
  message: string;
  status: number;
}

export interface AiToolRepositoryPort {
  getOwned(userId: string, workspaceId: string, actionId: string): Promise<StoredAiActionProposal | null>;
  insertProposal(input: InsertProposalInput): Promise<StoredAiActionProposal>;
  insertProposals(input: InsertProposalInput[]): Promise<StoredAiActionProposal[]>;
  claimConfirmation(input: ProposalMutationInput): Promise<StoredAiActionProposal | null>;
  claimExecution(input: ProposalMutationInput): Promise<StoredAiActionProposal | null>;
  completeEmailAction(input: ProposalMutationInput, outbox: {
    actionId: string;
    userId: string;
    workspaceId: string;
    toEmail: string;
    subject: string;
    bodyText: string;
    now: string;
  }): Promise<StoredAiActionProposal | null>;
  markRejected(input: ProposalMutationInput): Promise<StoredAiActionProposal | null>;
  markCompleted(input: ProposalMutationInput, result?: AiActionExecutionResult): Promise<StoredAiActionProposal | null>;
  markFailed(input: ProposalMutationInput, error?: AiActionErrorRecord): Promise<StoredAiActionProposal | null>;
  markConflict(input: ProposalMutationInput, error?: AiActionErrorRecord): Promise<StoredAiActionProposal | null>;
}

export class AiToolError extends Error {
  readonly retryable: boolean;

  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
    readonly details?: Record<string, unknown>,
    retryable = false,
  ) {
    super(message);
    this.name = "AiToolError";
    this.retryable = retryable;
  }
}

export function assertAiToolName(name: string): AiActionToolName {
  const parsed = AiActionToolNameSchema.safeParse(name);
  if (!parsed.success) {
    throw new AiToolError("AI_ACTION_TOOL_INVALID", "AI tool is not allowlisted", 400);
  }
  return parsed.data;
}

export function aiActionTargetId(tool: AiActionToolName, actionId: string) {
  return `${tool.replaceAll("_", "-")}:${actionId}`;
}

export function validateAiActionProposal(
  actionId: string,
  tool: AiActionToolName,
  input: unknown,
  expiresAt: string,
  summary: string,
  requiresConfirmation = true,
) {
  return AiActionProposalSchema.parse({
    action_id: actionId,
    tool,
    input,
    summary,
    requires_confirmation: requiresConfirmation,
    expires_at: expiresAt,
  });
}
