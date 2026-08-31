import { useCallback, useEffect, useRef, useState } from "react";
import { useDatabaseWorkspaceData, type UseDatabaseWorkspaceDataParams } from "./use-database-workspace-data";

export interface UseDatabaseWorkspaceControllerParams extends UseDatabaseWorkspaceDataParams {}

export function useDatabaseWorkspaceController({
  client,
  workspaceId,
  active,
  webClipperOpen,
  refreshVersion,
  resolvedNotificationRecord,
}: UseDatabaseWorkspaceControllerParams) {
  const data = useDatabaseWorkspaceData({
    client,
    workspaceId,
    active,
    webClipperOpen,
    refreshVersion,
    resolvedNotificationRecord,
  });
  const [firstDatabaseName, setFirstDatabaseName] = useState("");
  const [databaseCreateOpen, setDatabaseCreateOpen] = useState(false);
  const [creatingFirstDatabase, setCreatingFirstDatabase] = useState(false);
  const { setDatabaseError, setDatabases, setSelectedDatabaseId } = data;
  const scopeRef = useRef({ workspaceId, client });
  scopeRef.current = { workspaceId, client };

  useEffect(() => {
    setFirstDatabaseName("");
    setDatabaseCreateOpen(false);
    setCreatingFirstDatabase(false);
  }, [client, workspaceId]);

  const createDatabaseFromName = useCallback(async (name: string) => {
    const normalizedName = name.trim();
    if (!workspaceId || !normalizedName || creatingFirstDatabase) return false;
    const requestWorkspaceId = workspaceId;
    const requestClient = client;
    setCreatingFirstDatabase(true);
    setDatabaseError(null);
    try {
      const created = await requestClient.createDatabase({ name: normalizedName, description: "" });
      if (scopeRef.current.workspaceId !== requestWorkspaceId || scopeRef.current.client !== requestClient) return false;
      setDatabases((current) => current.some((database) => database.id === created.id)
        ? current.map((database) => database.id === created.id ? created : database)
        : [...current, created]);
      setSelectedDatabaseId(created.id);
      setFirstDatabaseName("");
      setDatabaseCreateOpen(false);
      return true;
    } catch {
      if (scopeRef.current.workspaceId === requestWorkspaceId && scopeRef.current.client === requestClient) {
        setDatabaseError("数据库暂时无法创建，请稍后重试。");
      }
      return false;
    } finally {
      if (scopeRef.current.workspaceId === requestWorkspaceId && scopeRef.current.client === requestClient) {
        setCreatingFirstDatabase(false);
      }
    }
  }, [client, creatingFirstDatabase, setDatabaseError, setDatabases, setSelectedDatabaseId, workspaceId]);

  return {
    ...data,
    firstDatabaseName,
    setFirstDatabaseName,
    databaseCreateOpen,
    setDatabaseCreateOpen,
    creatingFirstDatabase,
    createDatabaseFromName,
  };
}

export type DatabaseWorkspaceController = ReturnType<typeof useDatabaseWorkspaceController>;
