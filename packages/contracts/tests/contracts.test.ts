import { describe, expect, it } from "vitest";

type ContractExports = Record<string, unknown>;

async function loadContracts() {
  return (await import("../src/index")) as ContractExports;
}

describe("public API contracts", () => {
  it("creates success and failure envelopes with request IDs", async () => {
    const contracts = await loadContracts();
    expect(contracts.createSuccessResponse).toBeTypeOf("function");
    expect(contracts.createFailureResponse).toBeTypeOf("function");

    const createSuccessResponse = contracts.createSuccessResponse as (
      data: unknown,
      requestId: string,
      meta?: Record<string, unknown>,
    ) => unknown;
    const createFailureResponse = contracts.createFailureResponse as (
      error: Record<string, unknown>,
      requestId: string,
    ) => unknown;

    expect(createSuccessResponse({ ready: true }, "req-1", { stale: false })).toEqual({
      success: true,
      data: { ready: true },
      meta: { stale: false },
      request_id: "req-1",
    });
    expect(
      createFailureResponse(
        { code: "NOT_FOUND", message: "Missing", retryable: false },
        "req-2",
      ),
    ).toEqual({
      success: false,
      error: {
        code: "NOT_FOUND",
        message: "Missing",
        request_id: "req-2",
        retryable: false,
      },
      request_id: "req-2",
    });
  });

  it("validates cursor pages and rejects an empty opaque cursor", async () => {
    const contracts = await loadContracts();
    expect(contracts.createCursorPageSchema).toBeTypeOf("function");

    const createCursorPageSchema = contracts.createCursorPageSchema as (item: unknown) => {
      safeParse(value: unknown): { success: boolean };
    };
    const { z } = await import("zod");
    const schema = createCursorPageSchema(z.object({ id: z.string() }));

    expect(schema.safeParse({ items: [{ id: "note-1" }], next_cursor: "opaque" }).success).toBe(true);
    expect(schema.safeParse({ items: [], next_cursor: "" }).success).toBe(false);
    expect(schema.safeParse({ items: [], next_cursor: null }).success).toBe(true);
  });

  it("validates replay-safe sync operations", async () => {
    const contracts = await loadContracts();
    expect(contracts.SyncOperationSchema).toBeDefined();

    const schema = contracts.SyncOperationSchema as {
      safeParse(value: unknown): { success: boolean };
    };
    const operation = {
      operation_id: "op-1",
      workspace_id: "ws-1",
      entity_type: "note",
      entity_id: "note-1",
      base_revision: 2,
      kind: "update",
      patch: { title: "Updated" },
      created_at: "2026-08-20T15:00:00.000Z",
    };

    expect(schema.safeParse(operation).success).toBe(true);
    expect(schema.safeParse({ ...operation, base_revision: -1 }).success).toBe(false);
    expect(schema.safeParse({ ...operation, entity_type: "workspace" }).success).toBe(false);
  });

  it("validates upload and queue job bounds", async () => {
    const contracts = await loadContracts();
    expect(contracts.UploadIntentSchema).toBeDefined();
    expect(contracts.QueueJobSchema).toBeDefined();

    const upload = contracts.UploadIntentSchema as {
      safeParse(value: unknown): { success: boolean };
    };
    const job = contracts.QueueJobSchema as {
      safeParse(value: unknown): { success: boolean };
    };

    expect(
      upload.safeParse({ workspace_id: "ws-1", filename: "scan.pdf", mime_type: "application/pdf", size: 25 * 1024 * 1024 }).success,
    ).toBe(true);
    expect(
      upload.safeParse({ workspace_id: "ws-1", filename: "scan.pdf", mime_type: "application/pdf", size: 25 * 1024 * 1024 + 1 }).success,
    ).toBe(false);
    expect(
      job.safeParse({ job_id: "job-1", kind: "ocr", idempotency_key: "ocr:file-1", attempt: 1, deadline: "2026-08-20T15:05:00.000Z", payload: {} }).success,
    ).toBe(true);
  });
});
