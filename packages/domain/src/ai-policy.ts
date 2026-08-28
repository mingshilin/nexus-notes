import {
  AI_TOOL_CATALOG,
  AI_TRUSTED_MODE_TTL_MS,
  type AiToolName,
  type AiToolRisk,
  type AiToolTarget,
  type AiTrustedMode,
} from "@nexus/contracts";

export const AI_TOOL_RISK_BY_NAME = Object.freeze(Object.fromEntries(
  AI_TOOL_CATALOG.map((entry) => [entry.name, entry.risk]),
)) as Readonly<Record<AiToolName, AiToolRisk>>;

const entityBoundTools: ReadonlySet<AiToolName> = new Set([
  "get_note",
  "get_database_record",
  "update_note",
  "move_note",
  "archive_note",
  "restore_note",
  "delete_note",
  "apply_tag",
  "create_database_record",
  "update_database_record",
  "apply_template",
  "complete_reminder",
  "change_permissions",
  "delete_database",
]);

export class AiPolicyError extends Error {
  constructor(
    readonly code: "AI_TOOL_INVALID" | "AI_TOOL_SELECTED_CONTEXT_REQUIRED" | "AI_TRUSTED_MODE_EXPIRY_INVALID",
    message: string,
  ) {
    super(message);
    this.name = "AiPolicyError";
  }
}

export function isAiTrustedModeActive(
  mode: AiTrustedMode,
  now = new Date(),
  workspaceId: string,
) {
  if (!workspaceId || mode.workspace_id !== workspaceId || !mode.enabled || !mode.expires_at) return false;
  const expiresAt = Date.parse(mode.expires_at);
  return Number.isFinite(expiresAt) && expiresAt > now.getTime();
}

export function normalizeAiTrustedModeExpiry(
  enabled: boolean,
  now = new Date(),
  requestedExpiry?: string | null,
) {
  if (!enabled) return null;
  const nowMs = now.getTime();
  const maximumMs = nowMs + AI_TRUSTED_MODE_TTL_MS;
  if (requestedExpiry === undefined || requestedExpiry === null) return new Date(maximumMs).toISOString();
  const requestedMs = Date.parse(requestedExpiry);
  if (!Number.isFinite(requestedMs) || requestedMs <= nowMs || requestedMs > maximumMs) {
    throw new AiPolicyError(
      "AI_TRUSTED_MODE_EXPIRY_INVALID",
      "Trusted mode expiry must be within 24 hours",
    );
  }
  return new Date(requestedMs).toISOString();
}

export function createAiTrustedMode(input: {
  workspaceId: string;
  enabled: boolean;
  revision: number;
  now?: Date;
  expiresAt?: string | null;
}) {
  return {
    workspace_id: input.workspaceId,
    enabled: input.enabled,
    expires_at: normalizeAiTrustedModeExpiry(input.enabled, input.now, input.expiresAt),
    revision: input.revision,
  } satisfies AiTrustedMode;
}

export function evaluateAiToolPolicy(input: {
  tool: AiToolName;
  trusted: boolean;
  target: AiToolTarget;
  externalRecipient: boolean;
}) {
  const risk = AI_TOOL_RISK_BY_NAME[input.tool];
  if (!risk) throw new AiPolicyError("AI_TOOL_INVALID", "AI tool is not in the policy catalog");
  if (entityBoundTools.has(input.tool) && input.target === "workspace") {
    throw new AiPolicyError(
      "AI_TOOL_SELECTED_CONTEXT_REQUIRED",
      "AI entity actions require the current or an explicitly selected target",
    );
  }

  return {
    risk,
    requiresConfirmation: input.externalRecipient
      || risk === "confirmed_write"
      || risk === "external_or_destructive"
      || (risk === "safe_write" && !input.trusted),
  };
}
