import {
  MAX_UPLOAD_BYTES,
  MAX_WORKSPACE_ATTACHMENT_BYTES,
  SUPPORTED_ATTACHMENT_MIME_TYPES,
  type Attachment,
  type CreateAttachmentUploadInput,
  type KnowledgeDiagnosticsRequest,
  type OcrRetryInput,
  type UploadCompleteInput,
} from "@nexus/contracts";

export interface AttachmentActorContext {
  workspaceId: string;
  userId: string;
}

export interface AttachmentRepository {
  getAttachmentUsage?(workspaceId: string): Promise<number>;
  reserveUpload?(input: { workspaceId: string; userId: string; input: CreateAttachmentUploadInput; now: string }): Promise<Attachment>;
  getAttachment(workspaceId: string, attachmentId: string, includeDeleted: boolean): Promise<Attachment | null>;
  listAttachments?(workspaceId: string, request: import("@nexus/contracts").AttachmentListRequest): Promise<{ items: Attachment[]; next_cursor: string | null }>;
  markUploaded?(workspaceId: string, attachmentId: string, now: string): Promise<void>;
  deleteAttachment?(workspaceId: string, attachmentId: string, now: string): Promise<void>;
  ensureOcrJob?(workspaceId: string, userId: string, attachmentId: string, now: string): Promise<{ created: boolean; idempotency_key: string } | null>;
  retryOcr(workspaceId: string, userId: string, attachmentIds: string[], now: string): Promise<{
    queued: string[];
    ineligible: string[];
    duplicate: string[];
  }>;
  diagnostics(workspaceId: string, request: KnowledgeDiagnosticsRequest): Promise<{
    items: Array<{ kind: "unfiled_note" | "orphan_note" | "duplicate_title" | "broken_link" | "failed_ocr"; entity_id: string; title: string; count: number }>;
    nextCursor: string | null;
  }>;
}

interface PrivateFiles {
  put?(key: string, value: ArrayBuffer | ArrayBufferView, options?: R2PutOptions): Promise<unknown>;
  get?(key: string): Promise<{ body: ReadableStream; httpMetadata?: { contentType?: string } } | null>;
  delete?(key: string): Promise<void>;
}

interface JobQueue {
  send?(message: unknown): Promise<unknown>;
}

export class AttachmentServiceError extends Error {
  readonly retryable = false;

  constructor(readonly code: string, message: string, readonly status: number) {
    super(message);
    this.name = "AttachmentServiceError";
  }
}

function objectKey(workspaceId: string, attachmentId: string) {
  return `${workspaceId}/attachments/${attachmentId}`;
}

function bytesStartWith(bytes: Uint8Array, expected: number[]) {
  return expected.every((value, index) => bytes[index] === value);
}

function isValidText(bytes: Uint8Array) {
  if (bytes.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

function signatureMatches(mimeType: string, bytes: Uint8Array) {
  switch (mimeType) {
    case "application/pdf": return bytesStartWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]);
    case "image/jpeg": return bytesStartWith(bytes, [0xff, 0xd8, 0xff]);
    case "image/png": return bytesStartWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "image/webp": return bytesStartWith(bytes, [0x52, 0x49, 0x46, 0x46])
      && bytesStartWith(bytes.slice(8), [0x57, 0x45, 0x42, 0x50]);
    case "text/plain": return isValidText(bytes);
    default: return false;
  }
}

export class AttachmentService {
  private readonly clock: () => Date;
  private readonly queue?: JobQueue;

  constructor(
    private readonly repository: AttachmentRepository,
    private readonly files: PrivateFiles,
    options: { clock?: () => Date; queue?: JobQueue } = {},
  ) {
    this.clock = options.clock ?? (() => new Date());
    this.queue = options.queue;
  }

  async createUpload(context: AttachmentActorContext, input: CreateAttachmentUploadInput) {
    if (!SUPPORTED_ATTACHMENT_MIME_TYPES.includes(input.mime_type)) {
      throw new AttachmentServiceError("UNSUPPORTED_ATTACHMENT_TYPE", "Attachment type is not supported", 400);
    }
    if (input.size_bytes > MAX_UPLOAD_BYTES) {
      throw new AttachmentServiceError("ATTACHMENT_FILE_TOO_LARGE", "Attachment exceeds the 25 MB limit", 413);
    }
    const currentUsage = await this.repository.getAttachmentUsage?.(context.workspaceId) ?? 0;
    if (currentUsage + input.size_bytes > MAX_WORKSPACE_ATTACHMENT_BYTES) {
      throw new AttachmentServiceError("ATTACHMENT_QUOTA_EXCEEDED", "Workspace attachment quota exceeded", 403);
    }
    if (!this.repository.reserveUpload) {
      throw new AttachmentServiceError("ATTACHMENT_UPLOAD_UNAVAILABLE", "Attachment upload is not configured", 503);
    }
    return this.repository.reserveUpload({
      workspaceId: context.workspaceId,
      userId: context.userId,
      input,
      now: this.clock().toISOString(),
    });
  }

