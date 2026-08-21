import type { RouteDefinition } from "../http/route-registry";

export interface BetaWorkerEnv {
  DB: D1Database;
  APP_BASE_URL: string;
  CORS_ALLOWED_ORIGINS?: string;
  RATE_LIMIT_SECRET: string;
  TURNSTILE_SECRET_KEY: string;
  RESEND_API_KEY: string;
  EMAIL_FROM: string;
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
