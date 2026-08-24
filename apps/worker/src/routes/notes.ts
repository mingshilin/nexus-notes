import {
  CreateNoteInputSchema,
  ClipperInputSchema,
  DailyNoteInputSchema,
  DeleteNoteInputSchema,
  QuickCaptureInputSchema,
  NoteStatusSchema,
  RestoreNoteInputSchema,
  UpdateNoteInputSchema,
} from "@nexus/contracts";

import type { RouteDefinition } from "../http/route-registry";
import { NoteServiceError, type NoteService } from "../notes/note-service";

interface NoteRegistry<TEnv> {
  register<TBody, TData>(definition: RouteDefinition<TEnv, TBody, TData>): void;
}

type NoteRouteService = Pick<
  NoteService,
  "list" | "create" | "openOrCreateDaily" | "get" | "update" | "listRevisions" | "restore" | "deletePermanently" | "quickCapture" | "clipperCapture"
>;

function listOptions(request: Request) {
  const params = new URL(request.url).searchParams;
  const requestedLimit = Number(params.get("limit") ?? 50);
  const limit = Number.isInteger(requestedLimit) && requestedLimit > 0
    ? Math.min(requestedLimit, 100)
    : 50;
  const query = params.get("q")?.trim() ?? "";
  if (query.length > 500) throw new NoteServiceError("INVALID_QUERY", "Note search query is too long", 400);
  const rawStatus = params.get("status");
  const status = rawStatus ? NoteStatusSchema.parse(rawStatus) : undefined;
  const folderValue = params.get("folder_id");
  const folderId = folderValue === null ? undefined : folderValue === "none" ? null : folderValue;
  const dailyDate = params.get("daily_date") ?? undefined;
  const favoriteRaw = params.get("favorite");
  const pinnedRaw = params.get("pinned");
  const parseBoolean = (value: string | null) => {
    if (value === null) return undefined;
    if (value === "true") return true;
    if (value === "false") return false;
    throw new NoteServiceError("INVALID_FILTER", "Boolean note filters must be true or false", 400);
  };
  const favorite = parseBoolean(favoriteRaw);
  const pinned = parseBoolean(pinnedRaw);
  if (dailyDate !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(dailyDate)) {
    throw new NoteServiceError("INVALID_DATE", "daily_date must be YYYY-MM-DD", 400);
  }
  return {
    cursor: params.get("cursor") ?? undefined,
    limit,
    ...(query ? { query } : {}),
    status,
    folderId,
    dailyDate,
    ...(favorite !== undefined ? { favorite } : {}),
    ...(pinned !== undefined ? { pinned } : {}),
  };
}

function revisionParam(value: string) {
  const revision = Number(value);
  if (!Number.isInteger(revision) || revision < 1) {
    throw new NoteServiceError("INVALID_REVISION", "Revision must be a positive integer", 400);
  }
  return revision;
}

function mutationContext<T extends object>(workspace: T, requestId: string) {
  return { ...workspace, requestId };
}

export function registerNoteRoutes<TEnv>(
  registry: NoteRegistry<TEnv>,
  createService: (env: TEnv) => NoteRouteService,
) {
  registry.register({
    method: "GET",
    path: "/api/v2/notes",
    auth: "workspace",
    handler: async ({ request, env, workspace }) => ({
      data: await createService(env).list(workspace!, listOptions(request)),
    }),
  });

  registry.register({
    method: "POST",
    path: "/api/v2/notes/daily",
    auth: "workspace",
    minimumRole: "editor",
    quota: "notes",
    body: DailyNoteInputSchema,
    handler: async ({ env, workspace, body, requestId }) => ({
      data: { note: await createService(env).openOrCreateDaily(mutationContext(workspace!, requestId), body) },
    }),
  });

  registry.register({
    method: "POST",
    path: "/api/v2/notes",
    auth: "workspace",
    minimumRole: "editor",
    quota: "notes",
    body: CreateNoteInputSchema,
    handler: async ({ env, workspace, body, requestId }) => ({
      status: 201,
      data: { note: await createService(env).create(mutationContext(workspace!, requestId), body) },
    }),
  });

  registry.register({
    method: "GET",
    path: "/api/v2/notes/:noteId",
    auth: "workspace",
    handler: async ({ env, workspace, params }) => ({
      data: { note: await createService(env).get(workspace!, params.noteId!) },
    }),
  });

  registry.register({
    method: "PATCH",
    path: "/api/v2/notes/:noteId",
    auth: "workspace",
    minimumRole: "editor",
    body: UpdateNoteInputSchema,
    handler: async ({ env, workspace, params, body, requestId }) => ({
      data: { note: await createService(env).update(mutationContext(workspace!, requestId), params.noteId!, body) },
    }),
  });

  registry.register({
    method: "DELETE",
    path: "/api/v2/notes/:noteId",
    auth: "workspace",
    minimumRole: "editor",
    body: DeleteNoteInputSchema,
    handler: async ({ env, workspace, params, body, requestId }) => ({
      data: await createService(env).deletePermanently(mutationContext(workspace!, requestId), params.noteId!, body),
    }),
  });

  registry.register({
    method: "GET",
    path: "/api/v2/notes/:noteId/revisions",
    auth: "workspace",
    handler: async ({ env, workspace, params }) => ({
      data: { items: await createService(env).listRevisions(workspace!, params.noteId!) },
    }),
  });

  registry.register({
    method: "POST",
    path: "/api/v2/notes/:noteId/revisions/:revision/restore",
    auth: "workspace",
    minimumRole: "editor",
    body: RestoreNoteInputSchema,
    handler: async ({ env, workspace, params, body, requestId }) => ({
      data: {
        note: await createService(env).restore(
          mutationContext(workspace!, requestId),
          params.noteId!,
          revisionParam(params.revision!),
          body,
        ),
      },
    }),
  });

  registry.register({
    method: "POST",
    path: "/api/v2/capture",
    auth: "workspace",
    minimumRole: "editor",
    quota: "notes",
    body: QuickCaptureInputSchema,
    handler: async ({ env, workspace, body, requestId }) => ({
      status: 201,
      data: { note: await createService(env).quickCapture(mutationContext(workspace!, requestId), body) },
    }),
  });

  registry.register({
    method: "POST",
    path: "/api/v2/clipper/capture",
    auth: "workspace",
    minimumRole: "editor",
    quota: "notes",
    body: ClipperInputSchema,
    handler: async ({ env, workspace, body, requestId }) => ({
      status: 201,
      data: { note: await createService(env).clipperCapture(mutationContext(workspace!, requestId), body) },
    }),
  });
}
