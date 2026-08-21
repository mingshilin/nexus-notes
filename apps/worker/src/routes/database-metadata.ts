import {
  ApplyDatabaseTemplateInputSchema,
  CreateDatabasePropertyInputSchema,
  CreateDatabaseTemplateInputSchema,
  CreateDatabaseViewInputSchema,
  DeleteDatabaseInputSchema,
  SetDatabasePermissionInputSchema,
  SetFieldPermissionInputSchema,
  UpdateDatabasePropertyInputSchema,
  UpdateDatabaseTemplateInputSchema,
  UpdateDatabaseViewInputSchema,
} from "@nexus/contracts";

import type { DatabaseRegistry, DatabaseRepositoryFactory } from "./database-route-types";

export function registerDatabaseMetadataRoutes<TEnv>(
  registry: DatabaseRegistry<TEnv>,
  createRepository: DatabaseRepositoryFactory<TEnv>,
) {
  registry.register({
    method: "POST", path: "/api/v2/databases/:databaseId/properties", auth: "workspace", body: CreateDatabasePropertyInputSchema,
    handler: async ({ env, workspace, params, body }) => ({
      status: 201,
      data: { property: await createRepository(env).createProperty(workspace!, params.databaseId!, body) },
    }),
  });
  registry.register({
    method: "PATCH", path: "/api/v2/databases/:databaseId/properties/:propertyId", auth: "workspace", body: UpdateDatabasePropertyInputSchema,
    handler: async ({ env, workspace, params, body }) => ({
      data: { property: await createRepository(env).updateProperty(workspace!, params.databaseId!, params.propertyId!, body) },
    }),
  });
  registry.register({
    method: "DELETE", path: "/api/v2/databases/:databaseId/properties/:propertyId", auth: "workspace", body: DeleteDatabaseInputSchema,
    handler: async ({ env, workspace, params, body }) => ({
      data: await createRepository(env).deleteProperty(workspace!, params.databaseId!, params.propertyId!, body),
    }),
  });
  registry.register({
    method: "POST", path: "/api/v2/databases/:databaseId/views", auth: "workspace", body: CreateDatabaseViewInputSchema,
    handler: async ({ env, workspace, params, body }) => ({
      status: 201,
      data: { view: await createRepository(env).createView(workspace!, params.databaseId!, body) },
    }),
  });
  registry.register({
    method: "PATCH", path: "/api/v2/databases/:databaseId/views/:viewId", auth: "workspace", body: UpdateDatabaseViewInputSchema,
    handler: async ({ env, workspace, params, body }) => ({
      data: { view: await createRepository(env).updateView(workspace!, params.databaseId!, params.viewId!, body) },
    }),
  });
  registry.register({
    method: "DELETE", path: "/api/v2/databases/:databaseId/views/:viewId", auth: "workspace", body: DeleteDatabaseInputSchema,
    handler: async ({ env, workspace, params, body }) => ({
      data: await createRepository(env).deleteView(workspace!, params.databaseId!, params.viewId!, body),
    }),
  });
  registry.register({
    method: "POST", path: "/api/v2/databases/:databaseId/templates", auth: "workspace", body: CreateDatabaseTemplateInputSchema,
    handler: async ({ env, workspace, params, body }) => ({
      status: 201,
      data: { template: await createRepository(env).createTemplate(workspace!, params.databaseId!, body) },
    }),
  });
  registry.register({
    method: "PATCH", path: "/api/v2/databases/:databaseId/templates/:templateId", auth: "workspace", body: UpdateDatabaseTemplateInputSchema,
    handler: async ({ env, workspace, params, body }) => ({
      data: { template: await createRepository(env).updateTemplate(workspace!, params.databaseId!, params.templateId!, body) },
    }),
  });
  registry.register({
    method: "DELETE", path: "/api/v2/databases/:databaseId/templates/:templateId", auth: "workspace", body: DeleteDatabaseInputSchema,
    handler: async ({ env, workspace, params, body }) => ({
      data: await createRepository(env).deleteTemplate(workspace!, params.databaseId!, params.templateId!, body),
    }),
  });
  registry.register({
    method: "POST", path: "/api/v2/databases/:databaseId/templates/apply", auth: "workspace", body: ApplyDatabaseTemplateInputSchema,
    handler: async ({ env, workspace, params, body }) => ({
      data: await createRepository(env).applyTemplate(workspace!, params.databaseId!, body),
    }),
  });
  registry.register({
    method: "PUT", path: "/api/v2/databases/:databaseId/permissions", auth: "workspace", body: SetDatabasePermissionInputSchema,
    handler: async ({ env, workspace, params, body }) => ({
      data: { permission: await createRepository(env).setDatabasePermission(workspace!, params.databaseId!, body) },
    }),
  });
  registry.register({
    method: "PUT", path: "/api/v2/databases/:databaseId/properties/:propertyId/permissions", auth: "workspace", body: SetFieldPermissionInputSchema,
    handler: async ({ env, workspace, params, body }) => ({
      data: { permission: await createRepository(env).setFieldPermission(workspace!, params.databaseId!, params.propertyId!, body) },
    }),
  });
}
