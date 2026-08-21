import { describe, expect, it } from "vitest";

import { executeView } from "../src/databases/database-view-utils";

const now = "2026-08-21T00:00:00.000Z";
const records = [
  record("exact", { tags: ["a", "b"], members: ["user-1", "user-2"], relations: ["record-1", "record-2"] }),
  record("partial", { tags: ["a"], members: ["user-2"], relations: ["record-2"] }),
  record("prefix", { tags: ["ab"], members: ["user-20"], relations: ["record-20"] }),
  record("empty", { tags: [], members: [], relations: [] }),
  record("missing", {}),
];

function record(id: string, values: Record<string, unknown>) {
  return {
    id, workspace_id: "ws-1", database_id: "db-1", note_id: null, values,
    created_by: "user-1", updated_by: "user-1", revision: 1, created_at: now, updated_at: now,
  };
}

function ids(propertyId: string, operator: string, value?: unknown) {
  const view = {
    id: "view", workspace_id: "ws-1", database_id: "db-1", name: "Filtered", type: "table",
    config: {
      filters: [{ property_id: propertyId, operator, value }], sorts: [], grouping: null,
      visible_columns: [propertyId], page_size: 50, settings: {},
    },
    position: 0, revision: 1, created_at: now, updated_at: now,
  };
  return executeView(records as any, view as any).map((item) => item.id);
}

describe("local saved-view array filters", () => {
  it("uses exact ordered array equality and server-compatible empty semantics", () => {
    expect(ids("tags", "equals", ["a", "b"])).toEqual(["exact"]);
    expect(ids("members", "equals", ["user-1", "user-2"])).toEqual(["exact"]);
    expect(ids("relations", "equals", [])).toEqual(["empty", "missing"]);
    expect(ids("tags", "is_empty")).toEqual(["empty", "missing"]);
    expect(ids("members", "is_not_empty")).toEqual(["exact", "partial", "prefix"]);
  });

  it("uses exact array membership for equals and contains operators", () => {
    expect(ids("tags", "contains", "a")).toEqual(["exact", "partial"]);
    expect(ids("members", "equals", "user-2")).toEqual(["exact", "partial"]);
    expect(ids("relations", "contains", "record-2")).toEqual(["exact", "partial"]);
    expect(ids("relations", "not_contains", "record-1")).toEqual(["empty", "missing", "partial", "prefix"]);
  });
});
