import { existsSync, mkdtempSync, realpathSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const DEFAULT_URL = process.env.NEXUS_NOTES_BETA_URL ?? "http://127.0.0.1:4173/";
const DATABASE_NAME = "nexus-notes-beta";
const PROFILE_ENV = "NEXUS_NOTES_BETA_USER_DATA_DIR";
const AVATAR_ENV = "NEXUS_NOTES_BETA_AVATAR_FILE";
const SESSION_ENV = "NEXUS_NOTES_BETA_SESSION_TOKEN";
export const INSPECTOR_INERT_NAVIGATION_SELECTOR = "nav[aria-label='移动端主导航'][inert], nav[aria-label='主导航'][inert], [role='navigation'][inert]";
const MOBILE_LAYOUT_METRICS = { width: 390, height: 844, deviceScaleFactor: 2, mobile: true };
const MOBILE_KEYBOARD_METRICS = { ...MOBILE_LAYOUT_METRICS, height: 500 };
export const NAVIGATION_SHELL_BUDGET_MS = 100;
export const CACHED_PAGE_BUDGET_MS = 250;

export function buildAccessibilityAuditExpression(expectedViewport = 390) {
  const expected = Number.isFinite(Number(expectedViewport)) ? Number(expectedViewport) : 390;
  return `(() => {
    const visible = (node) => {
      if (!node) return false;
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && style.pointerEvents !== 'none' && rect.width > 0 && rect.height > 0;
    };
    const name = (node) => (node.getAttribute('aria-label') || node.getAttribute('title') || node.textContent || '').replace(/\\s+/g, ' ').trim();
    const controls = [...document.querySelectorAll('button,[role="button"],input,select,textarea')].filter(visible);
    const scrollOwners = [...document.querySelectorAll('[data-scroll-owner]')].filter(visible);
    return {
      expectedViewport: ${expected},
      viewport: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      scrollOwners: scrollOwners.length,
      scrollOwnerNames: scrollOwners.map((node) => node.getAttribute('data-scroll-owner') || '').slice(0, 3),
      unnamedButtons: controls.filter((node) => (node.matches('button,[role="button"]') && !name(node))).length,
      unnamedInputs: controls.filter((node) => (node.matches('input,select,textarea') && !name(node) && !node.closest('[aria-hidden="true"]'))).length,
    };
  })()`;
}

export function buildSensitiveDiagnosticsExpression() {
  return `(() => ({
    consoleErrors: Number(window.__nexusSmokeConsoleErrors || 0),
    exceptionCount: Number(window.__nexusSmokeExceptionCount || 0),
    messageLength: Number(window.__nexusSmokeLastMessageLength || 0),
  }))()`;
}

export function buildNavigationPerformanceExpression() {
  return `(() => {
    const navigation = performance.getEntriesByType('navigation')[0];
    const paint = performance.getEntriesByType('paint').find((entry) => entry.name === 'first-contentful-paint');
    return {
      navigationStart: navigation?.startTime ?? 0,
      domContentLoadedEventEnd: navigation?.domContentLoadedEventEnd ?? null,
      firstContentfulPaint: paint?.startTime ?? null,
    };
  })()`;
}

export function parseBrowserGateOutput(output) {
  const lines = String(output).trim().split(/\r?\n/u).reverse();
  for (const line of lines) {
    try {
      const value = JSON.parse(line);
      if (value && typeof value === 'object' && (value.status === 'PASS' || value.status === 'BLOCKED')) return value;
    } catch {
      // Ignore non-JSON browser diagnostics and inspect the next line.
    }
  }
  throw new Error('Browser gate output did not contain a PASS or BLOCKED result');
}

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
    sessionToken: process.env[SESSION_ENV],
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

export async function findBrowser() {
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

function printBlocked(reason, requiredEnv = [PROFILE_ENV]) {
  console.log(JSON.stringify({
    status: "BLOCKED",
    reason,
    requiredEnv,
    optionalBootstrapEnv: SESSION_ENV,
    profile: "external",
    authenticated: false,
  }));
}

export async function seedAuthenticatedSession(cdp, url, token) {
  const target = new URL(url).href;
  const result = await cdp.send("Network.setCookie", {
    name: "nexus_session",
    value: token,
    url: target,
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    expires: Math.floor(Date.now() / 1000) + 60 * 60,
  });
  if (result?.success === false) throw new Error("Could not seed the authenticated browser session");
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

export function attachBrowserDiagnostics(cdp) {
  const state = { consoleErrors: 0, exceptionCount: 0 };
  const removeConsole = cdp.on("Runtime.consoleAPICalled", (event) => {
    if (event.type === "error") state.consoleErrors += 1;
  });
  const removeException = cdp.on("Runtime.exceptionThrown", () => {
    state.exceptionCount += 1;
  });
  return {
    state,
    close() {
      removeConsole();
      removeException();
    },
  };
}

async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) {
    const detail = result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? "Browser evaluation failed";
    throw new Error(`${detail} [expression: ${expression.slice(0, 180)}]`);
  }
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
function roleNodeExpression(role, name) {
  const selector = role === "button"
    ? "button,[role='button']"
    : role === "heading"
      ? "h1,h2,h3,h4,h5,h6,[role='heading']"
      : "[role='" + role + "']";
  const lookup = "(node) => (" + accessibleName + ")(node) === " + JSON.stringify(name);
  return "[...document.querySelectorAll(" + JSON.stringify(selector) + ")].find((candidate) => (" + lookup + ")(candidate) && (" + visibleNode + ")(candidate))";
}

export function buildSafeClickPointExpression(nodeExpression, scrollBlock = "nearest") {
  const scrollBlockLiteral = JSON.stringify(scrollBlock);
  return `(() => {
    const node = ${nodeExpression};
    if (!node) return false;
    node.scrollIntoView({ block: ${scrollBlockLiteral}, inline: "nearest" });
    const rect = node.getBoundingClientRect();
    const visualViewport = window.visualViewport;
    const viewportLeft = Math.max(0, visualViewport?.offsetLeft ?? 0);
    const viewportTop = Math.max(0, visualViewport?.offsetTop ?? 0);
    const viewportRight = Math.min(window.innerWidth, viewportLeft + (visualViewport?.width ?? window.innerWidth));
    const viewportBottom = Math.min(window.innerHeight, viewportTop + (visualViewport?.height ?? window.innerHeight));
    const inset = 6;
    const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
    const left = clamp(rect.left + inset, viewportLeft, viewportRight);
    const right = clamp(rect.right - inset, viewportLeft, viewportRight);
    const top = clamp(rect.top + inset, viewportTop, viewportBottom);
    const bottom = clamp(rect.bottom - inset, viewportTop, viewportBottom);
    const centerX = clamp(rect.left + rect.width / 2, viewportLeft, viewportRight);
    const centerY = clamp(rect.top + rect.height / 2, viewportTop, viewportBottom);
    const points = [[centerX, centerY], [left, top], [right, top], [left, bottom], [right, bottom]];
    const match = points
      .map(([x, y]) => ({ x, y, stack: document.elementsFromPoint(x, y) }))
      .find(({ x, y, stack }) => x >= viewportLeft && y >= viewportTop && x <= viewportRight && y <= viewportBottom && stack[0] && (stack[0] === node || node.contains(stack[0])));
    return match ? { x: match.x, y: match.y } : false;
  })()`;
}

export function buildRoleLocatorExpression(role, name, action) {
  const nodeExpression = roleNodeExpression(role, name);
  return "(() => { const node = " + nodeExpression + "; if (!node) return false; " + action + " })()";
}

async function stableClickPoint(cdp, nodeExpression, label, scrollBlock = "nearest") {
  await waitFor(cdp, buildSafeClickPointExpression(nodeExpression, scrollBlock), label);
  await new Promise((resolveResult) => setTimeout(resolveResult, 80));
  return waitFor(cdp, buildSafeClickPointExpression(nodeExpression, scrollBlock), label + " after layout settle");
}

async function dispatchTrustedClick(cdp, point) {
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", buttons: 0, x: point.x, y: point.y });
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", buttons: 1, clickCount: 1, x: point.x, y: point.y });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", buttons: 0, clickCount: 1, x: point.x, y: point.y });
}

