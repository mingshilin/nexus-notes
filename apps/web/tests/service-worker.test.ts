import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

type WebExports = Record<string, unknown>;

async function loadWeb() {
  return (await import("../src/index")) as WebExports;
}

describe("Beta Service Worker", () => {
  it("does not activate a new worker before user confirmation", () => {
    const source = readFileSync(resolve(import.meta.dirname, "../public/sw.js"), "utf8");

    expect(source).not.toContain('self.addEventListener("install", () => self.skipWaiting())');
    expect(source).toContain('event.data?.type === "SKIP_WAITING"');
  });

  it("surfaces a waiting version and activates it only after user action", async () => {
    const web = await loadWeb();
    expect(web.registerBetaServiceWorker).toBeTypeOf("function");
    const postMessage = vi.fn();
    const registration = {
      waiting: { postMessage },
      installing: null,
      addEventListener: vi.fn(),
    };
    const serviceWorker = {
      controller: {},
      register: vi.fn(async () => registration),
    };
    const onUpdate = vi.fn();
    const registerBetaServiceWorker = web.registerBetaServiceWorker as (options: Record<string, unknown>) => Promise<unknown>;

    await registerBetaServiceWorker({ serviceWorker, onUpdate });

    expect(serviceWorker.register).toHaveBeenCalledWith("/sw.js", { scope: "/" });
    expect(onUpdate).toHaveBeenCalledOnce();
    const update = onUpdate.mock.calls[0]?.[0] as { activate(): void };
    update.activate();
    expect(postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
  });

  it("handles privacy-safe push notifications and reminder deep links", () => {
    const source = readFileSync(resolve(import.meta.dirname, "../public/sw.js"), "utf8");
    expect(source).toContain('self.addEventListener("push"');
    expect(source).toContain('self.addEventListener("notificationclick"');
    expect(source).toContain('"你有一条提醒"');
    expect(source).toContain("clients.openWindow");
  });
});
