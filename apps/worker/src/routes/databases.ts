import {
  CreateDatabaseInputSchema,
  DeleteDatabaseInputSchema,
  UpdateDatabaseInputSchema,
} from "@nexus/contracts";

import { registerDatabaseCommentRoutes } from "./database-comments";
import { registerDatabaseMetadataRoutes } from "./database-metadata";
import { registerDatabaseRecordRoutes } from "./database-records";
import type { DatabaseRegistry, DatabaseRepositoryFactory } from "./database-route-types";

export function registerDatabaseRoutes<TEnv>(
  registry: DatabaseRegistry<TEnv>,
  createRepository: DatabaseRepositoryFactory<TEnv>,
) {
  registry.register({
    method: "GET", path: "/api/v2/databases", auth: "workspace",
    handler: async ({ env, workspace }) => ({
      data: { items: await createRepository(env).listDatabases(workspace!) },
    }),
  });
  registry.register({
    method: "POST", path: "/api/v2/databases", auth: "workspace", minimumRole: "editor", body: CreateDatabaseInputSchema,
    handler: async ({ env, workspace, body }) => ({
      status: 201,
      data: { database: await createRepository(env).createDatabase(workspace!, body) },
    }),
  });
  registry.register({
    method: "GET", path: "/api/v2/databases/:databaseId", auth: "workspace",
    handler: async ({ env, workspace, params }) => ({
      data: await createRepository(env).getDatabase(workspace!, params.databaseId!),
    }),
  });
  registry.register({
    method: "PATCH", path: "/api/v2/databases/:databaseId", auth: "workspace", body: UpdateDatabaseInputSchema,
    handler: async ({ env, workspace, params, body }) => ({
      data: { database: await createRepository(env).updateDatabase(workspace!, params.databaseId!, body) },
    }),
  });
  registry.register({
    method: "DELETE", path: "/api/v2/databases/:databaseId", auth: "workspace", body: DeleteDatabaseInputSchema,
    handler: async ({ env, workspace, params, body }) => ({
      data: await createRepository(env).deleteDatabase(workspace!, params.databaseId!, body),
    }),
  });

  registerDatabaseRecordRoutes(registry, createRepository);
  registerDatabaseMetadataRoutes(registry, createRepository);
  registerDatabaseCommentRoutes(registry, createRepository);
}
