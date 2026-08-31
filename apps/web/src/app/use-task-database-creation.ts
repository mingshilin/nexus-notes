import { useCallback, useEffect, useMemo, useRef, type Dispatch, type SetStateAction } from "react";
import type { Database, DatabaseRecord, WorkspaceRoleContract } from "@nexus/contracts";
import type { DatabaseBootstrap, DatabaseBundle, DatabaseClient } from "../data/database-client";
import { createTaskDatabase, type TaskDatabaseSetup } from "../databases/task-database";

type CreateTaskDatabaseResult =
  | { status: "completed" }
  | { status: "rejected"; message: string };

interface UseTaskDatabaseCreationParams {
  client: DatabaseClient;
  transport?: object;
  workspaceId?: string;
  role: WorkspaceRoleContract;
  logoutPending: boolean;
  createSetup?: (client: DatabaseClient) => Promise<TaskDatabaseSetup>;
  setDatabases: Dispatch<SetStateAction<Database[]>>;
  setSelectedDatabaseId: Dispatch<SetStateAction<string | null>>;
  setDatabaseBundle: Dispatch<SetStateAction<DatabaseBundle | null>>;
  setDatabaseRecords: Dispatch<SetStateAction<DatabaseRecord[]>>;
  setDatabaseRecordsNextCursor: Dispatch<SetStateAction<string | null>>;
  setDatabaseError: Dispatch<SetStateAction<string | null>>;
  setDatabaseRefreshVersion: Dispatch<SetStateAction<number>>;
  setActivePane(pane: "context" | "canvas"): void;
  transitionToDomain(domain: "databases"): void;
}

interface TaskDatabaseScope {
  client: DatabaseClient;
  workspaceId?: string;
  role: WorkspaceRoleContract;
  logoutPending: boolean;
  token: object;
}

interface TaskDatabaseRequest {
  scopeToken: object;
}

const setupLeases = new WeakMap<object, Map<string, Promise<TaskDatabaseSetup>>>();

function setupLeaseFor(transport: object, workspaceId: string) {
  let leases = setupLeases.get(transport);
  if (!leases) {
    leases = new Map();
    setupLeases.set(transport, leases);
  }
  return leases.get(workspaceId);
}

function setSetupLease(transport: object, workspaceId: string, setup: Promise<TaskDatabaseSetup>) {
  let leases = setupLeases.get(transport);
  if (!leases) {
    leases = new Map();
    setupLeases.set(transport, leases);
  }
  leases.set(workspaceId, setup);
}

function clearSetupLease(transport: object, workspaceId: string, setup: Promise<TaskDatabaseSetup>) {
  const leases = setupLeases.get(transport);
  if (leases?.get(workspaceId) !== setup) return;
  leases.delete(workspaceId);
  if (leases.size === 0) setupLeases.delete(transport);
}

export function useTaskDatabaseCreation({
  client,
  transport,
  workspaceId,
  role,
  logoutPending,
  createSetup = createTaskDatabase,
  setDatabases,
  setSelectedDatabaseId,
  setDatabaseBundle,
  setDatabaseRecords,
  setDatabaseRecordsNextCursor,
  setDatabaseError,
  setDatabaseRefreshVersion,
  setActivePane,
  transitionToDomain,
}: UseTaskDatabaseCreationParams) {
  const mountedRef = useRef(true);
  const requestRef = useRef<TaskDatabaseRequest | null>(null);
  const leaseTransport = transport ?? client;
  const scopeToken = useMemo(() => ({}), [client, logoutPending, role, workspaceId]);
  const scopeRef = useRef<TaskDatabaseScope>({ client, workspaceId, role, logoutPending, token: scopeToken });
  scopeRef.current = { client, workspaceId, role, logoutPending, token: scopeToken };

  const isCurrent = useCallback((request: TaskDatabaseRequest) => {
    const current = scopeRef.current;
    return mountedRef.current
      && requestRef.current === request
      && current.token === request.scopeToken
      && current.client === client
      && current.workspaceId === workspaceId
      && current.role === role
      && !current.logoutPending;
  }, [client, role, workspaceId]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestRef.current = null;
    };
  }, []);

  useEffect(() => () => {
    if (requestRef.current?.scopeToken === scopeToken) requestRef.current = null;
  }, [scopeToken]);

  const abort = useCallback(() => {
    requestRef.current = null;
  }, []);

  const create = useCallback(async (): Promise<CreateTaskDatabaseResult> => {
    const current = scopeRef.current;
    if (
      !mountedRef.current
      || requestRef.current
      || current.token !== scopeToken
      || current.client !== client
      || current.workspaceId !== workspaceId
      || current.role !== role
      || current.role === "viewer"
      || current.logoutPending
    ) return { status: "rejected", message: "当前工作区已切换或没有创建任务数据库的权限。" };
    if (!workspaceId) return { status: "rejected", message: "当前没有可用工作区，暂时无法创建任务数据库。" };
    if (setupLeaseFor(leaseTransport, workspaceId)) return { status: "rejected", message: "当前工作区已有任务数据库正在创建，请稍候。" };

    const request = { scopeToken };
    requestRef.current = request;
    const setupPromise = Promise.resolve().then(() => createSetup(client));
    setSetupLease(leaseTransport, workspaceId, setupPromise);
    try {
      const setup = await setupPromise;
      if (!isCurrent(request)) return { status: "rejected", message: "工作区已切换，任务数据库仍在原工作区处理中。" };
      if (setup.database.workspace_id !== workspaceId) throw new Error("Task database response scope mismatch");
      setDatabases((databases) => [...databases.filter((database) => database.id !== setup.database.id), setup.database]);
      setSelectedDatabaseId(setup.database.id);
      setDatabaseBundle(null);
      setDatabaseRecords([]);
      setDatabaseRecordsNextCursor(null);
      setDatabaseError(null);
      setDatabaseRefreshVersion((version) => version + 1);
      setActivePane("canvas");
      transitionToDomain("databases");
      return { status: "completed" };
    } catch {
      if (!isCurrent(request)) return { status: "rejected", message: "工作区已切换，任务数据库未更新当前页面。" };
      return { status: "rejected", message: "任务数据库创建失败，未完成的结构会自动清理；请重试。" };
    } finally {
      if (requestRef.current === request) requestRef.current = null;
      clearSetupLease(leaseTransport, workspaceId, setupPromise);
    }
  }, [
    client,
    createSetup,
    isCurrent,
    leaseTransport,
    role,
    scopeToken,
    setActivePane,
    setDatabaseBundle,
    setDatabaseError,
    setDatabaseRecords,
    setDatabaseRecordsNextCursor,
    setDatabaseRefreshVersion,
    setDatabases,
    setSelectedDatabaseId,
    transitionToDomain,
    workspaceId,
  ]);

  return { create, abort };
}
