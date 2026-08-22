import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("mobile authentication overflow", () => {
  it("keeps the auth page viewport-bound and vertically scrollable when the keyboard reduces height", () => {
    const css = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
    const mobileRules = css.slice(css.indexOf("@media (max-width: 767px)"));

    expect(mobileRules).toMatch(/\.auth-page\s*\{\s*height:\s*100dvh/);
    expect(mobileRules).toMatch(/\.auth-page\s*\{[^}]*min-height:\s*0/);
    expect(mobileRules).toMatch(/\.auth-page\s*\{[^}]*overflow-y:\s*auto/);
  });
});
