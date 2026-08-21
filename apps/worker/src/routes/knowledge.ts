import { SavedSearchInputSchema, SearchRequestSchema } from "@nexus/contracts";

import type { RouteDefinition } from "../http/route-registry";
import type { KnowledgeService } from "../knowledge/knowledge-service";

interface KnowledgeRegistry<TEnv> {
  register<TBody, TData>(definition: RouteDefinition<TEnv, TBody, TData>): void;
}

type KnowledgeRouteService = Pick<
  KnowledgeService,
  "search" | "listSavedSearches" | "createSavedSearch" | "deleteSavedSearch"
>;

export function registerKnowledgeRoutes<TEnv>(
  registry: KnowledgeRegistry<TEnv>,
  createService: (env: TEnv) => KnowledgeRouteService,
) {
  registry.register({
    method: "POST",
    path: "/api/v2/search",
    auth: "workspace",
    body: SearchRequestSchema,
    handler: async ({ env, workspace, body }) => ({
      data: await createService(env).search(workspace!, body),
    }),
  });

  registry.register({
    method: "GET",
    path: "/api/v2/search/saved",
    auth: "workspace",
    handler: async ({ env, workspace }) => ({
      data: { items: await createService(env).listSavedSearches(workspace!) },
    }),
  });

  registry.register({
    method: "POST",
    path: "/api/v2/search/saved",
    auth: "workspace",
    body: SavedSearchInputSchema,
    handler: async ({ env, workspace, body }) => ({
      status: 201,
      data: { saved_search: await createService(env).createSavedSearch(workspace!, body) },
    }),
  });

  registry.register({
    method: "DELETE",
    path: "/api/v2/search/saved/:savedSearchId",
    auth: "workspace",
    handler: async ({ env, workspace, params }) => {
      await createService(env).deleteSavedSearch(workspace!, params.savedSearchId!);
      return { data: { deleted: true } };
    },
  });
}
