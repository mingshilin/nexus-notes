import { QueueJobSchema, type QueueJob } from "@nexus/contracts";
import { strToU8, zipSync } from "fflate";
import type { CreateNoteRecordInput } from "../notes/note-service";

const MAX_QUEUE_DELIVERY_ATTEMPTS = 3;
const MAX_IMPORT_BYTES = 200_000;
const MAX_IMPORT_NOTES = 100;
const MAX_EXPORT_BYTES = 5_000_000;
const MAX_EXPORT_NOTES = 10_000;

export type OperationsConsumerOutcome = { outcome: "ack" } | { outcome: "retry"; delaySeconds: number };

interface ClaimedOperation {
  id: string;
  workspace_id: string;
  user_id: string;
  kind: "import" | "export" | "index" | "email";
}

interface ExportNote {
  id: string;
  title: string;
  content: string;
}

export interface OperationsRepository {
  claimJob(job: QueueJob, now: string, nativeAttempts: number): Promise<ClaimedOperation | null>;
  completeJob(workspaceId: string, jobId: string, resultKey: string | null, now: string): Promise<boolean>;
  failJob(workspaceId: string, jobId: string, code: string, now: string): Promise<boolean>;
  listNotes(input: { workspaceId: string; cursor?: string; limit: number }): Promise<{ items: ExportNote[]; nextCursor: string | null }>;
}

export interface OperationsFiles {
  put(key: string, value: string | Uint8Array, options?: { httpMetadata?: { contentType: string } }): Promise<unknown>;
}

export interface OperationsMessage {
  body: unknown;
  attempts: number;
  ack(): void;
}

interface SafeMessage {
  body: unknown;
  attempts: number;
  ack(): void;
}

interface OperationsConsumerOptions {
  clock?: () => Date;
  createNote?(input: CreateNoteRecordInput): Promise<unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
  return { body: input, attempts: 1, ack: () => undefined };
}

function safeAck(message: SafeMessage) {
  try {
    message.ack();
  } catch {
    // A broken acknowledgement must not poison another queue message.
  }
}

function retryDelaySeconds(attempts: number) {
  return Math.min(60, 2 ** Math.max(0, attempts - 1));
}

function errorCode(error: unknown) {
  if (isRecord(error) && typeof error.code === "string" && /^[A-Z][A-Z0-9_]{2,127}$/u.test(error.code)) return error.code;
  return "OPERATION_FAILED";
}

function textBytes(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

function safeSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/gu, "_").slice(0, 128) || "unknown";
}

function titleFromPayload(payload: Record<string, unknown>, content: string) {
  if (typeof payload.title === "string" && payload.title.trim()) return payload.title.trim().slice(0, 160);
  const heading = /^#\s+(.+)$/mu.exec(content)?.[1]?.trim();
  if (heading) return heading.slice(0, 160);
  const filename = typeof payload.filename === "string" ? payload.filename.trim() : "Imported note";
  return (filename.replace(/\.[a-z0-9]+$/iu, "") || "Imported note").slice(0, 160);
}

export interface MarkdownImportItem {
  title: string;
  content: string;
}

export function parseMarkdownImport(content: string): MarkdownImportItem[] {
  return content
    .split(/\r?\n---+\r?\n/u)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block, index) => {
      const firstLine = block.split(/\r?\n/u)[0]?.replace(/^#{1,6}\s*/u, "").trim() ?? "";
      return {
        title: (firstLine || `Imported ${index + 1}`).slice(0, 160),
        content: block,
      };
    });
}

function markdownForNote(note: ExportNote) {
  const title = note.title.trim() || "Untitled note";
  return `# ${title}\n\n${note.content}\n\n`;
}

export class OperationsConsumer {
  private readonly clock: () => Date;
  private readonly createNote?: OperationsConsumerOptions["createNote"];

  constructor(
    private readonly repository: OperationsRepository,
    private readonly files: OperationsFiles,
    options: OperationsConsumerOptions = {},
  ) {
    this.clock = options.clock ?? (() => new Date());
    this.createNote = options.createNote;
  }

  async consume(messageOrJob: OperationsMessage | QueueJob | unknown): Promise<OperationsConsumerOutcome> {
    const message = toSafeMessage(messageOrJob);
    const parsed = QueueJobSchema.safeParse(message.body);
    if (!parsed.success || parsed.data.kind === "ocr") {
      safeAck(message);
      return { outcome: "ack" };
    }

    let claimed: ClaimedOperation | null;
    try {
      claimed = await this.repository.claimJob(parsed.data, this.clock().toISOString(), message.attempts);
    } catch {
      if (message.attempts < MAX_QUEUE_DELIVERY_ATTEMPTS) {
        return { outcome: "retry", delaySeconds: retryDelaySeconds(message.attempts) };
      }
      safeAck(message);
      return { outcome: "ack" };
    }
    if (!claimed) {
      safeAck(message);
      return { outcome: "ack" };
    }

    try {
      const resultKey = claimed.kind === "export"
        ? await this.runExport(parsed.data, claimed)
        : claimed.kind === "import"
          ? await this.runImport(parsed.data, claimed)
          : (() => { throw Object.assign(new Error("OPERATION_KIND_UNSUPPORTED"), { code: "OPERATION_KIND_UNSUPPORTED" }); })();
      await this.repository.completeJob(claimed.workspace_id, claimed.id, resultKey, this.clock().toISOString());
    } catch (error) {
      await this.repository.failJob(claimed.workspace_id, claimed.id, errorCode(error), this.clock().toISOString());
    }
    safeAck(message);
    return { outcome: "ack" };
  }

