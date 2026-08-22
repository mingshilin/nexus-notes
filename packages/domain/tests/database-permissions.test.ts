import { describe, expect, it } from "vitest";

async function loadDomain() {
  return await import("../src/index") as Record<string, unknown>;
}

describe("database permissions and field filtering", () => {
  it("enforces owner/editor/viewer and explicit field permissions", async () => {
    const domain = await loadDomain();
    expect(domain.canUseDatabase).toBeTypeOf("function");
    expect(domain.resolveFieldAccess).toBeTypeOf("function");
    const canUse = domain.canUseDatabase as Function;
    const fieldAccess = domain.resolveFieldAccess as Function;

    expect(canUse("owner", "manage")).toBe(true);
    expect(canUse("owner", "write")).toBe(true);
    expect(canUse("editor", "manage")).toBe(false);
    expect(canUse("editor", "write")).toBe(true);
    expect(canUse("viewer", "read")).toBe(true);
    expect(canUse("viewer", "write")).toBe(false);

    expect(fieldAccess("editor", undefined)).toEqual({ canRead: true, canWrite: true });
    expect(fieldAccess("viewer", undefined)).toEqual({ canRead: true, canWrite: false });
    expect(fieldAccess("owner", { can_read: false, can_write: false })).toEqual({ canRead: true, canWrite: true });
    expect(fieldAccess("editor", { can_read: true, can_write: false })).toEqual({ canRead: true, canWrite: false });
  });

  it("removes hidden and unauthorized fields and values from records and templates", async () => {
    const { filterDatabaseFields } = await loadDomain() as { filterDatabaseFields: Function };
    const properties = [
      { id: "public", hidden: false },
      { id: "hidden", hidden: true },
      { id: "denied", hidden: false },
    ];
    const result = filterDatabaseFields({
      properties,
      readablePropertyIds: new Set(["public", "hidden"]),
      records: [{ id: "record-1", values: { public: "yes", hidden: "secret", denied: "secret" } }],
      templates: [{ id: "template-1", default_values: { public: "yes", hidden: "secret", denied: "secret" } }],
    });

    expect(result).toEqual({
      properties: [{ id: "public", hidden: false }],
      records: [{ id: "record-1", values: { public: "yes" } }],
      templates: [{ id: "template-1", default_values: { public: "yes" } }],
    });
  });
});
