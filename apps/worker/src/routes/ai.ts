import { AiChatInputSchema, type AiChatInput, type AiChatResponse } from "@nexus/contracts";
import type { RouteDefinition } from "../http/route-registry";

interface AiRegistry<TEnv> {
  register<TBody, TData>(definition: RouteDefinition<TEnv, TBody, TData>): void;
}

export interface AiChatRouteService {
  chat(input: AiChatInput, signal: AbortSignal): Promise<AiChatResponse>;
}

export function registerAiRoutes<TEnv>(registry: AiRegistry<TEnv>, createService: (env: TEnv) => AiChatRouteService) {
  registry.register({
    method: "POST",
    path: "/api/v2/ai/chat",
    auth: "workspace",
    minimumRole: "viewer",
    rateLimit: { bucket: "ip", limit: 30, windowSeconds: 60 },
    bodyLimitBytes: 256 * 1024,
    timeoutMs: 35_000,
    body: AiChatInputSchema,
    handler: async ({ env, body, signal }) => ({
      data: await createService(env).chat(body, signal),
    }),
  });
}
