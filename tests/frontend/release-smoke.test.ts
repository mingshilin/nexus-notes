import { describe, expect, it, vi } from "vitest";

import {
  INSPECTOR_INERT_NAVIGATION_SELECTOR,
  enterKeyboardViewport,
  parseArgs,
  pressKey,
  restoreMobileGeometry,
  runAuthenticated,
} from "../../scripts/smoke-beta-browser.mjs";

describe("release browser smoke modes", () => {
  it("rejects public shell combined with an explicit authenticated mode", () => {
    expect(() => parseArgs(["--public-shell", "--require-auth"])).toThrow(/conflicting/i);
    expect(() => parseArgs(["--public-shell", "--authenticated"])).toThrow(/conflicting/i);
  });

  it("keeps cleanup recovery separate from standard authenticated smoke", () => {
    expect(parseArgs(["--require-auth", "--authenticated"]).cleanupRecovery).toBe(false);
    expect(parseArgs(["--require-auth", "--authenticated", "--cleanup-recovery"])).toMatchObject({
      cleanupRecovery: true,
      authenticated: true,
    });
  });

  it("keeps the authenticated scenario call contract aligned with its runner", () => {
    expect(runAuthenticated).toHaveLength(3);
  });

  it("recognizes the product's implicit nav landmark when it is inert", () => {
    document.body.innerHTML = '<nav aria-label="移动端主导航" inert></nav>';
    expect(document.querySelector(INSPECTOR_INERT_NAVIGATION_SELECTOR)).not.toBeNull();
  });

  it("sends real CDP Tab and Shift+Tab key metadata for inspector containment", async () => {
    const send = vi.fn().mockResolvedValue({});
    const cdp = { send };

    await pressKey(cdp, "Tab");
    await pressKey(cdp, "Tab", 8);

    expect(send).toHaveBeenNthCalledWith(1, "Input.dispatchKeyEvent", expect.objectContaining({ type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9, modifiers: 0 }));
    expect(send).toHaveBeenNthCalledWith(3, "Input.dispatchKeyEvent", expect.objectContaining({ type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9, modifiers: 8 }));
  });

  it("restores the mobile layout viewport after the keyboard viewport scenario", async () => {
    const send = vi.fn().mockResolvedValue({});
    const cdp = { send };

    await enterKeyboardViewport(cdp);
    await restoreMobileGeometry(cdp);

    expect(send).toHaveBeenNthCalledWith(1, "Emulation.setDeviceMetricsOverride", expect.objectContaining({
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      mobile: true,
      viewport: { x: 0, y: 0, width: 390, height: 500, scale: 1 },
    }));
    expect(send).toHaveBeenNthCalledWith(2, "Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      mobile: true,
    });
  });
});
