import type { RouteDefinition } from "../http/route-registry";
import type { QueueJob } from "@nexus/contracts";
import type { OcrAiBinding } from "../attachments/ocr-extractor";

export interface BetaWorkerEnv {
  DB: D1Database;
  FILES?: R2Bucket;
  AI?: OcrAiBinding;
  JOBS?: Queue<QueueJob>;
  APP_BASE_URL: string;
  CORS_ALLOWED_ORIGINS?: string;
  RATE_LIMIT_SECRET: string;
  TURNSTILE_SECRET_KEY: string;
  RESEND_API_KEY: string;
  EMAIL_FROM: string;
  DEPLOYMENT_VERSION?: string;
}

function ocrCapability(env: BetaWorkerEnv) {
  if (!env.FILES) return "unconfigured" as const;
  return env.AI ? "ready" as const : "degraded" as const;
}

export const healthRoute: RouteDefinition<BetaWorkerEnv, unknown, { status: "ok"; version: string; ocr: "unconfigured" | "degraded" | "ready" }> = {
  method: "GET",
  path: "/api/v2/health",
  auth: "public",
  handler: ({ env }) => ({
    data: {
      status: "ok",
      version: env.DEPLOYMENT_VERSION ?? "development",
      ocr: ocrCapability(env),
    },
  }),
};
