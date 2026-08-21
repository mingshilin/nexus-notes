import type { QueueJob } from "@nexus/contracts";

interface OcrRepository {
  claimOcrJob(job: QueueJob, now: string): Promise<{ id: string; workspace_id: string; attachment_id: string; attempt_count: number; deadline: string } | null>;
  completeOcrJob(workspaceId: string, jobId: string, text: string, now: string): Promise<boolean | void>;
  failOcrJob(workspaceId: string, jobId: string, code: string, now: string): Promise<void>;
}

interface OcrFiles { get(key: string): Promise<{ body: ReadableStream } | null>; }
interface OcrExtractor { extract(body: ReadableStream): Promise<string>; }

export class OcrConsumer {
  private readonly clock: () => Date;

  constructor(
    private readonly repository: OcrRepository,
    private readonly files: OcrFiles,
    private readonly extractor: OcrExtractor,
    options: { clock?: () => Date } = {},
  ) { this.clock = options.clock ?? (() => new Date()); }

  async consume(job: QueueJob) {
    if (job.kind !== "ocr" || typeof job.payload.workspace_id !== "string" || typeof job.payload.attachment_id !== "string") return;
    const now = this.clock().toISOString();
    const claimed = await this.repository.claimOcrJob(job, now);
    if (!claimed) return;
    try {
      if (Date.parse(claimed.deadline) <= this.clock().getTime()) throw new Error("OCR_DEADLINE_EXCEEDED");
      const file = await this.files.get(`${claimed.workspace_id}/attachments/${claimed.attachment_id}`);
      if (!file) throw new Error("OCR_FILE_NOT_FOUND");
      const text = (await this.extractor.extract(file.body)).trim();
      const completed = await this.repository.completeOcrJob(claimed.workspace_id, claimed.id, text, this.clock().toISOString());
      if (completed === false) {
        await this.repository.failOcrJob(claimed.workspace_id, claimed.id, "OCR_SOURCE_STALE", this.clock().toISOString());
      }
    } catch (error) {
      const code = error instanceof Error && /^[A-Z0-9_]+$/.test(error.message) ? error.message : "OCR_EXTRACTION_FAILED";
      await this.repository.failOcrJob(claimed.workspace_id, claimed.id, code, this.clock().toISOString());
    }
  }
}
