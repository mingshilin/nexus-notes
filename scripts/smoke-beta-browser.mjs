import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { spawn } from "node:child_process";

const DEFAULT_URL = process.env.NEXUS_NOTES_BETA_URL ?? "http://127.0.0.1:4173/";
const DATABASE_NAME = "nexus-notes-beta";
const PROFILE_ENV = "NEXUS_NOTES_BETA_USER_DATA_DIR";
const AVATAR_ENV = "NEXUS_NOTES_BETA_AVATAR_FILE";

function parseArgs(argv) {
  const options = {
    url: DEFAULT_URL,
    headed: false,
    requireAuth: process.env.NEXUS_NOTES_BETA_REQUIRE_AUTH === "1",
    userDataDir: process.env[PROFILE_ENV],
    avatarFile: process.env[AVATAR_ENV],
  };
  for (const arg of argv) {
    if (arg === "--headed") options.headed = true;
    else if (arg === "--require-auth") options.requireAuth = true;
    else if (arg.startsWith("--url=")) options.url = arg.slice("--url=".length);
    else if (arg.startsWith("--user-data-dir=")) options.userDataDir = arg.slice("--user-data-dir=".length);
    else if (arg.startsWith("--avatar-file=")) options.avatarFile = arg.slice("--avatar-file=".length);
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
    ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Microsoft Edge.app/Contents/MacOS/msedge"]
    : ["google-chrome", "chromium", "microsoft-edge"];
}

async function commandExists(command) {
  if (command.includes("\\") || command.includes("/") || command.endsWith(".exe")) return existsSync(command);
  const probe = spawn(process.platform === "win32" ? "where.exe" : "which", [command], { stdio: "ignore" });
  return new Promise((resolveResult) => probe.on("exit", (code) => resolveResult(code === 0)));
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

function externalPath(value, label) {
  const candidate = resolve(value);
  const remainder = relative(resolve(process.cwd()), candidate);
  const inside = !remainder || (!remainder.startsWith(".." + (process.platform === "win32" ? "\\" : "/")) && remainder !== "..");
  if (inside) throw new Error(label + " must be outside the repository");
  return candidate;
}

function printSkip(reason) {
  console.log(JSON.stringify({
    status: "SKIP",
    reason,
    requiredEnv: [PROFILE_ENV, AVATAR_ENV],
    authenticated: false,
  }));
}

async function fetchJson(url, attempts = 50) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
      lastError = new Error(response.status + " " + response.statusText);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveResult) => setTimeout(resolveResult, 100));
  }
  throw lastError instanceof Error ? lastError : new Error("Could not connect to " + url);
}

async function openTarget(debugPort, url) {
  const response = await fetch("http://127.0.0.1:" + debugPort + "/json/new?" + encodeURIComponent(url), { method: "PUT" });
  if (!response.ok) throw new Error("Could not open browser target: " + response.status);
  return response.json();
}

function connect(wsUrl) {
  const socket = new WebSocket(wsUrl);
  const pending = new Map();
  const listeners = new Map();
  let nextId = 0;
  const opened = new Promise((resolveResult, reject) => {
    socket.addEventListener("open", resolveResult, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id !== undefined) {
      const callback = pending.get(message.id);
      if (!callback) return;
      pending.delete(message.id);
      if (message.error) callback.reject(new Error(message.error.message));
      else callback.resolve(message.result);
      return;
    }
    for (const handler of listeners.get(message.method) ?? []) void handler(message.params ?? {});
  });
  return {
    async send(method, params = {}) {
      await opened;
      const id = ++nextId;
      socket.send(JSON.stringify({ id, method, params }));
      return new Promise((resolveResult, reject) => pending.set(id, { resolve: resolveResult, reject }));
    },
    on(method, handler) {
      const handlers = listeners.get(method) ?? [];
      handlers.push(handler);
      listeners.set(method, handlers);
      return () => listeners.set(method, handlers.filter((item) => item !== handler));
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
    if (await evaluate(cdp, expression)) return true;
    await new Promise((resolveResult) => setTimeout(resolveResult, 200));
  }
  throw new Error(label + " timed out");
}

async function waitForNode(predicate, label, timeoutMs = 15_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await predicate()) return true;
    await new Promise((resolveResult) => setTimeout(resolveResult, 200));
  }
  throw new Error(label + " timed out");
}

