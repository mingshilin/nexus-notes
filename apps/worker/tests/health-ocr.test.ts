import { describe, expect, it } from "vitest";

import { createBetaWorker } from "../src/bootstrap";
import type { BetaWorkerEnv } from "../src/routes/health";

function healthEnv(bindings: Record<string, unknown>): BetaWorkerEnv {
  return {
    DB: {} as D1Database,
    APP_BASE_URL: "https://beta.test",
    RATE_LIMIT_SECRET: "rate-limit-secret-at-least-32-characters",
    TURNSTILE_SECRET_KEY: "turnstile-secret",
    RESEND_API_KEY: "resend-secret",
    EMAIL_FROM: "Nexus Notes <notes@beta.test>",
    ...bindings,
  } as BetaWorkerEnv;
}

describe("OCR health capability", () => {
  it.each([
    [{}, "unconfigured"],
    [{ FILES: { get() {}, put() {} } }, "unconfigured"],
    [{ FILES: { get() {}, put() {}, delete() {} } }, "degraded"],
    [{ FILES: { get() {}, put() {}, delete() {} }, AI: {} }, "degraded"],
    [{ FILES: { get() {}, put() {}, delete() {} }, AI: { toMarkdown: async () => ({}) } }, "ready"],
  ] as const)("reports callable OCR capability with exact safe response keys", async (bindings, ocr) => {
    const response = await createBetaWorker().fetch(new Request("https://beta.test/api/v2/health"), healthEnv(bindings));

    expect(response.status).toBe(200);
    const body = await response.json() as { data: Record<string, unknown> } & Record<string, unknown>;
    expect(body.data).toEqual({ status: "ok", version: "development", ocr });
    expect(Object.keys(body.data).sort()).toEqual(["ocr", "status", "version"]);
    expect(Object.keys(body).sort()).toEqual(["data", "request_id", "success"]);
  });
});
