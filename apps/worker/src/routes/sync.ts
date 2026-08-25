import { SyncPullQuerySchema, SyncPushRequestSchema } from "@nexus/contracts";

import type { RouteDefinition } from "../http/route-registry";
import type { SyncService } from "../sync/sync-service";

interface Registry<TEnv> {
  register<TBody, TData>(definition: RouteDefinition<TEnv, TBody, TData>): void;
}

type Service = Pick<SyncService, "push" | "pull">;

class SyncQueryValidationError extends Error {
  readonly code = "VALIDATION_ERROR";
  readonly status = 400;
  readonly retryable = false;

  constructor() {
    super("Sync cursor is invalid");
    this.name = "SyncQueryValidationError";
  }
}

export function registerSyncRoutes<TEnv>(registry: Registry<TEnv>, createService: (env: TEnv) => Service) {
  registry.register({
    method: "POST",
    path: "/api/v2/sync/push",
    auth: "workspace",
    minimumRole: "editor",
    body: SyncPushRequestSchema,
    handler: async ({ env, workspace, body }) => ({
      data: await createService(env).push(workspace!, body),
    }),
  });

  registry.register({
    method: "GET",
    path: "/api/v2/sync/pull",
    auth: "workspace",
    handler: async ({ request, env, workspace }) => {
      const cursor = new URL(request.url).searchParams.get("cursor") ?? undefined;
      const parsed = SyncPullQuerySchema.safeParse(cursor === undefined ? {} : { cursor });
      if (!parsed.success) throw new SyncQueryValidationError();
      return { data: await createService(env).pull(workspace!, parsed.data.cursor ?? null) };
    },
  });
}