const accessibleName = "(node) => { const ids = node.getAttribute('aria-labelledby')?.split(/\\s+/) ?? []; const labelled = ids.map((id) => document.getElementById(id)?.textContent ?? '').join(' '); return (node.getAttribute('aria-label') || labelled || node.getAttribute('title') || node.textContent || '').replace(/\\s+/g, ' ').trim(); }";

// CDP locators mirror the required page.getByRole/getByLabel/getByText contract without storing a Playwright profile.
function getByRole(cdp, role, name) {
  const selector = role === "button" ? "button,[role='button']" : "[role='" + role + "']";
  const lookup = "(node) => " + accessibleName + "(node) === " + JSON.stringify(name);
  const expression = (action) => "(() => { const node = [...document.querySelectorAll(" + JSON.stringify(selector) + ")].find(" + lookup + "); if (!node) return false; " + action + " })()";
  return {
    async waitFor() {
      return waitFor(cdp, expression("const rect=node.getBoundingClientRect(); const style=getComputedStyle(node); return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;"), "role " + role + " " + name);
    },
    async click() { return waitFor(cdp, expression("node.click(); return true;"), "click role " + role + " " + name); },
    async focus() { return waitFor(cdp, expression("node.focus(); return document.activeElement === node;"), "focus role " + role + " " + name); },
    async press(key) {
      await evaluate(cdp, "(() => { const node = [...document.querySelectorAll(" + JSON.stringify(selector) + ")].find(" + lookup + "); if (!node) throw new Error('locator not found'); node.dispatchEvent(new KeyboardEvent('keydown', { key: " + JSON.stringify(key) + ", bubbles: true })); node.dispatchEvent(new KeyboardEvent('keyup', { key: " + JSON.stringify(key) + ", bubbles: true })); return true; })()");
    },
  };
}

function getByLabel(cdp, name) {
  const find = "(label) => (label.textContent || '').replace(/\\s+/g, ' ').trim().includes(" + JSON.stringify(name) + ")";
  const expression = (action) => "(() => { const label = [...document.querySelectorAll('label')].find(" + find + "); const node = label?.querySelector('input,textarea,select') || (label?.htmlFor ? document.getElementById(label.htmlFor) : null); if (!node) return false; " + action + " })()";
  return {
    async waitFor() {
      return waitFor(cdp, expression("const rect=node.getBoundingClientRect(); const style=getComputedStyle(node); return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;"), "label " + name);
    },
    async fill(value) {
      await waitFor(cdp, expression("const setter=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(node), 'value')?.set; setter?.call(node, " + JSON.stringify(value) + "); node.dispatchEvent(new Event('input', { bubbles: true })); node.dispatchEvent(new Event('change', { bubbles: true })); return true;"), "fill label " + name);
    },
    async focus() { return waitFor(cdp, expression("node.focus(); return document.activeElement === node;"), "focus label " + name); },
    async value() { return evaluate(cdp, expression("return node.value;")); },
  };
}

function getByText(cdp, text) {
  const expression = "(() => Boolean([...document.querySelectorAll('*')].find((node) => (node.textContent || '').replace(/\\s+/g, ' ').trim() === " + JSON.stringify(text) + ")))()";
  return { async waitFor() { return waitFor(cdp, expression, "text " + text); } };
}

async function setFileInput(cdp, filePath) {
  await cdp.send("DOM.enable");
  const documentResult = await cdp.send("DOM.getDocument", { depth: -1 });
  const node = await cdp.send("DOM.querySelector", { nodeId: documentResult.root.nodeId, selector: "input[type=file]" });
  if (!node.nodeId) throw new Error("Avatar file input not found");
  await cdp.send("DOM.setFileInputFiles", { nodeId: node.nodeId, files: [filePath] });
}

function networkEvidence(cdp) {
  const requests = [];
  const responses = [];
  cdp.on("Network.requestWillBeSent", (event) => {
    const url = new URL(event.request.url);
    if (url.pathname.includes("/api/v2/notes") || url.pathname.includes("/api/v2/profile")) {
      requests.push({ id: event.requestId, url: url.pathname, method: event.request.method, headers: event.request.headers, postData: event.request.postData });
    }
  });
  cdp.on("Network.responseReceived", (event) => {
    const url = new URL(event.response.url);
    if (url.pathname.includes("/api/v2/profile")) responses.push({ url: url.pathname, status: event.response.status, headers: event.response.headers });
  });
  return { requests, responses };
}

