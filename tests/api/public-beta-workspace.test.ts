import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");

function readJson(path: string) {
  return JSON.parse(readFileSync(resolve(root, path), "utf8")) as Record<string, unknown>;
}

describe("public Beta workspace", () => {
  it("declares the isolated app and package boundaries", () => {
    const packageJson = readJson("package.json");

    expect(packageJson.workspaces).toEqual(["apps/*", "packages/*"]);
    expect(readJson("apps/web/package.json").name).toBe("@nexus/web");
    expect(readJson("apps/worker/package.json").name).toBe("@nexus/worker");
    expect(readJson("packages/contracts/package.json").name).toBe("@nexus/contracts");
    expect(readJson("packages/domain/package.json").name).toBe("@nexus/domain");
    expect(readJson("packages/ui/package.json").name).toBe("@nexus/ui");
    expect(readJson("packages/testkit/package.json").name).toBe("@nexus/testkit");
  });

  it("keeps legacy checks while exposing Beta workspace gates", () => {
    const packageJson = readJson("package.json");
    const scripts = packageJson.scripts as Record<string, string>;

    expect(scripts["beta:lint"]).toBe("node scripts/run-workspace-scripts.mjs typecheck");
    expect(scripts["beta:test"]).toBe("node scripts/run-workspace-scripts.mjs test");
    expect(scripts["beta:build"]).toBe("node scripts/run-workspace-scripts.mjs build");
    expect(readJson("apps/worker/package.json").scripts).toMatchObject({
      test: "vitest run --config vitest.config.ts --maxWorkers=1 --minWorkers=1",
    });
    expect(readFileSync(resolve(root, ".github/workflows/public-beta-ci.yml"), "utf8")).toContain("npm run beta:test");
    expect(readFileSync(resolve(root, "apps/worker/wrangler.preview.example.toml"), "utf8")).toContain("nexus-notes-public-beta-preview");
  });

  it("pins PDF.js at the first non-vulnerable release", () => {
    const packageJson = readJson("package.json");
    const dependencies = packageJson.dependencies as Record<string, string>;

    expect(dependencies["pdfjs-dist"]).toBe("^6.2.108");
  });
});
