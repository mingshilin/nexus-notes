import { isAiTrustedModeActive, normalizeEmail, normalizeAiTrustedModeExpiry } from "@nexus/domain";
import { CreateJobInputSchema, FeedbackInputSchema, type AiActionExecutionResult, type OperationsStatus, type UpdateAiTrustedModeInput, type WorkspaceContext } from "@nexus/contracts";
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
import { NoteService, NoteServiceError, stableJson } from "./notes/note-service";
import { D1AiToolRepository } from "./ai/ai-tool-repository";
import { D1KnowledgeRepository } from "./knowledge/d1-knowledge-repository";
import { D1GraphRepository } from "./knowledge/d1-graph-repository";
import { D1ReminderRepository } from "./knowledge/d1-reminder-repository";
import { D1ReminderDeliveryRepository } from "./knowledge/d1-reminder-delivery-repository";
import { D1TaxonomyRepository } from "./knowledge/d1-taxonomy-repository";
import { KnowledgeService } from "./knowledge/knowledge-service";
import { registerAuthRoutes } from "./routes/auth";
import { registerProfileRoutes } from "./routes/profile";
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
import { OperationsConsumer, QueueConsumerRouter } from "./operations/operations-consumer";
import { createObservability, type ObservabilityLogger, type ObservabilityAnalytics } from "./observability";
import { D1ProfileRepository } from "./profile/d1-profile-repository";
import { ProfileAvatarStore } from "./profile/profile-avatar-store";
import { ProfileService } from "./profile/profile-service";
import { AiChatService } from "./ai/ai-chat-service";
import { AiEmailOutboxRepository } from "./ai/ai-email-outbox-repository";
import { AiEmailOutboxDispatcher } from "./ai/ai-email-outbox-dispatcher";
import { AiEmailConsumer } from "./ai/ai-email-consumer";
import { AiToolOrchestrator } from "./ai/ai-tool-orchestrator";
import { AiToolError, aiActionTargetId, type StoredAiActionProposal } from "./ai/ai-tool-model";
import { AiOrganizationTools } from "./ai/ai-organization-tools";
import { AiReadTools } from "./ai/ai-read-tools";
import { registerAiRoutes } from "./routes/ai";
import { registerAccountRoutes } from "./routes/account";
import { D1AccountRepository } from "./account/d1-account-repository";
import { UserSecretBox } from "./security/user-secret-box";
import { D1AiConfigRepository } from "./ai/d1-ai-config-repository";
import { UserAiConfigService } from "./ai/user-ai-config-service";
import { registerSyncRoutes } from "./routes/sync";
import { D1SyncRepository } from "./sync/d1-sync-repository";
import { SyncService } from "./sync/sync-service";
import { registerPushRoutes } from "./routes/push";
import { D1PushSubscriptionRepository } from "./push/d1-push-subscription-repository";
import { PushService } from "./push/push-service";
import { ReminderDeliveryConsumer } from "./push/reminder-delivery-consumer";
import { ReminderOutboxDispatcher } from "./push/reminder-outbox-dispatcher";
import { ResendReminderEmailSender } from "./push/resend-reminder-email";
import { WebPushSender } from "./push/web-push-sender";
import { D1CalendarRepository } from "./calendar/d1-calendar-repository";
import { CalendarService } from "./calendar/calendar-service";
import { createGoogleCalendarProvider, createOutlookCalendarProvider } from "./calendar/calendar-providers";
import { registerCalendarRoutes } from "./calendar/calendar-routes";

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

async function trustedAiModeEnabled(db: D1Database, workspaceId: string, now = new Date()) {
  try {
    const row = await db.prepare(
      "SELECT enabled, expires_at, revision FROM ai_trusted_modes WHERE workspace_id = ? LIMIT 1",
    ).bind(workspaceId).first<{ enabled: number; expires_at: string | null; revision: number }>();
    if (!row) return false;
    return isAiTrustedModeActive({
      workspace_id: workspaceId,
      enabled: Boolean(row.enabled),
      expires_at: row.expires_at,
      revision: row.revision,
    }, now, workspaceId);
  } catch {
    // Older preview databases may not have the additive trusted-mode table.
    return false;
  }
}

type NoteLifecycleProposal = Extract<StoredAiActionProposal, {
  tool: "update_note" | "move_note" | "archive_note" | "restore_note" | "delete_note";
}>;

