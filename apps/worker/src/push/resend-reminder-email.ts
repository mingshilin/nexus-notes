export class ResendReminderEmailSender {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async send(input: { to: string; subject: string; text: string }) {
    const response = await this.fetcher("https://api.resend.com/emails", {
      method: "POST",
      redirect: "error",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ from: this.from, to: [input.to], subject: input.subject, text: input.text }),
    });
    if (!response.ok) throw new Error(`REMINDER_EMAIL_${response.status}`);
  }
}