function header(headers, name) {
  return Object.entries(headers ?? {}).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1] ?? "";
}

async function readDraft(cdp, title) {
  const expression = "(() => new Promise((resolveResult, reject) => { const request = indexedDB.open(" + JSON.stringify(DATABASE_NAME) + ", 1); request.onerror = () => reject(request.error || new Error('IndexedDB open failed')); request.onsuccess = () => { const db=request.result; const read=db.transaction('drafts', 'readonly').objectStore('drafts').getAll(); read.onerror=()=>reject(read.error || new Error('draft read failed')); read.onsuccess=()=>{ const item=read.result.find((draft)=>draft.title===" + JSON.stringify(title) + "); db.close(); resolveResult(item ? { entityId:item.entity_id, generation:item.draft_generation ?? 0 } : null); }; }; }))()";
  return evaluate(cdp, expression);
}

async function installLostResponseFault(cdp) {
  const state = { responseFailed: false };
  const removeListener = cdp.on("Fetch.requestPaused", async (event) => {
    const url = new URL(event.request.url);
    const write = ["POST", "PATCH", "PUT"].includes(event.request.method) && url.pathname.includes("/api/v2/notes");
    if (write && event.responseStatusCode !== undefined && !state.responseFailed) {
      state.responseFailed = true;
      await cdp.send("Fetch.failRequest", { requestId: event.requestId, errorReason: "Failed" });
      return;
    }
    await cdp.send("Fetch.continueRequest", { requestId: event.requestId });
  });
  await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*/*", requestStage: "Request" }, { urlPattern: "*/*", requestStage: "Response" }] });
  return { state, async close() { removeListener(); await cdp.send("Fetch.disable"); } };
}

async function runPublicShell(cdp) {
  await waitFor(cdp, "document.readyState === 'complete'", "page load");
  await waitFor(cdp, "Boolean(document.body && document.body.innerText.trim())", "application shell");
  const result = await evaluate(cdp, "(() => { const visible=(node)=>{const style=getComputedStyle(node);const rect=node.getBoundingClientRect();return style.display!=='none'&&style.visibility!=='hidden'&&rect.width>0&&rect.height>0;}; const name=" + accessibleName + "; const navigation=performance.getEntriesByType('navigation')[0]; return {lang:document.documentElement.lang,viewport:window.innerWidth,devicePixelRatio:window.devicePixelRatio,scrollWidth:document.documentElement.scrollWidth,unnamedButtons:[...document.querySelectorAll('button')].filter((node)=>visible(node)&&!name(node)).length,unnamedInputs:[...document.querySelectorAll('input,select,textarea')].filter((node)=>visible(node)&&!name(node)&&!node.closest('[aria-hidden=\\\"true\\\"]')).length,domContentLoadedMs:navigation?Math.round(navigation.domContentLoadedEventEnd):null}; })()");
  const failures = [];
  if (result.lang !== "zh-CN") failures.push("html lang=" + JSON.stringify(result.lang));
  if (result.viewport !== 390) failures.push("viewport=" + result.viewport);
  if (result.devicePixelRatio !== 2) failures.push("devicePixelRatio=" + result.devicePixelRatio);
  if (result.scrollWidth > result.viewport + 1) failures.push("horizontal overflow " + result.scrollWidth + "px");
  if (result.unnamedButtons > 0) failures.push(result.unnamedButtons + " visible buttons without accessible names");
  if (result.unnamedInputs > 0) failures.push(result.unnamedInputs + " visible form controls without accessible names");
  if (result.domContentLoadedMs !== null && result.domContentLoadedMs > 5000) failures.push("DOMContentLoaded " + result.domContentLoadedMs + "ms");
  if (failures.length) throw new Error("Beta browser shell gates failed: " + failures.join("; "));
  return result;
}

