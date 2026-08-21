import { describe, expect, it } from "vitest";

import { createBetaWorker } from "../src/bootstrap";

describe("OCR health capability", () => {
  it.each([
    [{}, "unconfigured"],
    [{ FILES: {} }, "degraded"],
    [{ FILES: {}, AI: { toMarkdown: async () => ({}) } }, "ready"],
  ] as const)("reports %s binding availability without configuration detail", async (bindings, ocr) => {
    const response = await createBetaWorker().fetch(new Request("https://beta.test/api/v2/health"), {
      DB: {},
      APP_BASE_URL: "https://beta.test",
      RATE_LIMIT_SECRET: "rate-limit-secret-at-least-32-characters",
      TURNSTILE_SECRET_KEY: "turnstile-secret",
      RESEND_API_KEY: "resend-secret",
      EMAIL_FROM: "Nexus Notes <notes@beta.test>",
      ...bindings,
    } as any);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { status: "ok", ocr } });
  });
});
