import { existsSync, mkdtempSync, realpathSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const DEFAULT_URL = process.env.NEXUS_NOTES_BETA_URL ?? "http://127.0.0.1:4173/";
const DATABASE_NAME = "nexus-notes-beta";
const PROFILE_ENV = "NEXUS_NOTES_BETA_USER_DATA_DIR";
const AVATAR_ENV = "NEXUS_NOTES_BETA_AVATAR_FILE";
export const INSPECTOR_INERT_NAVIGATION_SELECTOR = "nav[aria-label='移动端主导航'][inert], nav[aria-label='主导航'][inert], [role='navigation'][inert]";
const MOBILE_LAYOUT_METRICS = { width: 390, height: 844, deviceScaleFactor: 2, mobile: true };
const MOBILE_KEYBOARD_METRICS = { ...MOBILE_LAYOUT_METRICS, viewport: { x: 0, y: 0, width: 390, height: 500, scale: 1 } };

export function parseArgs(argv) {
  const options = {
    url: DEFAULT_URL,
    headed: false,
    publicShell: false,
    authenticated: false,
    cleanupRecovery: false,
    authModeExplicit: process.env.NEXUS_NOTES_BETA_REQUIRE_AUTH === "1",
    requireAuth: process.env.NEXUS_NOTES_BETA_REQUIRE_AUTH !== "0",
    userDataDir: process.env[PROFILE_ENV],
    avatarFile: process.env[AVATAR_ENV],
  };
  for (const arg of argv) {
    if (arg === "--headed") options.headed = true;
    else if (arg === "--require-auth") { options.requireAuth = true; options.authModeExplicit = true; }
    else if (arg === "--authenticated") { options.authenticated = true; options.requireAuth = true; options.authModeExplicit = true; }
    else if (arg === "--cleanup-recovery") { options.cleanupRecovery = true; options.authenticated = true; options.requireAuth = true; options.authModeExplicit = true; }
    else if (arg === "--public-shell") options.publicShell = true;
    else if (arg.startsWith("--url=")) options.url = arg.slice("--url=".length);
    else if (arg.startsWith("--user-data-dir=")) options.userDataDir = arg.slice("--user-data-dir=".length);
    else if (arg.startsWith("--avatar-file=")) options.avatarFile = arg.slice("--avatar-file=".length);
  }
  if (options.publicShell && options.authModeExplicit) {
    throw new Error("Conflicting browser smoke modes: --public-shell cannot be combined with authenticated mode");
  }
  if (options.cleanupRecovery && options.publicShell) {
    throw new Error("Conflicting browser smoke modes: --cleanup-recovery requires authenticated mode");
  }
  if (options.publicShell) options.requireAuth = false;
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

function pathInside(parent, candidate) {
  const remainder = relative(parent, candidate);
  return !remainder || (!isAbsolute(remainder) && !remainder.startsWith(".." + (process.platform === "win32" ? "\\" : "/")) && remainder !== "..");
}

function assertOutsideRepository(candidate, label) {
  const repository = realpathSync.native(resolve(process.cwd()));
  if (pathInside(repository, candidate)) throw new Error(label + " must be outside the repository");
}

export function externalPath(value, label, kind = "file") {
  const candidate = resolve(value);
  assertOutsideRepository(candidate, label);
  if (!existsSync(candidate)) throw new Error(label + " does not exist");

  const canonical = realpathSync.native(candidate);
  const canonicalParents = [
    realpathSync.native(dirname(candidate)),
    realpathSync.native(dirname(canonical)),
  ];
  assertOutsideRepository(canonical, label);
  canonicalParents.forEach((parent) => assertOutsideRepository(parent, label + " parent"));

  const stats = statSync(canonical);
  if (kind === "directory" && !stats.isDirectory()) throw new Error(label + " must be a directory");
  if (kind === "file" && !stats.isFile()) throw new Error(label + " must be a file");
  return canonical;
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
    const value = await evaluate(cdp, expression);
    if (value) return value;
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
const visibleNode = "(node) => { const style=getComputedStyle(node); const rect=node.getBoundingClientRect(); return style.display !== 'none' && style.visibility !== 'hidden' && style.pointerEvents !== 'none' && rect.width > 0 && rect.height > 0; }";

// CDP locators mirror the required page.getByRole/getByLabel/getByText contract without storing a Playwright profile.
function getByRole(cdp, role, name) {
  const selector = role === "button" ? "button,[role='button']" : "[role='" + role + "']";
  const lookup = "(node) => " + accessibleName + "(node) === " + JSON.stringify(name);
  const nodeExpression = "[...document.querySelectorAll(" + JSON.stringify(selector) + ")].find((candidate) => (" + lookup + ")(candidate) && (" + visibleNode + ")(candidate))";
  const expression = (action) => "(() => { const node = " + nodeExpression + "; if (!node) return false; " + action + " })()";
  return {
    async waitFor() {
      return waitFor(cdp, expression("const rect=node.getBoundingClientRect(); const style=getComputedStyle(node); return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;"), "role " + role + " " + name);
    },
    async click() {
      const pointExpression = "(() => { const node = " + nodeExpression + "; if (!node) return false; const rect=node.getBoundingClientRect(); const x=rect.left + rect.width / 2; const y=rect.top + rect.height / 2; const hit=document.elementFromPoint(x,y); return hit && (hit === node || node.contains(hit)) ? { x, y } : false; })()";
      const point = await waitFor(cdp, pointExpression, "hit-test role " + role + " " + name);
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y });
      await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, x: point.x, y: point.y });
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, x: point.x, y: point.y });
      return true;
    },
    async focus() { return waitFor(cdp, expression("node.focus(); return document.activeElement === node;"), "focus role " + role + " " + name); },
    async press(key) {
      await this.focus();
      await pressKey(cdp, key);
    },
  };
}

