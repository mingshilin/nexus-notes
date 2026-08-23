import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("Public Beta build contract", () => {
  it("builds and verifies the same apps/web output that Preview deploys", () => {
    const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    const deployReadiness = readFileSync(resolve(root, "scripts/verify-deploy-readiness.mjs"), "utf8");
    const viteConfig = readFileSync(resolve(root, "apps/web/vite.config.ts"), "utf8");

    expect(packageJson.scripts.build).toBe("npm run beta:build");
    expect(packageJson.scripts.lint).toContain("npm run beta:lint");
    expect(packageJson.scripts["verify:deploy"]).toContain("--dist=apps/web/dist");
    expect(packageJson.scripts["verify:deploy:online"]).toContain("--dist=apps/web/dist");
    expect(deployReadiness).toContain('const DEFAULT_DIST_DIR = "apps/web/dist"');
    expect(viteConfig).toContain("manualChunks");
    expect(viteConfig).toContain("chunkSizeWarningLimit: 500");
  });
});
