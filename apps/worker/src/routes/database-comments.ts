import {
  CreateDatabaseCommentInputSchema,
  DeleteDatabaseInputSchema,
  UpdateDatabaseCommentInputSchema,
} from "@nexus/contracts";

import { mutationContext, type DatabaseRegistry, type DatabaseRepositoryFactory } from "./database-route-types";

export function registerDatabaseCommentRoutes<TEnv>(
  registry: DatabaseRegistry<TEnv>,
  createRepository: DatabaseRepositoryFactory<TEnv>,
) {
  registry.register({
    method: "GET", path: "/api/v2/databases/:databaseId/records/:recordId/comments", auth: "workspace",
    handler: async ({ env, workspace, params }) => ({
      data: { items: await createRepository(env).listComments(workspace!, params.databaseId!, params.recordId!) },
    }),
  });
  registry.register({
    method: "POST", path: "/api/v2/databases/:databaseId/records/:recordId/comments", auth: "workspace", body: CreateDatabaseCommentInputSchema,
    handler: async ({ env, workspace, params, body, requestId }) => ({
      status: 201,
      data: {
        comment: await createRepository(env).createComment(mutationContext(workspace!, requestId), params.databaseId!, {
          ...body,
          record_id: params.recordId!,
        }),
      },
    }),
  });
  registry.register({
    method: "PATCH", path: "/api/v2/databases/:databaseId/comments/:commentId", auth: "workspace", body: UpdateDatabaseCommentInputSchema,
    handler: async ({ env, workspace, params, body, requestId }) => ({
      data: { comment: await createRepository(env).updateComment(mutationContext(workspace!, requestId), params.databaseId!, params.commentId!, body) },
    }),
  });
  registry.register({
    method: "DELETE", path: "/api/v2/databases/:databaseId/comments/:commentId", auth: "workspace", body: DeleteDatabaseInputSchema,
    handler: async ({ env, workspace, params, body, requestId }) => ({
      data: await createRepository(env).deleteComment(mutationContext(workspace!, requestId), params.databaseId!, params.commentId!, body),
    }),
  });
}
