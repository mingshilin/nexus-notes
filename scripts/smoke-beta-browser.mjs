import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const DEFAULT_URL = process.env.NEXUS_NOTES_BETA_URL ?? "http://127.0.0.1:4173/";

function parseArgs(argv) {
  const options = {
    url: DEFAULT_URL,
    headed: false,
    userDataDir: process.env.NEXUS_NOTES_BETA_USER_DATA_DIR,
  };
  for (const arg of argv) {
    if (arg === "--headed") options.headed = true;
    else if (arg.startsWith("--url=")) options.url = arg.slice("--url=".length);
    else if (arg.startsWith("--user-data-dir=")) options.userDataDir = arg.slice("--user-data-dir=".length);
  }
  return options;
}

function browserCandidates() {
  if (process.env.CHROME_PATH) return [process.env.CHROME_PATH];
  if (process.platform === "win32") {
    return [
      join(process.env.PROGRAMFILES ?? "", "Google", "Chrome", "Application", "chrome.exe"),
      join(process.env.PROGRAMFILES ?? "", "Microsoft", "Edge", "Application", "msedge.exe"),
      join(process.env.LOCALAPPDATA ?? "", "Google", "Chrome", "Application", "chrome.exe"),
      join(process.env.LOCALAPPDATA ?? "", "Microsoft", "Edge", "Application", "msedge.exe"),
    ];
  }
  return process.platform === "darwin"
    ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"]
    : ["google-chrome", "chromium", "microsoft-edge"];
}

async function commandExists(command) {
  if (command.includes("\\") || command.includes("/") || command.endsWith(".exe")) return existsSync(command);
  const probe = spawn(process.platform === "win32" ? "where.exe" : "which", [command], { stdio: "ignore" });
  return new Promise((resolve) => probe.on("exit", (code) => resolve(code === 0)));
}

async function findBrowser() {
  for (const candidate of browserCandidates()) {
    if (candidate && await commandExists(candidate)) return candidate;
  }
  throw new Error("No Chrome/Edge executable found. Set CHROME_PATH for the Beta browser gates.");
}

function port() {
  return 43000 + Math.floor(Math.random() * 5000);
}

async function fetchJson(url, attempts = 50) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
      lastError = new Error(`${response.status} ${response.statusText}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw lastError instanceof Error ? lastError : new Error(`Could not connect to ${url}`);
}

async function openTarget(debugPort, url) {
  const response = await fetch(`http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(url)}`, { method: "PUT" });
  if (!response.ok) throw new Error(`Could not open browser target: ${response.status}`);
  return response.json();
}

function connect(wsUrl) {
  const socket = new WebSocket(wsUrl);
  const pending = new Map();
  let nextId = 0;
  const opened = new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    const callback = pending.get(message.id);
    if (!callback) return;
    pending.delete(message.id);
    if (message.error) callback.reject(new Error(message.error.message));
    else callback.resolve(message.result);
  });
  return {
    async send(method, params = {}) {
      await opened;
      const id = ++nextId;
      socket.send(JSON.stringify({ id, method, params }));
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    },
    close() { socket.close(); },
  };
}

async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text ?? "Browser evaluation failed");
  return result.result.value;
}

async function waitFor(cdp, expression, label, timeoutMs = 15_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const result = await evaluate(cdp, expression);
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`${label} timed out`);
}

async function stop(browser) {
  if (browser.exitCode !== null) return;
  browser.kill();
  await Promise.race([
    new Promise((resolve) => browser.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 1_500)),
  ]);
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  const browserPath = await findBrowser();
  const debugPort = port();
  const temporaryProfile = options.userDataDir ? null : mkdtempSync(join(tmpdir(), "nexus-beta-browser-"));
  const browser = spawn(browserPath, [
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${options.userDataDir ?? temporaryProfile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--window-size=390,844",
    ...(options.headed ? [] : ["--headless=new"]),
    "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe"] });
  const errors = [];
  browser.stderr.on("data", (chunk) => errors.push(String(chunk)));
  let cdp;
  try {
    await fetchJson(`http://127.0.0.1:${debugPort}/json/version`);
    const target = await openTarget(debugPort, options.url);
    cdp = connect(target.webSocketDebuggerUrl);
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await waitFor(cdp, "document.readyState === 'complete'", "page load");
    await waitFor(cdp, "Boolean(document.body && document.body.innerText.trim())", "application shell");

    const result = await evaluate(cdp, String.raw`(() => {
      const name = (node) => (node.getAttribute("aria-label") || node.getAttribute("title") || node.textContent || "").replace(/\s+/g, " ").trim();
      const visible = (node) => {
        const style = getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      };
      const unnamedButtons = [...document.querySelectorAll("button")].filter((node) => visible(node) && !name(node)).length;
      const unnamedInputs = [...document.querySelectorAll("input,select,textarea")].filter((node) => visible(node) && !name(node) && !node.closest("[aria-hidden='true']")).length;
      const navigation = performance.getEntriesByType("navigation")[0];
      return {
        lang: document.documentElement.lang,
        viewport: window.innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        unnamedButtons,
        unnamedInputs,
        scrollOwners: [...document.querySelectorAll("[data-scroll-owner]")].filter(visible).length,
        domContentLoadedMs: navigation ? Math.round(navigation.domContentLoadedEventEnd) : null,
      };
    })()`);

    const failures = [];
    if (result.lang !== "zh-CN") failures.push(`html lang=${JSON.stringify(result.lang)}`);
    if (result.viewport !== 390) failures.push(`viewport=${result.viewport}`);
    if (result.scrollWidth > result.viewport + 1) failures.push(`horizontal overflow ${result.scrollWidth}px`);
    if (result.unnamedButtons > 0) failures.push(`${result.unnamedButtons} visible buttons without accessible names`);
    if (result.unnamedInputs > 0) failures.push(`${result.unnamedInputs} visible form controls without accessible names`);
    if (result.domContentLoadedMs !== null && result.domContentLoadedMs > 5_000) failures.push(`DOMContentLoaded ${result.domContentLoadedMs}ms`);
    if (failures.length) throw new Error(`Beta browser gates failed: ${failures.join("; ")}`);
    console.log(`beta browser gates passed: ${JSON.stringify(result)}`);
  } finally {
    cdp?.close();
    await stop(browser);
    if (temporaryProfile) {
      try { rmSync(temporaryProfile, { recursive: true, force: true }); } catch { /* best-effort profile cleanup */ }
    }
    if (browser.exitCode !== null && browser.exitCode !== 0 && errors.length) console.error(errors.join("").slice(-2000));
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