async function dispatchTouchCompatibleClick(cdp, point) {
  const x = Math.round(point.x);
  const y = Math.round(point.y);
  await cdp.send("Input.emulateTouchFromMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await cdp.send("Input.emulateTouchFromMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
}

function getByRole(cdp, role, name) {
  const nodeExpression = roleNodeExpression(role, name);
  const expression = (action) => buildRoleLocatorExpression(role, name, action);
  return {
    async waitFor() {
      return waitFor(cdp, expression("const rect=node.getBoundingClientRect(); const style=getComputedStyle(node); return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;"), "role " + role + " " + name);
    },
    async click(scrollBlock = "nearest") {
      const point = await stableClickPoint(cdp, nodeExpression, "hit-test role " + role + " " + name, scrollBlock);
      await dispatchTrustedClick(cdp, point);
      return true;
    },
    async focus() { return waitFor(cdp, expression("node.focus(); return document.activeElement === node;"), "focus role " + role + " " + name); },
    async press(key) {
      await this.focus();
      await pressKey(cdp, key);
    },
  };
}

async function clickRoleSafely(cdp, role, name) {
  try {
    await getByRole(cdp, role, name).waitFor();
  } catch (error) {
    if (role !== "button" || name !== "账户") throw error;
    const diagnostic = await evaluate(cdp, `(() => { const visible=${visibleNode}; const name=${accessibleName}; const rect=(node)=>{const value=node?.getBoundingClientRect(); return value ? {left:value.left,top:value.top,right:value.right,bottom:value.bottom,width:value.width,height:value.height} : null;}; return {url:location.href,viewport:{innerWidth:window.innerWidth,innerHeight:window.innerHeight,visualWidth:window.visualViewport?.width ?? null,visualHeight:window.visualViewport?.height ?? null,scale:window.visualViewport?.scale ?? null},workbench:rect(document.querySelector('.adaptive-workbench')),mobileNav:rect(document.querySelector('.mobile-bottom-nav')),buttons:[...document.querySelectorAll('button,[role="button"]')].map((node)=>({name:name(node),rect:rect(node),visible:visible(node),hidden:node.closest('[aria-hidden="true"]')!==null,inert:node.closest('[inert]')!==null})).filter((item)=>item.name).slice(-20)}; })()`);
    throw new Error(`${error instanceof Error ? error.message : String(error)}; account diagnostic=${JSON.stringify(diagnostic)}`);
  }
  const point = await stableClickPoint(cdp, roleNodeExpression(role, name), "safe hit-test role " + role + " " + name);
  if (!point) throw new Error("safe click point unavailable for role " + role + " " + name);
  await dispatchTrustedClick(cdp, point);
}

async function openAccountMenu(cdp, label) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await revealMobileChrome(cdp);
      await clickRoleSafely(cdp, "button", "账户");
      await waitFor(cdp, "Boolean(document.querySelector('[role=menu]'))", label, 5_000);
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolveResult) => setTimeout(resolveResult, 500));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(label + " timed out");
}