  async consumeBatch(messages: readonly unknown[]) {
    return Promise.all(messages.map((message) => this.consume(message)));
  }

  private async runExport(job: QueueJob, claimed: ClaimedOperation) {
    const parts: string[] = [];
    let cursor: string | undefined;
    let count = 0;
    let totalBytes = 0;
    do {
      const page = await this.repository.listNotes({ workspaceId: claimed.workspace_id, cursor, limit: 100 });
      for (const note of page.items) {
        count += 1;
        if (count > MAX_EXPORT_NOTES) throw Object.assign(new Error("EXPORT_LIMIT_EXCEEDED"), { code: "EXPORT_LIMIT_EXCEEDED" });
        const part = markdownForNote(note);
        totalBytes += textBytes(part);
        if (totalBytes > MAX_EXPORT_BYTES) throw Object.assign(new Error("EXPORT_SIZE_EXCEEDED"), { code: "EXPORT_SIZE_EXCEEDED" });
        parts.push(part);
      }
      cursor = page.nextCursor ?? undefined;
    } while (cursor);

    const markdown = parts.join("");
    const format = job.payload.format === "zip" ? "zip" : "markdown";
    const key = `workspaces/${safeSegment(claimed.workspace_id)}/operations/${safeSegment(claimed.id)}.${format === "zip" ? "zip" : "md"}`;
    const body = format === "zip" ? zipSync({ "notes.md": strToU8(markdown) }, { level: 0 }) : markdown;
    await this.files.put(key, body, { httpMetadata: { contentType: format === "zip" ? "application/zip" : "text/markdown; charset=utf-8" } });
    return key;
  }

  private async runImport(job: QueueJob, claimed: ClaimedOperation) {
    const payload = job.payload;
    const content = typeof payload.content === "string" ? payload.content : "";
    if (!content || textBytes(content) > MAX_IMPORT_BYTES) {
      throw Object.assign(new Error("IMPORT_CONTENT_INVALID"), { code: "IMPORT_CONTENT_INVALID" });
    }
    if (!this.createNote) throw Object.assign(new Error("IMPORT_NOT_CONFIGURED"), { code: "IMPORT_NOT_CONFIGURED" });
    const blocks = parseMarkdownImport(content);
    if (blocks.length === 0) {
      throw Object.assign(new Error("IMPORT_CONTENT_INVALID"), { code: "IMPORT_CONTENT_INVALID" });
    }
    if (blocks.length > MAX_IMPORT_NOTES) {
      throw Object.assign(new Error("IMPORT_NOTE_LIMIT_EXCEEDED"), { code: "IMPORT_NOTE_LIMIT_EXCEEDED" });
    }

    // Preserve the original single-note behavior, including an explicit payload title and raw content.
    const items: MarkdownImportItem[] = blocks.length === 1
      ? [{ title: titleFromPayload(payload, content), content }]
      : blocks;
    for (const item of items) {
      await this.createNote({
        id: crypto.randomUUID(),
        workspaceId: claimed.workspace_id,
        userId: claimed.user_id,
        title: item.title,
        content: item.content,
        folderId: null,
        databaseId: null,
        dailyDate: null,
        isFavorite: false,
        isPinned: false,
        source: "import",
        now: this.clock().toISOString(),
      });
    }
    return null;
  }
}

type QueueConsumer = { consume(message: unknown): Promise<OperationsConsumerOutcome> };

export class QueueConsumerRouter {
  constructor(
    private readonly ocr: QueueConsumer,
    private readonly operations: QueueConsumer,
    private readonly aiEmail?: QueueConsumer,
    private readonly reminders?: QueueConsumer,
  ) {}

  async consume(message: unknown): Promise<OperationsConsumerOutcome> {
    const safe = toSafeMessage(message);
    const parsed = QueueJobSchema.safeParse(safe.body);
    const rawKind = isRecord(safe.body) && typeof safe.body.kind === "string" ? safe.body.kind : null;
    if (rawKind === "ocr" || rawKind === null) return this.ocr.consume(message);
    if (!parsed.success) {
      safeAck(safe);
      return { outcome: "ack" };
    }
    if (parsed.data.kind === "ocr") return this.ocr.consume(message);
    if (parsed.data.kind === "notification" && this.aiEmail && isRecord(parsed.data.payload) && typeof parsed.data.payload.outbox_id === "string") {
      return this.aiEmail.consume(message);
    }
    if ((parsed.data.kind === "notification" || parsed.data.kind === "email") && this.reminders) {
      return this.reminders.consume(message);
    }
    return this.operations.consume(message);
  }

  async consumeBatch(messages: readonly unknown[]) {
    return Promise.all(messages.map((message) => this.consume(message)));
  }
}
