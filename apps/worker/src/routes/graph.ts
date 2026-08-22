import type { RouteDefinition } from "../http/route-registry";
import type { KnowledgeService } from "../knowledge/knowledge-service";

interface Registry<TEnv> {
  register<TBody, TData>(definition: RouteDefinition<TEnv, TBody, TData>): void;
}

type Service = Pick<KnowledgeService, "getGraph">;

export function registerGraphRoutes<TEnv>(registry: Registry<TEnv>, createService: (env: TEnv) => Service) {
  registry.register({
    method: "GET", path: "/api/v2/graph", auth: "workspace",
    handler: async ({ env, workspace }) => ({ data: await createService(env).getGraph(workspace!) }),
  });
  registry.register({
    method: "GET", path: "/api/v2/graph/local/:noteId", auth: "workspace",
    handler: async ({ env, workspace, params }) => ({
      data: await createService(env).getGraph(workspace!, params.noteId!),
    }),
  });
}
