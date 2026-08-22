interface TurnstileResponse {
  success?: boolean;
  action?: string;
  hostname?: string;
}

export class TurnstileVerifier {
  private readonly allowedHostnames: ReadonlySet<string>;

  constructor(
    private readonly secret: string,
    private readonly fetchImpl: typeof fetch = fetch,
    allowedHostnames: readonly string[] | ReadonlySet<string> = [],
  ) {
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
      const response = await this.fetchImpl(
        "https://challenges.cloudflare.com/turnstile/v0/siteverify",
        {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body,
          signal: controller.signal,
        },
      );
      if (!response.ok) return false;
      const result = await response.json() as TurnstileResponse;
      const hostname = result.hostname?.trim().toLowerCase().replace(/\.$/u, "");
      return result.success === true
        && result.action === action
        && Boolean(hostname && this.allowedHostnames.has(hostname));
    } catch {
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }
}
