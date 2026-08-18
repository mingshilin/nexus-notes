import { useEffect, useMemo, useState } from "react";
import {
  getDatabaseDuplicateGroups,
  getDatabaseProperties,
  getDatabaseTemplates,
  getDatabaseViews,
  getDatabases,
} from "@/api/databases";
import type {
  Database,
  DatabaseDuplicateGroup,
  DatabaseProperty,
  DatabaseRecordTemplate,
  DatabaseViewKind,
} from "@/types/database";
import type { DatabaseViewPreference } from "@/store/useAppStore";
import type { AuthUser } from "@/types/auth";

interface UseDatabaseDataParams {
  user: AuthUser | null;
  selectedDatabaseId: string | null;
  databaseViewPreferences: Record<string, DatabaseViewPreference>;
  setDatabaseViewPreference: (databaseId: string, patch: Partial<DatabaseViewPreference>) => void;
}

export function useDatabaseData({
  user,
  selectedDatabaseId,
  databaseViewPreferences,
  setDatabaseViewPreference,
}: UseDatabaseDataParams) {
  const [databases, setDatabases] = useState<Database[]>([]);
  const [databaseProperties, setDatabaseProperties] = useState<DatabaseProperty[]>([]);
  const [databaseTemplates, setDatabaseTemplates] = useState<DatabaseRecordTemplate[]>([]);
  const [databaseDuplicateGroups, setDatabaseDuplicateGroups] = useState<DatabaseDuplicateGroup[]>([]);

  const currentDatabase = useMemo(
    () => (selectedDatabaseId ? databases.find((item) => item.id === selectedDatabaseId) ?? null : null),
    [databases, selectedDatabaseId],
  );
  const currentDatabasePreference = selectedDatabaseId ? databaseViewPreferences[selectedDatabaseId] : undefined;
  const databaseView: DatabaseViewKind = currentDatabasePreference?.view ?? "table";

  function clearDatabaseData() {
    setDatabases([]);
    setDatabaseProperties([]);
    setDatabaseTemplates([]);
    setDatabaseDuplicateGroups([]);
  }

  async function loadDatabaseList() {
    const list = await getDatabases();
    setDatabases(list);
    return list;
  }

  async function loadSelectedDatabaseChrome(databaseId: string) {
    const [properties, templates, duplicateGroups] = await Promise.all([
      getDatabaseProperties(databaseId).catch(() => []),
      getDatabaseTemplates(databaseId).catch(() => []),
      getDatabaseDuplicateGroups(databaseId).catch(() => []),
    ]);
    setDatabaseProperties(properties);
    setDatabaseTemplates(templates);
    setDatabaseDuplicateGroups(duplicateGroups);
    return { properties, templates, duplicateGroups };
  }

  async function loadSavedDatabaseViews(databaseId: string) {
    try {
      const views = await getDatabaseViews(databaseId);
      const activeSavedViewId = databaseViewPreferences[databaseId]?.activeSavedViewId ?? null;
      const activeStillExists = activeSavedViewId ? views.some((view) => view.id === activeSavedViewId) : false;
      setDatabaseViewPreference(databaseId, {
        savedViews: views,
        activeSavedViewId: activeStillExists ? activeSavedViewId : null,
      });
      return views;
    } catch {
      setDatabaseViewPreference(databaseId, { savedViews: [], activeSavedViewId: null });
      return [];
    }
  }

  useEffect(() => {
    if (!user || !selectedDatabaseId) {
      setDatabaseProperties([]);
      setDatabaseTemplates([]);
      setDatabaseDuplicateGroups([]);
      return;
    }
    loadSelectedDatabaseChrome(selectedDatabaseId).catch(() => undefined);
  }, [user?.current_workspace?.id, selectedDatabaseId]);

  useEffect(() => {
    if (!user || !selectedDatabaseId) return;
    loadSavedDatabaseViews(selectedDatabaseId).catch(() => undefined);
  }, [
    databaseViewPreferences[selectedDatabaseId ?? ""]?.activeSavedViewId,
    selectedDatabaseId,
    setDatabaseViewPreference,
    user?.current_workspace?.id,
  ]);

  return {
    databases,
    setDatabases,
    databaseProperties,
    setDatabaseProperties,
    databaseTemplates,
    setDatabaseTemplates,
    databaseDuplicateGroups,
    setDatabaseDuplicateGroups,
    currentDatabase,
    currentDatabasePreference,
    databaseView,
    clearDatabaseData,
    loadDatabaseList,
    loadSelectedDatabaseChrome,
    loadSavedDatabaseViews,
  };
}
