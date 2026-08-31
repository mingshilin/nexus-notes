import { act, renderHook, waitFor } from "@testing-library/react";
import type { DatabaseBootstrap, DatabaseClient } from "../src/data/database-client";
import type { DatabaseRecord } from "@nexus/contracts";
import { describe, expect, it, vi } from "vitest";

import { runVerifiedDatabaseMutation, useDatabaseWorkspaceData } from "../src/app/use-database-workspace-data";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function bootstrap(databaseId: string, name = databaseId, workspaceId = "workspace"): DatabaseBootstrap {
  return {
    items: [{ id: databaseId, name, description: "", icon: null, workspace_id: workspaceId, revision: 1, created_at: "2026-08-28T00:00:00.000Z", updated_at: "2026-08-28T00:00:00.000Z" }],
    selected_database_id: databaseId,
    bundle: {
      database: { id: databaseId, name, description: "", icon: null, workspace_id: workspaceId, revision: 1, created_at: "2026-08-28T00:00:00.000Z", updated_at: "2026-08-28T00:00:00.000Z" },
      role: "editor",
      properties: [],
      views: [],
      templates: [],
    },
    records: { items: [], next_cursor: null },
  };
}

function notificationRecord(id: string, workspaceId: string, databaseId: string): DatabaseRecord {
  return {
    id,
    workspace_id: workspaceId,
    database_id: databaseId,
    note_id: null,
    values: {},
    created_by: "user-1",
    updated_by: "user-1",
    revision: 1,
    created_at: "2026-08-28T00:00:00.000Z",
    updated_at: "2026-08-28T00:00:00.000Z",
  };
}

function clientWithBootstrap(loader: DatabaseClient["bootstrap"]) {
  return {
    bootstrap: vi.fn(loader),
    listDatabases: vi.fn(async () => []),
    listRecords: vi.fn(async () => ({ items: [], next_cursor: null })),
  } as unknown as DatabaseClient;
}

