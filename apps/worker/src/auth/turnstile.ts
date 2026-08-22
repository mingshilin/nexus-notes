interface TurnstileResponse {
  success?: boolean;
  action?: string;
  hostname?: string;
  "error-codes"?: unknown;
}

export interface TurnstileLogger {
  log(message: string): void;
}

function boundedValue(value: unknown, maxLength = 128) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : undefined;
}

function safeErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/[\u0000-\u001f\u007f]/gu, " ")
    .replace(/\b(secret|response|token|password|cookie)\s*[:=]\s*[^\s]+/giu, "$1=[redacted]")
    .slice(0, 160);
}

export class TurnstileVerifier {
  private readonly allowedHostnames: ReadonlySet<string>;
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly secret: string,
    fetchImpl: typeof fetch = fetch,
    allowedHostnames: readonly string[] | ReadonlySet<string> = [],
    private readonly logger: TurnstileLogger = console,
  ) {
    this.fetchImpl = fetchImpl.bind(globalThis);
    this.allowedHostnames = new Set(
      [...allowedHostnames]
        .map((hostname) => hostname.trim().toLowerCase().replace(/\.$/u, ""))
        .filter(Boolean),
    );
  }

  async verify(token: string, ip: string, action: "register" | "login" | "forgot_password" | "verify_email") {
    if (!this.secret || !token || token.length > 2048) return false;
    const body = new URLSearchParams();
    body.set("secret", this.secret);
    body.set("response", token);
    if (ip && ip !== "0.0.0.0") body.set("remoteip", ip);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      let response: Response;
      try {
        response = await this.fetchImpl(
          "https://challenges.cloudflare.com/turnstile/v0/siteverify",
          {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body,
            signal: controller.signal,
          },
        );
      } catch (error) {
        this.emitDiagnostic({
          success: false,
          failure: "network_error",
          error_name: error instanceof Error ? error.name : "unknown",
          error_message: safeErrorMessage(error),
        });
        return false;
      }
      if (!response.ok) {
        this.emitDiagnostic({ success: false, http_status: response.status });
        return false;
      }
      let result: TurnstileResponse;
      try {
        result = await response.json() as TurnstileResponse;
      } catch {
        this.emitDiagnostic({ success: false, failure: "response_parse_error" });
        return false;
      }
      this.emitDiagnostic(result);
      const hostname = typeof result.hostname === "string"
        ? result.hostname.trim().toLowerCase().replace(/\.$/u, "")
        : undefined;
      return result.success === true
        && result.action === action
        && Boolean(hostname && this.allowedHostnames.has(hostname));
    } finally {
      clearTimeout(timeout);
    }
  }

  private emitDiagnostic(result: TurnstileResponse & {
    http_status?: number;
    failure?: string;
    error_name?: string;
    error_message?: string;
  }) {
    const errorCodes = Array.isArray(result["error-codes"])
      ? result["error-codes"]
        .filter((code): code is string => typeof code === "string")
        .map((code) => code.slice(0, 64))
        .slice(0, 8)
      : [];
    try {
      this.logger.log(JSON.stringify({
        type: "turnstile.verify",
        success: result.success === true,
        action: boundedValue(result.action),
        hostname: boundedValue(result.hostname),
        error_codes: errorCodes,
        ...(result.http_status !== undefined ? { http_status: result.http_status } : {}),
        ...(result.failure ? { failure: result.failure } : {}),
        ...(result.error_name ? { error_name: boundedValue(result.error_name, 32) } : {}),
        ...(result.error_message ? { error_message: boundedValue(result.error_message, 160) } : {}),
      }));
    } catch {
      // Diagnostics must never change the authentication result.
    }
  }
}
