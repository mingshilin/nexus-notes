import type { RouteDefinition } from "../http/route-registry";
import type { QueueJob } from "@nexus/contracts";
import type { OcrAiBinding } from "../attachments/ocr-extractor";
import type { ObservabilityAnalytics } from "../observability";

export interface BetaWorkerEnv {
  DB: D1Database;
  ASSETS?: Fetcher;
  FILES?: R2Bucket;
  AI?: OcrAiBinding;
  AI_CHAT_API_URL?: string;
  AI_CHAT_API_KEY?: string;
  AI_CHAT_MODEL?: string;
  AI_ENABLED?: string;
  USER_SECRETS_ENCRYPTION_KEY?: string;
  WEB_PUSH_VAPID_PUBLIC_KEY?: string;
  WEB_PUSH_VAPID_PRIVATE_KEY?: string;
  WEB_PUSH_SUBJECT?: string;
  JOBS?: Queue<QueueJob>;
  PRESENCE?: DurableObjectNamespace;
  APP_BASE_URL: string;
  CORS_ALLOWED_ORIGINS?: string;
  RATE_LIMIT_SECRET: string;
  TURNSTILE_SECRET_KEY: string;
  RESEND_API_KEY: string;
  EMAIL_FROM: string;
  DEPLOYMENT_VERSION?: string;
  ANALYTICS?: ObservabilityAnalytics;
}

function ocrCapability(env: BetaWorkerEnv) {
  const filesReady = typeof env.FILES?.get === "function"
    && typeof env.FILES.put === "function"
    && typeof env.FILES.delete === "function";
  if (!filesReady) return "unconfigured" as const;
  return typeof env.AI?.toMarkdown === "function" ? "ready" as const : "degraded" as const;
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
