import { MAX_UPLOAD_BYTES } from "@nexus/contracts";

export const MAX_OCR_EXTRACTED_TEXT_BYTES = 1024 * 1024;

type SupportedOcrMimeType = "application/pdf" | "image/jpeg" | "image/png" | "image/webp" | "text/plain";

export interface OcrObjectStore {
  get(key: string): Promise<{ body: ReadableStream<Uint8Array>; size?: number } | null>;
}

export interface OcrAiBinding {
  toMarkdown(file: { name: string; blob: Blob }): Promise<
    | { format: "markdown"; data: string }
    | { format: "error"; error: string }
  >;
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

async function guarded<T>(operation: Promise<T>, request: Pick<OcrExtractionRequest, "deadline" | "signal">, timeoutMs: number) {
  assertActive(request);
  const deadlineMs = request.deadline ? request.deadline.getTime() - Date.now() : Number.POSITIVE_INFINITY;
  const waitMs = Math.min(timeoutMs, deadlineMs);
  if (!Number.isFinite(waitMs) || waitMs <= 0) throw timeoutError(request);

  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(timeoutError(request)), waitMs);
  });
  const cancellation = new Promise<never>((_resolve, reject) => {
    abort = () => reject(new OcrExtractionError("OCR_CANCELLED", true));
    request.signal?.addEventListener("abort", abort, { once: true });
  });
  try {
    return await Promise.race([operation, timeout, cancellation]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (abort) request.signal?.removeEventListener("abort", abort);
  }
}

async function readBoundedObject(
  object: { body: ReadableStream<Uint8Array>; size?: number },
  request: OcrExtractionRequest,
  timeoutMs: number,
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
      const { done, value } = await guarded(reader.read(), request, timeoutMs);
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
  return bytes;
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
    assertActive(request);

    let object: { body: ReadableStream<Uint8Array>; size?: number } | null;
    try {
      object = await guarded(this.dependencies.files.get(request.objectKey), request, this.timeoutMs);
    } catch (error) {
      if (error instanceof OcrExtractionError) throw error;
      throw new OcrExtractionError("OCR_OBJECT_READ_FAILED", true);
    }
    if (!object) throw new OcrExtractionError("OCR_OBJECT_NOT_FOUND", false);

    const bytes = await readBoundedObject(object, request, this.timeoutMs);
    if (request.mimeType === "text/plain") {
      try {
        const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        if (!text.trim()) throw new OcrExtractionError("OCR_EMPTY_RESULT", false);
        return text;
      } catch (error) {
        if (error instanceof OcrExtractionError) throw error;
        throw new OcrExtractionError("OCR_TEXT_DECODE_FAILED", false);
      }
    }

    if (!this.dependencies.ai) throw new OcrExtractionError("OCR_AI_UNAVAILABLE", false);

    const blob = new Blob([bytes], { type: request.mimeType });
    let response: Awaited<ReturnType<OcrAiBinding["toMarkdown"]>>;
    try {
      response = await guarded(this.dependencies.ai!.toMarkdown({ name: request.filename, blob }), request, this.timeoutMs);
    } catch (error) {
      if (error instanceof OcrExtractionError) throw error;
      throw new OcrExtractionError("OCR_AI_REQUEST_FAILED", true);
    }
    if (response.format === "error") throw new OcrExtractionError("OCR_AI_FORMAT_ERROR", false);
    if (!response.data.trim()) throw new OcrExtractionError("OCR_EMPTY_RESULT", false);
    if (new TextEncoder().encode(response.data).byteLength > MAX_OCR_EXTRACTED_TEXT_BYTES) {
      throw new OcrExtractionError("OCR_OUTPUT_TOO_LARGE", false);
    }
    assertActive(request);
    return response.data;
  }
}
