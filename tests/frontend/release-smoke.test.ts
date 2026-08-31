import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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
  function runAuthenticatedGate(args: string[]) {
    const env = { ...process.env };
    delete env.NEXUS_NOTES_BETA_USER_DATA_DIR;
    delete env.NEXUS_NOTES_BETA_AVATAR_FILE;
    delete env.NEXUS_NOTES_BETA_SESSION_TOKEN;
    return spawnSync(process.execPath, [resolve(process.cwd(), "scripts/smoke-beta-browser.mjs"), "--require-auth", ...args], {
      cwd: process.cwd(),
      env,
      encoding: "utf8",
    });
  }

  function runIndependentAuthenticatedGate(script: string, profile: string) {
    const env = { ...process.env };
    env.NEXUS_NOTES_BETA_USER_DATA_DIR = profile;
    delete env.NEXUS_NOTES_BETA_AVATAR_FILE;
    delete env.NEXUS_NOTES_BETA_SESSION_TOKEN;
    env.CHROME_PATH = "C:\\does-not-exist\\nexus-beta-chrome.exe";
    return spawnSync(process.execPath, [resolve(process.cwd(), script)], {
      cwd: process.cwd(),
      env,
      encoding: "utf8",
    });
  }

  it("fails closed with machine-readable BLOCKED output when no external profile is configured", () => {
    const result = runAuthenticatedGate([]);

    expect(result.status).toBe(2);
    expect(result.stdout).not.toContain('"status":"SKIP"');
    expect(JSON.parse(result.stdout.trim())).toMatchObject({
      status: "BLOCKED",
      reason: "AUTHENTICATED_PROFILE_UNSET",
      requiredEnv: ["NEXUS_NOTES_BETA_USER_DATA_DIR"],
      profile: "external",
    });
  });

  it("reports a separate blocked reason when the external profile exists but the avatar fixture is missing", () => {
    const profile = mkdtempSync(join(tmpdir(), "nexus-beta-release-profile-"));
    try {
      const result = runAuthenticatedGate([`--user-data-dir=${profile}`]);
      expect(result.status).toBe(2);
      expect(JSON.parse(result.stdout.trim())).toMatchObject({
        status: "BLOCKED",
        reason: "AVATAR_FIXTURE_UNSET",
        requiredEnv: ["NEXUS_NOTES_BETA_AVATAR_FILE"],
        profile: "external",
      });
    } finally {
      rmSync(profile, { recursive: true, force: true });
    }
  });

  it("reports an invalid external profile without starting a browser", () => {
    const profile = join(tmpdir(), `nexus-beta-profile-does-not-exist-${Date.now()}`);
    const result = runAuthenticatedGate([`--user-data-dir=${profile}`, `--avatar-file=${profile}.png`]);
    expect(result.status).toBe(2);
    expect(JSON.parse(result.stdout.trim())).toMatchObject({
      status: "BLOCKED",
      reason: "AUTHENTICATED_PROFILE_INVALID",
      profile: "external",
    });
  });

  it("validates the external profile before checking the avatar fixture", () => {
    const profile = join(tmpdir(), `nexus-beta-profile-does-not-exist-${Date.now()}`);
    const result = runAuthenticatedGate([`--user-data-dir=${profile}`]);
    expect(result.status).toBe(2);
    expect(JSON.parse(result.stdout.trim())).toMatchObject({
      status: "BLOCKED",
      reason: "AUTHENTICATED_PROFILE_INVALID",
      requiredEnv: ["NEXUS_NOTES_BETA_USER_DATA_DIR"],
      profile: "external",
    });
  });

  it("reports an invalid avatar fixture separately from a valid external profile", () => {
    const profile = mkdtempSync(join(tmpdir(), "nexus-beta-release-profile-"));
    const avatar = join(tmpdir(), `nexus-beta-avatar-does-not-exist-${Date.now()}.png`);
    try {
      const result = runAuthenticatedGate([`--user-data-dir=${profile}`, `--avatar-file=${avatar}`]);
      expect(result.status).toBe(2);
      expect(JSON.parse(result.stdout.trim())).toMatchObject({
        status: "BLOCKED",
        reason: "AUTHENTICATED_FIXTURE_INVALID",
        requiredEnv: ["NEXUS_NOTES_BETA_AVATAR_FILE"],
        profile: "external",
      });
    } finally {
      rmSync(profile, { recursive: true, force: true });
    }
  });

  it("rejects public shell combined with an explicit authenticated mode", () => {
    expect(() => parseArgs(["--public-shell", "--require-auth"])).toThrow(/conflicting/i);
    expect(() => parseArgs(["--public-shell", "--authenticated"])).toThrow(/conflicting/i);
  });

  it("keeps public shell isolated from an inherited authenticated profile", () => {
    vi.stubEnv("NEXUS_NOTES_BETA_USER_DATA_DIR", "C:\\external\\nexus-beta-auth-profile");
    vi.stubEnv("NEXUS_NOTES_BETA_AVATAR_FILE", "C:\\external\\fixtures\\avatar.png");
    try {
      expect(parseArgs(["--public-shell"])).toMatchObject({
        publicShell: true,
        userDataDir: undefined,
        avatarFile: undefined,
        sessionToken: undefined,
        requireAuth: false,
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("lets explicit public-shell mode override the inherited auth requirement", () => {
    vi.stubEnv("NEXUS_NOTES_BETA_REQUIRE_AUTH", "1");
    try {
      expect(parseArgs(["--public-shell"])).toMatchObject({
        publicShell: true,
        requireAuth: false,
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it.each([
    "tests/e2e/ai-assistant-flow.mjs",
    "tests/e2e/navigation-performance.mjs",
  ])("fails closed for a repository-local profile in %s", (script) => {
    const result = runIndependentAuthenticatedGate(script, process.cwd());
    expect(result.status).toBe(2);
    expect(JSON.parse(result.stdout.trim())).toMatchObject({
      status: "BLOCKED",
      reason: "AUTHENTICATED_PROFILE_INVALID",
      profile: "external",
    });
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
