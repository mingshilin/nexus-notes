import {
  AttachmentListRequestSchema,
  CreateAttachmentUploadInputSchema,
  UploadCompleteInputSchema,
  KnowledgeDiagnosticsRequestSchema,
  OcrRetryInputSchema,
} from "@nexus/contracts";

import type { RouteDefinition } from "../http/route-registry";
import { AttachmentServiceError } from "../attachments/attachment-service";

interface AttachmentRegistry<TEnv> {
  register<TBody, TData>(definition: RouteDefinition<TEnv, TBody, TData>): void;
}

interface AttachmentRouteService {
  listAttachments(context: { workspaceId: string; userId: string }, request: unknown): Promise<unknown>;
  getAttachment(context: { workspaceId: string; userId: string }, attachmentId: string): Promise<unknown>;
  createUpload(context: { workspaceId: string; userId: string }, input: unknown): Promise<unknown>;
  completeUpload(context: { workspaceId: string; userId: string }, attachmentId: string, input: unknown): Promise<unknown>;
  uploadContent(context: { workspaceId: string; userId: string }, attachmentId: string, body: Uint8Array): Promise<unknown>;
  deleteAttachment(context: { workspaceId: string; userId: string }, attachmentId: string): Promise<void>;
  retryOcr(context: { workspaceId: string; userId: string }, input: unknown): Promise<unknown>;
  diagnostics(context: { workspaceId: string; userId: string }, request: unknown): Promise<unknown>;
  download(context: { workspaceId: string; userId: string }, attachmentId: string): Promise<{
    body: BodyInit;
    mime_type: string;
    filename: string;
  }>;
}

function listRequest(request: Request) {
  const params = new URL(request.url).searchParams;
  const rawLimit = Number(params.get("limit") ?? 50);
  return AttachmentListRequestSchema.parse({
    mime_type: params.get("mime_type") ?? undefined,
    note_id: params.get("note_id") ?? undefined,
    status: params.get("status") ?? undefined,
    cursor: params.get("cursor") ?? undefined,
    limit: Number.isInteger(rawLimit) ? rawLimit : 50,
  });
}

function diagnosticsRequest(request: Request) {
  const params = new URL(request.url).searchParams;
  const rawLimit = Number(params.get("limit") ?? 50);
  return KnowledgeDiagnosticsRequestSchema.parse({
    cursor: params.get("cursor") ?? undefined,
    limit: Number.isInteger(rawLimit) ? rawLimit : 50,
  });
}

function contentDisposition(filename: string) {
  const safe = filename.replace(/[\\"\r\n]/gu, "_");
  return `attachment; filename="${safe}"`;
}

export function registerAttachmentRoutes<TEnv>(
  registry: AttachmentRegistry<TEnv>,
  createService: (env: TEnv) => AttachmentRouteService,
) {
  registry.register({
    method: "GET", path: "/api/v2/attachments", auth: "workspace",
    handler: async ({ request, env, workspace }) => ({ data: await createService(env).listAttachments(workspace!, listRequest(request)) }),
  });
  registry.register({
    method: "POST", path: "/api/v2/attachments/uploads", auth: "workspace", minimumRole: "editor",
    body: CreateAttachmentUploadInputSchema,
    handler: async ({ env, workspace, body }) => ({ status: 201, data: { attachment: await createService(env).createUpload(workspace!, body) } }),
  });
  registry.register({
    method: "GET", path: "/api/v2/attachments/:attachmentId", auth: "workspace",
    handler: async ({ env, workspace, params }) => ({ data: { attachment: await createService(env).getAttachment(workspace!, params.attachmentId!) } }),
  });
  registry.register({
    method: "POST", path: "/api/v2/attachments/:attachmentId/complete", auth: "workspace", minimumRole: "editor",
    body: UploadCompleteInputSchema,
    handler: async ({ env, workspace, params, body }) => ({ data: { attachment: await createService(env).completeUpload(workspace!, params.attachmentId!, body) } }),
  });
  registry.register({
    method: "PUT", path: "/api/v2/attachments/:attachmentId/content", auth: "workspace", minimumRole: "editor",
    handler: async ({ request, env, workspace, params }) => ({
      data: { attachment: await createService(env).uploadContent(workspace!, params.attachmentId!, new Uint8Array(await request.arrayBuffer())) },
    }),
  });
  registry.register({
    method: "GET", path: "/api/v2/attachments/:attachmentId/file", auth: "workspace",
    handler: async ({ env, workspace, params }) => {
      const file = await createService(env).download(workspace!, params.attachmentId!);
      return new Response(file.body, {
        headers: {
          "cache-control": "private, no-store",
          "content-disposition": contentDisposition(file.filename),
          "content-type": file.mime_type,
        },
      });
    },
  });
  registry.register({
    method: "DELETE", path: "/api/v2/attachments/:attachmentId", auth: "workspace", minimumRole: "editor",
    handler: async ({ env, workspace, params }) => {
      await createService(env).deleteAttachment(workspace!, params.attachmentId!);
      return { data: { deleted: true } };
    },
  });
  registry.register({
    method: "POST", path: "/api/v2/attachments/:attachmentId/ocr/retry", auth: "workspace", minimumRole: "editor",
    body: OcrRetryInputSchema,
    handler: async ({ env, workspace, params, body }) => {
      if (body.attachment_ids.length !== 1 || body.attachment_ids[0] !== params.attachmentId) {
        throw new AttachmentServiceError("OCR_RETRY_PATH_MISMATCH", "Retry body must match the attachment path", 400);
      }
      return { data: await createService(env).retryOcr(workspace!, body) };
    },
  });
  registry.register({
    method: "POST", path: "/api/v2/attachments/ocr/retry", auth: "workspace", minimumRole: "editor",
    body: OcrRetryInputSchema,
    handler: async ({ env, workspace, body }) => ({ data: await createService(env).retryOcr(workspace!, body) }),
  });
  registry.register({
    method: "GET", path: "/api/v2/knowledge/diagnostics", auth: "workspace",
    handler: async ({ request, env, workspace }) => ({ data: await createService(env).diagnostics(workspace!, diagnosticsRequest(request)) }),
  });
}
