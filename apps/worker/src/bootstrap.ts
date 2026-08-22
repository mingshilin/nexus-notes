import { normalizeEmail } from "@nexus/domain";
import { CreateJobInputSchema, FeedbackInputSchema, type OperationsStatus } from "@nexus/contracts";
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
import { registerOperationsRoutes } from "./routes/operations";
import { createPresenceNotifier } from "./presence/presence-dispatcher";
import { D1OperationsRepository } from "./operations/d1-operations-repository";
import { OperationsOutboxDispatcher } from "./operations/operations-outbox-dispatcher";
import { createObservability, type ObservabilityLogger, type ObservabilityAnalytics } from "./observability";

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

function allowedTurnstileHostnames(env: BetaWorkerEnv) {
  const hostnames = new Set<string>();
  const origins = [env.APP_BASE_URL, ...(env.CORS_ALLOWED_ORIGINS?.split(",") ?? [])];
  for (const origin of origins) {
    try {
      const url = new URL(origin.trim());
      if (url.protocol === "http:" || url.protocol === "https:") {
        hostnames.add(url.hostname);
      }
    } catch {
      // Ignore malformed optional CORS entries; the configured base URL still applies.
    }
  }
  return [...hostnames];
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

export interface BetaWorkerOptions {
  logger?: ObservabilityLogger;
  analytics?: ObservabilityAnalytics;
}

function createAuthService(env: BetaWorkerEnv, logger?: ObservabilityLogger) {
  const authTokens = secureTokens(env.RATE_LIMIT_SECRET, "auth");
  return new AuthService({
    repository: new D1AuthRepository(env.DB),
    logger,
    turnstile: new TurnstileVerifier(env.TURNSTILE_SECRET_KEY, fetch, allowedTurnstileHostnames(env), logger),
    risk: new D1LoginRiskService(env.DB, secureTokens(env.RATE_LIMIT_SECRET, "login-risk")),
    email: new ResendEmailSender(env.RESEND_API_KEY, env.EMAIL_FROM, env.APP_BASE_URL, fetch, logger),
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

function operationsStatus(env: BetaWorkerEnv): OperationsStatus {
  const filesReady = typeof env.FILES?.get === "function"
    && typeof env.FILES.put === "function"
    && typeof env.FILES.delete === "function";
  const storage = !env.FILES ? "unconfigured" : filesReady ? "ready" : "degraded";
  return {
    queue: typeof env.JOBS?.send === "function" ? "ready" : "unconfigured",
    storage,
    ocr: storage === "unconfigured" ? "unconfigured" : storage === "degraded" || typeof env.AI?.toMarkdown !== "function" ? "degraded" : "ready",
    version: env.DEPLOYMENT_VERSION ?? "development",
  };
}

function createOperationsService(env: BetaWorkerEnv) {
  const repository = new D1OperationsRepository(env.DB);
  return {
    createJob: (context: { workspaceId: string; userId: string }, input: unknown, now: string) =>
      repository.createJob(context, CreateJobInputSchema.parse(input), now),
    getJob: (workspaceId: string, jobId: string) => repository.getJob(workspaceId, jobId),
    listJobs: (workspaceId: string, limit?: number) => repository.listJobs(workspaceId, limit),
    createFeedback: (context: { workspaceId: string; userId: string }, input: unknown, requestId: string, now: string) =>
      repository.createFeedback(context, FeedbackInputSchema.parse(input), requestId, now),
    listFeedback: (workspaceId: string, limit?: number) => repository.listFeedback(workspaceId, limit),
    getUsage: (workspaceId: string) => repository.getUsage(workspaceId),
    getStatus: () => operationsStatus(env),
  };
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

export function createBetaWorker(options: BetaWorkerOptions = {}) {
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
  registerAuthRoutes(registry, (env) => createAuthService(env, options.logger));
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
  registerOperationsRoutes(registry, createOperationsService);

  return {
    async fetch(request: Request, env: BetaWorkerEnv) {
      const startedAt = Date.now();
      const observability = createObservability({
        logger: options.logger,
        analytics: options.analytics ?? env.ANALYTICS,
        deploymentVersion: env.DEPLOYMENT_VERSION,
        workspaceHashSecret: env.RATE_LIMIT_SECRET,
      });
      let response: Response;
      try {
        response = await createSecureGateway({
          allowedOrigins: allowedOrigins(env),
          handler: async (assetRequest: Request, assetEnv: BetaWorkerEnv) => {
            if (!new URL(assetRequest.url).pathname.startsWith("/api/") && assetEnv.ASSETS) {
              return assetEnv.ASSETS.fetch(assetRequest);
            }
            return registry.fetch(assetRequest, assetEnv);
          },
        }).fetch(request, env);
      } catch (error) {
        await observability.recordHttp({
          requestId: "unavailable",
          method: request.method,
          pathname: new URL(request.url).pathname,
          status: 500,
          latencyMs: Date.now() - startedAt,
          workspaceId: request.headers.get("x-workspace-id") ?? undefined,
        });
        throw error;
      }
      await observability.recordHttp({
        requestId: response.headers.get("x-request-id") ?? "unavailable",
        method: request.method,
        pathname: new URL(request.url).pathname,
        status: response.status,
        latencyMs: Date.now() - startedAt,
        workspaceId: request.headers.get("x-workspace-id") ?? undefined,
      });
      return response;
    },
    async queue(batch: MessageBatch<unknown>, env: BetaWorkerEnv, _ctx: ExecutionContext) {
      const observability = createObservability({
        logger: options.logger,
        analytics: options.analytics ?? env.ANALYTICS,
        deploymentVersion: env.DEPLOYMENT_VERSION,
        workspaceHashSecret: env.RATE_LIMIT_SECRET,
      });
      const consumer = new OcrConsumer(new D1AttachmentRepository(env.DB), createOcrExtractor(env));
      await Promise.all(batch.messages.map(async (message) => {
        const startedAt = Date.now();
        let outcome: "success" | "retry" | "failure" = "success";
        try {
          const result = await consumer.consume(message);
          if (result.outcome === "retry") {
            outcome = "retry";
            retryNativeMessage(message, result.delaySeconds);
          }
        } catch (error) {
          outcome = "failure";
          throw error;
        } finally {
          await observability.recordQueue({
            queue: "ocr",
            kind: "ocr",
            outcome,
            attempt: message.attempts,
            ageMs: Date.now() - startedAt,
          });
        }
      }));
    },
    async scheduled(_controller: ScheduledController, env: BetaWorkerEnv) {
      const repository = new D1AttachmentRepository(env.DB);
      await repository.recoverStaleOcrJobs(new Date().toISOString(), 50);
      if (env.JOBS) {
        await new OcrOutboxDispatcher(repository, env.JOBS).dispatch();
        await new OperationsOutboxDispatcher(new D1OperationsRepository(env.DB), env.JOBS).dispatch();
      }
    },
  };
}
