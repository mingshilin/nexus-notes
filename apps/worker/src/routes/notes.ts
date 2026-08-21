import {
  CreateNoteInputSchema,
  QuickCaptureInputSchema,
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
  "list" | "create" | "get" | "update" | "listRevisions" | "restore" | "quickCapture"
>;

function listOptions(request: Request) {
  const params = new URL(request.url).searchParams;
  const requestedLimit = Number(params.get("limit") ?? 50);
  const limit = Number.isInteger(requestedLimit) && requestedLimit > 0
    ? Math.min(requestedLimit, 100)
    : 50;
  return { cursor: params.get("cursor") ?? undefined, limit };
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
}