function isNoteLifecycleProposal(proposal: StoredAiActionProposal): proposal is NoteLifecycleProposal {
  return proposal.tool === "update_note"
    || proposal.tool === "move_note"
    || proposal.tool === "archive_note"
    || proposal.tool === "restore_note"
    || proposal.tool === "delete_note";
}

async function isCommittedNoteAction(db: D1Database, proposal: NoteLifecycleProposal) {
  const row = await db.prepare(
    `SELECT patch_json FROM ai_note_action_idempotency
     WHERE idempotency_key = ? AND workspace_id = ? AND note_id = ? AND base_revision = ?
     LIMIT 1`,
  ).bind(
    aiActionTargetId(proposal.tool, proposal.action_id),
    proposal.workspace_id,
    proposal.input.target_note_id,
    proposal.input.base_revision,
  ).first<{ patch_json: string }>();
  return row?.patch_json === stableJson(proposal.input.patch);
}

type EmailRecipientProposal = Extract<StoredAiActionProposal, { tool: "send_email" }>;

async function assertAiEmailRecipient(
  db: D1Database,
  context: WorkspaceContext,
  proposal: EmailRecipientProposal,
) {
  const scope = proposal.input.recipient_scope;
  // Legacy proposals have no declared scope. Keep them executable through the
  // existing confirmation flow rather than guessing the user's email.
  if (!scope || scope === "external") return;
  const email = normalizeEmail(proposal.input.to_email);
  const row = await db.prepare(
    `SELECT u.id
     FROM users u
     JOIN workspace_members wm ON wm.user_id = u.id AND wm.workspace_id = ?
     WHERE u.email = ? COLLATE NOCASE
       AND u.status = 'active'
       AND u.email_verified_at IS NOT NULL
       AND (? = 'workspace_member' OR u.id = ?)
     LIMIT 1`,
  ).bind(context.workspaceId, email, scope, context.userId).first<{ id: string }>();
  if (!row) {
    throw new AiToolError("AI_ACTION_RECIPIENT_MISMATCH", "Email recipient is not an eligible verified user", 403);
  }
}

function actionResultFromError(actionId: string, error: unknown): AiActionExecutionResult {
  const candidate = error && typeof error === "object" ? error as { code?: unknown; status?: unknown; retryable?: unknown } : {};
  const code = typeof candidate.code === "string" && candidate.code.length > 0
    ? candidate.code.slice(0, 128)
    : "AI_ACTION_EXECUTION_FAILED";
  const status = typeof candidate.status === "number" && Number.isInteger(candidate.status) && candidate.status >= 400 && candidate.status <= 599
    ? candidate.status
    : 500;
  const conflict = [
    "AI_ACTION_CONFLICT",
    "AI_ACTION_NOTE_CONFLICT",
    "NOTE_CONFLICT",
    "DAILY_NOTE_CONFLICT",
    "NOTE_IDEMPOTENCY_CONFLICT",
  ].includes(code);
  const retryable = candidate.retryable === true || code === "AI_ACTION_IN_PROGRESS";
  return {
    action_id: actionId,
    status: conflict ? "conflict" : "failed",
    ...(retryable ? { retryable: true } : {}),
    error: {
      code: conflict ? "AI_ACTION_NOTE_CONFLICT" : code,
      message: conflict ? "The note changed before the AI action could be executed" : "AI action execution failed",
      status,
    },
  };
}

