import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve } from "node:path";

import { checkLocalDist } from "./verify-deploy-readiness.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const previewConfigPath = join(root, "apps", "worker", "wrangler.preview.example.toml");

function assertReady(condition, message) {
  if (!condition) throw new Error(message);
}

export function verifyPreviewConfig(config) {
  assertReady(/name\s*=\s*"nexus-notes-public-beta-preview"/.test(config), "preview: unexpected Worker name");
  assertReady(/workers_dev\s*=\s*true/.test(config), "preview: workers_dev must remain enabled");
  assertReady(/preview_urls\s*=\s*true/.test(config), "preview: preview_urls must remain enabled");
  assertReady(/main\s*=\s*"src\/index\.ts"/.test(config), "preview: Worker entry must be apps/worker/src/index.ts");
  assertReady(/directory\s*=\s*"\.\.\/web\/dist"/.test(config), "preview: assets must use the Beta web build");
  assertReady(/database_id\s*=\s*"<PREVIEW_D1_DATABASE_ID>"/.test(config), "preview: example must not contain a real D1 ID");
  assertReady(/bucket_name\s*=\s*"nexus-notes-public-beta-preview-files"/.test(config), "preview: private FILES bucket is missing");
  assertReady(/queue\s*=\s*"nexus-notes-public-beta-preview-jobs"/.test(config), "preview: JOBS queue is missing");
  assertReady(/name\s*=\s*"PRESENCE"[\s\S]*class_name\s*=\s*"PresenceRoom"/.test(config), "preview: PRESENCE Durable Object is missing");
  assertReady(/binding\s*=\s*"ANALYTICS"/.test(config), "preview: ANALYTICS binding is missing");
  assertReady(!config.includes("notes.msl88ljctengxun.xyz"), "preview: production domain leaked into preview config");
  assertReady(!/^(TURNSTILE_SECRET_KEY|RESEND_API_KEY|RATE_LIMIT_SECRET)\s*=/mu.test(config), "preview: secret value cannot be stored in config");
  return { worker: "nexus-notes-public-beta-preview", hasPlaceholderD1: true, hasStorage: true, hasQueue: true };
}

export function verifyPreviewReadiness({ configPath = previewConfigPath, distDir = join(root, "apps", "web", "dist") } = {}) {
  assertReady(existsSync(configPath), `preview: missing ${configPath}`);
  const config = readFileSync(configPath, "utf8");
  const configResult = verifyPreviewConfig(config);
  const distResult = checkLocalDist(relative(root, distDir));
  const migrations = existsSync(join(root, "apps", "worker", "migrations"))
    ? readFileSync(join(root, "apps", "worker", "migrations", "0009_task9_operations.sql"), "utf8")
    : "";
  assertReady(migrations.includes("CREATE TABLE IF NOT EXISTS beta_jobs"), "preview: Task 9 migration is missing");
  return { ...configResult, checkedAssets: distResult.checkedAssets };
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? "")) {
  try {
    const result = verifyPreviewReadiness();
    console.log("preview readiness checks passed");
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
