import {
  AiChatResponseSchema,
  AiActionToolNameSchema,
  AiActionExecutionResultSchema,
  AiReadResultSchema,
  AiReadToolNameSchema,
  type AiActionExecutionResult,
  type AiActionProposal,
  type AiChatInput,
  type AiChatResponse,
  type AiReadResult,
  type AiReadToolName,
} from "@nexus/contracts";
import { AiToolError } from "./ai-tool-model";
import { AiReadToolError, type AiReadExecutionContext } from "./ai-read-tools";

export interface AiChatServiceOptions {
  apiUrl?: string;
  apiKey?: string;
  model?: string;
  fetchImpl?: typeof fetch;
  maxResponseBytes?: number;
  timeoutMs?: number;
}

export interface AiChatToolProposalOptions {
  proposeActions?(toolCalls: Array<{ name: string; arguments: unknown }>): Promise<AiActionProposal[]>;
  executeActions?(proposals: AiActionProposal[]): Promise<AiActionExecutionResult[]>;
  readTools?: {
    execute(tool: AiReadToolName, input: unknown, context: AiReadExecutionContext, signal?: AbortSignal): Promise<AiReadResult>;
  };
  readContext?: AiReadExecutionContext;
}

export class AiChatServiceError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryable: boolean;

  constructor(code: string, message: string, status: number, retryable: boolean) {
    super(message);
    this.name = "AiChatServiceError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

function configuredUrl(value: string | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function providerMessage(payload: unknown) {
  if (!payload || typeof payload !== "object") return null;
  const choice = (payload as { choices?: unknown[] }).choices?.[0];
  if (!choice || typeof choice !== "object") return null;
  const content = (choice as { message?: { content?: unknown } }).message?.content;
  if (typeof content === "string") return content.trim() || null;
  if (Array.isArray(content)) {
    const text = content
      .filter((part): part is { text: string } => Boolean(part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string"))
      .map((part) => part.text)
      .join("")
      .trim();
    return text || null;
  }
  return null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function toolParameters(properties: Record<string, unknown>, required: string[] = []) {
  return {
    type: "object",
    additionalProperties: false,
    properties,
    required,
  };
}

function actionToolParameters(properties: Record<string, unknown>, required: string[] = []) {
  return toolParameters({ workspace_id: { type: "string", minLength: 1, maxLength: 128 }, ...properties }, required);
}

const ACTION_TOOL_DEFINITIONS = [
  {
    type: "function",
    function: {
      name: "create_note",
      description: "Propose creating a note.",
      parameters: actionToolParameters({
        title: { type: "string" },
        content: { type: "string" },
        folder_id: { anyOf: [{ type: "string" }, { type: "null" }] },
        database_id: { anyOf: [{ type: "string" }, { type: "null" }] },
        daily_date: { anyOf: [{ type: "string" }, { type: "null" }] },
      }),
    },
  },
  {
    type: "function",
    function: {
      name: "create_reminder",
      description: "Propose creating a reminder.",
      parameters: actionToolParameters({
        note_id: { anyOf: [{ type: "string" }, { type: "null" }] },
        title: { type: "string" },
        remind_at: { type: "string" },
        timezone: { type: "string" },
      }),
    },
  },
  {
    type: "function",
    function: {
      name: "create_notification",
      description: "Propose creating a notification.",
      parameters: actionToolParameters({
        title: { type: "string" },
        body_text: { type: "string" },
      }),
    },
  },
  {
    type: "function",
    function: {
      name: "send_email",
      description: "Propose sending an email.",
      parameters: actionToolParameters({
        to_email: { type: "string" },
        subject: { type: "string" },
        body_text: { type: "string" },
      }),
    },
  },
  {
    type: "function",
    function: {
      name: "update_note",
      description: "Propose updating fields on a note. The target note ID and current base revision are required; unknown patch fields are rejected.",
      parameters: actionToolParameters({
        target_note_id: { type: "string", minLength: 1 },
        base_revision: { type: "integer", minimum: 1 },
        patch: {
          type: "object",
          additionalProperties: false,
          minProperties: 1,
          properties: {
            title: { type: "string", maxLength: 160 },
            content: { type: "string", maxLength: 20000 },
            folder_id: { anyOf: [{ type: "string" }, { type: "null" }] },
            database_id: { anyOf: [{ type: "string" }, { type: "null" }] },
            daily_date: { anyOf: [{ type: "string" }, { type: "null" }] },
            is_favorite: { type: "boolean" },
            is_pinned: { type: "boolean" },
          },
        },
      }, ["target_note_id", "base_revision", "patch"]),
    },
  },
  {
    type: "function",
    function: {
      name: "move_note",
      description: "Propose moving a note to a folder. The target note ID, current base revision, and folder ID are required.",
      parameters: actionToolParameters({
        target_note_id: { type: "string", minLength: 1 },
        base_revision: { type: "integer", minimum: 1 },
        patch: {
          type: "object",
          additionalProperties: false,
          properties: { folder_id: { anyOf: [{ type: "string" }, { type: "null" }] } },
          required: ["folder_id"],
        },
      }, ["target_note_id", "base_revision", "patch"]),
    },
  },
  {
    type: "function",
    function: {
      name: "archive_note",
      description: "Propose archiving a note. This action always requires confirmation.",
      parameters: actionToolParameters({
        target_note_id: { type: "string", minLength: 1 },
        base_revision: { type: "integer", minimum: 1 },
      }, ["target_note_id", "base_revision"]),
    },
  },
  {
    type: "function",
    function: {
      name: "restore_note",
      description: "Propose restoring a note to active status. This action always requires confirmation.",
      parameters: actionToolParameters({
        target_note_id: { type: "string", minLength: 1 },
        base_revision: { type: "integer", minimum: 1 },
      }, ["target_note_id", "base_revision"]),
    },
  },
  {
    type: "function",
    function: {
      name: "delete_note",
      description: "Propose moving a note to the trash without permanently deleting its content or database membership. This action always requires confirmation.",
      parameters: actionToolParameters({
        target_note_id: { type: "string", minLength: 1 },
        base_revision: { type: "integer", minimum: 1 },
      }, ["target_note_id", "base_revision"]),
    },
  },
  {
    type: "function",
    function: {
      name: "create_folder",
      description: "Propose creating a workspace folder. This action always requires confirmation.",
      parameters: actionToolParameters({
        name: { type: "string", minLength: 1, maxLength: 120 },
        parent_id: { anyOf: [{ type: "string" }, { type: "null" }] },
        position: { type: "integer", minimum: 0 },
      }, ["name"]),
    },
  },
  {
    type: "function",
    function: {
      name: "apply_tag",
      description: "Propose applying a tag set to selected workspace notes. Batch targets are bounded to 100 notes and always require confirmation.",
      parameters: actionToolParameters({
        target_note_ids: { type: "array", minItems: 1, maxItems: 100, items: { type: "string" } },
        tag_ids: { type: "array", minItems: 1, maxItems: 100, items: { type: "string" } },
      }, ["target_note_ids", "tag_ids"]),
    },
  },
  {
    type: "function",
    function: {
      name: "create_database_record",
      description: "Propose creating a typed record in a selected database. Field types and permissions are enforced by the server.",
      parameters: actionToolParameters({
        database_id: { type: "string", minLength: 1 },
        base_revision: { type: "integer", minimum: 1 },
        note_id: { anyOf: [{ type: "string" }, { type: "null" }] },
        values: { type: "object", additionalProperties: true },
      }, ["database_id", "base_revision"]),
    },
  },
  {
    type: "function",
    function: {
      name: "update_database_record",
      description: "Propose updating typed fields on a selected database record. The current record revision is required.",
      parameters: actionToolParameters({
        database_id: { type: "string", minLength: 1 },
        record_id: { type: "string", minLength: 1 },
        base_revision: { type: "integer", minimum: 1 },
        values: { type: "object", minProperties: 1, additionalProperties: true },
      }, ["database_id", "record_id", "base_revision", "values"]),
    },
  },
  {
    type: "function",
    function: {
      name: "apply_template",
      description: "Propose applying a database template to selected records. The operation is atomic, bounded to 100 records, and always requires confirmation.",
      parameters: actionToolParameters({
        database_id: { type: "string", minLength: 1 },
        template_id: { type: "string", minLength: 1 },
        base_revision: { type: "integer", minimum: 1 },
        records: {
          type: "array",
          minItems: 1,
          maxItems: 100,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              record_id: { type: "string", minLength: 1 },
              base_revision: { type: "integer", minimum: 1 },
            },
            required: ["record_id", "base_revision"],
          },
        },
      }, ["database_id", "template_id", "base_revision", "records"]),
    },
  },
] as const;

const MAX_CUMULATIVE_READ_RESULT_BYTES = 64 * 1024;
const MAX_PROVIDER_REQUEST_BYTES = 256 * 1024;

const READ_TOOL_DEFINITIONS = [
  {
    type: "function",
    function: {
      name: "search_notes",
      description: "Search explicitly selected notes, or the workspace only when the user enabled workspace search. A cursor is valid only with the same query and selected-note scope.",
      parameters: toolParameters({
        query: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 50 },
        cursor: { type: "string", maxLength: 4096 },
      }),
    },
  },
  {
    type: "function",
    function: {
      name: "get_note",
      description: "Read one note that the user explicitly selected.",
      parameters: toolParameters({ note_id: { type: "string" } }, ["note_id"]),
    },
  },
  {
    type: "function",
    function: {
      name: "list_reminders",
      description: "List reminders owned by the current user in the active workspace.",
      parameters: toolParameters({
        include_completed: { type: "boolean" },
        query: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 50 },
        cursor: { type: "string", maxLength: 4096 },
      }),
    },
  },
  {
    type: "function",
    function: {
      name: "search_databases",
      description: "Search selected databases, or the workspace only when the user enabled workspace search. Field permissions are enforced by the server.",
      parameters: toolParameters({
        query: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 50 },
        cursor: { type: "string", maxLength: 4096 },
      }),
    },
  },
  {
    type: "function",
    function: {
      name: "get_database_record",
      description: "Read one record from a database the user explicitly selected. Hidden or denied fields are removed by the server.",
      parameters: toolParameters({
        database_id: { type: "string" },
        record_id: { type: "string" },
      }, ["database_id", "record_id"]),
    },
  },
] as const;

