import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";

const DEFAULT_DIST_DIR = "dist";
const INITIAL_CHUNK_BUDGET_BYTES = 500 * 1024;
const FORBIDDEN_INITIAL_CHUNKS = ["markdown-vendor", "ocr-vendor"];
const TURNSTILE_SITE_KEY_PATTERN = /0x4[A-Za-z0-9_-]{20,}/g;
const REQUIRED_SECURITY_HEADERS = [
  "content-security-policy",
  "strict-transport-security",
  "x-content-type-options",
  "referrer-policy",
  "permissions-policy",
  "x-frame-options",
];

function parseArgs(argv) {
  const options = {
    distDir: DEFAULT_DIST_DIR,
    online: false,
    url: undefined,
    turnstileSiteKey: undefined,
  };

  for (const arg of argv) {
    if (arg === "--online") options.online = true;
    else if (arg.startsWith("--dist=")) options.distDir = arg.slice("--dist=".length);
    else if (arg.startsWith("--url=")) options.url = arg.slice("--url=".length);
    else if (arg.startsWith("--turnstile-site-key=")) options.turnstileSiteKey = arg.slice("--turnstile-site-key=".length);
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

export function extractTurnstileSiteKeys(source) {
  return [...new Set(source.match(TURNSTILE_SITE_KEY_PATTERN) ?? [])];
}

export function assertTurnstileBundle(files, expectedSiteKey, sourceLabel) {
  const keys = [...new Set(files.flatMap(({ source }) => extractTurnstileSiteKeys(source)))];

  assertReadiness(
    keys.length > 0,
    `${sourceLabel}: bundle does not contain a Turnstile site key`,
  );
  assertReadiness(
    keys.includes(expectedSiteKey),
    `${sourceLabel}: bundle does not contain the configured Turnstile site key`,
  );

  const staleKeys = keys.filter((key) => key !== expectedSiteKey);
  assertReadiness(
    staleKeys.length === 0,
    `${sourceLabel}: bundle contains stale Turnstile site key(s)`,
  );

  return { keys };
}

function collectLocalJavaScriptFiles(distDir) {
  const root = join(process.cwd(), distDir);
  const files = [];

  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const filePath = join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(filePath);
      } else if (/\.m?js$/i.test(entry.name)) {
        files.push({
          path: filePath.slice(root.length + 1).replaceAll("\\", "/"),
          source: readFileSync(filePath, "utf8"),
        });
      }
    }
  }

  visit(root);
  return files;
}

const JAVASCRIPT_REFERENCE_PATTERN = /["'`]([^"'`]+\.m?js(?:[?#][^"'`]*)?)["'`]/gi;

function extractJavaScriptReferences(source) {
  return [...source.matchAll(JAVASCRIPT_REFERENCE_PATTERN)].map((match) => match[1]);
}

