import { MAX_UPLOAD_BYTES } from "@nexus/contracts";

export const MAX_OCR_EXTRACTED_TEXT_BYTES = 1024 * 1024;

type SupportedOcrMimeType = "application/pdf" | "image/jpeg" | "image/png" | "image/webp" | "text/plain";

export interface OcrOperationOptions {
  signal?: AbortSignal;
}

export interface OcrObjectStore {
  get(key: string, options?: OcrOperationOptions): Promise<{ body: ReadableStream<Uint8Array>; size?: number } | null>;
}

export interface OcrAiBinding {
  toMarkdown(file: { name: string; blob: Blob }, options?: OcrOperationOptions): Promise<unknown>;
  run?(model: string, input: Record<string, unknown>): Promise<Record<string, unknown>>;
}

export interface OcrExtractionRequest {
  objectKey: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  deadline?: Date;
  signal?: AbortSignal;
}

export class OcrExtractionError extends Error {
  constructor(readonly code: string, readonly retryable: boolean) {
    super(code);
    this.name = "OcrExtractionError";
  }
}

function isSupportedMimeType(mimeType: string): mimeType is SupportedOcrMimeType {
  return mimeType === "application/pdf"
    || mimeType === "image/jpeg"
    || mimeType === "image/png"
    || mimeType === "image/webp"
    || mimeType === "text/plain";
}

function assertActive(request: Pick<OcrExtractionRequest, "deadline" | "signal">) {
  if (request.signal?.aborted) throw new OcrExtractionError("OCR_CANCELLED", true);
  if (request.deadline && request.deadline.getTime() <= Date.now()) {
    throw new OcrExtractionError("OCR_DEADLINE_EXCEEDED", false);
  }
}

function timeoutError(request: Pick<OcrExtractionRequest, "deadline">) {
  return request.deadline && request.deadline.getTime() <= Date.now()
    ? new OcrExtractionError("OCR_DEADLINE_EXCEEDED", false)
    : new OcrExtractionError("OCR_TIMEOUT", true);
}

async function cancelObject(object: { body: ReadableStream<Uint8Array> } | null | undefined) {
  await object?.body.cancel().catch(() => undefined);
}

async function guarded<T>(
  operation: () => Promise<T>,
  request: Pick<OcrExtractionRequest, "deadline" | "signal">,
  timeoutMs: number,
  options: { abort?: () => void; onLateResolve?: (value: T) => void | Promise<void> } = {},
) {
  assertActive(request);
  const deadlineMs = request.deadline ? request.deadline.getTime() - Date.now() : Number.POSITIVE_INFINITY;
  const waitMs = Math.min(timeoutMs, deadlineMs);
  if (!Number.isFinite(waitMs) || waitMs <= 0) throw timeoutError(request);

  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  let settled = false;
  let cancelled = false;
  let timedOut = false;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      options.abort?.();
      reject(timeoutError(request));
    }, waitMs);
  });
  const cancellation = new Promise<never>((_resolve, reject) => {
    abort = () => {
      cancelled = true;
      reject(timedOut ? timeoutError(request) : new OcrExtractionError("OCR_CANCELLED", true));
    };
    request.signal?.addEventListener("abort", abort, { once: true });
  });
  try {
    // Start only after cancellation and timeout observers are in place.
    const started = operation();
    const watched = started.then(
      async (value) => {
        if (settled || cancelled || timedOut) await options.onLateResolve?.(value);
        return value;
      },
      (error) => Promise.reject(error),
    );
    return await Promise.race([watched, timeout, cancellation]);
  } finally {
    settled = true;
    if (timer !== undefined) clearTimeout(timer);
    if (abort) request.signal?.removeEventListener("abort", abort);
  }
}

async function readBoundedObject(
  object: { body: ReadableStream<Uint8Array>; size?: number },
  request: OcrExtractionRequest,
  timeoutMs: number,
  abort: () => void,
) {
  if (!Number.isSafeInteger(request.sizeBytes) || request.sizeBytes <= 0 || request.sizeBytes > MAX_UPLOAD_BYTES) {
    throw new OcrExtractionError("OCR_INPUT_TOO_LARGE", false);
  }
  if (object.size !== undefined && (!Number.isSafeInteger(object.size) || object.size > MAX_UPLOAD_BYTES)) {
    await object.body.cancel().catch(() => undefined);
    throw new OcrExtractionError("OCR_INPUT_TOO_LARGE", false);
  }

  const reader = object.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await guarded(() => reader.read(), request, timeoutMs, { abort });
      if (done) break;
      const accepted = Math.min(value.byteLength, MAX_UPLOAD_BYTES + 1 - total);
      if (accepted > 0) chunks.push(value.subarray(0, accepted));
      total += accepted;
      if (accepted < value.byteLength || total > MAX_UPLOAD_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new OcrExtractionError("OCR_INPUT_TOO_LARGE", false);
      }
      assertActive(request);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    if (error instanceof OcrExtractionError) throw error;
    throw new OcrExtractionError("OCR_OBJECT_READ_FAILED", true);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  assertActive(request);
  return bytes;
}