describe("useDatabaseWorkspaceData", () => {
  it("runs mutations only for an explicitly verified active database", async () => {
    const mutation = vi.fn(async (databaseId: string) => databaseId);

    await expect(runVerifiedDatabaseMutation(null, mutation)).rejects.toThrow("当前数据库不可用");
    expect(mutation).not.toHaveBeenCalled();
    await expect(runVerifiedDatabaseMutation("db-current", mutation)).resolves.toBe("db-current");
    expect(mutation).toHaveBeenCalledWith("db-current");
  });

  it("ignores a late bootstrap response from the previous workspace", async () => {
    const oldRequest = deferred<DatabaseBootstrap>();
    const newRequest = deferred<DatabaseBootstrap>();
    const oldClient = clientWithBootstrap(() => oldRequest.promise);
    const newClient = clientWithBootstrap(() => newRequest.promise);
    const initialProps = {
      client: oldClient,
      workspaceId: "ws-1",
      active: true,
      webClipperOpen: false,
      refreshVersion: 0,
      resolvedNotificationRecord: null,
    };
    const { result, rerender } = renderHook(
      (props: typeof initialProps) => useDatabaseWorkspaceData(props),
      { initialProps },
    );

    await waitFor(() => expect(oldClient.bootstrap).toHaveBeenCalledOnce());
    rerender({ ...initialProps, client: newClient, workspaceId: "ws-2" });
    await waitFor(() => expect(newClient.bootstrap).toHaveBeenCalledOnce());

    await act(async () => {
      newRequest.resolve(bootstrap("db-new", "New", "ws-2"));
      await newRequest.promise;
    });
    await waitFor(() => expect(result.current.databases[0]?.id).toBe("db-new"));

    await act(async () => {
      oldRequest.resolve(bootstrap("db-old", "Old", "ws-1"));
      await oldRequest.promise;
    });

    expect(result.current.databases[0]?.id).toBe("db-new");
    expect(result.current.databaseBundle?.database.id).toBe("db-new");
  });

  it("adopts the server-selected database without issuing a duplicate bootstrap", async () => {
    const response = bootstrap("db-1", "Projects", "ws-1");
    const client = clientWithBootstrap(async () => response);
    const { result } = renderHook(() => useDatabaseWorkspaceData({
      client,
      workspaceId: "ws-1",
      active: true,
      webClipperOpen: false,
      refreshVersion: 0,
      resolvedNotificationRecord: null,
    }));

    await waitFor(() => expect(result.current.databaseBundle?.database.id).toBe("db-1"));
    expect(client.bootstrap).toHaveBeenCalledOnce();
    expect(result.current.selectedDatabaseId).toBe("db-1");
  });

  it("refuses record pagination when the selected database disagrees with the bundle", async () => {
    const response = bootstrap("db-current", "Current", "workspace");
    const client = clientWithBootstrap(async () => ({
      ...response,
      items: [
        ...response.items,
        { ...response.items[0]!, id: "db-other", name: "Other" },
      ],
      selected_database_id: "db-other",
    }));
    const { result } = renderHook(() => useDatabaseWorkspaceData({
      client,
      workspaceId: "workspace",
      active: true,
      webClipperOpen: false,
      refreshVersion: 0,
      resolvedNotificationRecord: null,
    }));

    await waitFor(() => expect(client.bootstrap).toHaveBeenCalledOnce());
    await waitFor(() => expect(result.current.selectedDatabaseId).toBeNull());
    expect(result.current.databaseBundle).toBeNull();
    expect(result.current.databaseRecords).toEqual([]);
    const page = await result.current.requestDatabasePage({ cursor: null, limit: 50, viewId: "view-current" });

    expect(page).toEqual({ items: [], next_cursor: null });
    expect(client.listRecords).not.toHaveBeenCalled();
  });

  it("clears the previous database bundle before a new database selection can mutate", async () => {
    const first = deferred<DatabaseBootstrap>();
    const second = deferred<DatabaseBootstrap>();
    const client = clientWithBootstrap(() => first.promise);
    const { result, rerender } = renderHook(() => useDatabaseWorkspaceData({
      client,
      workspaceId: "workspace",
      active: true,
      webClipperOpen: false,
      refreshVersion: 0,
      resolvedNotificationRecord: null,
    }));

    await waitFor(() => expect(client.bootstrap).toHaveBeenCalledOnce());
    first.resolve(bootstrap("db-current", "Current"));
    await waitFor(() => expect(result.current.databaseBundle?.database.id).toBe("db-current"));

    client.bootstrap = vi.fn(() => second.promise);
    act(() => result.current.setSelectedDatabaseId("db-next"));
    rerender();

    expect(result.current.databaseBundle).toBeNull();
    expect(result.current.databaseRecords).toEqual([]);
    await waitFor(() => expect(client.bootstrap).toHaveBeenCalledOnce());
  });

  it("reloads when the notification target changes within the same database", async () => {
    const first = deferred<DatabaseBootstrap>();
    const second = deferred<DatabaseBootstrap>();
    let calls = 0;
    const client = clientWithBootstrap(() => calls++ === 0 ? first.promise : second.promise);
    const firstRecord = notificationRecord("record-1", "ws-1", "db-1");
    const secondRecord = notificationRecord("record-2", "ws-1", "db-1");
    const { rerender } = renderHook(
      (record: DatabaseRecord) => useDatabaseWorkspaceData({
        client,
        workspaceId: "ws-1",
        active: true,
        webClipperOpen: false,
        refreshVersion: 0,
        resolvedNotificationRecord: record,
      }),
      { initialProps: firstRecord },
    );

    await waitFor(() => expect(client.bootstrap).toHaveBeenCalledOnce());
    rerender(secondRecord);
    await waitFor(() => expect(client.bootstrap).toHaveBeenCalledTimes(2));
    first.resolve(bootstrap("db-1"));
    second.resolve(bootstrap("db-1"));
    await Promise.all([first.promise, second.promise]);
  });

  it("does not bootstrap twice when an old workspace notification record survives a switch", async () => {
    const oldClient = clientWithBootstrap(async () => bootstrap("db-old"));
    const newClient = clientWithBootstrap(async () => bootstrap("db-new"));
    const oldRecord = notificationRecord("record-old", "ws-old", "db-old");
    const initialProps = {
      client: oldClient,
      workspaceId: "ws-old",
      active: true,
      webClipperOpen: false,
      refreshVersion: 0,
      resolvedNotificationRecord: oldRecord,
    };
    const { rerender } = renderHook(
      (props: typeof initialProps) => useDatabaseWorkspaceData(props),
      { initialProps },
    );

    await waitFor(() => expect(oldClient.bootstrap).toHaveBeenCalledOnce());
    rerender({ ...initialProps, client: newClient, workspaceId: "ws-new" });
    await waitFor(() => expect(newClient.bootstrap).toHaveBeenCalledOnce());
    await Promise.resolve();
    expect(newClient.bootstrap).toHaveBeenCalledOnce();
  });

  it("filters Web Clipper database discovery before updating shared workspace state", async () => {
    const current = bootstrap("db-current", "Current").items[0]!;
    const foreign = { ...current, id: "db-foreign", workspace_id: "foreign-workspace", name: "Foreign" };
    const client = clientWithBootstrap(async () => bootstrap("db-current", "Current"));
    client.listDatabases = vi.fn(async () => [current, foreign]);

    const { result } = renderHook(() => useDatabaseWorkspaceData({
      client,
      workspaceId: "workspace",
      active: false,
      webClipperOpen: true,
      refreshVersion: 0,
      resolvedNotificationRecord: null,
    }));

    await waitFor(() => expect(client.listDatabases).toHaveBeenCalledOnce());
    await waitFor(() => expect(result.current.databases).toEqual([current]));
    expect(result.current.databases).not.toContain(foreign);
  });
});
