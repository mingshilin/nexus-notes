import type { AiChatMessage, AiChatResponse } from "@nexus/contracts";
import { Bot, Send, Sparkles } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { ApiClient } from "../data/api-client";
import { AIConfigPanel } from "./AIConfigPanel";

const QUICK_PROMPTS = ["制定今日计划", "整理我的任务", "如何改进这篇笔记"] as const;

interface AIChatPanelProps {
  client: Pick<ApiClient, "request">;
  workspaceId: string;
  showStatus?: boolean;
}

function errorMessage(error: unknown) {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  if (code === "AI_NOT_CONFIGURED") return "AI 服务尚未配置，请管理员设置 AI_CHAT_API_URL、AI_CHAT_API_KEY 和 AI_CHAT_MODEL。";
  if (code === "UNAUTHENTICATED" || code === "FORBIDDEN") return "当前工作区没有使用 AI 助手的权限，请重新登录或切换工作区。";
  return "AI 服务暂时不可用，请稍后重试。你的问题仍保留在输入框中。";
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

export function AIChatPanel({ client, workspaceId, showStatus = false }: AIChatPanelProps) {
  const [messages, setMessages] = useState<AiChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [configuration, setConfiguration] = useState<"configured" | "unconfigured" | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const chatControllerRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      chatControllerRef.current?.abort();
      chatControllerRef.current = null;
    };
  }, [workspaceId]);

  useEffect(() => {
    if (!showStatus || !workspaceId) {
      setConfiguration(null);
      return undefined;
    }
    const controller = new AbortController();
    void client.request<{ configured: boolean }>({
      path: "/api/v2/ai/status",
      headers: { "x-workspace-id": workspaceId },
      requestClass: "query",
      policy: { timeoutMs: 8_000, retry: 1, dedupeKey: `ai-status:${workspaceId}`, signal: controller.signal },
    }).then((status) => {
      if (!controller.signal.aborted) setConfiguration(status.configured ? "configured" : "unconfigured");
    }).catch(() => {
      if (!controller.signal.aborted) setConfiguration(null);
    });
    return () => controller.abort();
  }, [client, showStatus, workspaceId]);

  const fillQuickPrompt = (prompt: string) => {
    setDraft(prompt);
    inputRef.current?.focus();
  };

  const clearConversation = () => {
    setMessages([]);
    setError(null);
  };

  const send = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const content = draft.trim();
    if (!content || pending || !workspaceId) return;
    const nextMessages: AiChatMessage[] = [...messages, { role: "user", content }];
    const totalCharacters = nextMessages.reduce((total, message) => total + message.content.length, 0);
    if (nextMessages.length > 20 || totalCharacters > 32_000) {
      setError("本次对话最多保留 20 条消息、32,000 个字符，请先缩短内容。");
      return;
    }
    setMessages(nextMessages);
    setDraft("");
    setError(null);
    setPending(true);
    chatControllerRef.current?.abort();
    const controller = new AbortController();
    chatControllerRef.current = controller;
    const requestWorkspaceId = workspaceId;
    const isCurrentRequest = () => mountedRef.current
      && chatControllerRef.current === controller
      && requestWorkspaceId === workspaceId;
    try {
      const response = await client.request<AiChatResponse>({
        path: "/api/v2/ai/chat",
        method: "POST",
        headers: { "x-workspace-id": workspaceId },
        body: { messages: nextMessages },
        requestClass: "command",
        policy: { timeoutMs: 35_000, retry: 0, idempotencyKey: crypto.randomUUID(), signal: controller.signal },
      });
      if (!isCurrentRequest()) return;
      setMessages([...nextMessages, { role: "assistant", content: response.message }]);
    } catch (caught) {
      if (controller.signal.aborted || isAbortError(caught)) {
        if (isCurrentRequest()) {
          setMessages(messages);
          setDraft(content);
        }
        return;
      }
      if (!isCurrentRequest()) return;
      setMessages(messages);
      setError(errorMessage(caught));
      setDraft(content);
    } finally {
      if (isCurrentRequest()) {
        chatControllerRef.current = null;
        setPending(false);
      }
    }
  };

  return (
    <section className="product-domain-page ai-chat-page" aria-labelledby="ai-chat-title">
      <div className="ai-chat-heading">
        <div>
          <p className="eyebrow">NEXUS AI</p>
          <h1 id="ai-chat-title">AI 助手</h1>
          <p className="product-domain-lead">围绕你的问题展开对话。服务端密钥不会进入浏览器或笔记内容。</p>
        </div>
        {messages.length > 0 ? <button type="button" onClick={clearConversation}>清空对话</button> : null}
        <span className="ai-chat-mark" aria-hidden="true"><Bot size={22} /></span>
      </div>
      {configuration === "unconfigured" ? <p className="ai-chat-config-status" role="status">AI 尚未配置。你可以在下方添加自己的 OpenAI-compatible provider，API Key 不会以明文返回。</p> : null}
      {configuration === "configured" ? <p className="ai-chat-config-status ready" role="status">AI 服务已连接，可以开始对话。</p> : null}
      {showStatus ? <AIConfigPanel client={client} /> : null}
      {!workspaceId ? <p role="status">未选择工作区，无法使用 AI 助手。</p> : null}
      <div className="ai-chat-messages" aria-live="polite">
        {messages.length === 0 ? (
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
        ) : messages.map((message, index) => (
          <article className={`ai-chat-message ai-chat-message-${message.role}`} key={`${message.role}-${index}`}>
            <small>{message.role === "user" ? "你" : "AI 助手"}</small>
            <p>{message.content}</p>
          </article>
        ))}
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
    </section>
  );
}