  async uploadContent(context: AttachmentActorContext, attachmentId: string, body: Uint8Array) {
    const attachment = await this.repository.getAttachment(context.workspaceId, attachmentId, false);
    if (!attachment) throw new AttachmentServiceError("ATTACHMENT_NOT_FOUND", "Attachment not found", 404);
    if (attachment.status !== "uploading") {
      throw new AttachmentServiceError("ATTACHMENT_UPLOAD_INELIGIBLE", "Attachment cannot accept content", 409);
    }
    if (body.byteLength !== attachment.size_bytes) {
      throw new AttachmentServiceError("ATTACHMENT_SIZE_MISMATCH", "Attachment size does not match upload intent", 400);
    }
    if (!signatureMatches(attachment.mime_type, body)) {
      throw new AttachmentServiceError("ATTACHMENT_SIGNATURE_MISMATCH", "Attachment bytes do not match its declared type", 400);
    }
    if (!this.files.put) {
      throw new AttachmentServiceError("ATTACHMENT_STORAGE_UNAVAILABLE", "Attachment storage is not configured", 503);
    }
    await this.files.put(objectKey(context.workspaceId, attachmentId), body, { httpMetadata: { contentType: attachment.mime_type } });
    await this.repository.markUploaded?.(context.workspaceId, attachmentId, this.clock().toISOString());
    return attachment;
  }

  async listAttachments(context: AttachmentActorContext, request: import("@nexus/contracts").AttachmentListRequest) {
    if (!this.repository.listAttachments) {
      throw new AttachmentServiceError("ATTACHMENT_LIST_UNAVAILABLE", "Attachment list is not configured", 503);
    }
    return this.repository.listAttachments(context.workspaceId, request);
  }

  async completeUpload(context: AttachmentActorContext, attachmentId: string, input: UploadCompleteInput) {
    if (input.upload_id !== attachmentId) {
      throw new AttachmentServiceError("UPLOAD_ATTACHMENT_MISMATCH", "Upload does not belong to this attachment", 400);
    }
    const attachment = await this.getAttachment(context, attachmentId);
    if (attachment.status !== "ready") {
      throw new AttachmentServiceError("ATTACHMENT_UPLOAD_INELIGIBLE", "Attachment content is not ready", 409);
    }
    const job = await this.repository.ensureOcrJob?.(context.workspaceId, context.userId, attachmentId, this.clock().toISOString());
    if (job?.created) {
      await this.queue?.send?.({
        job_id: crypto.randomUUID(), kind: "ocr", idempotency_key: job.idempotency_key, attempt: 1,
        deadline: new Date(this.clock().getTime() + 10 * 60_000).toISOString(),
        payload: { workspace_id: context.workspaceId, attachment_id: attachmentId },
      });
    }
    return attachment;
  }

  async getAttachment(context: AttachmentActorContext, attachmentId: string) {
    const attachment = await this.repository.getAttachment(context.workspaceId, attachmentId, false);
    if (!attachment) throw new AttachmentServiceError("ATTACHMENT_NOT_FOUND", "Attachment not found", 404);
    return attachment;
  }

  async download(context: AttachmentActorContext, attachmentId: string) {
    const attachment = await this.getAttachment(context, attachmentId);
    const object = await this.files.get?.(objectKey(context.workspaceId, attachmentId));
    if (!object) throw new AttachmentServiceError("ATTACHMENT_CONTENT_NOT_FOUND", "Attachment content not found", 404);
    return { body: object.body, mime_type: attachment.mime_type, filename: attachment.filename };
  }

  async deleteAttachment(context: AttachmentActorContext, attachmentId: string) {
    await this.getAttachment(context, attachmentId);
    if (!this.repository.deleteAttachment) {
      throw new AttachmentServiceError("ATTACHMENT_DELETE_UNAVAILABLE", "Attachment deletion is not configured", 503);
    }
    await this.repository.deleteAttachment(context.workspaceId, attachmentId, this.clock().toISOString());
    await this.files.delete?.(objectKey(context.workspaceId, attachmentId));
  }

  async retryOcr(context: AttachmentActorContext, input: OcrRetryInput) {
    const now = this.clock().toISOString();
    const result = await this.repository.retryOcr(context.workspaceId, context.userId, input.attachment_ids, now);
    await Promise.all(result.queued.map((attachmentId) => this.queue?.send?.({
      job_id: crypto.randomUUID(),
      kind: "ocr",
      idempotency_key: `ocr:${attachmentId}`,
      attempt: 1,
      deadline: new Date(this.clock().getTime() + 10 * 60_000).toISOString(),
      payload: { workspace_id: context.workspaceId, attachment_id: attachmentId },
    })));
    return result;
  }

  async diagnostics(context: AttachmentActorContext, request: KnowledgeDiagnosticsRequest) {
    const result = await this.repository.diagnostics(context.workspaceId, request);
    return { items: result.items, next_cursor: result.nextCursor };
  }
}
