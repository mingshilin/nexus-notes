import type { QueueJob } from "@nexus/contracts";

interface OcrRepository {
  claimOcrJob(job: QueueJob, now: string): Promise<{
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
  body: QueueJob;
  attempts: number;
  ack(): void;
}

export type OcrConsumerOutcome = { outcome: "ack" } | { outcome: "retry"; delaySeconds: number };

const MAX_QUEUE_DELIVERY_ATTEMPTS = 3;
const MAX_RETRY_DELAY_SECONDS = 60;

function errorCode(error: unknown) {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string" && /^[A-Z0-9_]+$/.test(error.code)) {
    return error.code;
  }
  if (error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)) return error.message;
  return "OCR_EXTRACTION_FAILED";
}

function isRetryable(error: unknown) {
  return Boolean(error && typeof error === "object" && "retryable" in error && error.retryable === true);
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
  async consume(messageOrJob: OcrQueueMessage | QueueJob): Promise<OcrConsumerOutcome> {
    const message: OcrQueueMessage = "body" in messageOrJob
      ? messageOrJob
      : { body: messageOrJob, attempts: messageOrJob.attempt, ack: () => undefined };
    const job = message.body;
    if (job.kind !== "ocr" || !job.payload || typeof job.payload !== "object"
      || typeof job.payload.workspace_id !== "string" || typeof job.payload.attachment_id !== "string") {
      message.ack();
      return { outcome: "ack" };
    }
    const now = this.clock().toISOString();
    const claimed = await this.repository.claimOcrJob(job, now);
    if (!claimed) {
      message.ack();
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
      message.ack();
      return { outcome: "ack" };
    } catch (error) {
      const code = errorCode(error);
      const attempts = Math.max(1, Math.floor(message.attempts));
      const beforeDeadline = Date.parse(claimed.deadline) > this.clock().getTime();
      if (isRetryable(error) && attempts < MAX_QUEUE_DELIVERY_ATTEMPTS && beforeDeadline) {
        const persisted = await this.repository.retryOcrJob(claimed.workspace_id, claimed.id, code, this.clock().toISOString());
        if (persisted) return { outcome: "retry", delaySeconds: retryDelaySeconds(attempts) };
        message.ack();
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
      message.ack();
      return { outcome: "ack" };
    }
  }

  async consumeBatch(messages: readonly OcrQueueMessage[]) {
    return Promise.all(messages.map((message) => this.consume(message)));
  }
}
