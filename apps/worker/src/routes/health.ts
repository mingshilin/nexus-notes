import type { RouteDefinition } from "../http/route-registry";

export interface BetaWorkerEnv {
  DEPLOYMENT_VERSION?: string;
}

export const healthRoute: RouteDefinition<BetaWorkerEnv, unknown, { status: "ok"; version: string }> = {
  method: "GET",
  path: "/api/v2/health",
  auth: "public",
  handler: ({ env }) => ({
    data: {
      status: "ok",
      version: env.DEPLOYMENT_VERSION ?? "development",
    },
  }),
};