async function runAuthenticated(cdp, debugPort, options, evidence) {
  await getByRole(cdp, "button", "新建笔记").waitFor();
  await getByRole(cdp, "button", "新建笔记").click();
  const title = "Phase 1 " + Date.now();
  await getByLabel(cdp, "笔记标题").fill(title);
  await getByLabel(cdp, "笔记内容").fill("IndexedDB recovery " + title);
  const fault = await installLostResponseFault(cdp);
  try {
    await waitForNode(() => fault.state.responseFailed, "lost save response", 20_000);
  } finally {
    await fault.close();
  }
  await waitForNode(async () => Boolean(await readDraft(cdp, title)), "IndexedDB draft persistence", 20_000);
  const draft = await readDraft(cdp, title);
  if (!draft) throw new Error("IndexedDB draft was not found after failed save");
  await cdp.send("Page.reload", { ignoreCache: true });
  await waitFor(cdp, "document.readyState === 'complete'", "reload after failed save");
  await waitFor(cdp, "document.querySelector(\"input[aria-label='笔记标题']\")?.value === " + JSON.stringify(title), "IndexedDB draft reload", 30_000);

  const keys = new Map();
  for (const request of evidence.requests.filter(({ url, method }) => url.includes("/api/v2/notes") && ["POST", "PATCH", "PUT"].includes(method))) {
    const key = header(request.headers, "idempotency-key");
    if (key) keys.set(key, (keys.get(key) ?? 0) + 1);
  }
  const replay = [...keys.entries()].find(([, count]) => count >= 2);
  if (!replay) throw new Error("Live idempotency crash/replay evidence missing");

  await getByRole(cdp, "button", "账户").click();
  await getByRole(cdp, "menuitem", "个人中心").click();
  await getByRole(cdp, "tab", "个人资料").waitFor();
  await getByLabel(cdp, "昵称").fill(title);
  await getByRole(cdp, "button", "保存个人资料").click();
  await waitForNode(() => evidence.requests.some(({ url, method }) => url === "/api/v2/profile" && method === "PATCH"), "profile update request", 20_000);
  await cdp.send("Page.reload", { ignoreCache: true });
  await waitFor(cdp, "document.readyState === 'complete'", "profile reload");
  await getByRole(cdp, "button", "账户").click();
  await getByRole(cdp, "menuitem", "个人中心").click();
  await getByRole(cdp, "tab", "个人资料").waitFor();
  await Promise.race([getByText(cdp, title).waitFor(), getByLabel(cdp, "昵称").waitFor()]);

  await setFileInput(cdp, externalPath(options.avatarFile, AVATAR_ENV));
  await getByRole(cdp, "button", "上传头像").click();
  await waitForNode(() => evidence.requests.some(({ url, method }) => url.includes("/profile/avatar") && method === "POST"), "raw avatar request", 20_000);
  const avatarRequest = evidence.requests.find(({ url, method }) => url.includes("/profile/avatar") && method === "POST");
  const avatarResponse = evidence.responses.find(({ url }) => url.includes("/profile/avatar"));
  if (!avatarRequest || !/^image\/(png|jpeg|webp)$/i.test(header(avatarRequest.headers, "content-type"))) throw new Error("Avatar request was not raw image File transport");
  if (avatarRequest.postData?.startsWith("data:") || avatarRequest.postData?.includes("base64")) throw new Error("Avatar request used a base64 substitute");
  if (!avatarResponse || !/(private|no-store)/i.test(header(avatarResponse.headers, "cache-control"))) throw new Error("Avatar response is missing private/no-store cache control");

  await getByRole(cdp, "tab", "个人资料").focus();
  await getByRole(cdp, "tab", "个人资料").press("ArrowRight");
  if (!await evaluate(cdp, "document.activeElement?.textContent?.trim() === '安全'")) throw new Error("Account tab focus did not move with ArrowRight");
  await getByRole(cdp, "button", "账户").click();
  await evaluate(cdp, "document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); true");
  if (!await evaluate(cdp, "document.activeElement?.getAttribute('aria-label') === '账户' && document.querySelector('[role=menu]') === null")) throw new Error("Account menu focus was not restored after Escape");

  if (await evaluate(cdp, "Boolean(document.querySelector('button[aria-label=\\\"打开检查器\\\"]'))")) {
    await getByRole(cdp, "button", "打开检查器").click();
    await getByRole(cdp, "dialog", "检查器").waitFor();
    await getByRole(cdp, "button", "关闭检查器").click();
    if (await evaluate(cdp, "Boolean(document.querySelector('[role=dialog][aria-label=\\\"检查器\\\"]'))")) throw new Error("Inspector modal did not close");
  }
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 500, deviceScaleFactor: 2, mobile: true });
  const editor = getByLabel(cdp, "笔记内容");
  await editor.waitFor();
  await editor.focus();
  await cdp.send("Input.insertText", { text: " mobile keyboard" });
  const mobile = await evaluate(cdp, "(() => { const node=document.querySelector(\"textarea[aria-label='笔记内容']\"); const rect=node?.getBoundingClientRect(); return {focused:document.activeElement===node,inserted:node?.value.includes('mobile keyboard')===true,bottom:rect?.bottom??0,viewport:window.innerHeight}; })()");
  if (!mobile.focused || !mobile.inserted || mobile.bottom > mobile.viewport) throw new Error("Mobile keyboard/focus gate failed: " + JSON.stringify(mobile));
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

  const secondTarget = await openTarget(debugPort, options.url);
  const second = connect(secondTarget.webSocketDebuggerUrl);
  try {
    await second.send("Runtime.enable");
    await waitFor(second, "document.readyState === 'complete'", "second tab");
    const blockedName = "task12-multitab-" + Date.now();
    await evaluate(second, "window.__task12Db=await new Promise((resolveResult,reject)=>{const request=indexedDB.open(" + JSON.stringify(blockedName) + ",1);request.onerror=()=>reject(request.error);request.onsuccess=()=>resolveResult(request.result);});true");
    await evaluate(cdp, "window.__task12Delete={blocked:false,done:false};const request=indexedDB.deleteDatabase(" + JSON.stringify(blockedName) + ");request.onblocked=()=>window.__task12Delete.blocked=true;request.onsuccess=()=>window.__task12Delete.done=true;true");
    await waitFor(cdp, "window.__task12Delete?.blocked===true", "blocked IndexedDB deletion");
    await evaluate(second, "window.__task12Db.close();true");
    await waitFor(cdp, "window.__task12Delete?.done===true", "IndexedDB deletion recovery");
  } finally {
    second.close();
  }
  return { title, draft, replay: { idempotencyKey: replay[0], attempts: replay[1] }, avatar: { endpoint: avatarRequest.url, contentType: header(avatarRequest.headers, "content-type"), cacheControl: header(avatarResponse.headers, "cache-control") }, mobile, indexedDb: { blocked: true, recovered: true } };
}

