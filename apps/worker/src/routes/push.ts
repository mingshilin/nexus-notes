import { PushSubscriptionInputSchema } from "@nexus/contracts";
import type { PushSubscriptionInput, PushSubscriptionSummary } from "@nexus/contracts";
import type { RouteDefinition } from "../http/route-registry";

interface Registry<TEnv> {
  register<TBody, TData>(definition: RouteDefinition<TEnv, TBody, TData>): void;
}

export interface PushRouteService {
  list(userId: string): Promise<PushSubscriptionSummary[]>;
  subscribe(userId: string, input: PushSubscriptionInput, requestId: string): Promise<PushSubscriptionSummary>;
  disable(userId: string, subscriptionId: string, requestId: string): Promise<boolean>;
  sendTest(userId: string, requestId: string): Promise<{ queued: number }>;
  publicKey(): string;
}

export function registerPushRoutes<TEnv>(registry: Registry<TEnv>, createService: (env: TEnv) => PushRouteService) {
  const rateLimit = { bucket: "ip", limit: 30, windowSeconds: 60 } as const;
  registry.register({
    method: "GET", path: "/api/v2/push/public-key", auth: "session", rateLimit,
    handler: async ({ env }) => ({ data: { public_key: createService(env).publicKey() } }),
  });
  registry.register({
    method: "GET", path: "/api/v2/push/subscriptions", auth: "session", rateLimit,
    handler: async ({ env, principal }) => ({ data: { items: await createService(env).list(principal!.userId) } }),
  });
  registry.register({
    method: "POST", path: "/api/v2/push/subscriptions", auth: "session", rateLimit,
    body: PushSubscriptionInputSchema,
    handler: async ({ env, principal, body, requestId }) => ({
      status: 201,
      data: { subscription: await createService(env).subscribe(principal!.userId, body, requestId) },
    }),
  });
  registry.register({
    method: "DELETE", path: "/api/v2/push/subscriptions/:subscriptionId", auth: "session", rateLimit,
    handler: async ({ env, principal, params, requestId }) => {
      const disabled = await createService(env).disable(principal!.userId, params.subscriptionId!, requestId);
      if (!disabled) throw Object.assign(new Error("Push subscription not found"), {
        code: "PUSH_SUBSCRIPTION_NOT_FOUND", status: 404, retryable: false,
      });
      return { data: { deleted: true } };
    },
  });
  registry.register({
    method: "POST", path: "/api/v2/push/test", auth: "session",
    rateLimit: { bucket: "ip", limit: 5, windowSeconds: 60 },
    handler: async ({ env, principal, requestId }) => ({
      status: 202,
      data: await createService(env).sendTest(principal!.userId, requestId),
    }),
  });
}