function withStaticAssetCachePolicy(request: Request, response: Response) {
  if (!response.ok || (request.method !== "GET" && request.method !== "HEAD")) return response;
  const headers = new Headers(response.headers);
  const pathname = new URL(request.url).pathname;
  headers.set(
    "cache-control",
    pathname.startsWith("/assets/")
      ? "public, max-age=31536000, immutable"
      : "public, max-age=0, must-revalidate",
  );
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
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

function createProfileService(env: BetaWorkerEnv, logger?: ObservabilityLogger) {
  return new ProfileService({
    repository: new D1ProfileRepository(env.DB),
    password: new WebCryptoPasswordHasher(),
    tokens: secureTokens(env.RATE_LIMIT_SECRET, "auth"),
    email: new ResendEmailSender(env.RESEND_API_KEY, env.EMAIL_FROM, env.APP_BASE_URL, fetch, logger),
    avatars: new ProfileAvatarStore(env.FILES),
    logger: logger ?? { log: () => undefined },
    createId: () => crypto.randomUUID(),
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
  const reminderDeliveries = new D1ReminderDeliveryRepository(env.DB);
  return new KnowledgeService({
    search: (...args) => search.search(...args),
    listSavedSearches: (...args) => search.listSavedSearches(...args),
    createSavedSearch: (...args) => search.createSavedSearch(...args),
    deleteSavedSearch: (...args) => search.deleteSavedSearch(...args),
    getCalendarFeed: (...args) => search.getCalendarFeed(...args),
    listFolders: (...args) => taxonomy.listFolders(...args),
    createFolder: (...args) => taxonomy.createFolder(...args),
    listTags: (...args) => taxonomy.listTags(...args),
    listNoteTags: (...args) => taxonomy.listNoteTags(...args),
    createTag: (...args) => taxonomy.createTag(...args),
    setNoteTags: (...args) => taxonomy.setNoteTags(...args),
    setNoteTagsBatch: (...args) => taxonomy.setNoteTagsBatch(...args),
    setNoteLinks: (...args) => taxonomy.setNoteLinks(...args),
    listNoteLinks: (...args) => taxonomy.listNoteLinks(...args),
    listBacklinks: (...args) => taxonomy.listBacklinks(...args),
    getGraph: (...args) => graph.getGraph(...args),
    listReminders: (...args) => reminders.listReminders(...args),
    listReminderPage: (...args) => reminders.listReminderPage(...args),
    createReminder: (...args) => reminders.createReminder(...args),
    updateReminder: (...args) => reminders.updateReminder(...args),
    snoozeReminder: (...args) => reminders.snoozeReminder(...args),
    deleteReminder: (...args) => reminders.deleteReminder(...args),
    getReminder: (...args) => reminders.getReminder(...args),
  }, { deliveryRepository: reminderDeliveries });
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
    cancelJob: (context: { workspaceId: string }, jobId: string, input: unknown, now: string) =>
      repository.cancelJob(context, jobId, input as { base_revision: number }, now),
    listJobs: (workspaceId: string, limit?: number) => repository.listJobs(workspaceId, limit),
    createFeedback: (context: { workspaceId: string; userId: string }, input: unknown, requestId: string, now: string) =>
      repository.createFeedback(context, FeedbackInputSchema.parse(input), requestId, now),
    listFeedback: (workspaceId: string, limit?: number) => repository.listFeedback(workspaceId, limit),
    getUsage: (workspaceId: string) => repository.getUsage(workspaceId),
    getStatus: () => operationsStatus(env),
    downloadJob: async (workspaceId: string, jobId: string) => {
      const key = await repository.getJobFile(workspaceId, jobId);
      if (!key || !env.FILES) return null;
      const object = await env.FILES.get(key);
      if (!object) return null;
      const zip = key.endsWith(".zip");
      return {
        body: object.body,
        filename: `nexus-notes-export-${jobId}.${zip ? "zip" : "md"}`,
        mime_type: zip ? "application/zip" : "text/markdown; charset=utf-8",
      };
    },
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

function createAiChatService(env: BetaWorkerEnv) {
  const aiEnabled = env.AI_ENABLED?.trim().toLowerCase() === "true";
  const externalConfigured = Boolean(env.AI_CHAT_API_URL?.trim() && env.AI_CHAT_API_KEY?.trim() && env.AI_CHAT_MODEL?.trim());
  const workersAiModel = externalConfigured
    ? env.AI_CHAT_MODEL!.trim()
    : "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
  const workersAiFetch: typeof fetch | undefined = typeof env.AI?.run === "function"
    ? async (_input, init) => {
      const request = JSON.parse(String(init?.body ?? "{}")) as {
        messages?: unknown;
        tools?: unknown;
        stream?: unknown;
      };
      const output = await env.AI!.run!(workersAiModel, {
        messages: request.messages ?? [],
        tools: request.tools ?? [],
        stream: false,
      });
      const rawToolCalls = Array.isArray(output.tool_calls) ? output.tool_calls : [];
      const toolCalls = rawToolCalls.map((value, index) => {
        const call = value && typeof value === "object" ? value as Record<string, unknown> : {};
        if (call.function && typeof call.function === "object") return call;
        return {
          id: typeof call.id === "string" ? call.id : `workers-ai-${index}`,
          type: "function",
          function: {
            name: typeof call.name === "string" ? call.name : "",
            arguments: typeof call.arguments === "string" ? call.arguments : JSON.stringify(call.arguments ?? {}),
          },
        };
      });
      return Response.json({
        choices: [{
          message: {
            content: typeof output.response === "string" ? output.response : "",
            ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
          },
        }],
      });
    }
    : undefined;
  const fallback = externalConfigured
    ? { apiUrl: env.AI_CHAT_API_URL, apiKey: env.AI_CHAT_API_KEY, model: env.AI_CHAT_MODEL }
    : workersAiFetch
      ? {
        apiUrl: "https://workers-ai.binding.invalid/v1/chat/completions",
        apiKey: "workers-ai-binding",
        model: workersAiModel,
        fetchImpl: workersAiFetch,
      }
      : { apiUrl: env.AI_CHAT_API_URL, apiKey: env.AI_CHAT_API_KEY, model: env.AI_CHAT_MODEL };
  const personal = env.USER_SECRETS_ENCRYPTION_KEY
    ? new UserAiConfigService(
      new D1AiConfigRepository(env.DB),
      new UserSecretBox(env.USER_SECRETS_ENCRYPTION_KEY),
    )
    : null;
  const requirePersonal = () => {
    if (!personal) throw new ConfigurationError("User secret encryption is not configured");
    return personal;
  };
  const fallbackStatus = () => new AiChatService(fallback).status();
  const resolveProvider = async (userId?: string) => {
    const preference = userId && personal
      ? await personal.getProviderPreference(userId)
      : { source: "system" as const, revision: 1 };
    const personalProvider = userId && personal && preference.source === "personal"
      ? await personal.resolve(userId)
      : null;
    if (personalProvider) return { ...personalProvider, source: "personal" as const, selectedSource: preference.source };
    if (aiEnabled) return { ...fallback, source: "server_default" as const, selectedSource: preference.source };
    return null;
  };
  return {
    async status(userId?: string) {
      const preference = userId && personal
        ? await personal.getProviderPreference(userId)
        : { source: "system" as const, revision: 1 };
      const personalStatus = personal && userId
        ? await personal.status(userId)
        : { configured: false, source: "unconfigured" as const };
      const fallback = fallbackStatus();
      const systemConfigured = aiEnabled && fallback.configured;
      const personalConfigured = personalStatus.configured;
      const effective = preference.source === "personal" && personalConfigured
        ? personalStatus
        : systemConfigured
          ? { ...fallback, source: "server_default" as const }
          : { configured: false, source: "unconfigured" as const };
      return {
        ...effective,
        selected_source: preference.source,
        personal_configured: personalConfigured,
        system_configured: systemConfigured,
        fallback: preference.source === "personal" && !personalConfigured && systemConfigured,
      };
    },
    async getConfig(userId: string) {
      return personal ? personal.status(userId) : { configured: false, source: "unconfigured" as const };
    },
    saveConfig(userId: string, input: Parameters<UserAiConfigService["saveConfig"]>[1], requestId: string) {
      return requirePersonal().saveConfig(userId, input, requestId);
    },
    testConfig(userId: string, input: Parameters<UserAiConfigService["testConfig"]>[1], signal: AbortSignal, requestId: string) {
      return requirePersonal().testConfig(userId, input, signal, requestId);
    },
    deleteConfig(userId: string, input: Parameters<UserAiConfigService["deleteConfig"]>[1], requestId: string) {
      return requirePersonal().deleteConfig(userId, input, requestId);
    },
    getProviderPreference(userId: string) {
      return requirePersonal().getProviderPreference(userId);
    },
    updateProviderPreference(userId: string, input: Parameters<UserAiConfigService["updateProviderPreference"]>[1]) {
      return requirePersonal().updateProviderPreference(userId, input);
    },
    async chat(
      input: Parameters<AiChatService["chat"]>[0],
      signal: AbortSignal,
      userId?: string,
      options?: Parameters<AiChatService["chat"]>[2],
    ) {
      const resolved = await resolveProvider(userId);
      if (!resolved) throw new ConfigurationError("AI service is disabled");
      return new AiChatService(resolved).chat(input, signal, options);
    },
  };
}

function createAiActionService(env: BetaWorkerEnv) {
  const chat = createAiChatService(env);
  const repository = new D1AiToolRepository(env.DB);
  const noteService = createNoteService(env);
  const knowledgeService = createKnowledgeService(env);
  const databaseRepository = createDatabaseRepository(env);
  const organization = new AiOrganizationTools({
    knowledge: knowledgeService,
    databases: databaseRepository,
  });
  const readTools = new AiReadTools({
    notes: noteService,
    knowledge: knowledgeService,
    databases: databaseRepository,
  });
  const collaborationRepository = createCollaborationRepository(env);
  const emailOutboxRepository = new AiEmailOutboxRepository(env.DB);
  const queue = env.JOBS ? {
    send: (message: any) => env.JOBS!.send(message),
  } : undefined;
  const actionExecution = {
    noteService,
    knowledgeService,
    collaborationRepository,
    emailOutboxRepository,
    organization,
    queue,
  };
  const orchestrator = new AiToolOrchestrator({
    repository,
    clock: () => new Date(),
    assertEmailRecipient: (context, proposal) => assertAiEmailRecipient(env.DB, context, proposal),
    assertFreshPermission: async (context, proposal) => {
      if (context.role === "viewer") {
        throw new AiToolError("AI_ACTION_PERMISSION_DENIED", "Viewer permission is insufficient", 403);
      }
      if (isNoteLifecycleProposal(proposal)) {
        if (await isCommittedNoteAction(env.DB, proposal)) return;
        const noteService = createNoteService(env);
        try {
          const note = await noteService.get(context, proposal.input.target_note_id);
          if (note.revision !== proposal.input.base_revision) {
            throw new AiToolError("AI_ACTION_NOTE_CONFLICT", "The note changed before this AI action was confirmed", 409);
          }
        } catch (error) {
          if (error instanceof AiToolError) throw error;
          if (error instanceof NoteServiceError && error.code === "NOTE_NOT_FOUND") {
            throw new AiToolError("AI_ACTION_PERMISSION_DENIED", "The target note is not available in this workspace", 403);
          }
          throw error;
        }
      }
      if (proposal.tool === "send_email" && proposal.input.to_email.endsWith("@blocked.test")) {
        throw new AiToolError("AI_ACTION_RECIPIENT_MISMATCH", "Email recipient changed before execution", 409);
      }
    },
  });
  return {
    ...chat,
    async getTrustedMode(workspaceId: string) {
      return repository.getTrustedMode(workspaceId);
    },
    async updateTrustedMode(workspaceId: string, input: UpdateAiTrustedModeInput, _requestId: string) {
      if (input.enabled && env.AI_ENABLED?.trim().toLowerCase() !== "true") {
        throw new ConfigurationError("AI service is disabled");
      }
      const expiresAt = normalizeAiTrustedModeExpiry(input.enabled, new Date(), input.expires_at);
      const updated = await repository.updateTrustedMode(workspaceId, { ...input, expires_at: expiresAt });
      if (!updated) {
        throw new AiToolError("AI_TRUSTED_MODE_CONFLICT", "Trusted mode changed before this update could be saved", 409);
      }
      return updated;
    },
    async listActionHistory(userId: string, workspaceId: string, limit: number) {
      return repository.listActionHistory(userId, workspaceId, limit);
    },
    async chat(input: Parameters<AiChatService["chat"]>[0], signal: AbortSignal, userId?: string, workspace?: WorkspaceContext) {
      const actor = userId && workspace ? {
        workspaceId: workspace.workspaceId,
        userId,
        role: workspace.role,
        capabilities: workspace.capabilities,
      } : null;
      return chat.chat(input, signal, userId, actor ? {
        proposeActions: async (toolCalls) => orchestrator.proposeMany(
          actor,
          toolCalls,
          { trusted: await trustedAiModeEnabled(env.DB, actor.workspaceId) },
        ),
        executeActions: async (proposals) => {
          const settled = await Promise.allSettled(
            proposals.map((proposal) => orchestrator.execute(actor, proposal.action_id, actionExecution)),
          );
          return settled.map((result, index) => result.status === "fulfilled"
            ? result.value
            : actionResultFromError(proposals[index]!.action_id, result.reason));
        },
        ...(input.read_context ? {
          readTools,
          readContext: {
            workspaceId: actor.workspaceId,
            userId: actor.userId,
            selectedNoteIds: input.read_context.selected_note_ids,
            selectedDatabaseIds: input.read_context.selected_database_ids,
            allowWorkspaceSearch: input.read_context.allow_workspace_search,
            role: actor.role,
            capabilities: actor.capabilities,
          },
        } : {}),
      } : undefined);
    },
    async confirmAction(userId: string, workspace: WorkspaceContext, actionId: string, baseRevision: number, requestId: string) {
      const actor = { workspaceId: workspace.workspaceId, userId, role: workspace.role, capabilities: workspace.capabilities };
      try {
        await orchestrator.confirm(actor, actionId, baseRevision);
      } catch (error) {
        if (error instanceof AiToolError && error.code === "AI_ACTION_CONFLICT") {
          const current = await repository.getOwned(userId, workspace.workspaceId, actionId);
          if (!current || !["confirmed", "executing", "executed", "failed", "conflict"].includes(current.status)) throw error;
        } else {
          throw error;
        }
      }
      return orchestrator.execute(actor, actionId, {
        noteService,
        knowledgeService,
        collaborationRepository,
        emailOutboxRepository,
        queue,
        requestId,
      });
    },
    async rejectAction(userId: string, workspace: WorkspaceContext, actionId: string, baseRevision: number, requestId: string) {
      const actor = { workspaceId: workspace.workspaceId, userId, role: workspace.role, capabilities: workspace.capabilities };
      return orchestrator.reject(actor, actionId, baseRevision);
    },
  };
}

function createAiEmailConsumer(env: BetaWorkerEnv) {
  return new AiEmailConsumer(
    new AiEmailOutboxRepository(env.DB),
    new ResendEmailSender(env.RESEND_API_KEY, env.EMAIL_FROM, env.APP_BASE_URL),
  );
}

function createAiEmailOutboxDispatcher(env: BetaWorkerEnv) {
  return env.JOBS
    ? new AiEmailOutboxDispatcher(new AiEmailOutboxRepository(env.DB), env.JOBS)
    : null;
}

function createOperationsConsumer(env: BetaWorkerEnv) {
  const repository = new D1OperationsRepository(env.DB);
  const notes = new D1NoteRepository(env.DB);
  const files = {
    async put(key: string, value: string | Uint8Array, options?: { httpMetadata?: { contentType: string } }) {
      if (!env.FILES) throw Object.assign(new Error("OPERATION_STORAGE_UNAVAILABLE"), { code: "OPERATION_STORAGE_UNAVAILABLE" });
      return env.FILES.put(key, value, options);
    },
  };
  return new OperationsConsumer(repository, files, {
    createNote: (input) => notes.createNote(input),
  });
}

function createSyncService(env: BetaWorkerEnv) {
  return new SyncService(new D1SyncRepository(env.DB));
}

function createPushService(env: BetaWorkerEnv) {
  if (!env.USER_SECRETS_ENCRYPTION_KEY) {
    throw new ConfigurationError("User secret encryption is not configured");
  }
  return new PushService(
    new D1PushSubscriptionRepository(env.DB, new UserSecretBox(env.USER_SECRETS_ENCRYPTION_KEY)),
    env.JOBS,
    env.WEB_PUSH_VAPID_PUBLIC_KEY ?? "",
  );
}

function calendarConfig(env: BetaWorkerEnv, provider: "google" | "outlook") {
  const redirectUri = env.CALENDAR_OAUTH_REDIRECT_URI?.trim();
  if (!redirectUri) return undefined;
  const clientId = provider === "google" ? env.GOOGLE_CALENDAR_CLIENT_ID : env.OUTLOOK_CALENDAR_CLIENT_ID;
  const clientSecret = provider === "google" ? env.GOOGLE_CALENDAR_CLIENT_SECRET : env.OUTLOOK_CALENDAR_CLIENT_SECRET;
  if (!clientId?.trim() || !clientSecret?.trim()) return undefined;
  return { clientId: clientId.trim(), clientSecret: clientSecret.trim(), redirectUri };
}

function createCalendarService(env: BetaWorkerEnv) {
  const stateSecret = env.RATE_LIMIT_SECRET ? new SecureTokenService(`calendar-oauth:${env.RATE_LIMIT_SECRET}`) : undefined;
  const secretBox = env.USER_SECRETS_ENCRYPTION_KEY ? new UserSecretBox(env.USER_SECRETS_ENCRYPTION_KEY) : undefined;
  return new CalendarService(new D1CalendarRepository(env.DB), {
    stateToken: stateSecret ? {
      create: () => stateSecret.createSessionToken(),
      hash: (value: string) => stateSecret.hash(value),
    } : undefined,
    secretBox,
    configs: {
      ...(calendarConfig(env, "google") ? { google: calendarConfig(env, "google") } : {}),
      ...(calendarConfig(env, "outlook") ? { outlook: calendarConfig(env, "outlook") } : {}),
    },
    providers: {
      google: createGoogleCalendarProvider(),
      outlook: createOutlookCalendarProvider(),
    },
  });
}

function createReminderDeliveryConsumer(env: BetaWorkerEnv) {
  const subscriptions = env.USER_SECRETS_ENCRYPTION_KEY
    ? new D1PushSubscriptionRepository(env.DB, new UserSecretBox(env.USER_SECRETS_ENCRYPTION_KEY))
    : {
        listActive: async () => [],
        markSuccess: async () => undefined,
        markFailure: async () => undefined,
      };
  const push = env.WEB_PUSH_VAPID_PUBLIC_KEY && env.WEB_PUSH_VAPID_PRIVATE_KEY && env.WEB_PUSH_SUBJECT
    ? new WebPushSender({
        publicKey: env.WEB_PUSH_VAPID_PUBLIC_KEY,
        privateKey: env.WEB_PUSH_VAPID_PRIVATE_KEY,
        subject: env.WEB_PUSH_SUBJECT,
      })
    : {
        send: async () => ({ ok: false, permanent: false, retryable: false }),
      };
  const email = env.RESEND_API_KEY && env.EMAIL_FROM
    ? new ResendReminderEmailSender(env.RESEND_API_KEY, env.EMAIL_FROM)
    : undefined;
  return new ReminderDeliveryConsumer(
    new D1ReminderDeliveryRepository(env.DB),
    subscriptions,
    push,
    email,
  );
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
  registerAiRoutes(registry, createAiActionService);
  registerAuthRoutes(registry, (env) => createAuthService(env, options.logger));
  registerProfileRoutes(registry, (env) => createProfileService(env, options.logger));
  registerAccountRoutes(registry, (env) => new D1AccountRepository(env.DB));
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
  registerSyncRoutes(registry, createSyncService);
  registerPushRoutes(registry, createPushService);
  registerCalendarRoutes(registry, createCalendarService);

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
              return withStaticAssetCachePolicy(assetRequest, await assetEnv.ASSETS.fetch(assetRequest));
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
      const consumer = new QueueConsumerRouter(
        new OcrConsumer(new D1AttachmentRepository(env.DB), createOcrExtractor(env)),
        createOperationsConsumer(env),
        createAiEmailConsumer(env),
        createReminderDeliveryConsumer(env),
      );
      await Promise.all(batch.messages.map(async (message) => {
        const startedAt = Date.now();
        let outcome: "success" | "retry" | "failure" = "success";
        const body = message.body;
        const kind = body && typeof body === "object" && !Array.isArray(body) && "kind" in body && typeof body.kind === "string"
          ? body.kind
          : "unknown";
        const payload = body && typeof body === "object" && !Array.isArray(body) && "payload" in body && body.payload && typeof body.payload === "object" && !Array.isArray(body.payload)
          ? body.payload as Record<string, unknown>
          : null;
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
            queue: kind === "ocr"
              ? "ocr"
              : kind === "notification" && typeof payload?.outbox_id === "string"
                ? "email"
                : kind === "notification" || kind === "email"
                  ? "reminders"
                  : "operations",
            kind,
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
        await createAiEmailOutboxDispatcher(env)?.dispatch();
        const reminders = new D1ReminderDeliveryRepository(env.DB);
        const now = new Date().toISOString();
        await reminders.prepareDue(now, 100);
        await new ReminderOutboxDispatcher(reminders, env.JOBS).dispatch();
      }
    },
  };
}
