import {
  CreateFolderInputSchema,
  CreateTagInputSchema,
  SetNoteLinksInputSchema,
  SetNoteTagsInputSchema,
} from "@nexus/contracts";

import type { RouteDefinition } from "../http/route-registry";
import type { KnowledgeService } from "../knowledge/knowledge-service";

interface Registry<TEnv> {
  register<TBody, TData>(definition: RouteDefinition<TEnv, TBody, TData>): void;
}

type Service = Pick<
  KnowledgeService,
  "listFolders" | "createFolder" | "listTags" | "createTag" | "setNoteTags" | "setNoteLinks" | "listNoteLinks" | "listBacklinks"
>;

export function registerTaxonomyRoutes<TEnv>(registry: Registry<TEnv>, createService: (env: TEnv) => Service) {
  registry.register({
    method: "GET", path: "/api/v2/folders", auth: "workspace",
    handler: async ({ env, workspace }) => ({ data: { items: await createService(env).listFolders(workspace!) } }),
  });
  registry.register({
    method: "POST", path: "/api/v2/folders", auth: "workspace", minimumRole: "editor",
    body: CreateFolderInputSchema,
    handler: async ({ env, workspace, body }) => ({
      status: 201, data: { folder: await createService(env).createFolder(workspace!, body) },
    }),
  });
  registry.register({
    method: "GET", path: "/api/v2/tags", auth: "workspace",
    handler: async ({ env, workspace }) => ({ data: { items: await createService(env).listTags(workspace!) } }),
  });
  registry.register({
    method: "POST", path: "/api/v2/tags", auth: "workspace", minimumRole: "editor",
    body: CreateTagInputSchema,
    handler: async ({ env, workspace, body }) => ({
      status: 201, data: { tag: await createService(env).createTag(workspace!, body) },
    }),
  });
  registry.register({
    method: "PUT", path: "/api/v2/notes/:noteId/tags", auth: "workspace", minimumRole: "editor",
    body: SetNoteTagsInputSchema,
    handler: async ({ env, workspace, params, body }) => {
      await createService(env).setNoteTags(workspace!, params.noteId!, body);
      return { data: { updated: true } };
    },
  });
  registry.register({
    method: "PUT", path: "/api/v2/notes/:noteId/links", auth: "workspace", minimumRole: "editor",
    body: SetNoteLinksInputSchema,
    handler: async ({ env, workspace, params, body }) => {
      await createService(env).setNoteLinks(workspace!, params.noteId!, body);
      return { data: { updated: true } };
    },
  });
  registry.register({
    method: "GET", path: "/api/v2/notes/:noteId/links", auth: "workspace",
    handler: async ({ env, workspace, params }) => ({
      data: { items: await createService(env).listNoteLinks(workspace!, params.noteId!) },
    }),
  });
  registry.register({
    method: "GET", path: "/api/v2/notes/:noteId/backlinks", auth: "workspace",
    handler: async ({ env, workspace, params }) => ({
      data: { items: await createService(env).listBacklinks(workspace!, params.noteId!) },
    }),
  });
}