interface ProviderToolCall {
  id: string;
  name: string;
  arguments: unknown;
}

function providerToolCalls(payload: unknown, allowedTools: ReadonlySet<string>): ProviderToolCall[] | null {
  if (!payload || typeof payload !== "object") return null;
  const choice = (payload as { choices?: unknown[] }).choices?.[0];
  if (!choice || typeof choice !== "object") return null;
  const message = (choice as { message?: { tool_calls?: unknown } }).message;
  const rawToolCalls = message && typeof message === "object" && "tool_calls" in message
    ? (message as { tool_calls?: unknown }).tool_calls
    : (choice as { tool_calls?: unknown }).tool_calls;
  if (rawToolCalls == null) return [];
  if (!Array.isArray(rawToolCalls)) return null;

  const toolCalls: ProviderToolCall[] = [];
  const seenIds = new Set<string>();
  for (const rawCall of rawToolCalls) {
    if (!isPlainObject(rawCall)) return null;
    const toolType = rawCall.type;
    const functionCall = rawCall.function;
    if (toolType !== "function" || !isPlainObject(functionCall)) return null;
    const name = functionCall.name;
    const id = rawCall.id;
    if (typeof id !== "string" || !id.trim() || id.length > 256) return null;
    if (typeof name !== "string" || !allowedTools.has(name)) return null;
    if (seenIds.has(id)) return null;
    seenIds.add(id);
    const rawArguments = functionCall.arguments;
    if (typeof rawArguments === "string") {
      if (!rawArguments.trim()) return null;
      try {
        const parsedArguments = JSON.parse(rawArguments);
        if (!isPlainObject(parsedArguments)) return null;
        toolCalls.push({ id, name, arguments: parsedArguments });
        continue;
      } catch {
        return null;
      }
    }
    if (isPlainObject(rawArguments)) {
      toolCalls.push({ id, name, arguments: rawArguments });
      continue;
    }
    return null;
  }
  return toolCalls;
}

