import { describe, expect, it } from "vitest";

type DomainExports = Record<string, unknown>;

async function loadDomain() {
  return (await import("../src/index")) as DomainExports;
}

describe("public Beta security policy", () => {
  it("allows owners and editors to write while viewers remain read-only", async () => {
    const domain = await loadDomain();
    expect(domain.canWorkspaceWrite).toBeTypeOf("function");
    const canWrite = domain.canWorkspaceWrite as (role: string) => boolean;

    expect(canWrite("owner")).toBe(true);
    expect(canWrite("editor")).toBe(true);
    expect(canWrite("viewer")).toBe(false);
  });

  it("uses the approved configurable Beta quota defaults", async () => {
    const domain = await loadDomain();
    expect(domain.DEFAULT_BETA_QUOTAS).toEqual({
      workspaces_per_user: 2,
      members: 10,
      notes: 10_000,
      databases: 100,
      records_per_database: 50_000,
      attachment_bytes: 1024 * 1024 * 1024,
      attachment_file_bytes: 25 * 1024 * 1024,
    });
    expect(domain.assertQuotaAvailable).toBeTypeOf("function");
    const assertQuotaAvailable = domain.assertQuotaAvailable as (
      key: string,
      current: number,
      delta: number,
      override?: number,
    ) => void;

    expect(() => assertQuotaAvailable("notes", 9_999, 1)).not.toThrow();
    expect(() => assertQuotaAvailable("notes", 10_000, 1)).toThrowError(/QUOTA_EXCEEDED/);
    expect(() => assertQuotaAvailable("notes", 15_000, 1, 20_000)).not.toThrow();
  });

  it("normalizes email and rejects weak new passwords", async () => {
    const domain = await loadDomain();
    expect(domain.normalizeEmail).toBeTypeOf("function");
    expect(domain.assertPasswordPolicy).toBeTypeOf("function");
    const normalizeEmail = domain.normalizeEmail as (email: string) => string;
    const assertPasswordPolicy = domain.assertPasswordPolicy as (password: string) => void;

    expect(normalizeEmail("  User@Example.COM ")).toBe("user@example.com");
    expect(() => assertPasswordPolicy("short123")).toThrowError(/PASSWORD_TOO_SHORT/);
    expect(() => assertPasswordPolicy("long-enough-123")).not.toThrow();
  });
});
