import {
  AiChatInputSchema,
  DeleteAiUserConfigInputSchema,
  TestAiUserConfigInputSchema,
  UpsertAiUserConfigInputSchema,
  type AiChatInput,
  type AiChatResponse,
  type AiStatus,
  type DeleteAiUserConfigInput,
  type TestAiUserConfigInput,
  type UpsertAiUserConfigInput,
} from "@nexus/contracts";
import type { RouteDefinition } from "../http/route-registry";

interface AiRegistry<TEnv> {
  register<TBody, TData>(definition: RouteDefinition<TEnv, TBody, TData>): void;
}

export interface AiChatRouteService {
  chat(input: AiChatInput, signal: AbortSignal, userId?: string): Promise<AiChatResponse>;
  status?(userId?: string): AiStatus | { configured: boolean } | Promise<AiStatus | { configured: boolean }>;
  getConfig?(userId: string): Promise<AiStatus>;
  saveConfig?(userId: string, input: UpsertAiUserConfigInput, requestId: string): Promise<AiStatus>;
  testConfig?(userId: string, input: TestAiUserConfigInput, signal: AbortSignal, requestId: string): Promise<unknown>;
  deleteConfig?(userId: string, input: DeleteAiUserConfigInput, requestId: string): Promise<{ deleted: true }>;
}

class AiConfigurationRouteError extends Error {
  readonly code = "AI_CONFIG_UNAVAILABLE";
  readonly status = 503;
  readonly retryable = false;
}

function required<T>(value: T | undefined): T {
  if (!value) throw new AiConfigurationRouteError("Personal AI configuration is unavailable");
  return value;
}

export function registerAiRoutes<TEnv>(registry: AiRegistry<TEnv>, createService: (env: TEnv) => AiChatRouteService) {
  registry.register({
    method: "GET",
    path: "/api/v2/ai/status",
    auth: "workspace",
    minimumRole: "viewer",
    rateLimit: { bucket: "ip", limit: 30, windowSeconds: 60 },
    handler: async ({ env, principal }) => {
      const status = await createService(env).status?.(principal!.userId) ?? { configured: false };
      return { data: "source" in status ? status : { ...status, source: status.configured ? "server_default" : "unconfigured" } };
    },
  });
  registry.register({
    method: "GET", path: "/api/v2/ai/config", auth: "session",
    rateLimit: { bucket: "ip", limit: 30, windowSeconds: 60 },
    handler: async ({ env, principal }) => ({ data: await required(createService(env).getConfig)(principal!.userId) }),
  });
  registry.register({
    method: "PUT", path: "/api/v2/ai/config", auth: "session",
    rateLimit: { bucket: "ip", limit: 10, windowSeconds: 10 * 60 }, body: UpsertAiUserConfigInputSchema,
    handler: async ({ env, principal, body, requestId }) => ({ data: await required(createService(env).saveConfig)(principal!.userId, body, requestId) }),
  });
  registry.register({
    method: "POST", path: "/api/v2/ai/config/test", auth: "session",
    rateLimit: { bucket: "ip", limit: 10, windowSeconds: 10 * 60 }, timeoutMs: 20_000,
    body: TestAiUserConfigInputSchema,
    handler: async ({ env, principal, body, signal, requestId }) => ({
      data: await required(createService(env).testConfig)(principal!.userId, body, signal, requestId),
    }),
  });
  registry.register({
    method: "DELETE", path: "/api/v2/ai/config", auth: "session",
    rateLimit: { bucket: "ip", limit: 5, windowSeconds: 30 * 60 }, body: DeleteAiUserConfigInputSchema,
    handler: async ({ env, principal, body, requestId }) => ({
      data: await required(createService(env).deleteConfig)(principal!.userId, body, requestId),
    }),
  });
  registry.register({
    method: "POST",
    path: "/api/v2/ai/chat",
    auth: "workspace",
    minimumRole: "viewer",
    rateLimit: { bucket: "ip", limit: 30, windowSeconds: 60 },
    bodyLimitBytes: 256 * 1024,
    timeoutMs: 35_000,
    body: AiChatInputSchema,
    handler: async ({ env, body, signal, principal }) => ({
      data: await createService(env).chat(body, signal, principal?.userId),
    }),
  });
}
