import { describe, expect, it, vi } from "vitest";

import {
  INSPECTOR_INERT_NAVIGATION_SELECTOR,
  buildLabelLocatorExpression,
  buildRoleLocatorExpression,
  buildSafeClickPointExpression,
  enterKeyboardViewport,
  parseArgs,
  pressKey,
  restoreMobileGeometry,
  runAuthenticated,
  seedAuthenticatedSession,
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

  it("seeds a short-lived authenticated session without exposing it to page JavaScript", async () => {
    const send = vi.fn().mockResolvedValue({ success: true });
    await seedAuthenticatedSession({ send }, "https://beta.example.test/", "session-token");

    expect(send).toHaveBeenCalledWith("Network.setCookie", expect.objectContaining({
      name: "nexus_session",
      value: "session-token",
      url: "https://beta.example.test/",
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    }));
  });

  it("recognizes the product's implicit nav landmark when it is inert", () => {
    document.body.innerHTML = '<nav aria-label="移动端主导航" inert></nav>';
    expect(document.querySelector(INSPECTOR_INERT_NAVIGATION_SELECTOR)).not.toBeNull();
  });

  it("builds a syntactically valid role locator that finds a visible named button", () => {
    document.body.innerHTML = '<button id="new-note">新建笔记</button>';
    const button = document.getElementById("new-note");
    Object.defineProperty(button, "getBoundingClientRect", {
      value: () => ({ width: 32, height: 32 }),
    });

    const expression = buildRoleLocatorExpression("button", "新建笔记", "return node.id === 'new-note';");
    const runExpression = new Function(`return ${expression};`);

    expect(runExpression()).toBe(true);
  });

  it("prefers an exact control aria-label when visible label copy is shorter", () => {
    document.body.innerHTML = '<label>标题<input aria-label="笔记标题" value="draft"></label>';
    const expression = buildLabelLocatorExpression("笔记标题", "return node.value;");
    const runExpression = new Function(`return ${expression};`);

    expect(runExpression()).toBe("draft");
  });

  it("builds a viewport-safe hit-test point for a visible control", () => {
    document.body.innerHTML = '<button id="account">账户</button>';
    const button = document.getElementById("account");
    Object.defineProperty(button, "getBoundingClientRect", {
      value: () => ({ left: 10, top: 10, right: 42, bottom: 42, width: 32, height: 32 }),
    });
    button.scrollIntoView = vi.fn();
    document.elementsFromPoint = vi.fn(() => [button]);

    const expression = buildSafeClickPointExpression("document.getElementById('account')");
    const point = new Function(`return ${expression};`)();

    expect(point).toMatchObject({ x: 26, y: 26 });
    expect(button.scrollIntoView).toHaveBeenCalledWith({ block: "nearest", inline: "nearest" });
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
      height: 500,
      deviceScaleFactor: 2,
      mobile: true,
    }));
    expect(send).toHaveBeenNthCalledWith(2, "Emulation.setVisibleSize", { width: 390, height: 500 });
    expect(send).toHaveBeenNthCalledWith(3, "Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      mobile: true,
    });
    expect(send).toHaveBeenNthCalledWith(4, "Emulation.setVisibleSize", { width: 390, height: 844 });
  });
});
