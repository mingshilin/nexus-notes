import type { AiActionExecutionResult, AiActionProposal, AiChatMessage, AiChatResponse, AiUserConfigSummary } from "@nexus/contracts";
import { Bot, Send, Sparkles } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { ApiClient } from "../data/api-client";
import { AIConfigPanel } from "./AIConfigPanel";
import { AIActionHistoryPanel, type ActionHistoryClient } from "./AIActionHistoryPanel";
import { AITrustedModePanel, type TrustedModeClient } from "./AITrustedModePanel";
import { AIActionCard, type AIActionCardStatus } from "./AIActionCard";

const QUICK_PROMPTS = ["制定今日计划", "整理我的任务", "如何改进这篇笔记"] as const;
const MAX_TIMER_DELAY_MS = 2_147_483_647;

export interface AIChatReadContext {
  selected_note_ids: readonly string[];
  selected_database_ids: readonly string[];
}

interface AIChatPanelProps {
  client: Pick<ApiClient, "request" | "confirmAiAction" | "rejectAiAction"> & Partial<Pick<ApiClient, "getAiTrustedMode" | "updateAiTrustedMode" | "listAiActionHistory">>;
  workspaceId: string;
  showStatus?: boolean;
  readContext?: AIChatReadContext;
}

type TranscriptEntry =
  | { id: string; kind: "message"; message: AiChatMessage }
  | { id: string; kind: "proposal"; proposal: AiActionProposal }
  | { id: string; kind: "action_result"; result: AiActionExecutionResult };

interface ActionState {
  status: AIActionCardStatus;
  baseRevision: number;
  error?: string | null;
}

function isFinalActionStatus(status: AIActionCardStatus) {
  return status === "confirmed" || status === "rejected" || status === "expired" || status === "failed" || status === "conflict";
}

function isProposalExpired(proposal: AiActionProposal, now = Date.now()) {
  return Date.parse(proposal.expires_at) <= now;
}

function expireActionStates(entries: TranscriptEntry[], current: Record<string, ActionState>, now = Date.now()) {
  let changed = false;
  const next = { ...current };
  for (const entry of entries) {
    if (entry.kind !== "proposal") continue;
    const state = next[entry.proposal.action_id];
    if (!state || isFinalActionStatus(state.status) || !isProposalExpired(entry.proposal, now)) continue;
    next[entry.proposal.action_id] = { ...state, status: "expired", error: null };
    changed = true;
  }
  return changed ? next : current;
}

function errorMessage(error: unknown) {
  const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code) : "";
  if (code === "AI_NOT_CONFIGURED") return "当前没有可用的 AI。请使用系统 AI，或在 AI 配置中添加自己的 API Key。";
  if (code === "AI_ACTION_EXPIRED") return "AI 操作已过期，请重新生成。";
  if (code === "UNAUTHENTICATED" || code === "FORBIDDEN") return "当前工作区没有使用 AI 助手的权限，请重新登录或切换工作区。";
  return "AI 服务暂时不可用，请稍后重试。你的问题仍保留在输入框中。";
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

function isAiDisabledError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; status?: unknown };
  return candidate.code === "SERVER_NOT_CONFIGURED" && candidate.status === 503;
}

function normalizeActionError(error: unknown) {
  const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code) : "";
  const status = error && typeof error === "object" && "status" in error && typeof (error as { status?: unknown }).status === "number"
    ? (error as { status: number }).status
    : undefined;
  const retryable = error && typeof error === "object" && "retryable" in error && (error as { retryable?: unknown }).retryable === true;
  if (code === "AI_ACTION_EXPIRED") return { status: "expired" as const, message: null };
  if (code === "AI_ACTION_IN_PROGRESS") {
    return { status: "proposed" as const, message: "AI 操作仍在执行，请稍后再次确认。" };
  }
  if (code === "AI_ACTION_CONFLICT" || code === "AI_ACTION_NOTE_CONFLICT") {
    return { status: "conflict" as const, message: "AI 操作状态已变化，请重新发起 AI 操作。" };
  }
  if (retryable !== true && (status === undefined || (status >= 400 && status < 600))) {
    if (status === undefined && code === "NETWORK_ERROR") {
      return { status: "proposed" as const, message: "请求未完成，可以再次确认。" };
    }
    return {
      status: "failed" as const,
      message: code === "AI_ACTION_PERMISSION_DENIED" ? "当前没有权限执行此 AI 操作。" : "AI 操作参数或权限不允许执行。",
    };
  }
  return { status: "proposed" as const, message: "请求未完成，可以再次确认。" };
}

