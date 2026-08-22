import { CreateReminderInputSchema, UpdateReminderInputSchema } from "@nexus/contracts";

import type { RouteDefinition } from "../http/route-registry";
import type { KnowledgeService } from "../knowledge/knowledge-service";

interface Registry<TEnv> {
  register<TBody, TData>(definition: RouteDefinition<TEnv, TBody, TData>): void;
}

type Service = Pick<KnowledgeService, "listReminders" | "createReminder" | "updateReminder">;

export function registerReminderRoutes<TEnv>(registry: Registry<TEnv>, createService: (env: TEnv) => Service) {
  registry.register({
    method: "GET", path: "/api/v2/reminders", auth: "workspace",
    handler: async ({ request, env, workspace }) => ({
      data: {
        items: await createService(env).listReminders(
          workspace!,
          new URL(request.url).searchParams.get("include_completed") === "true",
        ),
      },
    }),
  });
  registry.register({
    method: "POST", path: "/api/v2/reminders", auth: "workspace", body: CreateReminderInputSchema,
    handler: async ({ env, workspace, body }) => ({
      status: 201, data: { reminder: await createService(env).createReminder(workspace!, body) },
    }),
  });
  registry.register({
    method: "PATCH", path: "/api/v2/reminders/:reminderId", auth: "workspace", body: UpdateReminderInputSchema,
    handler: async ({ env, workspace, params, body }) => ({
      data: { reminder: await createService(env).updateReminder(workspace!, params.reminderId!, body) },
    }),
  });
}
