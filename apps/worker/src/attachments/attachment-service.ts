import {
  MAX_UPLOAD_BYTES,
  SUPPORTED_ATTACHMENT_MIME_TYPES,
  type Attachment,
  type CreateAttachmentUploadInput,
  type KnowledgeDiagnostic,
  type KnowledgeDiagnosticsRequest,
  type OcrRetryInput,
  type UploadCompleteInput,
} from "@nexus/contracts";

export interface AttachmentActorContext {
  workspaceId: string;
  userId: string;
}

export interface AttachmentRepository {
  reserveUpload?(input: { workspaceId: string; userId: string; input: CreateAttachmentUploadInput; now: string }): Promise<Attachment>;
  getAttachment(workspaceId: string, attachmentId: string, includeDeleted: boolean): Promise<Attachment | null>;
  listAttachments?(workspaceId: string, request: import("@nexus/contracts").AttachmentListRequest): Promise<{ items: Attachment[]; next_cursor: string | null }>;
  markUploaded?(workspaceId: string, attachmentId: string, now: string): Promise<void>;
  deleteAttachment?(workspaceId: string, attachmentId: string, now: string): Promise<void>;
  ensureOcrJob?(workspaceId: string, userId: string, attachmentId: string, now: string): Promise<{
    created: boolean;
    job_id: string;
    source_revision: number;
    attempt: number;
    deadline: string;
    idempotency_key: string;
    outbox_id: string;
  } | null>;
  retryOcr(workspaceId: string, userId: string, attachmentIds: string[], now: string): Promise<{
    queued: string[];
    ineligible: string[];
    duplicate: string[];
    outbox_ids: string[];
  }>;
  diagnostics(workspaceId: string, request: KnowledgeDiagnosticsRequest): Promise<{
    items: KnowledgeDiagnostic[];
    nextCursor: string | null;
  }>;
}

interface PrivateFiles {
  put?(key: string, value: ArrayBuffer | ArrayBufferView, options?: R2PutOptions): Promise<unknown>;
  get?(key: string): Promise<{ body: ReadableStream; httpMetadata?: { contentType?: string } } | null>;
  delete?(key: string): Promise<void>;
}

interface OutboxDispatcher {
  dispatch(ids?: string[]): Promise<{ dispatched: number; failed: number }>;
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
  private readonly outbox?: OutboxDispatcher;

  constructor(
    private readonly repository: AttachmentRepository,
    private readonly files?: PrivateFiles,
    options: { clock?: () => Date; outbox?: OutboxDispatcher } = {},
  ) {
    this.clock = options.clock ?? (() => new Date());
    this.outbox = options.outbox;
  }

  private requireFiles() {
    if (typeof this.files?.get !== "function" || typeof this.files.put !== "function" || typeof this.files.delete !== "function") {
      throw new AttachmentServiceError("ATTACHMENT_CAPABILITY_UNAVAILABLE", "Attachment storage is not configured", 503);
    }
    return this.files as Required<PrivateFiles>;
  }

  async createUpload(context: AttachmentActorContext, input: CreateAttachmentUploadInput) {
    if (!SUPPORTED_ATTACHMENT_MIME_TYPES.includes(input.mime_type)) {
      throw new AttachmentServiceError("UNSUPPORTED_ATTACHMENT_TYPE", "Attachment type is not supported", 400);
    }
    if (input.size_bytes > MAX_UPLOAD_BYTES) {
      throw new AttachmentServiceError("ATTACHMENT_FILE_TOO_LARGE", "Attachment exceeds the 25 MB limit", 413);
    }
    this.requireFiles();
    if (!this.repository.reserveUpload) {
      throw new AttachmentServiceError("ATTACHMENT_UPLOAD_UNAVAILABLE", "Attachment upload is not configured", 503);
    }
    try {
      return await this.repository.reserveUpload({
        workspaceId: context.workspaceId,
        userId: context.userId,
        input,
        now: this.clock().toISOString(),
      });
    } catch (error) {
      const code = error instanceof Error && "code" in error ? error.code : undefined;
      if (code === "ATTACHMENT_QUOTA_EXCEEDED") {
        throw new AttachmentServiceError(code, "Workspace attachment quota exceeded", 403);
      }
      if (code === "ATTACHMENT_NOTE_NOT_FOUND") {
        throw new AttachmentServiceError(code, "Attachment note not found", 404);
      }
      throw error;
    }
  }

  async uploadContent(context: AttachmentActorContext, attachmentId: string, body: Uint8Array) {
    const files = this.requireFiles();
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
    await files.put(objectKey(context.workspaceId, attachmentId), body, { httpMetadata: { contentType: attachment.mime_type } });
    await this.repository.markUploaded?.(context.workspaceId, attachmentId, this.clock().toISOString());
    return this.getAttachment(context, attachmentId);
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
      await this.outbox?.dispatch([job.outbox_id]);
    }
    return attachment;
  }

  async getAttachment(context: AttachmentActorContext, attachmentId: string) {
    const attachment = await this.repository.getAttachment(context.workspaceId, attachmentId, false);
    if (!attachment) throw new AttachmentServiceError("ATTACHMENT_NOT_FOUND", "Attachment not found", 404);
    return attachment;
  }

  async download(context: AttachmentActorContext, attachmentId: string) {
    const files = this.requireFiles();
    const attachment = await this.getAttachment(context, attachmentId);
    const object = await files.get(objectKey(context.workspaceId, attachmentId));
    if (!object) throw new AttachmentServiceError("ATTACHMENT_CONTENT_NOT_FOUND", "Attachment content not found", 404);
    return { body: object.body, mime_type: attachment.mime_type, filename: attachment.filename };
  }

  async deleteAttachment(context: AttachmentActorContext, attachmentId: string) {
    const files = this.requireFiles();
    await this.getAttachment(context, attachmentId);
    if (!this.repository.deleteAttachment) {
      throw new AttachmentServiceError("ATTACHMENT_DELETE_UNAVAILABLE", "Attachment deletion is not configured", 503);
    }
    await files.delete(objectKey(context.workspaceId, attachmentId));
    await this.repository.deleteAttachment(context.workspaceId, attachmentId, this.clock().toISOString());
  }

  async retryOcr(context: AttachmentActorContext, input: OcrRetryInput) {
    const now = this.clock().toISOString();
    const result = await this.repository.retryOcr(context.workspaceId, context.userId, input.attachment_ids, now);
    if (result.outbox_ids.length > 0) await this.outbox?.dispatch(result.outbox_ids);
    const { outbox_ids: _outboxIds, ...response } = result;
    return response;
  }

  async diagnostics(context: AttachmentActorContext, request: KnowledgeDiagnosticsRequest) {
    const result = await this.repository.diagnostics(context.workspaceId, request);
    return { items: result.items, next_cursor: result.nextCursor };
  }
}
