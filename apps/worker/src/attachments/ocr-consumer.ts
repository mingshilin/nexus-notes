import type { QueueJob } from "@nexus/contracts";

interface OcrRepository {
  claimOcrJob(job: QueueJob, now: string, nativeAttempts: number): Promise<{
    id: string;
    workspace_id: string;
    attachment_id: string;
    attempt_count: number;
    deadline: string;
    object_key: string;
    filename: string;
    mime_type: string;
    size_bytes: number;
  } | null>;
  completeOcrJob(workspaceId: string, jobId: string, text: string, now: string): Promise<boolean | void>;
  retryOcrJob(workspaceId: string, jobId: string, code: string, now: string): Promise<boolean>;
  failOcrJob(workspaceId: string, jobId: string, code: string, now: string, options?: { deadLetter?: boolean }): Promise<boolean | void>;
}

interface OcrExtractor {
  extract(input: { objectKey: string; filename: string; mimeType: string; sizeBytes: number; deadline: Date }): Promise<string>;
}

interface LegacyOcrFiles {
  get(key: string): Promise<{ body: ReadableStream } | null>;
}

interface LegacyOcrExtractor {
  extract(body: ReadableStream): Promise<string>;
}

export interface OcrQueueMessage {
  body: unknown;
  attempts: number;
  ack(): void;
}

export type OcrConsumerOutcome = { outcome: "ack" } | { outcome: "retry"; delaySeconds: number };

const MAX_QUEUE_DELIVERY_ATTEMPTS = 3;
const MAX_RETRY_DELAY_SECONDS = 60;
const GENERIC_OCR_ERROR_CODE = "OCR_EXTRACTION_FAILED";
const PERSISTED_OCR_ERROR_CODES = new Set([
  "OCR_AI_FORMAT_ERROR",
  "OCR_AI_INVALID_RESPONSE",
  "OCR_AI_REQUEST_FAILED",
  "OCR_AI_UNAVAILABLE",
  "OCR_ATTEMPTS_EXHAUSTED",
  "OCR_CANCELLED",
  "OCR_DEADLINE_EXCEEDED",
  "OCR_EMPTY_RESULT",
  "OCR_FILE_NOT_FOUND",
  "OCR_INPUT_TOO_LARGE",
  "OCR_OBJECT_NOT_FOUND",
  "OCR_OBJECT_READ_FAILED",
  "OCR_OUTPUT_TOO_LARGE",
  "OCR_STORAGE_UNAVAILABLE",
  "OCR_SOURCE_STALE",
  "OCR_TEXT_DECODE_FAILED",
  "OCR_TIMEOUT",
  "OCR_UNSUPPORTED_MIME",
  GENERIC_OCR_ERROR_CODE,
]);

interface SafeMessage {
  body: unknown;
  attempts: number;
  ack(): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeAck(message: SafeMessage) {
  try {
    message.ack();
  } catch {
    // An acknowledgement failure must not poison unrelated batch messages.
  }
}

function auditMalformedQueueMessage() {
  try {
    console.warn("OCR_QUEUE_MESSAGE_INVALID");
  } catch {
    // Audit sinks must not prevent a poison message from being acknowledged.
  }
}

function attemptsFrom(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1;
}

function toSafeMessage(input: unknown): SafeMessage {
  if (isRecord(input) && "body" in input) {
    const acknowledge = input.ack;
    return {
      body: input.body,
      attempts: attemptsFrom(input.attempts),
      ack: typeof acknowledge === "function" ? () => acknowledge.call(input) : () => undefined,
    };
  }
  return {
    body: input,
    attempts: attemptsFrom(isRecord(input) ? input.attempt : undefined),
    ack: () => undefined,
  };
}

function isOcrJob(value: unknown): value is QueueJob {
  return isRecord(value) && value.kind === "ocr" && isRecord(value.payload)
    && typeof value.payload.workspace_id === "string" && typeof value.payload.attachment_id === "string";
}

function errorCode(error: unknown) {
  const candidate = isRecord(error) && typeof error.code === "string"
    ? error.code
    : error instanceof Error ? error.message : undefined;
  if (candidate && PERSISTED_OCR_ERROR_CODES.has(candidate)) {
    return candidate;
  }
  return GENERIC_OCR_ERROR_CODE;
}

function isRetryable(error: unknown) {
  return isRecord(error) && error.retryable === true;
}

function retryDelaySeconds(attempts: number) {
  return Math.min(MAX_RETRY_DELAY_SECONDS, 2 ** Math.max(0, attempts - 1));
}

export class OcrConsumer {
  private readonly repository: OcrRepository;
  private readonly clock: () => Date;
  private readonly extractor: OcrExtractor;

