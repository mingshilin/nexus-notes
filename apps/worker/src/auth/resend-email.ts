export interface EmailLogger {
  log(message: string): void;
}

export class ResendEmailSender {
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly appBaseUrl: string,
    fetchImpl: typeof fetch = fetch,
    private readonly logger: EmailLogger = console,
  ) {
    this.fetchImpl = fetchImpl.bind(globalThis);
  }

  sendVerification(email: string, code: string) {
    return this.send({
      to: email,
      subject: "验证你的 Nexus Notes 邮箱",
      text: `你的验证码是 ${code}。验证码将在 15 分钟后失效。`,
    });
  }

  sendPasswordReset(email: string, token: string) {
    const url = new URL("/reset-password", this.appBaseUrl);
    url.searchParams.set("reset_token", token);
    return this.send({
      to: email,
      subject: "重置你的 Nexus Notes 密码",
      text: `请在 30 分钟内打开以下链接重置密码：${url.toString()}`,
    });
  }

  private async send(message: { to: string; subject: string; text: string }) {
    if (!this.apiKey) throw new Error("RESEND_API_KEY is not configured");
    let response: Response;
    try {
      response = await this.fetchImpl("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ from: this.from, ...message }),
      });
    } catch {
      this.emitDiagnostic({ outcome: "failure", failure: "network_error" });
      throw new Error("Email delivery failed");
    }
    if (!response.ok) {
      this.emitDiagnostic({ outcome: "failure", status: response.status });
      throw new Error(`Email delivery failed with status ${response.status}`);
    }
  }

  private emitDiagnostic(result: { outcome: "failure"; status?: number; failure?: string }) {
    try {
      this.logger.log(JSON.stringify({
        type: "email.delivery",
        provider: "resend",
        ...(result.status !== undefined ? { status: result.status } : {}),
        outcome: result.outcome,
        ...(result.failure ? { failure: result.failure } : {}),
      }));
    } catch {
      // Diagnostics must never change the delivery result.
    }
  }
}
