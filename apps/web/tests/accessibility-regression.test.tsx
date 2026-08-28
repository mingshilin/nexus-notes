import { describe, expect, it } from "vitest";
import {
  buildAccessibilityAuditExpression,
  buildSensitiveDiagnosticsExpression,
} from "../../../scripts/smoke-beta-browser.mjs";

describe("browser accessibility regression gates", () => {
  it("builds a 390px audit for one scroll owner and visible named controls", () => {
    const expression = buildAccessibilityAuditExpression(390);

    expect(expression).toContain("data-scroll-owner");
    expect(expression).toContain("scrollWidth");
    expect(expression).toContain("unnamedButtons");
    expect(expression).toContain("unnamedInputs");
    expect(expression).toContain("scrollOwners");
    expect(expression).toContain("390");
  });

  it("builds a diagnostic expression that reports only safe console metadata", () => {
    const expression = buildSensitiveDiagnosticsExpression();

    expect(expression).toContain("consoleErrors");
    expect(expression).toContain("exceptionCount");
    expect(expression).toContain("messageLength");
    expect(expression).not.toContain("localStorage");
    expect(expression).not.toContain("sessionStorage");
    expect(expression).not.toContain("document.cookie");
  });
});