function resolveRemoteAssetUrl(reference, assetUrl) {
  const normalizedReference = reference.startsWith("assets/") ? `/${reference}` : reference;
  const resolved = new URL(normalizedReference, assetUrl);
  if (resolved.pathname.startsWith("/assets/assets/")) {
    resolved.pathname = resolved.pathname.slice("/assets".length);
  }
  return resolved;
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

function checkSecurityHeaders(response, sourceLabel) {
  for (const name of REQUIRED_SECURITY_HEADERS) {
    assertReadiness(response.headers.get(name), `${sourceLabel}: missing security header ${name}`);
  }
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

export function checkLocalDist(distDir = DEFAULT_DIST_DIR, { turnstileSiteKey } = {}) {
  const indexPath = join(process.cwd(), distDir, "index.html");
  assertReadiness(existsSync(indexPath), `local: ${indexPath} does not exist; run npm run build first`);

  const html = readFileSync(indexPath, "utf8");
  const assets = extractInitialAssets(html);

  assertReadiness(assets.scripts.length > 0, "local: index.html has no module entry script");
  checkInitialAssetNames(assets, "local");
  checkLocalAssetSizes(distDir, assets, "local");
  if (turnstileSiteKey) {
    assertTurnstileBundle(collectLocalJavaScriptFiles(distDir), turnstileSiteKey, "local");
  }

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

function readConfiguredTurnstileSiteKey() {
  const direct = process.env.NEXUS_NOTES_TURNSTILE_SITE_KEY ?? process.env.VITE_TURNSTILE_SITE_KEY;
  if (direct?.trim()) return direct.trim();

  for (const filePath of [
    ".env.local",
    ".env.production",
    ".env",
    join("apps", "web", ".env.local"),
    join("apps", "web", ".env.production"),
  ]) {
    if (!existsSync(filePath)) continue;
    const source = readFileSync(filePath, "utf8");
    const match = source.match(/^VITE_TURNSTILE_SITE_KEY\s*=\s*["']?([^"'\r\n]*)/mu);
    if (match?.[1]?.trim()) return match[1].trim();
  }

  return undefined;
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

async function collectRemoteJavaScript(baseUrl, initialAssets) {
  const queue = initialAssets.map((asset) => new URL(asset, baseUrl));
  const visited = new Set();
  const files = [];

  while (queue.length > 0) {
    const assetUrl = queue.shift();
    const assetKey = assetUrl.href;
    if (visited.has(assetKey)) continue;
    visited.add(assetKey);

    if (assetUrl.origin !== baseUrl.origin || !assetUrl.pathname.startsWith("/assets/")) continue;
    const response = await fetchWithTimeout(assetUrl);
    assertReadiness(response.ok, `online: failed to fetch ${assetUrl} (${response.status})`);
    assertReadiness(
      !response.headers.get("content-type")?.toLowerCase().startsWith("text/html"),
      `online: asset reference returned HTML instead of JavaScript: ${assetUrl}`,
    );
    const source = await response.text();
    files.push({ path: assetUrl.pathname, source });

    for (const reference of extractJavaScriptReferences(source)) {
      const referenceUrl = resolveRemoteAssetUrl(reference, assetUrl);
      if (
        referenceUrl.origin === baseUrl.origin
        && referenceUrl.pathname.startsWith("/assets/")
        && /\.js$/i.test(referenceUrl.pathname)
        && !visited.has(referenceUrl.href)
      ) {
        queue.push(referenceUrl);
      }
    }
  }

  return files;
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

export async function checkRemoteDeploy(baseUrl, { turnstileSiteKey } = {}) {
  assertReadiness(baseUrl, "online: deploy URL is required");

  const normalizedBaseUrl = new URL(baseUrl);
  const htmlResponse = await fetchWithTimeout(normalizedBaseUrl);
  assertReadiness(htmlResponse.ok, `online: failed to fetch ${normalizedBaseUrl} (${htmlResponse.status})`);
  checkSecurityHeaders(htmlResponse, "online");
  const html = await htmlResponse.text();
  const assets = extractInitialAssets(html);

  assertReadiness(assets.scripts.length > 0, "online: HTML has no module entry script");
  checkInitialAssetNames(assets, "online");
  await checkRemoteAssetSizes(normalizedBaseUrl, assets, "online");
  if (turnstileSiteKey) {
    assertTurnstileBundle(
      await collectRemoteJavaScript(normalizedBaseUrl, assets.initialJs),
      turnstileSiteKey,
      "online",
    );
  }

  const healthCandidates = ["/api/v2/health", "/api/health/turnstile"];
  let healthPath;
  let healthResponse;
  for (const candidate of healthCandidates) {
    const response = await fetchWithTimeout(new URL(candidate, normalizedBaseUrl));
    if (response.ok) {
      healthPath = candidate;
      healthResponse = response;
      break;
    }
  }
  assertReadiness(healthResponse, `online: health endpoint failed (${healthCandidates.join(" or ")})`);
  checkSecurityHeaders(healthResponse, "online");
  const health = await healthResponse.json();
  assertReadiness(health?.success === true, "online: health endpoint did not return success=true");
  if (healthPath === "/api/v2/health") {
    assertReadiness(health?.data?.status === "ok", "online: Beta health endpoint did not report status=ok");
  } else {
    assertReadiness(typeof health?.data?.configured === "boolean", "online: health endpoint missing configured flag");
  }

  const healthDetails = healthPath === "/api/v2/health"
    ? {
        healthStatus: health.data.status ?? undefined,
        healthOcr: health.data.ocr ?? undefined,
      }
    : {
        healthConfigured: health.data.configured === true,
        healthStatus: health.data.status ?? undefined,
      };

  return {
    label: "online",
    checkedAssets: assets.initialJs,
    healthPath,
    ...healthDetails,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const turnstileSiteKey = options.turnstileSiteKey ?? readConfiguredTurnstileSiteKey();
  if (!turnstileSiteKey) {
    console.warn("deploy readiness: Turnstile bundle key check skipped; configure VITE_TURNSTILE_SITE_KEY");
  }

  const results = [checkLocalDist(options.distDir, { turnstileSiteKey })];

  if (options.online) {
    const baseUrl = options.url ?? process.env.NEXUS_NOTES_DEPLOY_URL ?? readDeployUrlFromWrangler();
    results.push(await checkRemoteDeploy(baseUrl, { turnstileSiteKey }));
  }

  for (const result of results) {
    const assets = result.checkedAssets.map((asset) => `  - ${asset}`).join("\n");
    console.log(`${result.label}: deploy readiness checks passed`);
    console.log(assets);
    if ("healthConfigured" in result) {
      console.log(`  - ${result.healthPath} configured=${result.healthConfigured}${result.healthStatus ? ` status=${result.healthStatus}` : ""}`);
    } else if ("healthOcr" in result) {
      console.log(`  - ${result.healthPath} status=${result.healthStatus ?? "unknown"}${result.healthOcr ? ` ocr=${result.healthOcr}` : ""}`);
    }
  }
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
