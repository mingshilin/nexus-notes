import { normalizeEmail } from "@nexus/domain";
import { AuthService } from "./auth/auth-service";
import { SecureTokenService, WebCryptoPasswordHasher } from "./auth/crypto";
import { D1AuthRepository } from "./auth/d1-auth-repository";
import { D1LoginRiskService } from "./auth/login-risk";
import { ResendEmailSender } from "./auth/resend-email";
import { D1SessionAuthenticator, D1WorkspaceAuthorizer } from "./auth/session-tenancy";
import { TurnstileVerifier } from "./auth/turnstile";
import { createRouteRegistry, type GatewayHookContext } from "./http/route-registry";
import { createSecureGateway } from "./http/security-gateway";
import { D1NoteRepository } from "./notes/d1-note-repository";
import { NoteService } from "./notes/note-service";
import { D1KnowledgeRepository } from "./knowledge/d1-knowledge-repository";
import { KnowledgeService } from "./knowledge/knowledge-service";
import { registerAuthRoutes } from "./routes/auth";
import { healthRoute, type BetaWorkerEnv } from "./routes/health";
import { registerKnowledgeRoutes } from "./routes/knowledge";
import { registerNoteRoutes } from "./routes/notes";
import { D1QuotaService } from "./security/quota";
import { D1RateLimiter } from "./security/rate-limit";

class ConfigurationError extends Error {
  readonly code = "SERVER_NOT_CONFIGURED";
  readonly status = 503;
  readonly retryable = false;
}

function secureTokens(secret: string, namespace: string) {
  if (!secret || secret.length < 32) throw new ConfigurationError(`${namespace} secret is not configured`);
  return new SecureTokenService(`${namespace}:${secret}`);
}

function clientIp(request: Request) {
  return request.headers.get("cf-connecting-ip")
    ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? "0.0.0.0";
}

async function rateLimitKey(
  policy: { bucket: "ip" | "account" | "workspace" },
  context: GatewayHookContext<BetaWorkerEnv>,
) {
  const ip = clientIp(context.request);
  if (policy.bucket === "ip") return `ip:${ip}`;
  if (policy.bucket === "workspace") {
    return `workspace:${context.request.headers.get("x-workspace-id") ?? "missing"}:${ip}`;
  }
  const body = context.body as { email?: unknown } | null | undefined;
  const email = typeof body?.email === "string" ? normalizeEmail(body.email) : "unknown";
  return `account:${email}:${ip}`;
}

function createAuthService(env: BetaWorkerEnv) {
  const authTokens = secureTokens(env.RATE_LIMIT_SECRET, "auth");
  return new AuthService({
    repository: new D1AuthRepository(env.DB),
    turnstile: new TurnstileVerifier(env.TURNSTILE_SECRET_KEY),
    risk: new D1LoginRiskService(env.DB, secureTokens(env.RATE_LIMIT_SECRET, "login-risk")),
    email: new ResendEmailSender(env.RESEND_API_KEY, env.EMAIL_FROM, env.APP_BASE_URL),
    password: new WebCryptoPasswordHasher(),
    tokens: authTokens,
    clock: () => new Date(),
  });
}

function createNoteService(env: BetaWorkerEnv) {
  return new NoteService(new D1NoteRepository(env.DB));
}

function createKnowledgeService(env: BetaWorkerEnv) {
  return new KnowledgeService(new D1KnowledgeRepository(env.DB));
}

function allowedOrigins(env: BetaWorkerEnv) {
  const origins = new Set<string>();
  if (env.APP_BASE_URL) origins.add(new URL(env.APP_BASE_URL).origin);
  for (const origin of env.CORS_ALLOWED_ORIGINS?.split(",") ?? []) {
    if (origin.trim()) origins.add(new URL(origin.trim()).origin);
  }
  return origins;
}

export function createBetaWorker() {
  const registry = createRouteRegistry<BetaWorkerEnv>({
    authenticate: ({ request, env }) => new D1SessionAuthenticator(
      env.DB,
      secureTokens(env.RATE_LIMIT_SECRET, "auth"),
    ).authenticate(request),
    authorizeWorkspace: (principal, workspaceId, { env }) => new D1WorkspaceAuthorizer(env.DB)
      .authorize(principal, workspaceId),
    enforceRateLimit: async (policy, context) => new D1RateLimiter(
      context.env.DB,
      secureTokens(context.env.RATE_LIMIT_SECRET, "rate-limit"),
    ).consume({
      key: await rateLimitKey(policy, context),
      limit: policy.limit,
      windowSeconds: policy.windowSeconds,
    }),
    enforceQuota: async (quota, context) => {
      if (!context.workspace) throw new Error("Workspace context is required for quotas");
      await new D1QuotaService(context.env.DB).assertAvailable(context.workspace.workspaceId, quota, 1);
    },
  });
  registry.register(healthRoute);
  registerAuthRoutes(registry, createAuthService);
  registerNoteRoutes(registry, createNoteService);
  registerKnowledgeRoutes(registry, createKnowledgeService);

  return {
    fetch(request: Request, env: BetaWorkerEnv) {
      return createSecureGateway({ allowedOrigins: allowedOrigins(env), handler: registry }).fetch(request, env);
    },
  };
}
