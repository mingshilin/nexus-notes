import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DatabaseBootstrap, DatabaseClient } from "../src/data/database-client";
import { useDatabaseWorkspaceController } from "../src/app/use-database-workspace-controller";

function bootstrap(databaseId = "db-1", name = "项目"): DatabaseBootstrap {
  const database = {
    id: databaseId, workspace_id: "ws-1", name, description: "", icon: null,
    created_by: "u-1", revision: 1, created_at: "2026-08-29T00:00:00.000Z", updated_at: "2026-08-29T00:00:00.000Z",
  };
  return {
    items: [database],
    selected_database_id: database.id,
    bundle: { database, role: "owner", properties: [], views: [], templates: [] },
    records: { items: [], next_cursor: null },
  };
}

describe("useDatabaseWorkspaceController", () => {
  it("exposes bootstrap selection and owns first-database creation state", async () => {
    const created = { ...bootstrap().items[0]!, id: "db-2", name: "路线图" };
    const client = {
      bootstrap: vi.fn(async ({ databaseId }: { databaseId?: string }) => databaseId === "db-2"
        ? { ...bootstrap("db-2", "路线图"), items: [bootstrap().items[0]!, created] }
        : bootstrap()),
      createDatabase: vi.fn(async () => created),
      listDatabases: vi.fn(async () => []),
      listRecords: vi.fn(async () => ({ items: [], next_cursor: null })),
    } as unknown as DatabaseClient;
    const { result } = renderHook(() => useDatabaseWorkspaceController({
      client,
      workspaceId: "ws-1",
      active: true,
      webClipperOpen: false,
      refreshVersion: 0,
      resolvedNotificationRecord: null,
    }));

    await waitFor(() => expect(result.current.databaseBundle?.database.id).toBe("db-1"));
    expect(result.current.selectedDatabaseId).toBe("db-1");
    expect(result.current.firstDatabaseName).toBe("");

    act(() => result.current.setFirstDatabaseName("路线图"));
    await act(async () => {
      await result.current.createDatabaseFromName("路线图");
    });

    expect(client.createDatabase).toHaveBeenCalledWith({ name: "路线图", description: "" });
    expect(result.current.databases.map((database) => database.id)).toEqual(["db-1", "db-2"]);
    expect(result.current.selectedDatabaseId).toBe("db-2");
    expect(result.current.firstDatabaseName).toBe("");
    expect(result.current.databaseCreateOpen).toBe(false);
    expect(result.current.creatingFirstDatabase).toBe(false);
  });

  it("ignores a database creation response from a previous workspace", async () => {
    let resolveCreate!: (value: ReturnType<typeof bootstrap>["items"][number]) => void;
    const pendingCreate = new Promise<ReturnType<typeof bootstrap>["items"][number]>((resolve) => {
      resolveCreate = resolve;
    });
    let resolveNewBootstrap!: (value: DatabaseBootstrap) => void;
    const pendingNewBootstrap = new Promise<DatabaseBootstrap>((resolve) => {
      resolveNewBootstrap = resolve;
    });
    const oldDatabase = bootstrap().items[0]!;
    const oldClient = {
      bootstrap: vi.fn(async () => ({ ...bootstrap(), items: [oldDatabase] })),
      createDatabase: vi.fn(() => pendingCreate),
      listDatabases: vi.fn(async () => []),
      listRecords: vi.fn(async () => ({ items: [], next_cursor: null })),
    } as unknown as DatabaseClient;
    const newClient = {
      bootstrap: vi.fn(() => pendingNewBootstrap),
      createDatabase: vi.fn(),
      listDatabases: vi.fn(async () => []),
      listRecords: vi.fn(async () => ({ items: [], next_cursor: null })),
    } as unknown as DatabaseClient;
    const { result, rerender } = renderHook(
      ({ workspaceId, client }) => useDatabaseWorkspaceController({
        client,
        workspaceId,
        active: true,
        webClipperOpen: false,
        refreshVersion: 0,
        resolvedNotificationRecord: null,
      }),
      { initialProps: { workspaceId: "ws-1", client: oldClient } },
    );

    await waitFor(() => expect(result.current.databaseBundle?.database.id).toBe("db-1"));
    let createResult!: Promise<boolean>;
    act(() => { createResult = result.current.createDatabaseFromName("旧工作区库"); });
    rerender({ workspaceId: "ws-2", client: newClient });
    await waitFor(() => expect(result.current.databases).toEqual([]));
    resolveCreate({ ...oldDatabase, id: "db-old-response", name: "旧工作区库" });
    await act(async () => { await createResult; });

    expect(result.current.databases).toEqual([]);
    expect(result.current.selectedDatabaseId).toBeNull();
    resolveNewBootstrap({ items: [], selected_database_id: null, bundle: null, records: { items: [], next_cursor: null } });
  });
});
