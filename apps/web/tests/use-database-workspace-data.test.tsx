import { act, renderHook, waitFor } from "@testing-library/react";
import type { DatabaseBootstrap, DatabaseClient } from "../src/data/database-client";
import type { DatabaseRecord } from "@nexus/contracts";
import { describe, expect, it, vi } from "vitest";

import { useDatabaseWorkspaceData } from "../src/app/use-database-workspace-data";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function bootstrap(databaseId: string, name = databaseId): DatabaseBootstrap {
  return {
    items: [{ id: databaseId, name, description: "", icon: null, workspace_id: "workspace", revision: 1, created_at: "2026-08-28T00:00:00.000Z", updated_at: "2026-08-28T00:00:00.000Z" }],
    selected_database_id: databaseId,
    bundle: {
      database: { id: databaseId, name, description: "", icon: null, workspace_id: "workspace", revision: 1, created_at: "2026-08-28T00:00:00.000Z", updated_at: "2026-08-28T00:00:00.000Z" },
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
      newRequest.resolve(bootstrap("db-new", "New"));
      await newRequest.promise;
    });
    await waitFor(() => expect(result.current.databases[0]?.id).toBe("db-new"));

    await act(async () => {
      oldRequest.resolve(bootstrap("db-old", "Old"));
      await oldRequest.promise;
    });

    expect(result.current.databases[0]?.id).toBe("db-new");
    expect(result.current.databaseBundle?.database.id).toBe("db-new");
  });

  it("adopts the server-selected database without issuing a duplicate bootstrap", async () => {
    const response = bootstrap("db-1", "Projects");
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
});
