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
import { D1GraphRepository } from "./knowledge/d1-graph-repository";
import { D1ReminderRepository } from "./knowledge/d1-reminder-repository";
import { D1TaxonomyRepository } from "./knowledge/d1-taxonomy-repository";
import { KnowledgeService } from "./knowledge/knowledge-service";
import { registerAuthRoutes } from "./routes/auth";
import { healthRoute, type BetaWorkerEnv } from "./routes/health";
import { registerKnowledgeRoutes } from "./routes/knowledge";
import { registerNoteRoutes } from "./routes/notes";
import { registerGraphRoutes } from "./routes/graph";
import { registerReminderRoutes } from "./routes/reminders";
import { registerTaxonomyRoutes } from "./routes/taxonomy";
import { D1QuotaService } from "./security/quota";
import { D1RateLimiter } from "./security/rate-limit";
import { D1AttachmentRepository } from "./attachments/d1-attachment-repository";
import { AttachmentService } from "./attachments/attachment-service";
import { registerAttachmentRoutes } from "./routes/attachments";
import { OcrConsumer } from "./attachments/ocr-consumer";
import { OcrExtractionError, OcrExtractor } from "./attachments/ocr-extractor";
import { OcrOutboxDispatcher } from "./attachments/ocr-outbox-dispatcher";
import { D1DatabaseRepository } from "./databases/d1-database-repository";
import { registerDatabaseRoutes } from "./routes/databases";
import { D1CollaborationRepository } from "./collaboration/d1-collaboration-repository";
import { registerCollaborationRoutes } from "./routes/collaboration";
import { registerPresenceRoute } from "./routes/presence";
import { createPresenceNotifier } from "./presence/presence-dispatcher";

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
  return new NoteService(new D1NoteRepository(env.DB, undefined, {
    presence: createPresenceNotifier(env),
  }));
}

function createDatabaseRepository(env: BetaWorkerEnv) {
  return new D1DatabaseRepository(env.DB, {
    presence: createPresenceNotifier(env),
  });
}

function collaborationTokens(env: BetaWorkerEnv) {
  return secureTokens(env.RATE_LIMIT_SECRET, "collaboration");
}

function createCollaborationRepository(env: BetaWorkerEnv) {
  return new D1CollaborationRepository(env.DB, {
    tokens: collaborationTokens(env),
    password: new WebCryptoPasswordHasher(),
    presence: createPresenceNotifier(env),
  });
}

async function consumePublicSharePasswordAttempt(env: BetaWorkerEnv, request: Request, token: string) {
  const limiter = new D1RateLimiter(env.DB, secureTokens(env.RATE_LIMIT_SECRET, "rate-limit"));
  const policy = { limit: 5, windowSeconds: 300 };
  await limiter.consume({ key: `public-share-password:ip:${clientIp(request)}`, ...policy });
  await limiter.consume({ key: `public-share-password:token:${token}`, ...policy });
}

function createKnowledgeService(env: BetaWorkerEnv) {
  const search = new D1KnowledgeRepository(env.DB);
  const taxonomy = new D1TaxonomyRepository(env.DB);
  const graph = new D1GraphRepository(env.DB);
  const reminders = new D1ReminderRepository(env.DB);
  return new KnowledgeService({
    search: (...args) => search.search(...args),
    listSavedSearches: (...args) => search.listSavedSearches(...args),
    createSavedSearch: (...args) => search.createSavedSearch(...args),
    deleteSavedSearch: (...args) => search.deleteSavedSearch(...args),
    listFolders: (...args) => taxonomy.listFolders(...args),
    createFolder: (...args) => taxonomy.createFolder(...args),
    listTags: (...args) => taxonomy.listTags(...args),
    createTag: (...args) => taxonomy.createTag(...args),
    setNoteTags: (...args) => taxonomy.setNoteTags(...args),
    setNoteLinks: (...args) => taxonomy.setNoteLinks(...args),
    listNoteLinks: (...args) => taxonomy.listNoteLinks(...args),
    listBacklinks: (...args) => taxonomy.listBacklinks(...args),
    getGraph: (...args) => graph.getGraph(...args),
    listReminders: (...args) => reminders.listReminders(...args),
    createReminder: (...args) => reminders.createReminder(...args),
    updateReminder: (...args) => reminders.updateReminder(...args),
  });
}

function createAttachmentService(env: BetaWorkerEnv) {
  const repository = new D1AttachmentRepository(env.DB);
  return new AttachmentService(repository, env.FILES, {
    outbox: env.JOBS ? new OcrOutboxDispatcher(repository, env.JOBS) : undefined,
  });
}

function createOcrExtractor(env: BetaWorkerEnv) {
  return new OcrExtractor({
    files: {
      async get(key) {
        if (!env.FILES) throw new OcrExtractionError("OCR_STORAGE_UNAVAILABLE", false);
        const object = await env.FILES.get(key);
        return object ? { body: object.body, size: object.size } : null;
      },
    },
    ai: env.AI ? {
      toMarkdown(file) {
        return env.AI!.toMarkdown(file);
      },
    } : undefined,
  });
}

function retryNativeMessage(message: Message<unknown>, delaySeconds: number) {
  message.retry({ delaySeconds });
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
  registerTaxonomyRoutes(registry, createKnowledgeService);
  registerReminderRoutes(registry, createKnowledgeService);
  registerGraphRoutes(registry, createKnowledgeService);
  registerAttachmentRoutes(registry, createAttachmentService);
  registerDatabaseRoutes(registry, createDatabaseRepository);
  registerCollaborationRoutes(registry, {
    createRepository: createCollaborationRepository,
    hashToken: (env, token) => collaborationTokens(env).hash(token),
    consumePublicSharePasswordAttempt,
  });
  registerPresenceRoute(registry);

  return {
    fetch(request: Request, env: BetaWorkerEnv) {
      return createSecureGateway({ allowedOrigins: allowedOrigins(env), handler: registry }).fetch(request, env);
    },
    async queue(batch: MessageBatch<unknown>, env: BetaWorkerEnv, _ctx: ExecutionContext) {
      const consumer = new OcrConsumer(new D1AttachmentRepository(env.DB), createOcrExtractor(env));
      await Promise.all(batch.messages.map(async (message) => {
        const outcome = await consumer.consume(message);
        if (outcome.outcome === "retry") retryNativeMessage(message, outcome.delaySeconds);
      }));
    },
    async scheduled(_controller: ScheduledController, env: BetaWorkerEnv) {
      const repository = new D1AttachmentRepository(env.DB);
      await repository.recoverStaleOcrJobs(new Date().toISOString(), 50);
      if (env.JOBS) await new OcrOutboxDispatcher(repository, env.JOBS).dispatch();
    },
  };
}
