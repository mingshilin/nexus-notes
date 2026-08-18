import { toast } from "sonner";
import {
  batchDatabaseNotes,
  createDatabase,
  createDatabaseNote,
  createDatabaseProperty,
  createDatabaseTemplate,
  createDatabaseView,
  deleteDatabase,
  deleteDatabaseProperty,
  deleteDatabaseTemplate,
  deleteDatabaseView,
  exportDatabaseCsv,
  getDatabaseDuplicateGroups,
  importDatabaseCsv,
  updateDatabase,
  updateDatabaseProperty,
  updateDatabaseTemplate,
  updateDatabaseView,
  updateNoteDatabaseMembership,
  updateNoteDatabaseValues,
} from "@/api/databases";
import { updateNote } from "@/api/notes";
import type {
  Database,
  DatabaseDuplicateGroup,
  DatabaseProperty,
  DatabaseRecordTemplate,
  DatabaseView,
  DatabaseViewKind,
  UpdateDatabaseNoteValuesPayload,
} from "@/types/database";
import type { NoteWithTags } from "@/types/note";
import type { LibraryView } from "@/store/useAppStore";

type DatabaseBatchPayload = {
  note_ids: string[];
  action: "archive" | "unarchive" | "duplicate" | "update_values";
  values?: Array<{
    property_id: string;
    value_text?: string | null;
    value_number?: number | null;
    value_boolean?: boolean | null;
    value_date?: string | null;
    value_json?: string[] | null;
  }>;
};

type DatabaseValuePayload = {
  property_id: string;
  value_text?: string | null;
  value_number?: number | null;
  value_boolean?: boolean | null;
  value_date?: string | null;
  value_json?: string[] | null;
};

interface UseDatabaseMutationsParams {
  databases: Database[];
  notes: NoteWithTags[];
  selectedDatabaseId: string | null;
  currentDatabase: Database | null;
  currentDatabasePreference?: { activeSavedViewId: string | null };
  databaseName: string;
  databaseDescription: string;
  databaseIcon: string;
  databaseInitialStatus: boolean;
  databaseInitialDate: boolean;
  assertCanWrite: () => void;
  setDatabases: (databases: Database[]) => void;
  setDatabaseProperties: (properties: DatabaseProperty[]) => void;
  setDatabaseTemplates: (templates: DatabaseRecordTemplate[]) => void;
  setDatabaseDuplicateGroups: (groups: DatabaseDuplicateGroup[]) => void;
  setDatabaseDialogOpen: (value: boolean) => void;
  setSelectedDatabaseId: (id: string | null) => void;
  setLibraryView: (view: LibraryView) => void;
  setNotes: (notes: NoteWithTags[]) => void;
  upsertNote: (note: NoteWithTags) => void;
  selectNote: (id: string) => Promise<void>;
  refreshDataSilently: (reason: string, lightweight?: boolean, debounceMs?: number) => void;
  navigateToListView: (
    view: Exclude<LibraryView, "graph" | "knowledge" | "reminders">,
    options?: { folderId?: string | null; tagId?: string | null; favoriteOnly?: boolean; databaseId?: string | null },
  ) => void;
  loadSelectedDatabaseChrome: (databaseId: string) => Promise<unknown>;
  setDatabaseViewPreference: (databaseId: string, patch: { savedViews?: DatabaseView[]; activeSavedViewId?: string | null }) => void;
}