function toolFallbackMessage(count: number) {
  return count === 1 ? "已生成 1 个待确认操作。" : `已生成 ${count} 个待确认操作。`;
}

function toolCompletedMessage(count: number) {
  return count === 1 ? "已完成 1 个 AI 操作。" : `已完成 ${count} 个 AI 操作。`;
}

function toolResultMessage(results: AiActionExecutionResult[]) {
  const completed = results.filter((result) => result.status === "executed").length;
  const incomplete = results.length - completed;
  if (incomplete === 0) return toolCompletedMessage(completed);
  return `AI 操作完成 ${completed} 个，${incomplete} 个未执行。`;
}

export class AiChatService {
  private readonly fetchImpl: typeof fetch;
  private readonly maxResponseBytes: number;
  private readonly timeoutMs: number;

  constructor(private readonly options: AiChatServiceOptions) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.maxResponseBytes = options.maxResponseBytes ?? 256 * 1024;
    this.timeoutMs = Number.isFinite(options.timeoutMs) ? Math.max(1, Math.min(120_000, Math.floor(options.timeoutMs!))) : 30_000;
  }

  status() {
    const apiUrl = configuredUrl(this.options.apiUrl);
    const apiKey = this.options.apiKey?.trim();
    const model = this.options.model?.trim();
    return { configured: Boolean(apiUrl && apiKey && model && model.length <= 128) };
  }

  async chat(input: AiChatInput, signal: AbortSignal, options: AiChatToolProposalOptions = {}): Promise<AiChatResponse> {
    const apiUrl = configuredUrl(this.options.apiUrl);
    const apiKey = this.options.apiKey?.trim();
    const model = this.options.model?.trim();
    if (!this.status().configured || !apiUrl || !apiKey || !model) {
      throw new AiChatServiceError("AI_NOT_CONFIGURED", "AI service is not configured", 503, false);
    }

    const controller = new AbortController();
    let timedOut = false;
    const abortFromCaller = () => controller.abort();
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", abortFromCaller, { once: true });
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);

    try {
      const readEnabled = Boolean(options.readTools && options.readContext);
      const toolDefinitions = readEnabled
        ? [...READ_TOOL_DEFINITIONS, ...ACTION_TOOL_DEFINITIONS]
        : [...ACTION_TOOL_DEFINITIONS];
      const allowedTools = new Set(toolDefinitions.map((tool) => tool.function.name));
      const providerMessages: Array<Record<string, unknown>> = input.messages.map((message) => ({
        role: message.role,
        content: message.content,
      }));
      const readResults: AiReadResult[] = [];
      let cumulativeReadResultBytes = 0;
      const maximumReadCalls = 5;
      const maximumProviderRounds = 3;

      for (let round = 0; round < maximumProviderRounds; round += 1) {
        const providerPayload = {
          model,
          messages: providerMessages,
          stream: false,
          tools: toolDefinitions,
          tool_choice: "auto",
        };
        const serializedProviderPayload = JSON.stringify(providerPayload);
        if (new TextEncoder().encode(serializedProviderPayload).byteLength > MAX_PROVIDER_REQUEST_BYTES) {
          throw new AiChatServiceError("AI_PROVIDER_INVALID_RESPONSE", "AI provider request exceeded the bounded size", 502, false);
        }
        const response = await this.fetchImpl(apiUrl, {
          method: "POST",
          redirect: "error",
          headers: {
            accept: "application/json",
            authorization: `Bearer ${apiKey}`,
            "content-type": "application/json",
          },
          body: serializedProviderPayload,
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new AiChatServiceError(
            "AI_PROVIDER_UNAVAILABLE",
            "AI provider is unavailable",
            response.status === 429 || response.status >= 500 ? 503 : 502,
            response.status === 429 || response.status >= 500,
          );
        }

        const responseText = await readResponseText(response, this.maxResponseBytes, controller.signal);

        let payload: unknown;
        try {
          payload = JSON.parse(responseText);
        } catch {
          throw new AiChatServiceError("AI_PROVIDER_INVALID_RESPONSE", "AI provider returned invalid JSON", 502, false);
        }
        const toolCalls = providerToolCalls(payload, allowedTools);
        if (toolCalls === null) {
          throw new AiChatServiceError("AI_PROVIDER_INVALID_RESPONSE", "AI provider returned invalid tool calls", 502, false);
        }

        const readCalls = toolCalls.filter((call) => AiReadToolNameSchema.safeParse(call.name).success);
        const actionCalls = toolCalls.filter((call) => AiActionToolNameSchema.safeParse(call.name).success);
        if (readCalls.length > 0 && actionCalls.length > 0) {
          throw new AiChatServiceError("AI_PROVIDER_INVALID_RESPONSE", "AI provider mixed read and write tool calls", 502, false);
        }
        if (readCalls.length > 0) {
          if (!readEnabled || !options.readTools || !options.readContext) {
            throw new AiChatServiceError("AI_PROVIDER_INVALID_RESPONSE", "AI provider returned read calls without a scoped read handler", 502, false);
          }
          if (readResults.length + readCalls.length > maximumReadCalls) {
            throw new AiChatServiceError("AI_PROVIDER_INVALID_RESPONSE", "AI provider exceeded the read tool limit", 502, false);
          }
          const roundResults: Array<{ call: ProviderToolCall; result: AiReadResult }> = [];
          for (const call of readCalls) {
            try {
              const readResult = await options.readTools.execute(
                AiReadToolNameSchema.parse(call.name),
                call.arguments,
                options.readContext,
                controller.signal,
              );
              const validatedReadResult = AiReadResultSchema.safeParse(readResult);
              if (!validatedReadResult.success || validatedReadResult.data.tool !== call.name) {
                throw new AiChatServiceError("AI_PROVIDER_INVALID_RESPONSE", "AI read tool returned invalid data", 502, false);
              }
              const readResultBytes = new TextEncoder().encode(JSON.stringify(validatedReadResult.data)).byteLength;
              if (cumulativeReadResultBytes + readResultBytes > MAX_CUMULATIVE_READ_RESULT_BYTES) {
                throw new AiChatServiceError("AI_PROVIDER_INVALID_RESPONSE", "AI provider exceeded the cumulative read result limit", 502, false);
              }
              cumulativeReadResultBytes += readResultBytes;
              roundResults.push({ call, result: validatedReadResult.data });
              readResults.push(validatedReadResult.data);
            } catch (error) {
              if (error instanceof AiReadToolError) throw error;
              throw error;
            }
          }
          providerMessages.push({
            role: "assistant",
            content: providerMessage(payload) ?? "",
            tool_calls: readCalls.map((call) => ({
              id: call.id,
              type: "function",
              function: { name: call.name, arguments: JSON.stringify(call.arguments) },
            })),
          });
          for (const item of roundResults) {
            providerMessages.push({
              role: "tool",
              tool_call_id: item.call.id,
              name: item.call.name,
              content: JSON.stringify(item.result),
            });
          }
          continue;
        }

        let proposals: AiActionProposal[] = [];
        let actionResults: AiActionExecutionResult[] = [];
        if (actionCalls.length > 0) {
          if (!options.proposeActions) {
            throw new AiChatServiceError("AI_PROVIDER_INVALID_RESPONSE", "AI provider returned tool calls without a proposal handler", 502, false);
          }
          try {
            proposals = await options.proposeActions(actionCalls.map(({ name, arguments: toolArguments }) => ({ name, arguments: toolArguments })));
          } catch (error) {
            if (error instanceof AiToolError) {
              throw new AiChatServiceError("AI_PROVIDER_INVALID_RESPONSE", "AI provider returned an invalid tool call", 502, false);
            }
            throw error;
          }
          if (!Array.isArray(proposals) || proposals.length !== actionCalls.length) {
            throw new AiChatServiceError("AI_PROVIDER_INVALID_RESPONSE", "AI provider returned an invalid tool call", 502, false);
          }
          const autoProposals = proposals.filter((proposal) => !proposal.requires_confirmation);
          if (autoProposals.length > 0 && options.executeActions) {
            const executionResults = await options.executeActions(autoProposals);
            if (executionResults.length !== autoProposals.length
              || executionResults.some((result) => !AiActionExecutionResultSchema.safeParse(result).success)) {
              throw new AiChatServiceError("AI_ACTION_EXECUTION_FAILED", "A trusted AI action could not be completed", 502, true);
            }
            actionResults = executionResults.map((result) => AiActionExecutionResultSchema.parse(result));
            proposals = proposals.filter((proposal) => proposal.requires_confirmation);
          }
        }

        const hasIncompleteAction = actionResults.some((result) => result.status !== "executed");
        const message = hasIncompleteAction
          ? toolResultMessage(actionResults)
          : providerMessage(payload)
          ?? (proposals.length > 0
            ? toolFallbackMessage(proposals.length)
            : actionResults.length > 0 ? toolResultMessage(actionResults) : null);
        if (!message || message.length > 8_000) {
          throw new AiChatServiceError("AI_PROVIDER_INVALID_RESPONSE", "AI provider returned no usable message", 502, false);
        }
        const result = AiChatResponseSchema.safeParse({
          message,
          model,
          ...(proposals.length ? { action_proposals: proposals } : {}),
          ...(actionResults.length ? { action_results: actionResults } : {}),
          ...(readResults.length ? { read_results: readResults } : {}),
        });
        if (!result.success) {
          throw new AiChatServiceError("AI_PROVIDER_INVALID_RESPONSE", "AI provider response failed validation", 502, false);
        }
        return result.data;
      }
      throw new AiChatServiceError("AI_PROVIDER_INVALID_RESPONSE", "AI provider exceeded the read tool round limit", 502, false);
    } catch (error) {
      if (signal.aborted) throw error;
      if (timedOut) throw new AiChatServiceError("AI_PROVIDER_TIMEOUT", "AI provider timed out", 504, true);
      if (error instanceof AiChatServiceError) throw error;
      if (error instanceof AiReadToolError) throw error;
      throw new AiChatServiceError("AI_PROVIDER_UNAVAILABLE", "AI provider is unavailable", 502, true);
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abortFromCaller);
    }
  }
}

async function readResponseText(response: Response, maxBytes: number, signal?: AbortSignal) {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new AiChatServiceError("AI_PROVIDER_INVALID_RESPONSE", "AI provider response is too large", 502, false);
  }
  if (!response.body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) {
      throw new AiChatServiceError("AI_PROVIDER_INVALID_RESPONSE", "AI provider response is too large", 502, false);
    }
    return text;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      if (signal?.aborted) throw new DOMException("The operation was aborted", "AbortError");
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new AiChatServiceError("AI_PROVIDER_INVALID_RESPONSE", "AI provider response is too large", 502, false);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}