function actionResultMessage(result: { status?: string; error?: { code?: string } }) {
  if (result.status === "conflict" || result.error?.code === "AI_ACTION_NOTE_CONFLICT") {
    return "笔记内容已发生变化，请重新发起 AI 操作。";
  }
  return "AI 操作执行失败，请重新发起 AI 操作。";
}

function actionResultText(result: AiActionExecutionResult) {
  if (result.status === "executed") return "AI 操作已完成。";
  if (result.status === "conflict") return "AI 操作未执行：目标内容已发生变化。";
  if (result.retryable === true || result.error?.code === "AI_ACTION_IN_PROGRESS") return "AI 操作仍在执行，请稍后重试。";
  return "AI 操作执行失败，请重新发起。";
}

type AIConfigurationState = "checking" | "configured" | "unconfigured" | "disabled" | null;

export function AIChatPanel({ client, workspaceId, showStatus = false, readContext }: AIChatPanelProps) {
  const [entries, setEntries] = useState<TranscriptEntry[]>([]);
  const [actionStates, setActionStates] = useState<Record<string, ActionState>>({});
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [configuration, setConfiguration] = useState<AIConfigurationState>(() => workspaceId ? "checking" : null);
  const [configurationDetails, setConfigurationDetails] = useState<AiUserConfigSummary | null>(null);
  const [allowWorkspaceSearch, setAllowWorkspaceSearch] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const chatControllerRef = useRef<AbortController | null>(null);
  const workspaceIdRef = useRef(workspaceId);
  const requestGenerationRef = useRef(0);
  const mountedRef = useRef(false);
  workspaceIdRef.current = workspaceId;

  useEffect(() => {
    requestGenerationRef.current += 1;
    setEntries([]);
    setActionStates({});
    setDraft("");
    setError(null);
    setConfiguration(workspaceId ? "checking" : null);
    setConfigurationDetails(null);
    setAllowWorkspaceSearch(false);
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      chatControllerRef.current?.abort();
      chatControllerRef.current = null;
    };
  }, [workspaceId]);

  useEffect(() => {
    setAllowWorkspaceSearch(false);
  }, [workspaceId, readContext?.selected_note_ids.join("\u001f"), readContext?.selected_database_ids.join("\u001f")]);

  useEffect(() => {
    if (!workspaceId) {
      setConfiguration(null);
      return undefined;
    }
    const controller = new AbortController();
    void client.request<AiUserConfigSummary>({
      path: "/api/v2/ai/status",
      headers: { "x-workspace-id": workspaceId },
      requestClass: "query",
      policy: { timeoutMs: 8_000, retry: 1, dedupeKey: `ai-status:${workspaceId}`, signal: controller.signal },
    }).then((status) => {
      if (!controller.signal.aborted) {
        setConfigurationDetails(status);
        setConfiguration(status.configured ? "configured" : "unconfigured");
      }
    }).catch((caught) => {
      if (!controller.signal.aborted) {
        setConfigurationDetails(null);
        setConfiguration(isAiDisabledError(caught) ? "disabled" : null);
      }
    });
    return () => controller.abort();
  }, [client, workspaceId]);

  useEffect(() => {
    setActionStates((current) => expireActionStates(entries, current));

    let nextExpiryAt = Number.POSITIVE_INFINITY;
    const now = Date.now();
    for (const entry of entries) {
      if (entry.kind !== "proposal") continue;
      const state = actionStates[entry.proposal.action_id];
      if (!state || isFinalActionStatus(state.status)) continue;
      const expiresAt = Date.parse(entry.proposal.expires_at);
      if (Number.isNaN(expiresAt) || expiresAt <= now) continue;
      nextExpiryAt = Math.min(nextExpiryAt, expiresAt);
    }
    if (!Number.isFinite(nextExpiryAt)) return undefined;

    const delay = Math.max(0, nextExpiryAt - now) + 1;
    if (delay > MAX_TIMER_DELAY_MS) return undefined;

    const timer = window.setTimeout(() => {
      setActionStates((current) => expireActionStates(entries, current, Date.now()));
    }, delay);
    return () => window.clearTimeout(timer);
  }, [actionStates, entries]);

  const fillQuickPrompt = (prompt: string) => {
    setDraft(prompt);
    inputRef.current?.focus();
  };

  const clearConversation = () => {
    requestGenerationRef.current += 1;
    chatControllerRef.current?.abort();
    chatControllerRef.current = null;
    setEntries([]);
    setActionStates({});
    setError(null);
    setDraft("");
    setPending(false);
  };

  const updateActionState = (actionId: string, next: Partial<ActionState> | null) => {
    setActionStates((current) => {
      if (!next) {
        const clone = { ...current };
        delete clone[actionId];
        return clone;
      }
      return { ...current, [actionId]: { ...current[actionId], ...next } };
    });
  };

  const setProposalState = (proposal: AiActionProposal, next?: Partial<ActionState>) => {
    const baseRevision = proposal.proposal_revision ?? 1;
    setActionStates((current) => ({
      ...current,
      [proposal.action_id]: {
        ...current[proposal.action_id],
        status: isProposalExpired(proposal) ? "expired" : "proposed",
        baseRevision,
        error: null,
        ...next,
      },
    }));
  };

  const send = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const content = draft.trim();
    if (!content || pending || !workspaceId || configuration === "disabled") return;
    const previousEntries = entries;
    const nextMessages: AiChatMessage[] = entries
      .filter((entry): entry is Extract<TranscriptEntry, { kind: "message" }> => entry.kind === "message")
      .map((entry) => entry.message);
    const requestMessages = [...nextMessages, { role: "user", content }];
    const totalCharacters = requestMessages.reduce((total, message) => total + message.content.length, 0);
    if (requestMessages.length > 20 || totalCharacters > 32_000) {
      setError("本次对话最多保留 20 条消息、32,000 个字符，请先缩短内容。");
      return;
    }
    const userEntry: TranscriptEntry = { id: crypto.randomUUID(), kind: "message", message: { role: "user", content } };
    setEntries([...previousEntries, userEntry]);
    setDraft("");
    setError(null);
    setPending(true);
    chatControllerRef.current?.abort();
    const controller = new AbortController();
    chatControllerRef.current = controller;
    const requestWorkspaceId = workspaceId;
    const requestGeneration = requestGenerationRef.current;
    const isCurrentRequest = () => mountedRef.current
      && chatControllerRef.current === controller
      && requestGeneration === requestGenerationRef.current
      && requestWorkspaceId === workspaceIdRef.current;
    try {
      const response = await client.request<AiChatResponse>({
        path: "/api/v2/ai/chat",
        method: "POST",
        headers: { "x-workspace-id": workspaceId },
        body: {
          messages: requestMessages,
          ...(readContext ? {
            read_context: {
              selected_note_ids: [...readContext.selected_note_ids],
              selected_database_ids: [...readContext.selected_database_ids],
              allow_workspace_search: allowWorkspaceSearch,
            },
          } : {}),
        },
        requestClass: "command",
        policy: { timeoutMs: 35_000, retry: 0, idempotencyKey: crypto.randomUUID(), signal: controller.signal },
      });
      if (!isCurrentRequest()) return;
      const assistantEntry: TranscriptEntry = { id: crypto.randomUUID(), kind: "message", message: { role: "assistant", content: response.message } };
      const proposalEntries = (response.action_proposals ?? []).map((proposal) => {
        setProposalState(proposal);
        return { id: proposal.action_id, kind: "proposal" as const, proposal };
      });
      const resultEntries = (response.action_results ?? []).map((result) => ({
        id: `result:${result.action_id}`,
        kind: "action_result" as const,
        result,
      }));
      setEntries([...previousEntries, userEntry, assistantEntry, ...resultEntries, ...proposalEntries]);
    } catch (caught) {
      if (controller.signal.aborted || isAbortError(caught)) {
        if (isCurrentRequest()) {
          setEntries(previousEntries);
          setDraft(content);
        }
        return;
      }
      if (!isCurrentRequest()) return;
      setEntries(previousEntries);
      if (isAiDisabledError(caught)) {
        setConfiguration("disabled");
        setError(null);
        setDraft(content);
        return;
      }
      setError(errorMessage(caught));
      setDraft(content);
    } finally {
      if (isCurrentRequest()) {
        chatControllerRef.current = null;
        setPending(false);
      }
    }
  };

  const confirmProposal = async (proposal: AiActionProposal) => {
    const state = actionStates[proposal.action_id];
    if (!workspaceId || state?.status === "confirming" || state?.status === "rejecting" || state?.status === "confirmed" || state?.status === "rejected" || state?.status === "expired") return;
    if (isProposalExpired(proposal)) {
      updateActionState(proposal.action_id, { status: "expired", error: null });
      return;
    }
    updateActionState(proposal.action_id, { status: "confirming", error: null });
    try {
      const response = await client.confirmAiAction(workspaceId, proposal.action_id, state?.baseRevision ?? 1);
      if (response.action.status === "executed") {
        updateActionState(proposal.action_id, { status: "confirmed", error: null, baseRevision: (state?.baseRevision ?? 1) + 1 });
      } else {
        updateActionState(proposal.action_id, {
          status: response.action.status === "conflict" ? "conflict" : "failed",
          error: actionResultMessage(response.action),
          baseRevision: state?.baseRevision ?? 1,
        });
      }
    } catch (caught) {
      const normalized = normalizeActionError(caught);
      updateActionState(proposal.action_id, { ...normalized, error: normalized.message, baseRevision: state?.baseRevision ?? 1 });
    }
  };

  const rejectProposal = async (proposal: AiActionProposal) => {
    const state = actionStates[proposal.action_id];
    if (!workspaceId || state?.status === "confirming" || state?.status === "rejecting" || state?.status === "confirmed" || state?.status === "rejected" || state?.status === "expired") return;
    if (isProposalExpired(proposal)) {
      updateActionState(proposal.action_id, { status: "expired", error: null });
      return;
    }
    updateActionState(proposal.action_id, { status: "rejecting", error: null });
    try {
      await client.rejectAiAction(workspaceId, proposal.action_id, state?.baseRevision ?? 1);
      updateActionState(proposal.action_id, { status: "rejected", error: null, baseRevision: (state?.baseRevision ?? 1) + 1 });
    } catch (caught) {
      const normalized = normalizeActionError(caught);
      updateActionState(proposal.action_id, { ...normalized, error: normalized.message, baseRevision: state?.baseRevision ?? 1 });
    }
  };

  const firstActionId = entries.find((entry) => entry.kind === "proposal" && actionStates[entry.proposal.action_id]?.status === "proposed")?.kind === "proposal"
    ? (entries.find((entry) => entry.kind === "proposal" && actionStates[entry.proposal.action_id]?.status === "proposed") as Extract<TranscriptEntry, { kind: "proposal" }>).proposal.action_id
    : null;

  return (
    <section className="product-domain-page ai-chat-page" aria-labelledby="ai-chat-title">
      <div className="ai-chat-heading">
        <div>
          <p className="eyebrow">NEXUS AI</p>
          <h1 id="ai-chat-title">AI 助手</h1>
          <p className="product-domain-lead">围绕你的问题展开对话。服务端密钥不会进入浏览器或笔记内容。</p>
        </div>
        {entries.length > 0 ? <button type="button" onClick={clearConversation}>清空对话</button> : null}
        <span className="ai-chat-mark" aria-hidden="true"><Bot size={22} /></span>
      </div>
      {showStatus && configuration === "unconfigured" ? <p className="ai-chat-config-status" role="status">AI 尚未配置。你可以在下方添加自己的 OpenAI-compatible provider，API Key 不会以明文返回。</p> : null}
      {showStatus && configuration === "configured" ? <p className="ai-chat-config-status ready" role="status">AI 服务已连接，可以开始对话。</p> : null}
      {configuration === "checking" ? (
        <p className="ai-chat-config-status" role="status">正在检查 AI 服务状态…</p>
      ) : configuration === "disabled" ? (
        <p className="ai-chat-config-status" role="status">AI 助手当前不可用，管理员尚未启用此功能。</p>
      ) : (
        <>
          {showStatus ? <AIConfigPanel client={client} status={configurationDetails} /> : null}
          {showStatus && workspaceId && typeof client.getAiTrustedMode === "function" && typeof client.updateAiTrustedMode === "function" ? <AITrustedModePanel client={client as TrustedModeClient} workspaceId={workspaceId} /> : null}
          {showStatus && workspaceId && typeof client.listAiActionHistory === "function" ? <AIActionHistoryPanel client={client as ActionHistoryClient} workspaceId={workspaceId} /> : null}
          {!workspaceId ? <p role="status">未选择工作区，无法使用 AI 助手。</p> : null}
          {readContext ? (
            <fieldset className="ai-chat-context">
              <legend>AI 读取范围</legend>
              <p>
                {readContext.selected_note_ids.length > 0 || readContext.selected_database_ids.length > 0
                  ? `当前已选择 ${readContext.selected_note_ids.length} 篇笔记、${readContext.selected_database_ids.length} 个数据库。`
                  : "当前没有选中的笔记或数据库。"}
              </p>
              <label><input type="checkbox" aria-label="允许搜索工作区" checked={allowWorkspaceSearch} onChange={(event) => setAllowWorkspaceSearch(event.target.checked)} />允许搜索工作区</label>
            </fieldset>
          ) : null}
          <div className="ai-chat-messages" aria-live="polite">
            {entries.length === 0 ? (
              <div className="ai-chat-empty">
                <Sparkles size={18} aria-hidden="true" />
                <div>
                  <p>可以问我如何整理任务、拆解目标或改进笔记结构。</p>
                  <div className="ai-chat-quick-prompts" aria-label="快捷提问">
                    {QUICK_PROMPTS.map((prompt) => (
                      <button type="button" key={prompt} onClick={() => fillQuickPrompt(prompt)}>{prompt}</button>
                    ))}
                  </div>
                </div>
              </div>
            ) : entries.map((entry) => {
              if (entry.kind === "message") {
                return (
                  <article className={`ai-chat-message ai-chat-message-${entry.message.role}`} key={entry.id}>
                    <small>{entry.message.role === "user" ? "你" : "AI 助手"}</small>
                    <p>{entry.message.content}</p>
                  </article>
                );
              }
              if (entry.kind === "action_result") {
                const retryable = entry.result.retryable === true || entry.result.error?.code === "AI_ACTION_IN_PROGRESS";
                return (
                  <article className={`ai-chat-action-result ai-chat-action-result-${retryable ? "in-progress" : entry.result.status}`} key={entry.id} role="status">
                    <small>AI 操作结果</small>
                    <p>{actionResultText(entry.result)}</p>
                    {!retryable && entry.result.status !== "executed" ? (
                      <button
                        type="button"
                        onClick={() => {
                          setDraft("请重新发起刚才未完成的 AI 操作");
                          inputRef.current?.focus();
                        }}
                      >重新发起</button>
                    ) : null}
                  </article>
                );
              }
              const state = actionStates[entry.proposal.action_id] ?? { status: "proposed", baseRevision: 1, error: null };
              return (
                <AIActionCard
                  key={entry.id}
                  proposal={entry.proposal}
                  status={state.status}
                  error={state.error ?? null}
                  autoFocus={entry.proposal.action_id === firstActionId}
                  onConfirm={() => { void confirmProposal(entry.proposal); }}
                  onReject={() => { void rejectProposal(entry.proposal); }}
                  onRegenerate={() => {
                    setDraft(`请重新生成：${entry.proposal.summary}`);
                    inputRef.current?.focus();
                  }}
                />
              );
            })}
            {pending ? <p className="ai-chat-pending" role="status">AI 正在思考…</p> : null}
          </div>
          {error ? <p className="database-operation-error" role="alert">{error}</p> : null}
          <form className="ai-chat-form" onSubmit={send}>
            <textarea
              aria-label="输入问题"
              ref={inputRef}
              value={draft}
              maxLength={4_000}
              disabled={!workspaceId || pending}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="输入你想讨论的问题…"
              rows={3}
            />
            <div className="ai-chat-submit-area">
              <small aria-live="polite">{draft.length}/4,000</small>
              <button type="submit" disabled={!workspaceId || pending || !draft.trim()}><Send size={16} aria-hidden="true" />发送</button>
            </div>
          </form>
        </>
      )}
    </section>
  );
}
