import { describe, expect, it } from "vitest";

describe("sync contracts", () => {
  it("validates pull pages and full change envelopes", async () => {
    const contracts = await import("../src");
    expect(contracts.SyncPullQuerySchema.parse({ cursor: "12" })).toEqual({ cursor: "12" });
    expect(contracts.SyncPullQuerySchema.parse({})).toEqual({});
    expect(contracts.SyncPullQuerySchema.safeParse({ cursor: "-1" }).success).toBe(false);
    expect(contracts.SyncChangeSchema.safeParse({
      cursor: "13", entity_type: "note", entity_id: "note-1", revision: 2,
      kind: "update", payload: { id: "note-1", title: "Updated" },
    }).success).toBe(true);
    expect(contracts.SyncPullResponseSchema.safeParse({ changes: [], next_cursor: null }).success).toBe(true);
  });

  it("rejects malformed sync operations and bounds a push batch", async () => {
    const contracts = await import("../src");
    const operation = {
      operation_id: "op-1", workspace_id: "ws-1", entity_type: "note", entity_id: "note-1",
      base_revision: 0, kind: "create", patch: { title: "Draft", content: "Body" },
      created_at: "2026-08-24T00:00:00.000Z",
    };
    expect(contracts.SyncPushRequestSchema.parse({ operations: [operation] })).toMatchObject({ operations: [operation] });
    expect(contracts.SyncPushRequestSchema.safeParse({ operations: Array.from({ length: 101 }, () => operation) }).success).toBe(false);
    expect(contracts.SyncOperationSchema.safeParse({ ...operation, workspace_id: "" }).success).toBe(false);
  });
});
