import { act, renderHook } from "@testing-library/react";
import { StrictMode, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { DatabaseClient } from "../src/data/database-client";
import type { TaskDatabaseSetup } from "../src/databases/task-database";
import { useTaskDatabaseCreation } from "../src/app/use-task-database-creation";

function StrictModeWrapper({ children }: { children: ReactNode }) {
  return <StrictMode>{children}</StrictMode>;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  return {
    promise: new Promise<T>((next) => { resolve = next; }),
    resolve,
  };
}

function setup(workspaceId: string): TaskDatabaseSetup {
  const database = {
    id: `${workspaceId}-database`,
    workspace_id: workspaceId,
    name: "任务管理",
    description: "",
    icon: null,
    created_by: "user-1",
    revision: 1,
    created_at: "2026-08-24T00:00:00.000Z",
    updated_at: "2026-08-24T00:00:00.000Z",
  };
  return { database, properties: [], views: [], template: {} as never };
}

describe("useTaskDatabaseCreation", () => {
  it("does not publish a late setup from the previous workspace", async () => {
    const pending = deferred<TaskDatabaseSetup>();
    const createSetup = vi.fn()
      .mockImplementationOnce(() => pending.promise)
      .mockResolvedValueOnce(setup("ws-1"));
    const setDatabases = vi.fn();
    const setSelectedDatabaseId = vi.fn();
    const setDatabaseBundle = vi.fn();
    const setDatabaseRecords = vi.fn();
    const setDatabaseRecordsNextCursor = vi.fn();
    const setDatabaseError = vi.fn();
    const setDatabaseRefreshVersion = vi.fn();
    const setActivePane = vi.fn();
    const transitionToDomain = vi.fn();
    const oldClient = {} as DatabaseClient;
    const newClient = {} as DatabaseClient;
    const shared = {
      client: oldClient,
      role: "owner" as const,
      logoutPending: false,
      createSetup,
      setDatabases,
      setSelectedDatabaseId,
      setDatabaseBundle,
      setDatabaseRecords,
      setDatabaseRecordsNextCursor,
      setDatabaseError,
      setDatabaseRefreshVersion,
      setActivePane,
      transitionToDomain,
    };
    const { result, rerender } = renderHook(
      ({ client, workspaceId }) => useTaskDatabaseCreation({ ...shared, client, workspaceId }),
      { initialProps: { client: oldClient, workspaceId: "ws-1" }, wrapper: StrictModeWrapper },
    );
    let creation!: Promise<unknown>;
    act(() => { creation = result.current.create(); });

    rerender({ client: newClient, workspaceId: "ws-2" });
    pending.resolve(setup("ws-1"));

    await expect(creation).resolves.toMatchObject({ status: "rejected" });
    expect(setDatabases).not.toHaveBeenCalled();
    expect(setSelectedDatabaseId).not.toHaveBeenCalled();
    expect(setDatabaseBundle).not.toHaveBeenCalled();
    expect(setDatabaseRecords).not.toHaveBeenCalled();
    expect(setDatabaseRefreshVersion).not.toHaveBeenCalled();
    expect(setActivePane).not.toHaveBeenCalled();
    expect(transitionToDomain).not.toHaveBeenCalled();
  });

  it("keeps setup failures in the Create Center result instead of leaking a database error", async () => {
    const createSetup = vi.fn(async () => { throw new Error("setup failed"); });
    const setDatabaseError = vi.fn();
    const client = {} as DatabaseClient;
    const { result } = renderHook(() => useTaskDatabaseCreation({
      client,
      workspaceId: "ws-1",
      role: "owner",
      logoutPending: false,
      createSetup,
      setDatabases: vi.fn(),
      setSelectedDatabaseId: vi.fn(),
      setDatabaseBundle: vi.fn(),
      setDatabaseRecords: vi.fn(),
      setDatabaseRecordsNextCursor: vi.fn(),
      setDatabaseError,
      setDatabaseRefreshVersion: vi.fn(),
      setActivePane: vi.fn(),
      transitionToDomain: vi.fn(),
    }));

    await expect(result.current.create()).resolves.toEqual({
      status: "rejected",
      message: "任务数据库创建失败，未完成的结构会自动清理；请重试。",
    });
    expect(setDatabaseError).not.toHaveBeenCalled();
  });

  it("does not start a second setup when an A-B-A scope cycle returns before setup settles", async () => {
    const pending = deferred<TaskDatabaseSetup>();
    const createSetup = vi.fn(() => pending.promise);
    const transport = {};
    const oldClient = {} as DatabaseClient;
    const newClient = {} as DatabaseClient;
    const shared = {
      role: "owner" as const,
      logoutPending: false,
      createSetup,
      setDatabases: vi.fn(),
      setSelectedDatabaseId: vi.fn(),
      setDatabaseBundle: vi.fn(),
      setDatabaseRecords: vi.fn(),
      setDatabaseRecordsNextCursor: vi.fn(),
      setDatabaseError: vi.fn(),
      setDatabaseRefreshVersion: vi.fn(),
      setActivePane: vi.fn(),
      transitionToDomain: vi.fn(),
    };
    const first = renderHook(
      () => useTaskDatabaseCreation({ ...shared, client: oldClient, workspaceId: "ws-1", transport }),
    );
    let firstCreation!: Promise<unknown>;
    act(() => { firstCreation = first.result.current.create(); });
    first.unmount();

    const second = renderHook(
      () => useTaskDatabaseCreation({ ...shared, client: newClient, workspaceId: "ws-2", transport }),
    );
    second.unmount();
    const third = renderHook(
      () => useTaskDatabaseCreation({ ...shared, client: oldClient, workspaceId: "ws-1", transport }),
    );
    let secondCreation!: Promise<unknown>;
    act(() => { secondCreation = third.result.current.create(); });

    await expect(secondCreation).resolves.toMatchObject({ status: "rejected" });
    expect(createSetup).toHaveBeenCalledOnce();
    pending.resolve(setup("ws-1"));
    await expect(firstCreation).resolves.toMatchObject({ status: "rejected" });
    let afterSettledCreation!: Promise<unknown>;
    act(() => { afterSettledCreation = third.result.current.create(); });
    await expect(afterSettledCreation).resolves.toEqual({ status: "completed" });
    expect(createSetup).toHaveBeenCalledTimes(2);
    third.unmount();
  });
});
