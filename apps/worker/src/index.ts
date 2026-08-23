import { createBetaWorker } from "./bootstrap";
import { PresenceRoom } from "./presence/presence-room";

const betaWorker = createBetaWorker();

export default betaWorker;
export { PresenceRoom };

export { createRouteRegistry } from "./http/route-registry";
export { AuthService, AuthServiceError } from "./auth/auth-service";
export { WebCryptoPasswordHasher, SecureTokenService } from "./auth/crypto";
export { D1AuthRepository } from "./auth/d1-auth-repository";
export { D1ProfileRepository } from "./profile/d1-profile-repository";
export { ProfileService } from "./profile/profile-service";
export { ProfileServiceError } from "./profile/profile-model";
export type { ProfileRepository, StoredProfile } from "./profile/profile-model";
export { D1SessionAuthenticator, D1WorkspaceAuthorizer } from "./auth/session-tenancy";
export { D1LoginRiskService } from "./auth/login-risk";
export { ResendEmailSender } from "./auth/resend-email";
export { D1RateLimiter, RateLimitError } from "./security/rate-limit";
export { D1QuotaService, QuotaExceededError } from "./security/quota";
export { createSecureGateway } from "./http/security-gateway";
export {
  Observability,
  classifyHttpStatus,
  createObservability,
  normalizeRoute,
} from "./observability";
export { TurnstileVerifier } from "./auth/turnstile";
export { D1NoteRepository } from "./notes/d1-note-repository";
export { D1DatabaseRepository } from "./databases/d1-database-repository";
export {
  D1CollaborationRepository,
  CollaborationRepositoryError,
} from "./collaboration/d1-collaboration-repository";
export type {
  CollaborationRepositoryOptions,
  InvitationAcceptanceContext,
  PublicTokenHashContext,
} from "./collaboration/d1-collaboration-repository";
export { DatabaseRepositoryError } from "./databases/database-model";
export { NoteService, NoteServiceError } from "./notes/note-service";
export { D1KnowledgeRepository } from "./knowledge/d1-knowledge-repository";
export { D1GraphRepository } from "./knowledge/d1-graph-repository";
export { D1ReminderRepository } from "./knowledge/d1-reminder-repository";
export { D1TaxonomyRepository } from "./knowledge/d1-taxonomy-repository";
export { KnowledgeService, KnowledgeServiceError } from "./knowledge/knowledge-service";
export { AttachmentService, AttachmentServiceError } from "./attachments/attachment-service";
export { D1AttachmentRepository } from "./attachments/d1-attachment-repository";
export { D1OperationsRepository } from "./operations/d1-operations-repository";
export { OperationsOutboxDispatcher, nextOutboxRetryAt } from "./operations/operations-outbox-dispatcher";
export { OcrConsumer } from "./attachments/ocr-consumer";
export { OcrOutboxDispatcher } from "./attachments/ocr-outbox-dispatcher";
export { registerAuthRoutes } from "./routes/auth";
export { registerProfileRoutes } from "./routes/profile";
export { registerKnowledgeRoutes } from "./routes/knowledge";
export { registerGraphRoutes } from "./routes/graph";
export { registerReminderRoutes } from "./routes/reminders";
export { registerTaxonomyRoutes } from "./routes/taxonomy";
export { registerNoteRoutes } from "./routes/notes";
export { registerAttachmentRoutes } from "./routes/attachments";
export { registerDatabaseRoutes } from "./routes/databases";
export { registerCollaborationRoutes } from "./routes/collaboration";
export type { CollaborationRouteDependencies } from "./routes/collaboration";
export { registerPresenceRoute, signPresenceIdentity } from "./routes/presence";
export { registerOperationsRoutes } from "./routes/operations";
export { registerAiRoutes } from "./routes/ai";
export { AiChatService, AiChatServiceError } from "./ai/ai-chat-service";
export { createBetaWorker } from "./bootstrap";
export type { BetaWorkerEnv } from "./routes/health";
