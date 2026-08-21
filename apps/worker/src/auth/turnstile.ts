interface TurnstileResponse {
  success?: boolean;
  action?: string;
}

export class TurnstileVerifier {
  constructor(
    private readonly secret: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async verify(token: string, ip: string, action: "register" | "login" | "forgot_password" | "verify_email") {
    if (!this.secret || !token) return false;
    const body = new FormData();
    body.set("secret", this.secret);
    body.set("response", token);
    if (ip && ip !== "0.0.0.0") body.set("remoteip", ip);

    try {
      const response = await this.fetchImpl(
        "https://challenges.cloudflare.com/turnstile/v0/siteverify",
        { method: "POST", body },
      );
      if (!response.ok) return false;
      const result = await response.json() as TurnstileResponse;
      return result.success === true && result.action === action;
    } catch {
      return false;
    }
  }
}
