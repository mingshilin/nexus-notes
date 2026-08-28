import { describe, expect, it } from "vitest";
import {
  CACHED_PAGE_BUDGET_MS,
  NAVIGATION_SHELL_BUDGET_MS,
  buildNavigationPerformanceExpression,
  parseBrowserGateOutput,
} from "../../../scripts/smoke-beta-browser.mjs";

describe("browser navigation performance budgets", () => {
  it("keeps the shell and cached-page budgets explicit", () => {
    expect(NAVIGATION_SHELL_BUDGET_MS).toBe(100);
    expect(CACHED_PAGE_BUDGET_MS).toBe(250);
  });

  it("builds a navigation timing expression without reading page content", () => {
    const expression = buildNavigationPerformanceExpression();

    expect(expression).toContain("domContentLoadedEventEnd");
    expect(expression).toContain("firstContentfulPaint");
    expect(expression).toContain("navigationStart");
    expect(expression).not.toContain("innerText");
    expect(expression).not.toContain("textContent");
  });

  it("parses machine-readable browser PASS and BLOCKED results", () => {
    expect(parseBrowserGateOutput('{"status":"PASS","scenario":"navigation"}')).toEqual({
      status: "PASS",
      scenario: "navigation",
    });
    expect(parseBrowserGateOutput('{"status":"BLOCKED","scenario":"ai-assistant","reason":"AUTHENTICATED_PROFILE_UNSET"}')).toEqual({
      status: "BLOCKED",
      scenario: "ai-assistant",
      reason: "AUTHENTICATED_PROFILE_UNSET",
    });
  });
});
