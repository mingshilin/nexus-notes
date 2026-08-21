import { createBetaWorker } from "./bootstrap";

const betaWorker = createBetaWorker();

export default betaWorker;

export { createRouteRegistry } from "./http/route-registry";
export { AuthService, AuthServiceError } from "./auth/auth-service";
export { WebCryptoPasswordHasher, SecureTokenService } from "./auth/crypto";
export { D1AuthRepository } from "./auth/d1-auth-repository";
export { D1SessionAuthenticator, D1WorkspaceAuthorizer } from "./auth/session-tenancy";
export { D1LoginRiskService } from "./auth/login-risk";
export { ResendEmailSender } from "./auth/resend-email";
export { D1RateLimiter, RateLimitError } from "./security/rate-limit";
export { D1QuotaService, QuotaExceededError } from "./security/quota";
export { createSecureGateway } from "./http/security-gateway";
export { TurnstileVerifier } from "./auth/turnstile";
export { registerAuthRoutes } from "./routes/auth";
export { createBetaWorker } from "./bootstrap";
export type { BetaWorkerEnv } from "./routes/health";