function markdownText(response: unknown) {
  try {
    if (!response || typeof response !== "object") throw new OcrExtractionError("OCR_AI_INVALID_RESPONSE", true);
    const record = response as { format?: unknown; data?: unknown; error?: unknown };
    if (record.format === "error") {
      if (typeof record.error !== "string" || !record.error.trim()) {
        throw new OcrExtractionError("OCR_AI_INVALID_RESPONSE", true);
      }
      throw new OcrExtractionError("OCR_AI_FORMAT_ERROR", false);
    }
    if (record.format !== "markdown" || typeof record.data !== "string") {
      throw new OcrExtractionError("OCR_AI_INVALID_RESPONSE", true);
    }
    return record.data;
  } catch (error) {
    if (error instanceof OcrExtractionError) throw error;
    throw new OcrExtractionError("OCR_AI_INVALID_RESPONSE", true);
  }
}

function assertBoundedText(text: string) {
  if (new TextEncoder().encode(text).byteLength > MAX_OCR_EXTRACTED_TEXT_BYTES) {
    throw new OcrExtractionError("OCR_OUTPUT_TOO_LARGE", false);
  }
  if (!text.trim()) throw new OcrExtractionError("OCR_EMPTY_RESULT", false);
}

export class OcrExtractor {
  private readonly timeoutMs: number;

  constructor(private readonly dependencies: { files: OcrObjectStore; ai?: OcrAiBinding }, options: { timeoutMs?: number } = {}) {
    this.timeoutMs = options.timeoutMs ?? 60_000;
  }

  async extract(request: OcrExtractionRequest) {
    if (!isSupportedMimeType(request.mimeType)) {
      throw new OcrExtractionError("OCR_UNSUPPORTED_MIME", false);
    }
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (request.signal?.aborted) abort();
    request.signal?.addEventListener("abort", abort, { once: true });
    const activeRequest = { ...request, signal: controller.signal };

    try {
      assertActive(activeRequest);
      let object: { body: ReadableStream<Uint8Array>; size?: number } | null;
      try {
        object = await guarded(
          () => this.dependencies.files.get(request.objectKey, { signal: controller.signal }),
          activeRequest,
          this.timeoutMs,
          { abort, onLateResolve: cancelObject },
        );
      } catch (error) {
        if (error instanceof OcrExtractionError) throw error;
        throw new OcrExtractionError("OCR_OBJECT_READ_FAILED", true);
      }
      if (!object) throw new OcrExtractionError("OCR_OBJECT_NOT_FOUND", false);
      try {
        assertActive(activeRequest);
      } catch (error) {
        await cancelObject(object);
        throw error;
      }

      const bytes = await readBoundedObject(object, activeRequest, this.timeoutMs, abort);
      if (request.mimeType === "text/plain") {
        try {
          const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
          assertActive(activeRequest);
          assertBoundedText(text);
          assertActive(activeRequest);
          return text;
        } catch (error) {
          if (error instanceof OcrExtractionError) throw error;
          throw new OcrExtractionError("OCR_TEXT_DECODE_FAILED", false);
        }
      }

      const ai = this.dependencies.ai;
      if (!ai) throw new OcrExtractionError("OCR_AI_UNAVAILABLE", false);

      const blob = new Blob([bytes], { type: request.mimeType });
      let response: Awaited<ReturnType<OcrAiBinding["toMarkdown"]>>;
      try {
        response = await guarded(
          () => ai.toMarkdown({ name: request.filename, blob }, { signal: controller.signal }),
          activeRequest,
          this.timeoutMs,
          { abort },
        );
      } catch (error) {
        if (error instanceof OcrExtractionError) throw error;
        throw new OcrExtractionError("OCR_AI_REQUEST_FAILED", true);
      }
      assertActive(activeRequest);
      const text = markdownText(response);
      assertActive(activeRequest);
      assertBoundedText(text);
      assertActive(activeRequest);
      return text;
    } finally {
      request.signal?.removeEventListener("abort", abort);
    }
  }
}