async function stop(browser) {
  if (browser.exitCode !== null) return;
  browser.kill();
  await Promise.race([
    new Promise((resolveResult) => browser.once("exit", resolveResult)),
    new Promise((resolveResult) => setTimeout(resolveResult, 1_500)),
  ]);
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  const authReady = Boolean(options.userDataDir && options.avatarFile);
  if (options.requireAuth && !authReady) {
    printSkip(options.userDataDir ? "AVATAR_FIXTURE_UNSET" : "AUTH_FIXTURE_UNSET");
    process.exitCode = 2;
    return;
  }
  if (options.userDataDir) options.userDataDir = externalPath(options.userDataDir, PROFILE_ENV);
  if (options.avatarFile && !existsSync(resolve(options.avatarFile))) throw new Error(AVATAR_ENV + " does not exist");
  const browserPath = await findBrowser();
  const debugPort = port();
  const temporaryProfile = options.userDataDir ? null : mkdtempSync(join(tmpdir(), "nexus-beta-browser-"));
  const browser = spawn(browserPath, [
    "--remote-debugging-port=" + debugPort,
    "--user-data-dir=" + (options.userDataDir ?? temporaryProfile),
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
    await fetchJson("http://127.0.0.1:" + debugPort + "/json/version");
    const target = await openTarget(debugPort, options.url);
    cdp = connect(target.webSocketDebuggerUrl);
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Network.enable");
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    const evidence = networkEvidence(cdp);
    console.log(JSON.stringify({ status: "PASS", scenario: "public-shell", evidence: await runPublicShell(cdp) }));
    if (!authReady) {
      printSkip("AUTH_FIXTURE_UNSET");
      if (options.requireAuth) process.exitCode = 2;
      return;
    }
    console.log(JSON.stringify({ status: "PASS", scenario: "authenticated-phase1", evidence: await runAuthenticated(cdp, debugPort, options, evidence) }));
  } finally {
    cdp?.close();
    await stop(browser);
    if (temporaryProfile) {
      try { rmSync(temporaryProfile, { recursive: true, force: true }); } catch { /* best effort */ }
    }
    if (browser.exitCode !== null && browser.exitCode !== 0 && errors.length) console.error(errors.join("").slice(-2000));
  }
}

run().catch((error) => {
  console.error(JSON.stringify({ status: "FAIL", reason: error instanceof Error ? error.message : String(error) }));
  process.exit(1);
});
