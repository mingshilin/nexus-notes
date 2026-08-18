import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { spawn } from "node:child_process";

const DEFAULT_URL = "https://notes.msl88ljctengxun.xyz/";

function parseArgs(argv) {
  const options = {
    url: process.env.NEXUS_NOTES_SMOKE_URL ?? DEFAULT_URL,
    headed: false,
    userDataDir: process.env.NEXUS_NOTES_SMOKE_USER_DATA_DIR,
  };

  for (const arg of argv) {
    if (arg === "--headed") options.headed = true;
    else if (arg.startsWith("--url=")) options.url = arg.slice("--url=".length);
    else if (arg.startsWith("--user-data-dir=")) options.userDataDir = arg.slice("--user-data-dir=".length);
  }

  return options;
}

function chromeCandidates() {
  const candidates = [];
  if (process.env.CHROME_PATH) candidates.push(process.env.CHROME_PATH);

  if (process.platform === "win32") {
    const roots = [process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA].filter(Boolean);
    for (const root of roots) {
      candidates.push(
        join(root, "Google", "Chrome", "Application", "chrome.exe"),
        join(root, "Microsoft", "Edge", "Application", "msedge.exe"),
      );
    }
  } else if (process.platform === "darwin") {
    candidates.push(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
    );
  } else {
    candidates.push("google-chrome-stable", "google-chrome", "microsoft-edge", "chromium", "chromium-browser");
  }

  return candidates;
}

async function commandExists(command) {
  if (command.includes("\\") || command.includes("/") || command.endsWith(".exe")) {
    const { existsSync } = await import("node:fs");
    return existsSync(command);
  }

  const probe = spawn(process.platform === "win32" ? "where.exe" : "which", [command], { stdio: "ignore" });
  return new Promise((resolve) => probe.on("exit", (code) => resolve(code === 0)));
}

async function findChromeExecutable() {
  for (const candidate of chromeCandidates()) {
    if (candidate && (await commandExists(candidate))) return candidate;
  }
  throw new Error("No Chrome/Edge executable found. Set CHROME_PATH to run the real browser smoke.");
}

function randomPort() {
  return 42000 + Math.floor(Math.random() * 10000);
}

async function fetchJson(url, attempts = 40) {
  let lastError;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
      lastError = new Error(`${response.status} ${response.statusText}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw lastError instanceof Error ? lastError : new Error(`Failed to fetch ${url}`);
}

async function createPageTarget(port, url) {
  const response = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: "PUT" });
  if (!response.ok) throw new Error(`Failed to create browser target: ${response.status} ${response.statusText}`);
  return response.json();
}

function connectCdp(wsUrl) {
  const socket = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const events = new Map();

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
      return;
    }

    if (message.method && events.has(message.method)) {
      for (const listener of events.get(message.method)) listener(message.params);
    }
  });

  const opened = new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  return {
    async send(method, params = {}) {
      await opened;
      id += 1;
      socket.send(JSON.stringify({ id, method, params }));
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    },
    once(method) {
      return new Promise((resolve) => {
        const listener = (params) => {
          events.set(method, (events.get(method) ?? []).filter((item) => item !== listener));
          resolve(params);
        };
        events.set(method, [...(events.get(method) ?? []), listener]);
      });
    },
    close() {
      socket.close();
    },
  };
}

async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text ?? "Runtime.evaluate failed");
  }
  return result.result.value;
}

async function waitFor(cdp, expression, label, timeoutMs = 12000) {
  const started = Date.now();
  let lastValue;
  while (Date.now() - started < timeoutMs) {
    lastValue = await evaluate(cdp, expression);
    if (lastValue) return lastValue;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${label} timed out; last value: ${JSON.stringify(lastValue)}`);
}

async function stopBrowser(browser) {
  if (browser.exitCode !== null) return;
  browser.kill();
  await Promise.race([
    new Promise((resolve) => browser.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 1500)),
  ]);
}