async function openPersonalAccountCenter(cdp, label) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await openAccountMenu(cdp, label + " menu");
      await getByRole(cdp, "menuitem", "个人中心").click();
      await waitFor(cdp, "Boolean(document.querySelector('.account-center-shell'))", label, 5_000);
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolveResult) => setTimeout(resolveResult, 500));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(label + " timed out");
}

export async function pressKey(cdp, key, modifiers = 0) {
  const virtualKeyCode = key === "Enter" ? 13
    : key === "Tab" ? 9
      : key === "Escape" ? 27
      : key === "ArrowLeft" ? 37
        : key === "ArrowUp" ? 38
          : key === "ArrowRight" ? 39
            : key === "ArrowDown" ? 40
              : undefined;
  const event = {
    key,
    modifiers,
    code: key === "Enter" || key === "Tab" || key === "Escape" || key.startsWith("Arrow") ? key : undefined,
    text: key === "Enter" ? "\r" : undefined,
    unmodifiedText: key === "Enter" ? "\r" : undefined,
    windowsVirtualKeyCode: virtualKeyCode,
    nativeVirtualKeyCode: virtualKeyCode,
  };
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", ...event });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...event });
}

export async function enterKeyboardViewport(cdp) {
  await cdp.send("Emulation.setDeviceMetricsOverride", MOBILE_KEYBOARD_METRICS);
  await cdp.send("Emulation.setVisibleSize", { width: 390, height: 500 });
}

export async function restoreMobileGeometry(cdp) {
  await cdp.send("Emulation.setDeviceMetricsOverride", MOBILE_LAYOUT_METRICS);
  await cdp.send("Emulation.setVisibleSize", { width: 390, height: 844 });
}

export function buildLabelLocatorExpression(name, action) {
  const find = "(label) => (label.textContent || '').replace(/\\s+/g, ' ').trim().includes(" + JSON.stringify(name) + ")";
  return "(() => { const direct = [...document.querySelectorAll('input,textarea,select')].find((candidate) => candidate.getAttribute('aria-label') === " + JSON.stringify(name) + "); const label = [...document.querySelectorAll('label')].find(" + find + "); const node = direct || label?.querySelector('input,textarea,select') || (label?.htmlFor ? document.getElementById(label.htmlFor) : null); if (!node) return false; " + action + " })()";
}