  constructor(
    repository: OcrRepository,
    extractor: OcrExtractor,
    options?: { clock?: () => Date },
  );
  constructor(
    repository: OcrRepository,
    files: LegacyOcrFiles,
    extractor: LegacyOcrExtractor,
    options?: { clock?: () => Date },
  );
  constructor(
    repository: OcrRepository,
    extractorOrFiles: OcrExtractor | LegacyOcrFiles,
    extractorOrOptions: LegacyOcrExtractor | { clock?: () => Date } = {},
    legacyOptions: { clock?: () => Date } = {},
  ) {
    this.repository = repository;
    if ("extract" in extractorOrFiles) {
      this.extractor = extractorOrFiles;
      this.clock = (extractorOrOptions as { clock?: () => Date }).clock ?? (() => new Date());
      return;
    }
    const files = extractorOrFiles;
    const extractor = extractorOrOptions as LegacyOcrExtractor;
    this.extractor = {
      async extract(input) {
        const file = await files.get(input.objectKey);
        if (!file) throw new Error("OCR_FILE_NOT_FOUND");
        return extractor.extract(file.body);
      },
    };
    this.clock = legacyOptions.clock ?? (() => new Date());
  }

  async consume(message: OcrQueueMessage): Promise<OcrConsumerOutcome>;
  async consume(job: QueueJob): Promise<OcrConsumerOutcome>;
  async consume(message: unknown): Promise<OcrConsumerOutcome>;
  async consume(messageOrJob: unknown): Promise<OcrConsumerOutcome> {
    const message = toSafeMessage(messageOrJob);
    try {
      return await this.consumeMessage(message);
    } catch {
      if (message.attempts < MAX_QUEUE_DELIVERY_ATTEMPTS) {
        return { outcome: "retry", delaySeconds: retryDelaySeconds(message.attempts) };
      }
      safeAck(message);
      return { outcome: "ack" };
    }
  }

  private async consumeMessage(message: SafeMessage): Promise<OcrConsumerOutcome> {
    const job = message.body;
    if (!isOcrJob(job)) {
      auditMalformedQueueMessage();
      safeAck(message);
      return { outcome: "ack" };
    }
    const now = this.clock().toISOString();
    const claimed = await this.repository.claimOcrJob(job, now, message.attempts);
    if (!claimed) {
      safeAck(message);
      return { outcome: "ack" };
    }
    try {
      if (Date.parse(claimed.deadline) <= this.clock().getTime()) throw new Error("OCR_DEADLINE_EXCEEDED");
      const text = (await this.extractor.extract({
        objectKey: claimed.object_key,
        filename: claimed.filename,
        mimeType: claimed.mime_type,
        sizeBytes: claimed.size_bytes,
        deadline: new Date(claimed.deadline),
      })).trim();
      const completed = await this.repository.completeOcrJob(claimed.workspace_id, claimed.id, text, this.clock().toISOString());
      if (completed === false) {
        await this.repository.failOcrJob(claimed.workspace_id, claimed.id, "OCR_SOURCE_STALE", this.clock().toISOString());
      }
      safeAck(message);
      return { outcome: "ack" };
    } catch (error) {
      const code = errorCode(error);
      const attempts = Math.max(message.attempts, claimed.attempt_count);
      const beforeDeadline = Date.parse(claimed.deadline) > this.clock().getTime();
      if (isRetryable(error) && attempts < MAX_QUEUE_DELIVERY_ATTEMPTS && beforeDeadline) {
        const persisted = await this.repository.retryOcrJob(claimed.workspace_id, claimed.id, code, this.clock().toISOString());
        if (persisted) return { outcome: "retry", delaySeconds: retryDelaySeconds(attempts) };
        safeAck(message);
        return { outcome: "ack" };
      }
      const exhausted = isRetryable(error) && attempts >= MAX_QUEUE_DELIVERY_ATTEMPTS;
      await this.repository.failOcrJob(
        claimed.workspace_id,
        claimed.id,
        exhausted ? "OCR_ATTEMPTS_EXHAUSTED" : code,
        this.clock().toISOString(),
        { deadLetter: exhausted },
      );
      safeAck(message);
      return { outcome: "ack" };
    }
  }

  async consumeBatch(messages: readonly unknown[]) {
    return Promise.all(messages.map((message) => this.consume(message)));
  }
}