async function removeTempProfile(path) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      rmSync(path, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt === 5) {
        console.warn(`Could not remove temporary browser profile ${path}: ${error instanceof Error ? error.message : error}`);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  const chrome = await findChromeExecutable();
  const port = randomPort();
  const tempProfile = options.userDataDir ? null : mkdtempSync(join(tmpdir(), "nexus-notes-smoke-"));
  const userDataDir = options.userDataDir ?? tempProfile;

  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-extensions",
    "--window-size=390,844",
    options.headed ? "" : "--headless=new",
    "about:blank",
  ].filter(Boolean);

  const browser = spawn(chrome, args, { stdio: ["ignore", "pipe", "pipe"] });
  const stderr = [];
  browser.stderr.on("data", (chunk) => stderr.push(String(chunk)));

  try {
    await fetchJson(`http://127.0.0.1:${port}/json/version`);
    const target = await createPageTarget(port, options.url);
    const cdp = connectCdp(target.webSocketDebuggerUrl);

    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      mobile: true,
    });

    await waitFor(cdp, "document.readyState === 'complete'", "page load");
    await waitFor(cdp, "Boolean(document.body && document.body.innerText.trim())", "app text");

    const bootState = await waitFor(
      cdp,
      String.raw`(() => {
        const text = document.body.innerText || "";
        const hasAuthInputs = Boolean(document.querySelector("input[type='password'], input[type='email']"));
        if (/Daily Log|每日笔记/.test(text)) return "app";
        if (hasAuthInputs || /登录|注册|邮箱|密码|验证码/.test(text)) return "auth";
        return false;
      })()`,
      "app shell or auth screen",
    );
    if (bootState === "auth") {
      throw new Error("Daily Log smoke needs an authenticated browser profile. Re-run with --user-data-dir or NEXUS_NOTES_SMOKE_USER_DATA_DIR.");
    }

    await evaluate(
      cdp,
      String.raw`(() => {
        const openNav = [...document.querySelectorAll("button")].find((item) => /打开导航|返回列表/.test(item.getAttribute("aria-label") || ""));
        if (openNav && /打开导航/.test(openNav.getAttribute("aria-label") || "")) openNav.click();
        return true;
      })()`,
    );

    await waitFor(
      cdp,
      String.raw`(() => {
        const item = [...document.querySelectorAll("button,[role='button']")].find((node) => /每日笔记|Daily Log/.test(node.textContent || ""));
        if (!item) return false;
        item.click();
        return true;
      })()`,
      "daily navigation",
    ).catch(async (error) => {
      const diagnostic = await evaluate(
        cdp,
        String.raw`(() => ({
          title: document.title,
          hasPassword: Boolean(document.querySelector("input[type='password']")),
          text: (document.body.innerText || "").replace(/\s+/g, " ").trim().slice(0, 240),
        }))()`,
      );
      throw new Error(`${error.message}; page=${JSON.stringify(diagnostic)}`);
    });

    const visibility = await waitFor(
      cdp,
      String.raw`(() => {
        const view = document.querySelector("[data-testid='daily-note-list-view']");
        if (!view) return false;
        const cards = [...view.querySelectorAll("[role='button']")].filter((node) => {
          const rect = node.getBoundingClientRect();
          return rect.height >= 54 && (node.textContent || "").trim().length > 0;
        });
        const card = cards[0];
        if (!card) return { passed: false, reason: "no note card in Daily Log" };
        const rect = card.getBoundingClientRect();
        const visibleHeight = Math.max(0, Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0));
        const ratio = rect.height ? visibleHeight / rect.height : 0;
        return {
          passed: ratio >= 0.65 && rect.top < window.innerHeight * 0.78,
          ratio,
          top: rect.top,
          bottom: rect.bottom,
          viewport: window.innerHeight,
          text: (card.textContent || "").replace(/\s+/g, " ").trim().slice(0, 120),
        };
      })()`,
      "daily card visibility",
    );

    if (!visibility.passed) {
      throw new Error(`Daily card is not visible enough: ${JSON.stringify(visibility)}`);
    }

    console.log("daily-log-visible smoke passed");
    console.log(`browser=${basename(chrome)} url=${options.url}`);
    console.log(`visibleRatio=${visibility.ratio.toFixed(2)} top=${Math.round(visibility.top)} viewport=${visibility.viewport}`);
    cdp.close();
  } finally {
    await stopBrowser(browser);
    if (tempProfile) await removeTempProfile(tempProfile);
    if (browser.exitCode !== null && browser.exitCode !== 0 && stderr.length) {
      console.error(stderr.join("").slice(-2000));
    }
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
