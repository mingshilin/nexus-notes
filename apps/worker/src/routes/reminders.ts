import {
  CreateReminderInputSchema,
  DeleteReminderInputSchema,
  ReminderListQuerySchema,
  SnoozeReminderInputSchema,
  UpdateReminderInputSchema,
} from "@nexus/contracts";

import type { RouteDefinition } from "../http/route-registry";
import type { KnowledgeService } from "../knowledge/knowledge-service";

interface Registry<TEnv> {
  register<TBody, TData>(definition: RouteDefinition<TEnv, TBody, TData>): void;
}

type Service = Pick<
  KnowledgeService,
  "listReminders" | "listReminderPage" | "createReminder" | "updateReminder" | "snoozeReminder" | "deleteReminder"
  | "listReminderDeliveries" | "retryReminderDelivery"
>;

export function registerReminderRoutes<TEnv>(registry: Registry<TEnv>, createService: (env: TEnv) => Service) {
  registry.register({
    method: "GET", path: "/api/v2/reminders", auth: "workspace",
    handler: async ({ request, env, workspace }) => {
      const params = new URL(request.url).searchParams;
      if (params.has("include_completed") && !["status", "query", "cursor", "limit"].some((key) => params.has(key))) {
        return { data: { items: await createService(env).listReminders(workspace!, params.get("include_completed") === "true") } };
      }
      const parsed = ReminderListQuerySchema.parse({
        status: params.get("status") ?? undefined,
        query: params.get("query") ?? undefined,
        cursor: params.get("cursor") ?? undefined,
        limit: params.get("limit") ?? undefined,
      });
      return { data: await createService(env).listReminderPage(workspace!, parsed) };
    },
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
  registry.register({
    method: "POST", path: "/api/v2/reminders/:reminderId/snooze", auth: "workspace", body: SnoozeReminderInputSchema,
    handler: async ({ env, workspace, params, body }) => ({
      data: { reminder: await createService(env).snoozeReminder(workspace!, params.reminderId!, body) },
    }),
  });
  registry.register({
    method: "DELETE", path: "/api/v2/reminders/:reminderId", auth: "workspace", body: DeleteReminderInputSchema,
    handler: async ({ env, workspace, params, body }) => {
      await createService(env).deleteReminder(workspace!, params.reminderId!, body);
      return { data: { deleted: true } };
    },
  });
  registry.register({
    method: "GET", path: "/api/v2/reminders/:reminderId/deliveries", auth: "workspace",
    handler: async ({ env, workspace, params }) => ({
      data: { items: await createService(env).listReminderDeliveries(workspace!, params.reminderId!) },
    }),
  });
  registry.register({
    method: "POST", path: "/api/v2/reminders/:reminderId/deliveries/:deliveryId/retry", auth: "workspace",
    handler: async ({ env, workspace, params }) => ({
      data: { delivery: await createService(env).retryReminderDelivery(workspace!, params.reminderId!, params.deliveryId!) },
    }),
  });
}
