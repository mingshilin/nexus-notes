import { describe, expect, it, vi } from "vitest";

type WorkerExports = Record<string, unknown>;

async function loadWorker() {
  return (await import("../src")) as WorkerExports;
}

const context = { workspaceId: "ws-1", userId: "user-1", role: "editor", capabilities: new Set<string>() };
const operation = {
  operation_id: "op-1", workspace_id: "ws-1", entity_type: "note" as const, entity_id: "note-1",
  base_revision: 1, kind: "update" as const, patch: { title: "Local" },
  created_at: "2026-08-24T00:00:00.000Z",
};

describe("SyncService", () => {
  it("applies workspace operations, records successful results, and returns a cursor", async () => {
    const worker = await loadWorker();
    expect(worker.SyncService).toBeTypeOf("function");
    const repository = {
      getProcessed: vi.fn(async () => null),
      apply: vi.fn(async () => ({ operation_id: "op-1", status: "applied" as const, revision: 2 })),
      recordProcessed: vi.fn(async () => undefined),
      latestCursor: vi.fn(async () => "22"),
      pull: vi.fn(async () => ({ changes: [], next_cursor: "22" })),
    };
    const Service = worker.SyncService as new (repository: typeof repository) => any;
    const service = new Service(repository);

    await expect(service.push(context, { operations: [operation] })).resolves.toEqual({
      operations: [{ operation_id: "op-1", status: "applied", revision: 2 }], next_cursor: "22",
    });
    expect(repository.apply).toHaveBeenCalledWith(context, operation);
    expect(repository.recordProcessed).toHaveBeenCalledWith("ws-1", operation, expect.objectContaining({ status: "applied" }));
  });

  it("returns duplicate results without applying an operation twice", async () => {
    const worker = await loadWorker();
    const repository = {
      getProcessed: vi.fn(async () => ({ operation_id: "op-1", status: "applied" as const, revision: 2 })),
      apply: vi.fn(), recordProcessed: vi.fn(), latestCursor: vi.fn(async () => "22"),
    };
    const Service = worker.SyncService as new (repository: typeof repository) => any;
    const service = new Service(repository);

    await expect(service.push(context, { operations: [operation] })).resolves.toMatchObject({
      operations: [{ operation_id: "op-1", status: "duplicate", revision: 2 }],
    });
    expect(repository.apply).not.toHaveBeenCalled();
    expect(repository.recordProcessed).not.toHaveBeenCalled();
  });

  it("does not persist conflicts and rejects operations from another workspace", async () => {
    const worker = await loadWorker();
    const conflict = { operation_id: "op-1", status: "conflict" as const, error: "NOTE_CONFLICT" };
    const repository = {
      getProcessed: vi.fn(async () => null),
      apply: vi.fn(async () => conflict), recordProcessed: vi.fn(), latestCursor: vi.fn(async () => null),
    };
    const Service = worker.SyncService as new (repository: typeof repository) => any;
    const service = new Service(repository);
    const foreign = { ...operation, operation_id: "op-foreign", workspace_id: "ws-other" };

    await expect(service.push(context, { operations: [operation, foreign] })).resolves.toEqual({
      operations: [conflict, { operation_id: "op-foreign", status: "rejected", error: "WORKSPACE_MISMATCH" }],
      next_cursor: null,
    });
    expect(repository.recordProcessed).not.toHaveBeenCalled();
  });

  it("pulls only the caller workspace cursor page", async () => {
    const worker = await loadWorker();
    const repository = { pull: vi.fn(async () => ({ changes: [], next_cursor: "30" })) };
    const Service = worker.SyncService as new (repository: typeof repository) => any;
    const service = new Service(repository);

    await expect(service.pull(context, "29")).resolves.toEqual({ changes: [], next_cursor: "30" });
    expect(repository.pull).toHaveBeenCalledWith(context, "29");
  });
});