function getByLabel(cdp, name) {
  const expression = (action) => buildLabelLocatorExpression(name, action);
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

async function revealMobileChrome(cdp) {
  await evaluate(cdp, "document.activeElement?.blur(); document.querySelectorAll('input,textarea,[contenteditable=\"true\"]').forEach((node) => node.blur()); document.querySelectorAll('[data-scroll-owner=page]').forEach((node) => node.scrollTo({ top: 0, behavior: 'instant' })); window.scrollTo(0, 0); true");
  await waitFor(cdp, "(() => { const nav=document.querySelector('.mobile-bottom-nav'); return nav?.dataset.visible === 'true' && nav.getBoundingClientRect().bottom <= window.innerHeight + 1; })()", "mobile chrome reveal");
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

export async function runPublicShell(cdp) {
  await waitFor(cdp, "document.readyState === 'complete'", "page load");
  await waitFor(cdp, "Boolean(document.body && document.body.innerText.trim())", "application shell");
  const audit = await evaluate(cdp, buildAccessibilityAuditExpression(390));
  const timing = await evaluate(cdp, buildNavigationPerformanceExpression());
  const result = {
    lang: await evaluate(cdp, "document.documentElement.lang"),
    viewport: audit.viewport,
    devicePixelRatio: await evaluate(cdp, "window.devicePixelRatio"),
    scrollWidth: audit.scrollWidth,
    unnamedButtons: audit.unnamedButtons,
    unnamedInputs: audit.unnamedInputs,
    scrollOwners: audit.scrollOwners,
    domContentLoadedMs: timing.domContentLoadedEventEnd === null ? null : Math.round(timing.domContentLoadedEventEnd),
    firstContentfulPaintMs: timing.firstContentfulPaint === null ? null : Math.round(timing.firstContentfulPaint),
  };
  const failures = [];
  if (result.lang !== "zh-CN") failures.push("html lang=" + JSON.stringify(result.lang));
  if (result.viewport !== 390) failures.push("viewport=" + result.viewport);
  if (result.devicePixelRatio !== 2) failures.push("devicePixelRatio=" + result.devicePixelRatio);
  if (result.scrollWidth > result.viewport + 1) failures.push("horizontal overflow " + result.scrollWidth + "px");
  if (result.scrollOwners > 1) failures.push(result.scrollOwners + " visible scroll owners; expected at most one");
  if (result.unnamedButtons > 0) failures.push(result.unnamedButtons + " visible buttons without accessible names");
  if (result.unnamedInputs > 0) failures.push(result.unnamedInputs + " visible form controls without accessible names");
  if (result.domContentLoadedMs !== null && result.domContentLoadedMs > 5000) failures.push("DOMContentLoaded " + result.domContentLoadedMs + "ms");
  if (failures.length) throw new Error("Beta browser shell gates failed: " + failures.join("; "));
  return result;
}

export async function runNavigationPerformanceScenario(cdp) {
  const authenticated = await evaluate(cdp, "Boolean(document.querySelector(\"button[aria-label='账户']\"))");
  if (!authenticated) {
    throw Object.assign(new Error("An authenticated browser profile is required for navigation performance"), {
      code: "AUTHENTICATED_PROFILE_REQUIRED",
      gateBlocked: true,
    });
  }
  const destinations = [
    ["数据库", "databases"],
    ["知识整理", "knowledge"],
    ["提醒", "reminders"],
    ["AI 助手", "ai"],
  ];
  const measurements = [];
  await evaluate(cdp, `(() => {
    window.__nexusNavigationStart = null;
    window.__nexusNavigationListener?.();
    const listener = (event) => {
      const target = event.target instanceof Element ? event.target.closest('button,[role="button"]') : null;
      if (target) window.__nexusNavigationStart = performance.now();
    };
    window.__nexusNavigationListener = () => document.removeEventListener('click', listener, true);
    document.addEventListener('click', listener, true);
    return true;
  })()`);
  for (const [label, domain] of destinations) {
    await getByRole(cdp, "button", label).click();
    await waitFor(cdp, `document.querySelector('.workspace-domain-surface')?.dataset.domain === ${JSON.stringify(domain)}`, `${label} navigation shell`, 5_000);
    const shellMs = await evaluate(cdp, "window.__nexusNavigationStart === null ? null : performance.now() - window.__nexusNavigationStart");
    if (shellMs === null) throw new Error(`${label} navigation did not expose a measurable click timestamp`);
    measurements.push({ domain, shellMs: Math.round(shellMs) });
  }
  await getByRole(cdp, "button", "数据库").click();
  await waitFor(cdp, "document.querySelector('.workspace-domain-surface')?.dataset.domain === 'databases'", "cached database navigation shell", 5_000);
  const cachedShellMs = await evaluate(cdp, "window.__nexusNavigationStart === null ? null : performance.now() - window.__nexusNavigationStart");
  if (cachedShellMs === null) throw new Error("Cached database navigation did not expose a measurable click timestamp");
  measurements.push({ domain: "databases-cached", shellMs: Math.round(cachedShellMs) });
  await evaluate(cdp, "window.__nexusNavigationListener?.(); window.__nexusNavigationListener = null; true");
  const failures = measurements
    .filter((item) => item.shellMs > NAVIGATION_SHELL_BUDGET_MS)
    .map((item) => `${item.domain} shell ${item.shellMs}ms > ${NAVIGATION_SHELL_BUDGET_MS}ms`);
  if (failures.length) throw new Error(`Navigation shell budget failed: ${failures.join("; ")}`);
  if (measurements.at(-1)?.shellMs > CACHED_PAGE_BUDGET_MS) {
    throw new Error(`Cached page budget failed: ${measurements.at(-1).shellMs}ms > ${CACHED_PAGE_BUDGET_MS}ms`);
  }
  return { measurements, budgets: { navigationShellMs: NAVIGATION_SHELL_BUDGET_MS, cachedPageMs: CACHED_PAGE_BUDGET_MS } };
}

export async function runAiAssistantScenario(cdp) {
  const authenticated = await evaluate(cdp, "Boolean(document.querySelector(\"button[aria-label='账户']\"))");
  if (!authenticated) {
    throw Object.assign(new Error("An authenticated browser profile is required for the AI assistant flow"), {
      code: "AUTHENTICATED_PROFILE_REQUIRED",
      gateBlocked: true,
    });
  }
  await getByRole(cdp, "button", "AI 助手").click();
  await getByRole(cdp, "heading", "AI 助手").waitFor();
  const unavailable = await evaluate(cdp, `(() => [...document.querySelectorAll('[role="status"]')].some((node) => /当前不可用|尚未配置/u.test(node.textContent || '')))()`);
  if (unavailable) {
    throw Object.assign(new Error("AI provider is unavailable or not configured for the authenticated profile"), {
      code: "AI_PROVIDER_UNAVAILABLE",
      gateBlocked: true,
    });
  }
  const input = getByLabel(cdp, "输入问题");
  await input.fill("请创建一条标题为 AI 浏览器门禁笔记 的笔记，正文写入 smoke test");
  await getByRole(cdp, "button", "发送").click();
  await waitFor(cdp, "Boolean(document.querySelector('.ai-action-card'))", "AI action proposal", 35_000);
  const proposal = await evaluate(cdp, `(() => ({ cards: document.querySelectorAll('.ai-action-card').length, confirmations: [...document.querySelectorAll('.ai-action-card')].filter((node) => /待确认/u.test(node.textContent || '')).length }))()`);
  if (proposal.confirmations < 1) {
    throw Object.assign(new Error("AI provider did not return a confirmation-gated action proposal"), {
      code: "AI_ACTION_PROPOSAL_MISSING",
      gateBlocked: true,
    });
  }
  await getByRole(cdp, "button", "确认执行").click();
  await waitFor(cdp, "Boolean(document.querySelector('.ai-chat-action-result, .ai-action-card-confirmed'))", "AI action confirmation result", 35_000);
  const result = await evaluate(cdp, `(() => ({ cards: document.querySelectorAll('.ai-action-card').length, results: document.querySelectorAll('.ai-chat-action-result').length, history: Boolean(document.querySelector('.ai-action-history-list')) }))()`);
  return { proposal, result, confirmation: true };
}

async function runZoomHitTest(cdp) {
  await cdp.send("Emulation.setPageScaleFactor", { pageScaleFactor: 2 });
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await waitFor(cdp, "window.visualViewport?.scale >= 1.99", "200% page zoom");
  await evaluate(cdp, "document.querySelectorAll('[data-scroll-owner=page]').forEach((node) => node.scrollTo({ top: 0, behavior: 'instant' })); window.scrollTo(0, 0); true");
  await new Promise((resolveResult) => setTimeout(resolveResult, 100));
  const geometryExpression = `(() => { const rect=(node)=>{const value=node?.getBoundingClientRect(); return value ? {left:value.left,top:value.top,right:value.right,bottom:value.bottom,width:value.width,height:value.height} : null;}; const visible=(node)=>node && getComputedStyle(node).display!=='none' && getComputedStyle(node).visibility!=='hidden' && getComputedStyle(node).pointerEvents!=='none' && node.getBoundingClientRect().width>0 && node.getBoundingClientRect().height>0; const named=(name)=>[...document.querySelectorAll('button,[role=button]')].find((node)=>visible(node) && (node.getAttribute('aria-label') || node.textContent || '').replace(/\\s+/g,' ').trim()===name); const editorNodes=[...document.querySelectorAll('input[aria-label="笔记标题"],textarea[aria-label="笔记内容"]')].filter(visible); const editorRects=editorNodes.map(rect); const overlaps=(left,right)=>Boolean(left && right && left.left < right.right && left.right > right.left && left.top < right.bottom && left.bottom > right.top); const hit=(node)=>{if(!node) return false; const value=node.getBoundingClientRect(); const target=document.elementFromPoint(value.left+value.width/2,value.top+value.height/2); return Boolean(target && (target===node || node.contains(target)));}; const create=named('新建笔记'); const account=named('账户'); return {scale:window.visualViewport?.scale ?? 0,create:rect(create),account:rect(account),editor:editorRects,createHits:hit(create),accountHits:hit(account),createOverlapsEditor:editorRects.some((item)=>overlaps(rect(create),item)),accountOverlapsEditor:editorRects.some((item)=>overlaps(rect(account),item))}; })()`;
  const geometry = await evaluate(cdp, geometryExpression);
  const failures = [];
  if (geometry.scale < 1.99) failures.push("visual viewport scale is below 200%");
  if (!geometry.create || !geometry.account || geometry.editor.length === 0) failures.push("create/account/editor geometry is incomplete");
  if (!geometry.createHits || !geometry.accountHits) failures.push("create/account center failed real hit testing");
  if (geometry.createOverlapsEditor || geometry.accountOverlapsEditor) failures.push("create/account control overlaps editor input");
  if (failures.length) throw new Error("200% zoom geometry gate failed: " + failures.join("; ") + "; geometry=" + JSON.stringify(geometry));
  return geometry;
}

export async function runAuthenticated(cdp, options, evidence) {
  await getByRole(cdp, "button", "新建笔记").waitFor();
  await getByRole(cdp, "button", "新建笔记").click();
  const title = "Phase 1 " + Date.now();
  try {
    await getByLabel(cdp, "笔记标题").waitFor();
  } catch (error) {
    const diagnostic = await evaluate(cdp, `(() => { const visible=(node)=>{const style=getComputedStyle(node);const rect=node.getBoundingClientRect();return style.display!=='none'&&style.visibility!=='hidden'&&rect.width>0&&rect.height>0;}; const text=(node)=>(node.getAttribute('aria-label')||node.textContent||'').replace(/\\s+/g,' ').trim().slice(0,120); return {domain:document.querySelector('.workspace-domain-surface')?.getAttribute('data-domain')??null,busy:document.querySelector('.workspace-domain-surface')?.getAttribute('aria-busy')??null,taskPane:document.querySelector('[data-testid="task-pane"]')?.className??null,buttons:[...document.querySelectorAll('button')].filter(visible).map(text).filter(Boolean).slice(0,30),controls:[...document.querySelectorAll('input,textarea,select')].filter(visible).map((node)=>node.getAttribute('aria-label')||node.getAttribute('name')||node.tagName).slice(0,20),alerts:[...document.querySelectorAll('[role="alert"]')].filter(visible).map(text).slice(0,10),statuses:[...document.querySelectorAll('[role="status"]')].filter(visible).map(text).slice(0,10)}; })()`);
    throw new Error(`${error instanceof Error ? error.message : String(error)}; diagnostic=${JSON.stringify(diagnostic)}`);
  }
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
  await cdp.send("Emulation.setPageScaleFactor", { pageScaleFactor: 1 });
  await waitFor(cdp, "window.visualViewport?.scale <= 1.01", "restore normal page zoom");
  await evaluate(cdp, "window.dispatchEvent(new Event('resize')); true");
  await new Promise((resolveResult) => setTimeout(resolveResult, 100));
  const reloadEvidence = await navigateToNewDocument(cdp, await evaluate(cdp, "location.href"));
  await waitFor(cdp, "document.querySelector(\"input[aria-label='笔记标题']\")?.value === " + JSON.stringify(title), "IndexedDB draft reload", 30_000);
  await revealMobileChrome(cdp);

  const faultedKey = fault.state.faultedRequest?.idempotencyKey;
  const faultedNetworkId = fault.state.faultedRequest?.id;
  if (!faultedKey) throw new Error("Faulted note write idempotency key was not captured");
  let replay = [];
  await waitForNode(() => {
    const exact = evidence.requests.filter(({ url, method, headers }) => url.includes("/api/v2/notes") && ["POST", "PATCH", "PUT"].includes(method) && header(headers, "idempotency-key") === faultedKey);
    if (exact.length >= 2 && exact.some(({ loaderId }) => loaderId === reloadEvidence.loaderId)) {
      replay = exact;
      return true;
    }
    return false;
  }, "post-reload replay with the faulted idempotency key", 30_000);
  const faultedEvidence = evidence.requests.find(({ id }) => id === faultedNetworkId)
    ?? evidence.requests.find(({ headers }) => header(headers, "idempotency-key") === faultedKey && header(headers, "idempotency-key") !== "");
  if (!faultedEvidence || faultedEvidence.loaderId === reloadEvidence.loaderId) throw new Error("Faulted and replayed requests did not cross a document loader boundary");
  await new Promise((resolveResult) => setTimeout(resolveResult, 750));

  await openPersonalAccountCenter(cdp, "account center navigation");
  await getByRole(cdp, "tab", "个人资料").waitFor();
  await waitForNode(async () => Boolean(await getByLabel(cdp, "语言").value()) && Boolean(await getByLabel(cdp, "时区").value()), "profile form hydration", 30_000);
  await waitFor(cdp, buildRoleLocatorExpression("button", "保存个人资料", "return !node.disabled;"), "profile form ready", 30_000);
  await getByLabel(cdp, "昵称").fill(title);
  await evaluate(cdp, `(() => { const name=${accessibleName}; window.__nexusSmokeClickTrace=[]; window.__nexusSmokeClickListener=(event)=>{const target=event.target; window.__nexusSmokeClickTrace.push({type:event.type,tag:target?.tagName??null,name:target instanceof Element ? name(target) : null,active:document.activeElement?.tagName??null,defaultPrevented:event.defaultPrevented});}; for (const type of ['pointerdown','mousedown','pointerup','mouseup','click','keydown','keyup','submit']) document.addEventListener(type, window.__nexusSmokeClickListener, true); return true; })()`);
  const saveProfileButton = getByRole(cdp, "button", "保存个人资料");
  // Prefer the same trusted pointer path used by the other browser actions. Some
  // Chromium builds do not synthesize a submit click from CDP rawKeyDown on a
  // focused button, even though the element is keyboard-focusable.
  await saveProfileButton.click();
  await new Promise((resolveResult) => setTimeout(resolveResult, 250));
  if (!evidence.requests.some(({ url, method }) => url === "/api/v2/profile" && method === "PATCH")) {
    const savePoint = await stableClickPoint(cdp, roleNodeExpression("button", "保存个人资料"), "touch-compatible profile submit");
    await dispatchTouchCompatibleClick(cdp, savePoint);
    await new Promise((resolveResult) => setTimeout(resolveResult, 250));
  }
  if (!evidence.requests.some(({ url, method }) => url === "/api/v2/profile" && method === "PATCH")) {
    await getByLabel(cdp, "昵称").focus();
    await pressKey(cdp, "Enter");
  }
  try {
    await waitForNode(() => evidence.requests.some(({ url, method }) => url === "/api/v2/profile" && method === "PATCH"), "profile update request", 20_000);
  } catch (error) {
    const diagnostic = await evaluate(cdp, `(() => { const visible=${visibleNode}; const name=${accessibleName}; const rect=(node)=>{const value=node?.getBoundingClientRect(); return value ? {left:value.left,top:value.top,right:value.right,bottom:value.bottom,width:value.width,height:value.height} : null;}; const save=[...document.querySelectorAll('button')].find((node)=>name(node)==='保存个人资料'); const saveRect=rect(save); const saveStack=saveRect ? document.elementsFromPoint(saveRect.left+saveRect.width/2,saveRect.top+saveRect.height/2).slice(0,5).map((node)=>({tag:node.tagName,name:name(node),className:node.className})) : []; document.removeEventListener('click', window.__nexusSmokeClickListener, true); return {buttons:[...document.querySelectorAll('button')].filter(visible).map((node)=>({name:name(node),disabled:node.disabled,ariaDisabled:node.getAttribute('aria-disabled'),rect:rect(node)})).slice(-20),saveStack,clickTrace:window.__nexusSmokeClickTrace ?? [],inputs:[...document.querySelectorAll('input,textarea')].filter(visible).map((node)=>({label:node.getAttribute('aria-label'),value:node.value,disabled:node.disabled})),alerts:[...document.querySelectorAll('[role="alert"],[role="status"]')].filter(visible).map((node)=>node.textContent?.replace(/\\s+/g,' ').trim()).filter(Boolean).slice(-10)}; })()`);
    throw new Error(`${error instanceof Error ? error.message : String(error)}; profile diagnostic=${JSON.stringify(diagnostic)}`);
  }
  await evaluate(cdp, "(() => { for (const type of ['pointerdown','mousedown','pointerup','mouseup','click','keydown','keyup','submit']) document.removeEventListener(type, window.__nexusSmokeClickListener, true); return true; })()");
  const profileReload = await navigateToNewDocument(cdp, await evaluate(cdp, "location.href"));
  await revealMobileChrome(cdp);
  await openPersonalAccountCenter(cdp, "account center navigation after reload");
  await getByRole(cdp, "tab", "个人资料").waitFor();
  const persistedProfileExpression = buildLabelLocatorExpression("昵称", "return node.value === " + JSON.stringify(title) + ";");
  let profilePersisted = false;
  let profilePersistenceError;
  for (let attempt = 0; attempt < 3 && !profilePersisted; attempt += 1) {
    try {
      await waitFor(cdp, persistedProfileExpression, "profile nickname persistence after confirmed reload", 5_000);
      profilePersisted = true;
    } catch (error) {
      profilePersistenceError = error;
      if (attempt < 2) {
        await openPersonalAccountCenter(cdp, "account center re-navigation after draft recovery");
        await getByRole(cdp, "tab", "个人资料").waitFor();
      }
    }
  }
  if (!profilePersisted) {
    const diagnostic = await evaluate(cdp, `(() => { const visible=${visibleNode}; const name=${accessibleName}; return {inputs:[...document.querySelectorAll('input,textarea')].filter(visible).map((node)=>({name:name(node),value:node.value})),alerts:[...document.querySelectorAll('[role="alert"],[role="status"]')].filter(visible).map((node)=>node.textContent?.replace(/\s+/g,' ').trim()).filter(Boolean).slice(-10)}; })()`);
    const profileRequests = evidence.requests.filter(({ url }) => url === "/api/v2/profile").slice(-6).map(({ method, url }) => ({ method, url }));
    throw new Error(`${profilePersistenceError instanceof Error ? profilePersistenceError.message : String(profilePersistenceError)}; profile reload diagnostic=${JSON.stringify({ diagnostic, profileRequests })}`);
  }

  const avatarCapture = await installRawAvatarCapture(cdp);
  await setFileInput(cdp, externalPath(options.avatarFile, AVATAR_ENV));
  await waitFor(cdp, buildRoleLocatorExpression("button", "上传头像", "return !node.disabled;"), "avatar upload ready", 30_000);
  const uploadAvatarButton = getByRole(cdp, "button", "上传头像");
  await uploadAvatarButton.click("center");
  await new Promise((resolveResult) => setTimeout(resolveResult, 250));
  if (!avatarCapture.state.request) {
    const uploadPoint = await stableClickPoint(cdp, roleNodeExpression("button", "上传头像"), "touch-compatible avatar upload", "center");
    await dispatchTouchCompatibleClick(cdp, uploadPoint);
    await new Promise((resolveResult) => setTimeout(resolveResult, 250));
  }
  if (!avatarCapture.state.request) {
    await uploadAvatarButton.focus();
    await pressKey(cdp, "Enter");
  }
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
  await openAccountMenu(cdp, "account menu focus restore");
  await pressKey(cdp, "Escape");
  if (!await evaluate(cdp, "document.activeElement?.getAttribute('aria-label') === '账户' && document.querySelector('[role=menu]') === null")) throw new Error("Account menu focus was not restored after Escape");

  await getByRole(cdp, "button", "笔记").waitFor();
  await getByRole(cdp, "button", "笔记").click();
  const inspectorOpener = getByRole(cdp, "button", "打开笔记信息");
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
  if (!await evaluate(cdp, "document.activeElement === document.querySelector('button[aria-label=\\\"打开笔记信息\\\"]')")) throw new Error("Inspector opener focus was not restored");

  const editor = getByLabel(cdp, "笔记内容");
  await editor.waitFor();
  await editor.focus();
  await enterKeyboardViewport(cdp);
  let mobile;
  try {
    await new Promise((resolveResult) => setTimeout(resolveResult, 250));
    await waitFor(cdp, buildSafeClickPointExpression("document.querySelector(\"textarea[aria-label='笔记内容']\")", "center"), "keyboard editor visible", 15_000);
    await editor.focus();
    await cdp.send("Input.insertText", { text: " mobile keyboard" });
    mobile = await evaluate(cdp, "(() => { const node=document.querySelector(\"textarea[aria-label='笔记内容']\"); const rect=node?.getBoundingClientRect(); const visualHeight=window.visualViewport?.height ?? 0; const layoutHeight=window.innerHeight; const keyboardInset=Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--keyboard-inset')) || 0; return {focused:document.activeElement===node,inserted:node?.value.includes('mobile keyboard')===true,bottom:rect?.bottom??0,visualViewportHeight:visualHeight,layoutViewportHeight:layoutHeight,keyboardInset}; })()");
    const visualViewportKeyboard = mobile.visualViewportHeight < mobile.layoutViewportHeight && mobile.keyboardInset > 0;
    const reducedLayoutKeyboard = mobile.layoutViewportHeight <= 500 && mobile.visualViewportHeight <= 500;
    mobile.mode = visualViewportKeyboard ? "visual-viewport" : reducedLayoutKeyboard ? "reduced-layout" : "unsupported";
    if (!mobile.focused || !mobile.inserted || (!visualViewportKeyboard && !reducedLayoutKeyboard) || mobile.bottom > mobile.visualViewportHeight) throw new Error("Mobile keyboard/focus gate failed: " + JSON.stringify(mobile));
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
  await revealMobileChrome(cdp);
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

export async function startBrowserSession(url, options = {}) {
  const browserPath = options.browserPath ?? await findBrowser();
  const debugPort = port();
  const temporaryProfile = options.userDataDir ? null : mkdtempSync(join(tmpdir(), "nexus-beta-browser-gate-"));
  const userDataDir = options.userDataDir
    ? externalPath(options.userDataDir, PROFILE_ENV, "directory")
    : temporaryProfile;
  const browser = spawn(browserPath, [
    "--remote-debugging-port=" + debugPort,
    "--user-data-dir=" + userDataDir,
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
  let diagnostics;
  try {
    await fetchJson("http://127.0.0.1:" + debugPort + "/json/version");
    const target = await openTarget(debugPort, url);
    cdp = connect(target.webSocketDebuggerUrl);
    diagnostics = attachBrowserDiagnostics(cdp);
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Network.enable");
    await cdp.send("Emulation.setDeviceMetricsOverride", MOBILE_LAYOUT_METRICS);
    return {
      cdp,
      debugPort,
      diagnostics,
      async close() {
        diagnostics?.close();
        cdp?.close();
        await stop(browser);
        if (temporaryProfile) {
          try { rmSync(temporaryProfile, { recursive: true, force: true }); } catch { /* best effort */ }
        }
      },
    };
  } catch (error) {
    diagnostics?.close();
    cdp?.close();
    await stop(browser);
    if (temporaryProfile) {
      try { rmSync(temporaryProfile, { recursive: true, force: true }); } catch { /* best effort */ }
    }
    if (errors.length) error.message += "; browser=" + errors.join("").slice(-500);
    throw error;
  }
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.publicShell && !options.userDataDir) {
    printBlocked("AUTHENTICATED_PROFILE_UNSET");
    process.exitCode = 2;
    return;
  }
  if (!options.publicShell && !options.avatarFile) {
    printBlocked("AVATAR_FIXTURE_UNSET", [AVATAR_ENV]);
    process.exitCode = 2;
    return;
  }
  try {
    if (options.userDataDir) options.userDataDir = externalPath(options.userDataDir, PROFILE_ENV, "directory");
  } catch {
    printBlocked("AUTHENTICATED_PROFILE_INVALID", [PROFILE_ENV]);
    process.exitCode = 2;
    return;
  }
  try {
    if (options.avatarFile) options.avatarFile = externalPath(options.avatarFile, AVATAR_ENV, "file");
  } catch {
    printBlocked("AUTHENTICATED_FIXTURE_INVALID", [AVATAR_ENV]);
    process.exitCode = 2;
    return;
  }
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
  let diagnostics;
  try {
    await fetchJson("http://127.0.0.1:" + debugPort + "/json/version");
    const target = await openTarget(debugPort, options.url);
    cdp = connect(target.webSocketDebuggerUrl);
    diagnostics = attachBrowserDiagnostics(cdp);
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Network.enable");
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    if (options.sessionToken) {
      await seedAuthenticatedSession(cdp, options.url, options.sessionToken);
      await navigateToNewDocument(cdp, options.url);
    }
    const evidence = networkEvidence(cdp);
    const publicEvidence = await runPublicShell(cdp);
    if (diagnostics.state.consoleErrors > 0 || diagnostics.state.exceptionCount > 0) {
      throw new Error("Beta browser runtime diagnostics reported an error");
    }
    console.log(JSON.stringify({ status: "PASS", scenario: "public-shell", evidence: { ...publicEvidence, diagnostics: diagnostics.state } }));
    if (options.publicShell) return;
    console.log(JSON.stringify({ status: "PASS", scenario: "authenticated-phase1", evidence: await runAuthenticated(cdp, options, evidence) }));
    if (options.cleanupRecovery) {
      console.log(JSON.stringify({ status: "PASS", scenario: "authenticated-cleanup-recovery", evidence: await runCleanupRecovery(cdp, debugPort, options) }));
    }
  } finally {
    diagnostics?.close();
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
