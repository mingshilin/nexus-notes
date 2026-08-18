import { HttpError, jsonSuccess } from "../http";
import {
  deleteNoteAttachmentById,
  getNoteAttachmentById,
  getNoteById,
  insertNoteAttachment,
  listNoteAttachments,
} from "../db/queries";

const MAX_ATTACHMENT_SIZE = 8 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "application/pdf",
]);

export async function handleUploadNoteAttachment(
  db: D1Database,
  request: Request,
  payload: {
    userId: string;
    workspaceId: string;
    noteId: string;
    bucket?: R2Bucket;
  },
) {
  const note = await getNoteById(db, payload.userId, payload.workspaceId, payload.noteId);
  if (!note) throw new HttpError(404, "NOT_FOUND", "note not found");
  if (!payload.bucket) throw new HttpError(503, "R2_DISABLED", "R2 bucket is not configured");

  const formData = await request.formData();
  const file = formData.get("file") as
    | {
        arrayBuffer: () => Promise<ArrayBuffer>;
        type?: string;
        name?: string;
        size?: number;
      }
    | null;

  if (!file || typeof file.arrayBuffer !== "function") {
    throw new HttpError(400, "VALIDATION_ERROR", "file is required");
  }

  const mimeType = (file.type || "").toLowerCase();
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    throw new HttpError(400, "VALIDATION_ERROR", "unsupported attachment type");
  }

  const size = Number(file.size ?? 0);
  if (size > MAX_ATTACHMENT_SIZE) {
    throw new HttpError(400, "VALIDATION_ERROR", "attachment size exceeds limit");
  }

  const ext = mimeType === "application/pdf" ? "pdf" : mimeType.split("/")[1] || "bin";
  const attachmentId = crypto.randomUUID();
  const storageKey = `attachments/${payload.workspaceId}/${payload.noteId}/${attachmentId}.${ext}`;
  const body = await file.arrayBuffer();

  await payload.bucket.put(storageKey, body, {
    httpMetadata: { contentType: mimeType },
  });

  await insertNoteAttachment(db, {
    id: attachmentId,
    noteId: payload.noteId,
    workspaceId: payload.workspaceId,
    uploaderId: payload.userId,
    storageKey,
    fileName: file.name ?? `image.${ext}`,
    mimeType,
    size: size || body.byteLength,
  });

  return jsonSuccess(
    {
      id: attachmentId,
      file_name: file.name ?? `attachment.${ext}`,
      mime_type: mimeType,
      size: size || body.byteLength,
      markdown_url: `/api/attachments/${attachmentId}/file`,
    },
    { status: 201 },
  );
}

export async function handleListNoteAttachments(
  db: D1Database,
  payload: { userId: string; workspaceId: string; noteId: string },
) {
  const note = await getNoteById(db, payload.userId, payload.workspaceId, payload.noteId);
  if (!note) throw new HttpError(404, "NOT_FOUND", "note not found");
  return jsonSuccess(await listNoteAttachments(db, payload.workspaceId, payload.noteId));
}

export async function handleDeleteNoteAttachment(
  db: D1Database,
  payload: {
    workspaceId: string;
    attachmentId: string;
    bucket?: R2Bucket;
  },
) {
  const attachment = await getNoteAttachmentById(db, payload.workspaceId, payload.attachmentId);
  if (!attachment) throw new HttpError(404, "NOT_FOUND", "attachment not found");
  if (payload.bucket) {
    await payload.bucket.delete(attachment.storage_key);
  }
  await deleteNoteAttachmentById(db, payload.workspaceId, payload.attachmentId);
  return jsonSuccess({ ok: true });
}

export async function handleGetAttachmentFile(
  db: D1Database,
  payload: { workspaceId: string; attachmentId: string; bucket?: R2Bucket },
) {
  if (!payload.bucket) throw new HttpError(404, "NOT_FOUND", "attachment not found");
  const attachment = await getNoteAttachmentById(db, payload.workspaceId, payload.attachmentId);
  if (!attachment) throw new HttpError(404, "NOT_FOUND", "attachment not found");
  const object = await payload.bucket.get(attachment.storage_key);
  if (!object) throw new HttpError(404, "NOT_FOUND", "attachment not found");
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", "public, max-age=604800");
  return new Response(object.body, { headers });
}
