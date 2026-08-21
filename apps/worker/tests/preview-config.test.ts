import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("preview Worker configuration", () => {
  it("dispatches API requests to the Worker before the SPA asset fallback", () => {
    const config = readFileSync(resolve(process.cwd(), "wrangler.preview.example.toml"), "utf8");
    const assets = config.match(/\[assets\]([\s\S]*?)(?=\n\[|$)/)?.[1] ?? "";

    expect(assets).toContain('binding = "ASSETS"');
    expect(assets).toContain('not_found_handling = "single-page-application"');
    expect(assets).toContain('run_worker_first = ["/api/*"]');
  });

  it("redrives stale OCR jobs and pending outbox rows every minute", () => {
    const config = readFileSync(resolve(process.cwd(), "wrangler.preview.example.toml"), "utf8");
    const triggers = config.match(/\[triggers\]([\s\S]*?)(?=\n\[|$)/)?.[1] ?? "";

    expect(triggers).toContain('crons = ["*/1 * * * *"]');
  });

  it("declares the native Workers AI binding without a secret value", () => {
    const config = readFileSync(resolve(process.cwd(), "wrangler.preview.example.toml"), "utf8");
    const aiSection = config.match(/^\[ai\]\r?\n([\s\S]*?)(?=^\[|\z)/m)?.[1];

    expect(aiSection).toContain('binding = "AI"');
    expect(config).not.toMatch(/AI(?:_|_API)?(?:KEY|TOKEN|SECRET)\s*=/i);
  });
});
