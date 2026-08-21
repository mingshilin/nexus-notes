import {
  ApplyDatabaseTemplateInputSchema,
  CreateDatabasePropertyInputSchema,
  CreateDatabaseTemplateInputSchema,
  CreateDatabaseViewInputSchema,
  DeleteDatabasePermissionInputSchema,
  DeleteDatabaseInputSchema,
  DeleteFieldPermissionInputSchema,
  SetDatabasePermissionInputSchema,
  SetFieldPermissionInputSchema,
  UpdateDatabasePropertyInputSchema,
  UpdateDatabaseTemplateInputSchema,
  UpdateDatabaseViewInputSchema,
} from "@nexus/contracts";

import { mutationContext, type DatabaseRegistry, type DatabaseRepositoryFactory } from "./database-route-types";

export function registerDatabaseMetadataRoutes<TEnv>(
  registry: DatabaseRegistry<TEnv>,
  createRepository: DatabaseRepositoryFactory<TEnv>,
) {
  registry.register({
    method: "POST", path: "/api/v2/databases/:databaseId/properties", auth: "workspace", body: CreateDatabasePropertyInputSchema,
    handler: async ({ env, workspace, params, body, requestId }) => ({
      status: 201,
      data: { property: await createRepository(env).createProperty(mutationContext(workspace!, requestId), params.databaseId!, body) },
    }),
  });
  registry.register({
    method: "PATCH", path: "/api/v2/databases/:databaseId/properties/:propertyId", auth: "workspace", body: UpdateDatabasePropertyInputSchema,
    handler: async ({ env, workspace, params, body, requestId }) => ({
      data: { property: await createRepository(env).updateProperty(mutationContext(workspace!, requestId), params.databaseId!, params.propertyId!, body) },
    }),
  });
  registry.register({
    method: "DELETE", path: "/api/v2/databases/:databaseId/properties/:propertyId", auth: "workspace", body: DeleteDatabaseInputSchema,
    handler: async ({ env, workspace, params, body, requestId }) => ({
      data: await createRepository(env).deleteProperty(mutationContext(workspace!, requestId), params.databaseId!, params.propertyId!, body),
    }),
  });
  registry.register({
    method: "POST", path: "/api/v2/databases/:databaseId/views", auth: "workspace", body: CreateDatabaseViewInputSchema,
    handler: async ({ env, workspace, params, body, requestId }) => ({
      status: 201,
      data: { view: await createRepository(env).createView(mutationContext(workspace!, requestId), params.databaseId!, body) },
    }),
  });
  registry.register({
    method: "PATCH", path: "/api/v2/databases/:databaseId/views/:viewId", auth: "workspace", body: UpdateDatabaseViewInputSchema,
    handler: async ({ env, workspace, params, body, requestId }) => ({
      data: { view: await createRepository(env).updateView(mutationContext(workspace!, requestId), params.databaseId!, params.viewId!, body) },
    }),
  });
  registry.register({
    method: "DELETE", path: "/api/v2/databases/:databaseId/views/:viewId", auth: "workspace", body: DeleteDatabaseInputSchema,
    handler: async ({ env, workspace, params, body, requestId }) => ({
      data: await createRepository(env).deleteView(mutationContext(workspace!, requestId), params.databaseId!, params.viewId!, body),
    }),
  });
  registry.register({
    method: "POST", path: "/api/v2/databases/:databaseId/templates", auth: "workspace", body: CreateDatabaseTemplateInputSchema,
    handler: async ({ env, workspace, params, body, requestId }) => ({
      status: 201,
      data: { template: await createRepository(env).createTemplate(mutationContext(workspace!, requestId), params.databaseId!, body) },
    }),
  });
  registry.register({
    method: "PATCH", path: "/api/v2/databases/:databaseId/templates/:templateId", auth: "workspace", body: UpdateDatabaseTemplateInputSchema,
    handler: async ({ env, workspace, params, body, requestId }) => ({
      data: { template: await createRepository(env).updateTemplate(mutationContext(workspace!, requestId), params.databaseId!, params.templateId!, body) },
    }),
  });
  registry.register({
    method: "DELETE", path: "/api/v2/databases/:databaseId/templates/:templateId", auth: "workspace", body: DeleteDatabaseInputSchema,
    handler: async ({ env, workspace, params, body, requestId }) => ({
      data: await createRepository(env).deleteTemplate(mutationContext(workspace!, requestId), params.databaseId!, params.templateId!, body),
    }),
  });
  registry.register({
    method: "POST", path: "/api/v2/databases/:databaseId/templates/apply", auth: "workspace", body: ApplyDatabaseTemplateInputSchema,
    handler: async ({ env, workspace, params, body, requestId }) => ({
      data: await createRepository(env).applyTemplate(mutationContext(workspace!, requestId), params.databaseId!, body),
    }),
  });
  registry.register({
    method: "PUT", path: "/api/v2/databases/:databaseId/permissions", auth: "workspace", body: SetDatabasePermissionInputSchema,
    handler: async ({ env, workspace, params, body, requestId }) => ({
      data: { permission: await createRepository(env).setDatabasePermission(mutationContext(workspace!, requestId), params.databaseId!, body) },
    }),
  });
  registry.register({
    method: "GET", path: "/api/v2/databases/:databaseId/permissions", auth: "workspace",
    handler: async ({ env, workspace, params }) => ({
      data: { items: await createRepository(env).listDatabasePermissions(workspace!, params.databaseId!) },
    }),
  });
  registry.register({
    method: "DELETE", path: "/api/v2/databases/:databaseId/permissions/:permissionId", auth: "workspace", body: DeleteDatabasePermissionInputSchema,
    handler: async ({ env, workspace, params, body, requestId }) => ({
      data: await createRepository(env).deleteDatabasePermission(mutationContext(workspace!, requestId), params.databaseId!, params.permissionId!, body),
    }),
  });
  registry.register({
    method: "PUT", path: "/api/v2/databases/:databaseId/properties/:propertyId/permissions", auth: "workspace", body: SetFieldPermissionInputSchema,
    handler: async ({ env, workspace, params, body, requestId }) => ({
      data: { permission: await createRepository(env).setFieldPermission(mutationContext(workspace!, requestId), params.databaseId!, params.propertyId!, body) },
    }),
  });
  registry.register({
    method: "GET", path: "/api/v2/databases/:databaseId/properties/:propertyId/permissions", auth: "workspace",
    handler: async ({ env, workspace, params }) => ({
      data: { items: await createRepository(env).listFieldPermissions(workspace!, params.databaseId!, params.propertyId!) },
    }),
  });
  registry.register({
    method: "DELETE", path: "/api/v2/databases/:databaseId/properties/:propertyId/permissions/:permissionId", auth: "workspace", body: DeleteFieldPermissionInputSchema,
    handler: async ({ env, workspace, params, body, requestId }) => ({
      data: await createRepository(env).deleteFieldPermission(mutationContext(workspace!, requestId), params.databaseId!, params.propertyId!, params.permissionId!, body),
    }),
  });
}