export async function pressKey(cdp, key, modifiers = 0) {
  const virtualKeyCode = key === "Tab" ? 9
    : key === "Escape" ? 27
      : key === "ArrowLeft" ? 37
        : key === "ArrowUp" ? 38
          : key === "ArrowRight" ? 39
            : key === "ArrowDown" ? 40
              : undefined;
  const event = {
    key,
    modifiers,
    code: key === "Tab" || key === "Escape" || key.startsWith("Arrow") ? key : undefined,
    windowsVirtualKeyCode: virtualKeyCode,
    nativeVirtualKeyCode: virtualKeyCode,
  };
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", ...event });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...event });
}

export async function enterKeyboardViewport(cdp) {
  await cdp.send("Emulation.setDeviceMetricsOverride", MOBILE_KEYBOARD_METRICS);
}

export async function restoreMobileGeometry(cdp) {
  await cdp.send("Emulation.setDeviceMetricsOverride", MOBILE_LAYOUT_METRICS);
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
      requests.push({
        id: event.requestId,
        loaderId: event.loaderId,
        url: url.pathname,
        method: event.request.method,
        headers: event.request.headers,
        hasPostData: event.request.hasPostData === true,
        postData: event.request.postData,
      });
    }
  });
  cdp.on("Network.responseReceived", (event) => {
    const url = new URL(event.response.url);
    if (url.pathname.includes("/api/v2/profile")) {
      responses.push({ id: event.requestId, url: url.pathname, status: event.response.status, headers: event.response.headers });
    }
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

async function navigateToNewDocument(cdp, url) {
  const previousTimeOrigin = await evaluate(cdp, "performance.timeOrigin");
  const frameNavigation = new Promise((resolveResult, reject) => {
    const timeout = setTimeout(() => {
      removeListener();
      reject(new Error("new document navigation timed out"));
    }, 30_000);
    const removeListener = cdp.on("Page.frameNavigated", (event) => {
      if (event.frame.parentId) return;
      clearTimeout(timeout);
      removeListener();
      resolveResult(event.frame);
    });
  });
  const navigation = await cdp.send("Page.navigate", { url });
  const frame = await frameNavigation;
  await waitFor(cdp, "document.readyState === 'complete' && performance.timeOrigin !== " + JSON.stringify(previousTimeOrigin), "new loader/document");
  return {
    loaderId: navigation.loaderId ?? frame.loaderId,
    previousTimeOrigin,
    timeOrigin: await evaluate(cdp, "performance.timeOrigin"),
  };
}

async function installLostResponseFault(cdp) {
  const state = { responseFailed: false, faultedRequest: null, error: null };
  const removeListener = cdp.on("Fetch.requestPaused", async (event) => {
    const url = new URL(event.request.url);
    const write = ["POST", "PATCH", "PUT"].includes(event.request.method) && url.pathname.includes("/api/v2/notes");
    if (write && event.responseStatusCode !== undefined && !state.responseFailed) {
      state.responseFailed = true;
      const idempotencyKey = header(event.request.headers, "idempotency-key");
      state.faultedRequest = {
        id: event.networkId ?? null,
        fetchId: event.requestId,
        idempotencyKey,
        url: url.pathname,
      };
      if (!idempotencyKey) state.error = new Error("Faulted note write did not carry an idempotency key");
      await cdp.send("Fetch.failRequest", { requestId: event.requestId, errorReason: "Failed" });
      return;
    }
    await cdp.send("Fetch.continueRequest", { requestId: event.requestId });
  });
  await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*/*", requestStage: "Request" }, { urlPattern: "*/*", requestStage: "Response" }] });
  return { state, async close() { removeListener(); await cdp.send("Fetch.disable"); } };
}

async function installRawAvatarCapture(cdp) {
  const state = { request: null };
  const removeListener = cdp.on("Fetch.requestPaused", async (event) => {
    const url = new URL(event.request.url);
    if (url.pathname === "/api/v2/profile/avatar" && event.request.method === "POST") {
      let postData = event.request.postData;
      if (!postData && event.request.hasPostData) {
        try {
          postData = (await cdp.send("Fetch.getRequestPostData", { requestId: event.requestId })).postData;
        } catch {
          postData = undefined;
        }
      }
      state.request = {
        id: event.networkId ?? null,
        fetchId: event.requestId,
        url: url.pathname,
        method: event.request.method,
        headers: event.request.headers,
        hasPostData: event.request.hasPostData === true,
        postData,
      };
    }
    await cdp.send("Fetch.continueRequest", { requestId: event.requestId });
  });
  await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*/api/v2/profile/avatar", requestStage: "Request" }] });
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

async function runZoomHitTest(cdp) {
  await cdp.send("Emulation.setPageScaleFactor", { pageScaleFactor: 2 });
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await waitFor(cdp, "window.visualViewport?.scale >= 1.99", "200% page zoom");
  const geometryExpression = `(() => { const rect=(node)=>{const value=node?.getBoundingClientRect(); return value ? {left:value.left,top:value.top,right:value.right,bottom:value.bottom,width:value.width,height:value.height} : null;}; const visible=(node)=>node && getComputedStyle(node).display!=='none' && getComputedStyle(node).visibility!=='hidden' && getComputedStyle(node).pointerEvents!=='none' && node.getBoundingClientRect().width>0 && node.getBoundingClientRect().height>0; const named=(name)=>[...document.querySelectorAll('button,[role=button]')].find((node)=>visible(node) && (node.getAttribute('aria-label') || node.textContent || '').replace(/\\s+/g,' ').trim()===name); const editorNodes=[...document.querySelectorAll('input[aria-label="笔记标题"],textarea[aria-label="笔记内容"]')].filter(visible); const editorRects=editorNodes.map(rect); const overlaps=(left,right)=>Boolean(left && right && left.left < right.right && left.right > right.left && left.top < right.bottom && left.bottom > right.top); const hit=(node)=>{if(!node) return false; const value=node.getBoundingClientRect(); const target=document.elementFromPoint(value.left+value.width/2,value.top+value.height/2); return Boolean(target && (target===node || node.contains(target)));}; const create=named('新建笔记'); const account=named('账户'); return {scale:window.visualViewport?.scale ?? 0,create:rect(create),account:rect(account),editor:editorRects,createHits:hit(create),accountHits:hit(account),createOverlapsEditor:editorRects.some((item)=>overlaps(rect(create),item)),accountOverlapsEditor:editorRects.some((item)=>overlaps(rect(account),item))}; })()`;
  const geometry = await evaluate(cdp, geometryExpression);
  const failures = [];
  if (geometry.scale < 1.99) failures.push("visual viewport scale is below 200%");
  if (!geometry.create || !geometry.account || geometry.editor.length === 0) failures.push("create/account/editor geometry is incomplete");
  if (!geometry.createHits || !geometry.accountHits) failures.push("create/account center failed real hit testing");
  if (geometry.createOverlapsEditor || geometry.accountOverlapsEditor) failures.push("create/account control overlaps editor input");
  if (failures.length) throw new Error("200% zoom geometry gate failed: " + failures.join("; "));
  return geometry;
}

export async function runAuthenticated(cdp, options, evidence) {
  await getByRole(cdp, "button", "新建笔记").waitFor();
  await getByRole(cdp, "button", "新建笔记").click();
  const title = "Phase 1 " + Date.now();
  await getByLabel(cdp, "笔记标题").waitFor();
  await getByLabel(cdp, "笔记标题").fill(title);
  await getByLabel(cdp, "笔记内容").fill("IndexedDB recovery " + title);
  const fault = await installLostResponseFault(cdp);
  try {
    await waitForNode(() => fault.state.responseFailed, "lost save response", 20_000);
  } finally {
    await fault.close();
  }
  if (fault.state.error) throw fault.state.error;
  await waitForNode(async () => Boolean(await readDraft(cdp, title)), "IndexedDB draft persistence", 20_000);
  const draft = await readDraft(cdp, title);
  if (!draft) throw new Error("IndexedDB draft was not found after failed save");
  await evaluate(cdp, "document.activeElement?.blur(); document.body.focus(); true");
  const zoom = await runZoomHitTest(cdp);
  await getByRole(cdp, "button", "账户").click();
  await pressKey(cdp, "Escape");
  await getByRole(cdp, "button", "新建笔记").click();
  await cdp.send("Emulation.setPageScaleFactor", { pageScaleFactor: 1 });
  const reloadEvidence = await navigateToNewDocument(cdp, await evaluate(cdp, "location.href"));
  await waitFor(cdp, "document.querySelector(\"input[aria-label='笔记标题']\")?.value === " + JSON.stringify(title), "IndexedDB draft reload", 30_000);

  const faultedKey = fault.state.faultedRequest?.idempotencyKey;
  const faultedNetworkId = fault.state.faultedRequest?.id;
  if (!faultedKey) throw new Error("Faulted note write idempotency key was not captured");
  const replay = await waitForNode(() => {
    const exact = evidence.requests.filter(({ url, method, headers }) => url.includes("/api/v2/notes") && ["POST", "PATCH", "PUT"].includes(method) && header(headers, "idempotency-key") === faultedKey);
    return exact.length >= 2 && exact.some(({ loaderId }) => loaderId === reloadEvidence.loaderId) ? exact : false;
  }, "post-reload replay with the faulted idempotency key", 30_000);
  const faultedEvidence = evidence.requests.find(({ id }) => id === faultedNetworkId)
    ?? evidence.requests.find(({ headers }) => header(headers, "idempotency-key") === faultedKey && header(headers, "idempotency-key") !== "");
  if (!faultedEvidence || faultedEvidence.loaderId === reloadEvidence.loaderId) throw new Error("Faulted and replayed requests did not cross a document loader boundary");

  await getByRole(cdp, "button", "账户").click();
  await getByRole(cdp, "menuitem", "个人中心").click();
  await getByRole(cdp, "tab", "个人资料").waitFor();
  await getByLabel(cdp, "昵称").fill(title);
  await getByRole(cdp, "button", "保存个人资料").click();
  await waitForNode(() => evidence.requests.some(({ url, method }) => url === "/api/v2/profile" && method === "PATCH"), "profile update request", 20_000);
  const profileReload = await navigateToNewDocument(cdp, await evaluate(cdp, "location.href"));
  await getByRole(cdp, "button", "账户").click();
  await getByRole(cdp, "menuitem", "个人中心").click();
  await getByRole(cdp, "tab", "个人资料").waitFor();
  await waitForNode(async () => (await getByLabel(cdp, "昵称").value()) === title, "profile nickname persistence after confirmed reload", 30_000);

  const avatarCapture = await installRawAvatarCapture(cdp);
  await setFileInput(cdp, externalPath(options.avatarFile, AVATAR_ENV));
  await getByRole(cdp, "button", "上传头像").click();
  try {
    await waitForNode(() => avatarCapture.state.request !== null, "raw avatar request", 20_000);
    await waitForNode(() => {
      const requestId = avatarCapture.state.request?.id;
      return Boolean(requestId && evidence.responses.some(({ id, url }) => url.includes("/profile/avatar") && id === requestId));
    }, "correlated avatar response", 20_000);
  } finally {
    await avatarCapture.close();
  }
  const avatarRequest = avatarCapture.state.request;
  const avatarResponse = evidence.responses.find(({ id, url }) => url.includes("/profile/avatar") && id === avatarRequest?.id);
  if (!avatarRequest?.id || !avatarResponse) throw new Error("Avatar request and response did not share a network request identity");
  if (avatarResponse.status < 200 || avatarResponse.status >= 300) throw new Error("Avatar response was not 2xx: " + avatarResponse.status);
  if (!avatarRequest.hasPostData || typeof avatarRequest.postData !== "string" || avatarRequest.postData.length === 0) throw new Error("Avatar request did not expose a raw body");
  if (!/^image\/(png|jpeg|webp)$/i.test(header(avatarRequest.headers, "content-type"))) throw new Error("Avatar request was not raw image File transport");
  if (/^data:/i.test(avatarRequest.postData) || /base64/i.test(avatarRequest.postData)) throw new Error("Avatar request used a base64 substitute");
  if (!/(private|no-store)/i.test(header(avatarResponse.headers, "cache-control"))) throw new Error("Avatar response is missing private/no-store cache control");

  await getByRole(cdp, "tab", "个人资料").focus();
  await getByRole(cdp, "tab", "个人资料").press("ArrowRight");
  if (!await evaluate(cdp, "document.activeElement?.id === 'account-tab-security'")) throw new Error("Account tab focus did not move with ArrowRight");
  await getByRole(cdp, "button", "账户").click();
  await pressKey(cdp, "Escape");
  if (!await evaluate(cdp, "document.activeElement?.getAttribute('aria-label') === '账户' && document.querySelector('[role=menu]') === null")) throw new Error("Account menu focus was not restored after Escape");

  await getByRole(cdp, "button", "笔记").waitFor();
  await getByRole(cdp, "button", "笔记").click();
  const inspectorOpener = getByRole(cdp, "button", "打开检查器");
  await inspectorOpener.waitFor();
  await inspectorOpener.click();
  await getByRole(cdp, "dialog", "检查器").waitFor();
  const inspectorFocus = await evaluate(cdp, "(() => { const dialog=document.querySelector('[role=dialog][aria-label=\\\"检查器\\\"]'); const backgroundInert=Boolean(document.querySelector('.workbench-canvas[inert]')) && Boolean(document.querySelector(" + JSON.stringify(INSPECTOR_INERT_NAVIGATION_SELECTOR) + ")); return { contained:Boolean(dialog && dialog.contains(document.activeElement)), backgroundInert, active:document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.tagName ?? null }; })()");
  if (!inspectorFocus.contained || !inspectorFocus.backgroundInert) throw new Error("Inspector modal did not contain focus or inert the background");
  await pressKey(cdp, "Tab");
  const tabContained = await evaluate(cdp, "Boolean(document.querySelector('[role=dialog][aria-label=\\\"检查器\\\"]')?.contains(document.activeElement))");
  await pressKey(cdp, "Tab", 8);
  const shiftTabContained = await evaluate(cdp, "Boolean(document.querySelector('[role=dialog][aria-label=\\\"检查器\\\"]')?.contains(document.activeElement))");
  if (!tabContained || !shiftTabContained) throw new Error("Inspector Tab/Shift+Tab focus escaped the dialog");
  await pressKey(cdp, "Escape");
  await waitFor(cdp, "!document.querySelector('[role=dialog][aria-label=\\\"检查器\\\"]')", "inspector Escape close");
  if (!await evaluate(cdp, "document.activeElement === document.querySelector('button[aria-label=\\\"打开检查器\\\"]')")) throw new Error("Inspector opener focus was not restored");

  const editor = getByLabel(cdp, "笔记内容");
  await editor.waitFor();
  await editor.focus();
  await enterKeyboardViewport(cdp);
  let mobile;
  try {
    await waitFor(cdp, "window.visualViewport && window.visualViewport.height < window.innerHeight && Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--keyboard-inset')) > 0", "real visual viewport keyboard inset", 15_000);
    await cdp.send("Input.insertText", { text: " mobile keyboard" });
    mobile = await evaluate(cdp, "(() => { const node=document.querySelector(\"textarea[aria-label='笔记内容']\"); const rect=node?.getBoundingClientRect(); const visualHeight=window.visualViewport?.height ?? 0; const layoutHeight=window.innerHeight; const keyboardInset=Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--keyboard-inset')) || 0; return {focused:document.activeElement===node,inserted:node?.value.includes('mobile keyboard')===true,bottom:rect?.bottom??0,visualViewportHeight:visualHeight,layoutViewportHeight:layoutHeight,keyboardInset}; })()");
    if (!mobile.focused || !mobile.inserted || mobile.visualViewportHeight >= mobile.layoutViewportHeight || mobile.keyboardInset <= 0 || mobile.bottom > mobile.visualViewportHeight) throw new Error("Mobile keyboard/focus gate failed: " + JSON.stringify(mobile));
  } finally {
    await restoreMobileGeometry(cdp);
  }
  return {
    title,
    draft,
    replay: { idempotencyKey: faultedKey, attempts: replay.length, postReloadAttempts: replay.filter(({ loaderId }) => loaderId === reloadEvidence.loaderId).length, reload: reloadEvidence },
    profile: { reload: profileReload, nickname: title },
    avatar: { endpoint: avatarRequest.url, requestId: avatarRequest.id, responseId: avatarResponse.id, status: avatarResponse.status, contentType: header(avatarRequest.headers, "content-type"), rawBodyBytes: avatarRequest.postData.length, cacheControl: header(avatarResponse.headers, "cache-control") },
    zoom,
    mobile,
    inspector: { focusContained: inspectorFocus.contained, backgroundInert: inspectorFocus.backgroundInert, tabContained, shiftTabContained, escapeClosed: true, openerRestored: true },
  };
}

async function runCleanupRecovery(cdp, debugPort, options) {
  await evaluate(cdp, "document.activeElement?.blur(); document.body.focus(); true");
  await getByRole(cdp, "button", "账户").waitFor();
  const secondTarget = await openTarget(debugPort, options.url);
  const second = connect(secondTarget.webSocketDebuggerUrl);
  try {
    await second.send("Page.enable");
    await second.send("Runtime.enable");
    await waitFor(second, "document.readyState === 'complete'", "second tab");
    await getByRole(second, "button", "新建笔记").click();
    const heldTitle = "Task 12 held " + Date.now();
    await getByLabel(second, "笔记标题").fill(heldTitle);
    await waitForNode(async () => Boolean(await readDraft(second, heldTitle)), "second tab real local-store connection", 20_000);
    await getByRole(cdp, "button", "账户").click();
    await getByRole(cdp, "menuitem", "退出登录").click();
    await getByText(cdp, "本地数据清理失败").waitFor();
    const blocked = { database: DATABASE_NAME, path: "App logout -> BetaLocalStore.destroy()", remoteAccountDeleted: false };
    const released = await navigateToNewDocument(second, "about:blank");
    await getByRole(cdp, "button", "重试清理本地数据").click();
    await waitFor(cdp, "Boolean(document.querySelector('[aria-label=\\\"账户认证\\\"]'))", "local cleanup retry recovery", 30_000);
    return { ...blocked, releasedLoaderId: released.loaderId, recovered: true };
  } finally {
    second.close();
  }
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
  if (!options.publicShell && !authReady) {
    printSkip(options.userDataDir ? "AVATAR_FIXTURE_UNSET" : "AUTH_FIXTURE_UNSET");
    process.exitCode = 2;
    return;
  }
  if (options.userDataDir) options.userDataDir = externalPath(options.userDataDir, PROFILE_ENV, "directory");
  if (options.avatarFile) options.avatarFile = externalPath(options.avatarFile, AVATAR_ENV, "file");
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
    if (options.publicShell) return;
    console.log(JSON.stringify({ status: "PASS", scenario: "authenticated-phase1", evidence: await runAuthenticated(cdp, options, evidence) }));
    if (options.cleanupRecovery) {
      console.log(JSON.stringify({ status: "PASS", scenario: "authenticated-cleanup-recovery", evidence: await runCleanupRecovery(cdp, debugPort, options) }));
    }
  } finally {
    cdp?.close();
    await stop(browser);
    if (temporaryProfile) {
      try { rmSync(temporaryProfile, { recursive: true, force: true }); } catch { /* best effort */ }
    }
    if (browser.exitCode !== null && browser.exitCode !== 0 && errors.length) console.error(errors.join("").slice(-2000));
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  run().catch((error) => {
    console.error(JSON.stringify({ status: "FAIL", reason: error instanceof Error ? error.message : String(error) }));
    process.exit(1);
  });
}
