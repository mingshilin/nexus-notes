import { existsSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";

const DEFAULT_DIST_DIR = "dist";
const INITIAL_CHUNK_BUDGET_BYTES = 500 * 1024;
const FORBIDDEN_INITIAL_CHUNKS = ["markdown-vendor", "ocr-vendor"];

function parseArgs(argv) {
  const options = {
    distDir: DEFAULT_DIST_DIR,
    online: false,
    url: undefined,
  };

  for (const arg of argv) {
    if (arg === "--online") options.online = true;
    else if (arg.startsWith("--dist=")) options.distDir = arg.slice("--dist=".length);
    else if (arg.startsWith("--url=")) options.url = arg.slice("--url=".length);
  }

  return options;
}

function getAttribute(tag, name) {
  const pattern = new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, "i");
  return tag.match(pattern)?.[1];
}

export function extractInitialAssets(html) {
  const scripts = Array.from(html.matchAll(/<script\b[^>]*>/gi))
    .filter(([tag]) => getAttribute(tag, "type") === "module")
    .map(([tag]) => getAttribute(tag, "src"))
    .filter(Boolean);

  const modulePreloads = Array.from(html.matchAll(/<link\b[^>]*>/gi))
    .filter(([tag]) => getAttribute(tag, "rel") === "modulepreload")
    .map(([tag]) => getAttribute(tag, "href"))
    .filter(Boolean);

  return {
    scripts,
    modulePreloads,
    initialJs: [...scripts, ...modulePreloads],
  };
}

function assertReadiness(condition, message) {
  if (!condition) throw new Error(message);
}

function checkInitialAssetNames(assets, sourceLabel) {
  const offenders = assets.initialJs.filter((asset) =>
    FORBIDDEN_INITIAL_CHUNKS.some((chunkName) => asset.includes(chunkName)),
  );

  assertReadiness(
    offenders.length === 0,
    `${sourceLabel}: forbidden lazy chunks are initial assets: ${offenders.join(", ")}`,
  );
}

function checkLocalAssetSizes(distDir, assets, sourceLabel) {
  for (const asset of assets.initialJs) {
    const normalized = asset.replace(/^\//, "");
    const filePath = join(process.cwd(), distDir, normalized);
    assertReadiness(existsSync(filePath), `${sourceLabel}: missing initial asset ${asset}`);
    const { size } = statSync(filePath);
    assertReadiness(
      size <= INITIAL_CHUNK_BUDGET_BYTES,
      `${sourceLabel}: ${asset} is ${size} bytes, over ${INITIAL_CHUNK_BUDGET_BYTES} bytes`,
    );
  }
}

export function checkLocalDist(distDir = DEFAULT_DIST_DIR) {
  const indexPath = join(process.cwd(), distDir, "index.html");
  assertReadiness(existsSync(indexPath), `local: ${indexPath} does not exist; run npm run build first`);

  const html = readFileSync(indexPath, "utf8");
  const assets = extractInitialAssets(html);

  assertReadiness(assets.scripts.length > 0, "local: index.html has no module entry script");
  checkInitialAssetNames(assets, "local");
  checkLocalAssetSizes(distDir, assets, "local");

  return {
    label: "local",
    checkedAssets: assets.initialJs,
  };
}

function readDeployUrlFromWrangler() {
  const wranglerPath = join(process.cwd(), "wrangler.toml");
  if (!existsSync(wranglerPath)) return undefined;
  const wrangler = readFileSync(wranglerPath, "utf8");
  return wrangler.match(/APP_BASE_URL\s*=\s*"([^"]+)"/)?.[1];
}

async function fetchWithTimeout(url, init = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function checkRemoteAssetSizes(baseUrl, assets, sourceLabel) {
  for (const asset of assets.initialJs) {
    const assetUrl = new URL(asset, baseUrl);
    const response = await fetchWithTimeout(assetUrl);
    assertReadiness(response.ok, `${sourceLabel}: failed to fetch ${assetUrl} (${response.status})`);
    const bytes = (await response.arrayBuffer()).byteLength;
    assertReadiness(
      bytes <= INITIAL_CHUNK_BUDGET_BYTES,
      `${sourceLabel}: ${assetUrl.pathname} is ${bytes} bytes, over ${INITIAL_CHUNK_BUDGET_BYTES} bytes`,
    );
  }
}

export async function checkRemoteDeploy(baseUrl) {
  assertReadiness(baseUrl, "online: deploy URL is required");

  const normalizedBaseUrl = new URL(baseUrl);
  const htmlResponse = await fetchWithTimeout(normalizedBaseUrl);
  assertReadiness(htmlResponse.ok, `online: failed to fetch ${normalizedBaseUrl} (${htmlResponse.status})`);
  const html = await htmlResponse.text();
  const assets = extractInitialAssets(html);

  assertReadiness(assets.scripts.length > 0, "online: HTML has no module entry script");
  checkInitialAssetNames(assets, "online");
  await checkRemoteAssetSizes(normalizedBaseUrl, assets, "online");

  const healthUrl = new URL("/api/health/turnstile", normalizedBaseUrl);
  const healthResponse = await fetchWithTimeout(healthUrl);
  assertReadiness(healthResponse.ok, `online: health endpoint failed (${healthResponse.status})`);
  const health = await healthResponse.json();
  assertReadiness(health?.success === true, "online: health endpoint did not return success=true");
  assertReadiness(typeof health?.data?.configured === "boolean", "online: health endpoint missing configured flag");

  return {
    label: "online",
    checkedAssets: assets.initialJs,
    healthConfigured: health.data.configured,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const results = [checkLocalDist(options.distDir)];

  if (options.online) {
    const baseUrl = options.url ?? process.env.NEXUS_NOTES_DEPLOY_URL ?? readDeployUrlFromWrangler();
    results.push(await checkRemoteDeploy(baseUrl));
  }

  for (const result of results) {
    const assets = result.checkedAssets.map((asset) => `  - ${asset}`).join("\n");
    console.log(`${result.label}: deploy readiness checks passed`);
    console.log(assets);
    if ("healthConfigured" in result) {
      console.log(`  - /api/health/turnstile configured=${result.healthConfigured}`);
    }
  }
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