export function useDatabaseMutations(params: UseDatabaseMutationsParams) {
  const {
    databases,
    notes,
    selectedDatabaseId,
    currentDatabase,
    currentDatabasePreference,
    databaseName,
    databaseDescription,
    databaseIcon,
    databaseInitialStatus,
    databaseInitialDate,
    assertCanWrite,
    setDatabases,
    setDatabaseProperties,
    setDatabaseTemplates,
    setDatabaseDuplicateGroups,
    setDatabaseDialogOpen,
    setSelectedDatabaseId,
    setLibraryView,
    setNotes,
    upsertNote,
    selectNote,
    refreshDataSilently,
    navigateToListView,
    loadSelectedDatabaseChrome,
    setDatabaseViewPreference,
  } = params;

  async function handleCreateDatabase() {
    assertCanWrite();
    const created = await createDatabase({
      name: databaseName.trim(),
      description: databaseDescription.trim(),
      icon: databaseIcon.trim(),
      initial_status_property: databaseInitialStatus,
      initial_date_property: databaseInitialDate,
      bind_board_property: databaseInitialStatus,
      bind_calendar_property: databaseInitialDate,
    });
    setDatabases([...databases, created]);
    setDatabaseDialogOpen(false);
    navigateToListView("database", { databaseId: created.id });
    await loadSelectedDatabaseChrome(created.id);
    toast.success("数据库已创建");
  }

  async function handleCreateDatabaseNote(templateId?: string | null) {
    if (!selectedDatabaseId) return;
    assertCanWrite();
    const created = await createDatabaseNote(selectedDatabaseId, templateId);
    upsertNote(created);
    setNotes([created, ...notes.filter((item) => item.id !== created.id)]);
    await selectNote(created.id);
    refreshDataSilently("database-note-create");
  }

  async function handleDeleteCurrentDatabase() {
    if (!selectedDatabaseId) return;
    assertCanWrite();
    await deleteDatabase(selectedDatabaseId);
    setDatabases(databases.filter((item) => item.id !== selectedDatabaseId));
    setDatabaseProperties([]);
    setDatabaseTemplates([]);
    setDatabaseDuplicateGroups([]);
    setSelectedDatabaseId(null);
    setLibraryView("all");
    toast.success("数据库已删除，原有笔记已移出数据库");
    refreshDataSilently("database-delete", false, 100);
  }

  async function handleUpdateDatabaseInfo(payload: { name?: string; description?: string | null; icon?: string | null }) {
    if (!selectedDatabaseId) return;
    assertCanWrite();
    const updated = await updateDatabase(selectedDatabaseId, payload);
    setDatabases(databases.map((item) => (item.id === updated.id ? updated : item)));
    toast.success("数据库信息已更新");
  }

  async function handleCreateDatabaseProperty(payload: { name: string; type: DatabaseProperty["type"] }) {
    if (!selectedDatabaseId) return;
    assertCanWrite();
    const updated = await createDatabaseProperty(selectedDatabaseId, payload);
    setDatabaseProperties(updated);
    toast.success("属性已添加");
  }

  async function handleUpdateDatabaseProperty(propertyId: string, payload: { name?: string; sort_order?: number; config?: Record<string, unknown> }) {
    if (!selectedDatabaseId) return;
    assertCanWrite();
    const updated = await updateDatabaseProperty(selectedDatabaseId, propertyId, payload);
    setDatabaseProperties(updated);
  }

  async function handleDeleteDatabaseProperty(propertyId: string) {
    if (!selectedDatabaseId) return;
    assertCanWrite();
    const updated = await deleteDatabaseProperty(selectedDatabaseId, propertyId);
    setDatabaseProperties(updated);
    toast.success("属性已删除");
  }

  async function handleCreateSavedDatabaseView(payload: {
    name: string;
    view: DatabaseViewKind;
    visibleColumnIds: string[];
    filterQuery: string;
    filterPropertyId: string;
    filterPropertyValue: string;
    advancedFilter: DatabaseView["advancedFilter"];
    sortField: string;
    sortDirection: DatabaseView["sortDirection"];
  }) {
    if (!selectedDatabaseId) return;
    assertCanWrite();
    const views = await createDatabaseView(selectedDatabaseId, payload);
    const created = views.find((view) => view.name === payload.name) ?? views[0] ?? null;
    setDatabaseViewPreference(selectedDatabaseId, {
      savedViews: views,
      activeSavedViewId: created?.id ?? null,
    });
  }

  async function handleUpdateSavedDatabaseView(viewId: string, payload: Partial<DatabaseView>) {
    if (!selectedDatabaseId) return;
    assertCanWrite();
    const views = await updateDatabaseView(selectedDatabaseId, viewId, payload);
    setDatabaseViewPreference(selectedDatabaseId, { savedViews: views });
  }

  async function handleDeleteSavedDatabaseView(viewId: string) {
    if (!selectedDatabaseId) return;
    assertCanWrite();
    const views = await deleteDatabaseView(selectedDatabaseId, viewId);
    setDatabaseViewPreference(selectedDatabaseId, {
      savedViews: views,
      activeSavedViewId: currentDatabasePreference?.activeSavedViewId === viewId ? null : currentDatabasePreference?.activeSavedViewId ?? null,
    });
  }

  async function handleExportCurrentDatabaseCsv() {
    if (!selectedDatabaseId) return;
    await exportDatabaseCsv(selectedDatabaseId);
  }

  async function handleImportCurrentDatabaseCsv(file: File) {
    if (!selectedDatabaseId) return;
    assertCanWrite();
    const result = await importDatabaseCsv(selectedDatabaseId, file);
    setDatabaseProperties(result.properties);
    setNotes(result.notes);
    toast.success(`已导入 ${result.imported} 条记录`);
    if (result.warnings.length > 0) {
      toast(`导入提示：${result.warnings.slice(0, 2).join("；")}`);
    }
    refreshDataSilently("database-csv-import");
  }

  async function handleCreateCurrentDatabaseTemplate(payload: { name: string; title?: string; content?: string; default_values?: UpdateDatabaseNoteValuesPayload["values"] }) {
    if (!selectedDatabaseId) return;
    assertCanWrite();
    const templates = await createDatabaseTemplate(selectedDatabaseId, payload);
    setDatabaseTemplates(templates);
    toast.success("数据库模板已保存");
  }

  async function handleUpdateCurrentDatabaseTemplate(templateId: string, payload: { name?: string; title?: string; content?: string }) {
    if (!selectedDatabaseId) return;
    assertCanWrite();
    const templates = await updateDatabaseTemplate(selectedDatabaseId, templateId, payload);
    setDatabaseTemplates(templates);
  }

  async function handleDeleteCurrentDatabaseTemplate(templateId: string) {
    if (!selectedDatabaseId) return;
    assertCanWrite();
    const templates = await deleteDatabaseTemplate(selectedDatabaseId, templateId);
    setDatabaseTemplates(templates);
  }

  async function handleBatchCurrentDatabaseNotes(payload: DatabaseBatchPayload) {
    if (!selectedDatabaseId) return;
    assertCanWrite();
    const updated = await batchDatabaseNotes(selectedDatabaseId, payload);
    setNotes(updated);
    setDatabaseDuplicateGroups(await getDatabaseDuplicateGroups(selectedDatabaseId).catch(() => []));
    refreshDataSilently("database-batch");
  }

  async function handleUpdateDatabaseFields(payload: { board_property_id?: string | null; calendar_property_id?: string | null }) {
    if (!selectedDatabaseId || !currentDatabase) return;
    assertCanWrite();
    const updated = await updateDatabase(selectedDatabaseId, payload);
    setDatabases(databases.map((item) => (item.id === updated.id ? updated : item)));
  }

  async function handleUpdateNoteDatabaseValue(noteId: string, payload: DatabaseValuePayload) {
    assertCanWrite();
    const updated = await updateNoteDatabaseValues(noteId, { values: [payload] });
    upsertNote(updated);
    setNotes(notes.map((item) => (item.id === updated.id ? updated : item)));
  }

  async function handleUpdateNoteDatabaseMembershipValue(noteId: string, databaseId: string | null) {
    assertCanWrite();
    const updated = await updateNoteDatabaseMembership(noteId, databaseId);
    upsertNote(updated);
    refreshDataSilently("database-membership-update");
  }

  async function handleUpdateNoteTitleInDatabase(noteId: string, title: string) {
    assertCanWrite();
    const updated = await updateNote(noteId, { title });
    upsertNote(updated);
    setNotes(notes.map((item) => (item.id === updated.id ? updated : item)));
  }

  return {
    handleCreateDatabase,
    handleCreateDatabaseNote,
    handleDeleteCurrentDatabase,
    handleUpdateDatabaseInfo,
    handleCreateDatabaseProperty,
    handleUpdateDatabaseProperty,
    handleDeleteDatabaseProperty,
    handleCreateSavedDatabaseView,
    handleUpdateSavedDatabaseView,
    handleDeleteSavedDatabaseView,
    handleExportCurrentDatabaseCsv,
    handleImportCurrentDatabaseCsv,
    handleCreateCurrentDatabaseTemplate,
    handleUpdateCurrentDatabaseTemplate,
    handleDeleteCurrentDatabaseTemplate,
    handleBatchCurrentDatabaseNotes,
    handleUpdateDatabaseFields,
    handleUpdateNoteDatabaseValue,
    handleUpdateNoteDatabaseMembershipValue,
    handleUpdateNoteTitleInDatabase,
  };
}
