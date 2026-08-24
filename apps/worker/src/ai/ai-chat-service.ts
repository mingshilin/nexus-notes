import { AiChatResponseSchema, type AiChatInput, type AiChatResponse } from "@nexus/contracts";

export interface AiChatServiceOptions {
  apiUrl?: string;
  apiKey?: string;
  model?: string;
  fetchImpl?: typeof fetch;
  maxResponseBytes?: number;
  timeoutMs?: number;
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

  async chat(input: AiChatInput, signal: AbortSignal): Promise<AiChatResponse> {
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
      const response = await this.fetchImpl(apiUrl, {
        method: "POST",
        redirect: "error",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ model, messages: input.messages, stream: false }),
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
      const message = providerMessage(payload);
      if (!message || message.length > 8_000) {
        throw new AiChatServiceError("AI_PROVIDER_INVALID_RESPONSE", "AI provider returned no usable message", 502, false);
      }
      const result = AiChatResponseSchema.safeParse({ message, model });
      if (!result.success) {
        throw new AiChatServiceError("AI_PROVIDER_INVALID_RESPONSE", "AI provider response failed validation", 502, false);
      }
      return result.data;
    } catch (error) {
      if (signal.aborted) throw error;
      if (timedOut) throw new AiChatServiceError("AI_PROVIDER_TIMEOUT", "AI provider timed out", 504, true);
      if (error instanceof AiChatServiceError) throw error;
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
