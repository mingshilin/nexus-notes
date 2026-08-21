import { describe, expect, it } from "vitest";

type DomainExports = Record<string, unknown>;

async function loadDomain() {
  return (await import("../src/index")) as DomainExports;
}

const property = (id: string, type: string, config: Record<string, unknown> = {}) => ({
  id,
  type,
  config,
  hidden: false,
  read_only: false,
});

describe("database property value normalization", () => {
  it("normalizes every supported property type", async () => {
    const domain = await loadDomain();
    expect(domain.normalizeDatabaseValues).toBeTypeOf("function");
    const normalize = domain.normalizeDatabaseValues as Function;
    const properties = [
      property("text", "text", { max_length: 20 }),
      property("number", "number", { precision: 2 }),
      property("checkbox", "checkbox"),
      property("select", "select", { options: [{ id: "todo" }, { id: "done" }] }),
      property("multi", "multi_select", { options: [{ id: "a" }, { id: "b" }] }),
      property("date", "date"),
      property("url", "url"),
      property("email", "email"),
      property("member", "member", { allow_multiple: true }),
      property("relation", "relation", { allow_multiple: true, target_database_id: "db-2" }),
    ];

    expect(normalize(properties, {
      text: "  hello  ", number: 12.345, checkbox: true, select: "todo", multi: ["b", "a", "b"],
      date: "2024-02-29", url: "https://example.com/path", email: " Person@Example.COM ",
      member: ["user-2", "user-1", "user-2"], relation: ["record-2", "record-1", "record-2"],
    }, { writablePropertyIds: new Set(properties.map((item) => item.id)) })).toEqual({
      text: "hello", number: 12.35, checkbox: true, select: "todo", multi: ["b", "a"],
      date: "2024-02-29", url: "https://example.com/path", email: "person@example.com",
      member: ["user-2", "user-1"], relation: ["record-2", "record-1"],
    });
  });

  it("rejects unknown, hidden, read-only, unauthorized, and type-invalid fields", async () => {
    const { normalizeDatabaseValues } = await loadDomain() as { normalizeDatabaseValues: Function };
    const writable = new Set(["visible"]);
    const properties = [
      property("visible", "date"),
      { ...property("hidden", "text"), hidden: true },
      { ...property("read-only", "text"), read_only: true },
      property("denied", "text"),
    ];

    for (const [values, code] of [
      [{ unknown: "x" }, "UNKNOWN_FIELD"],
      [{ hidden: "x" }, "HIDDEN_FIELD"],
      [{ "read-only": "x" }, "READ_ONLY_FIELD"],
      [{ denied: "x" }, "FIELD_WRITE_DENIED"],
      [{ visible: "2023-02-29" }, "INVALID_FIELD_VALUE"],
    ] as const) {
      expect(() => normalizeDatabaseValues(properties, values, { writablePropertyIds: writable })).toThrow(expect.objectContaining({ code }));
    }
  });

  it("accepts calendar dates but rejects unsupported date-time values", async () => {
    const { normalizeDatabaseValues } = await loadDomain() as { normalizeDatabaseValues: Function };
    const properties = [property("due", "date")];

    expect(normalizeDatabaseValues(properties, { due: "2026-08-21" })).toEqual({ due: "2026-08-21" });
    expect(() => normalizeDatabaseValues(properties, { due: "2026-08-21T12:30:00.000Z" }))
      .toThrow(expect.objectContaining({ code: "INVALID_FIELD_VALUE", propertyId: "due" }));
  });
});
