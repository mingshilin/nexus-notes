import { useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CopyPlus,
  Edit3,
  Filter,
  KanbanSquare,
  Plus,
  RotateCcw,
  Settings2,
  Table2,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import type { Database, DatabaseAdvancedFilter, DatabaseFilterOperator, DatabaseProperty, DatabaseView, DatabaseViewKind, DatabaseViewSnapshot, SelectOption } from "@/types/database";
import type { DatabaseDuplicateGroup, DatabaseRecordTemplate } from "@/types/database";
import type { NoteWithTags } from "@/types/note";
import type { DatabaseViewPreference } from "@/store/useAppStore";
import type { DatabaseSortDirection } from "@/types/database";
import type { WorkspaceMember } from "@/types/workspace";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Input } from "@/components/ui/input";
import { DatabaseBoardView } from "@/components/database/DatabaseBoardView";
import { DatabaseCalendarView } from "@/components/database/DatabaseCalendarView";
import { DatabasePropertyManager } from "@/components/database/DatabasePropertyManager";
import { DatabaseTableView } from "@/components/database/DatabaseTableView";
import { DatabaseTableCell } from "@/components/database/DatabaseTableCell";
import { DatabaseToolbar } from "@/components/database/DatabaseToolbar";
import { cn, decodeEscapedUnicode, normalizeDisplayIcon } from "@/lib/utils";

type DatabaseValuePayload = {
  property_id: string;
  value_text?: string | null;
  value_number?: number | null;
  value_boolean?: boolean | null;
  value_date?: string | null;
  value_json?: string[] | null;
};

type OptimisticValues = Record<string, Record<string, DatabaseValuePayload>>;

interface DatabasePageProps {
  database: Database;
  properties: DatabaseProperty[];
  templates?: DatabaseRecordTemplate[];
  duplicateGroups?: DatabaseDuplicateGroup[];
  notes: NoteWithTags[];
  workspaceMembers: WorkspaceMember[];
  activeView: DatabaseViewKind;
  viewPreference?: DatabaseViewPreference;
  selectedNoteId: string | null;
  onViewChange: (view: DatabaseViewKind) => void;
  onPreferenceChange?: (patch: Partial<DatabaseViewPreference>) => void;
  onSelectNote: (id: string) => void;
  onCreateNote: (templateId?: string | null) => void;
  onRequestDeleteDatabase: () => void;
  onUpdateDatabaseInfo: (payload: { name?: string; description?: string | null; icon?: string | null }) => Promise<void> | void;
  onUpdateDatabaseField: (payload: { board_property_id?: string | null; calendar_property_id?: string | null }) => Promise<void> | void;
  onCreateProperty: (payload: { name: string; type: DatabaseProperty["type"] }) => Promise<void> | void;
  onUpdateProperty: (propertyId: string, payload: { name?: string; sort_order?: number; config?: Record<string, unknown> }) => Promise<void> | void;
  onDeleteProperty: (propertyId: string) => Promise<void> | void;
  onUpdateNoteTitle: (noteId: string, title: string) => Promise<void> | void;
  onUpdateNoteValue: (noteId: string, payload: DatabaseValuePayload) => Promise<void> | void;
  onCreateSavedView?: (payload: Omit<DatabaseView, "id" | "database_id" | "created_by_user_id" | "created_at" | "updated_at"> & { name: string }) => Promise<void> | void;
  onUpdateSavedView?: (viewId: string, payload: Partial<DatabaseView>) => Promise<void> | void;
  onDeleteSavedView?: (viewId: string) => Promise<void> | void;
  onExportCsv?: () => Promise<void> | void;
  onImportCsv?: (file: File) => Promise<void> | void;
  onCreateTemplate?: (payload: { name: string; title?: string; content?: string; default_values?: DatabaseValuePayload[] }) => Promise<void> | void;
  onUpdateTemplate?: (templateId: string, payload: { name?: string; title?: string; content?: string; default_values?: DatabaseValuePayload[] }) => Promise<void> | void;
  onDeleteTemplate?: (templateId: string) => Promise<void> | void;
  onBatchNotes?: (payload: { note_ids: string[]; action: "archive" | "unarchive" | "duplicate" | "update_values"; values?: DatabaseValuePayload[] }) => Promise<void> | void;
}

const viewTabs = [
  { key: "table" as const, label: "表格", icon: Table2 },
  { key: "board" as const, label: "看板", icon: KanbanSquare },
  { key: "calendar" as const, label: "日历", icon: CalendarDays },
];

const propertyTypeOptions: Array<{ value: DatabaseProperty["type"]; label: string }> = [
  { value: "url", label: "URL" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
  { value: "rating", label: "Rating" },
  { value: "progress", label: "Progress" },
  { value: "text", label: "文本" },
  { value: "number", label: "数字" },
  { value: "checkbox", label: "复选" },
  { value: "date", label: "日期" },
  { value: "single_select", label: "单选" },
  { value: "multi_select", label: "多选" },
  { value: "member", label: "成员" },
];

const optionColors = ["#6B9EFF", "#34C759", "#FF9500", "#FF3B30", "#AF52DE", "#8E8E93"];
const ungroupedBoardId = "__ungrouped__";
const tablePageSizes = [100, 200, 500] as const;
type TablePageSize = (typeof tablePageSizes)[number];
const boardInitialColumnLimit = 50;
const calendarVisibleNotesPerDay = 5;
const defaultAdvancedFilter: DatabaseAdvancedFilter = { mode: "and", rules: [] };
const advancedFilterOperators: Array<{ value: DatabaseFilterOperator; label: string }> = [
  { value: "contains", label: "包含" },
  { value: "equals", label: "等于" },
  { value: "not_equals", label: "不等于" },
  { value: "gte", label: ">=" },
  { value: "lte", label: "<=" },
  { value: "before", label: "早于" },
  { value: "after", label: "晚于" },
  { value: "on", label: "当天" },
  { value: "has_any", label: "任一" },
  { value: "has_all", label: "全部" },
  { value: "is_empty", label: "为空" },
  { value: "not_empty", label: "非空" },
];

function getOptions(property: DatabaseProperty | null | undefined): SelectOption[] {
  return Array.isArray(property?.config.options) ? property.config.options : [];
}

function getMemberName(member: WorkspaceMember) {
  return member.display_name || member.email || member.user_id;
}

function getEffectiveValue(note: NoteWithTags, property: DatabaseProperty, optimisticValues: OptimisticValues) {
  const optimistic = optimisticValues[note.id]?.[property.id];
  if (optimistic) {
    return {
      property_id: property.id,
      type: property.type,
      value_text: optimistic.value_text,
      value_number: optimistic.value_number,
      value_boolean: optimistic.value_boolean,
      value_date: optimistic.value_date,
      value_json: optimistic.value_json,
    };
  }
  return note.database_values?.[property.id] ?? null;
}

function formatValue(note: NoteWithTags, property: DatabaseProperty, members: WorkspaceMember[], optimisticValues: OptimisticValues) {
  const value = getEffectiveValue(note, property, optimisticValues);
  if (!value) return "";
  if (property.type === "checkbox") return value.value_boolean ? "是" : "否";
  if (property.type === "number" || property.type === "rating" || property.type === "progress") return value.value_number?.toString() ?? "";
  if (property.type === "date") return value.value_date?.slice(0, 10) ?? "";
  if (property.type === "single_select" || property.type === "multi_select") {
    const options = getOptions(property);
    return (value.value_json ?? [])
      .map((id) => options.find((option) => option.id === id)?.name)
      .filter((item): item is string => Boolean(item))
      .join(", ");
  }
  if (property.type === "member") {
    return (value.value_json ?? [])
      .map((id) => members.find((member) => member.user_id === id))
      .filter((member): member is WorkspaceMember => Boolean(member))
      .map(getMemberName)
      .join(", ");
  }
  return value.value_text ?? "";
}

function monthDays(date: Date) {
  const year = date.getFullYear();
  const month = date.getMonth();
  const first = new Date(year, month, 1);
  const firstWeekDay = (first.getDay() + 6) % 7;
  const start = new Date(year, month, 1 - firstWeekDay);
  return Array.from({ length: 42 }, (_, index) => {
    const current = new Date(start);
    current.setDate(start.getDate() + index);
    return current;
  });
}

function getMonthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthFromDateInput(value: string | null | undefined) {
  const normalized = normalizeDateInput(value);
  if (!normalized) return null;
  const [year, month] = normalized.split("-").map(Number);
  if (!year || !month) return null;
  return new Date(year, month - 1, 1);
}

function isSameStringArray(a: string[], b: string[]) {
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

function normalizeTablePageSize(value: number | undefined): TablePageSize {
  return tablePageSizes.includes(value as TablePageSize) ? value as TablePageSize : 100;
}

function normalizeDateInput(value: string | null | undefined) {
  return value ? value.slice(0, 10) : "";
}

function sortNotes(
  notes: NoteWithTags[],
  properties: DatabaseProperty[],
  sortField: string,
  sortDirection: DatabaseSortDirection,
  optimisticValues: OptimisticValues,
) {
  const direction = sortDirection === "asc" ? 1 : -1;
  const property = properties.find((item) => item.id === sortField);
  return [...notes].sort((a, b) => {
    if (sortField === "title") {
      return decodeEscapedUnicode(a.title || "").localeCompare(decodeEscapedUnicode(b.title || ""), "zh-CN") * direction;
    }
    if (sortField === "updated_at" || !property) {
      return a.updated_at.localeCompare(b.updated_at) * direction;
    }
    const left = getEffectiveValue(a, property, optimisticValues);
    const right = getEffectiveValue(b, property, optimisticValues);
    if (property.type === "number" || property.type === "rating" || property.type === "progress") {
      return ((left?.value_number ?? Number.NEGATIVE_INFINITY) - (right?.value_number ?? Number.NEGATIVE_INFINITY)) * direction;
    }
    if (property.type === "date") {
      return (normalizeDateInput(left?.value_date).localeCompare(normalizeDateInput(right?.value_date)) || a.updated_at.localeCompare(b.updated_at)) * direction;
    }
    return formatValue(a, property, [], optimisticValues).localeCompare(formatValue(b, property, [], optimisticValues), "zh-CN") * direction;
  });
}

export function DatabasePage({
  database,
  properties,
  templates = [],
  duplicateGroups = [],
  notes,
  workspaceMembers,
  activeView,
  viewPreference,
  selectedNoteId,
  onViewChange,
  onPreferenceChange,
  onSelectNote,
  onCreateNote,
  onRequestDeleteDatabase,
  onUpdateDatabaseInfo,
  onUpdateDatabaseField,
  onCreateProperty,
  onUpdateProperty,
  onDeleteProperty,
  onUpdateNoteTitle,
  onUpdateNoteValue,
  onCreateSavedView,
  onUpdateSavedView,
  onDeleteSavedView,
  onExportCsv,
  onImportCsv,
  onCreateTemplate,
  onUpdateTemplate,
  onDeleteTemplate,
  onBatchNotes,
}: DatabasePageProps) {
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const [propertyName, setPropertyName] = useState("");
  const [propertyType, setPropertyType] = useState<DatabaseProperty["type"]>("text");
  const [showPropertyManager, setShowPropertyManager] = useState(false);
  const [showViewOptions, setShowViewOptions] = useState(false);
  const [showMobileToolDrawer, setShowMobileToolDrawer] = useState(false);
  const [showDatabaseEditor, setShowDatabaseEditor] = useState(false);
  const [databaseNameDraft, setDatabaseNameDraft] = useState(() => decodeEscapedUnicode(database.name));
  const [databaseDescriptionDraft, setDatabaseDescriptionDraft] = useState(() => decodeEscapedUnicode(database.description ?? ""));
  const [databaseIconDraft, setDatabaseIconDraft] = useState(database.icon ?? "");
  const [calendarMonth, setCalendarMonth] = useState(() => new Date());
  const [editingOptionsPropertyId, setEditingOptionsPropertyId] = useState<string | null>(null);
  const [optionDrafts, setOptionDrafts] = useState<SelectOption[]>([]);
  const [optimisticValues, setOptimisticValues] = useState<OptimisticValues>({});
  const [deletePropertyTargetId, setDeletePropertyTargetId] = useState<string | null>(null);
  const [deleteTemplateTargetId, setDeleteTemplateTargetId] = useState<string | null>(null);
  const [deleteSavedViewTargetId, setDeleteSavedViewTargetId] = useState<string | null>(null);
  const [destructiveActionLoading, setDestructiveActionLoading] = useState(false);
  const [savedViewName, setSavedViewName] = useState("");
  const [selectedRecordIds, setSelectedRecordIds] = useState<string[]>([]);
  const [templateName, setTemplateName] = useState("");
  const [templateTitle, setTemplateTitle] = useState("");
  const [templateContent, setTemplateContent] = useState("");
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [templateDefaultDrafts, setTemplateDefaultDrafts] = useState<Record<string, string>>({});
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [batchPropertyId, setBatchPropertyId] = useState("");
  const [batchValue, setBatchValue] = useState("");
  const [tablePage, setTablePage] = useState(() => viewPreference?.tablePage ?? 1);
  const [tablePageSize, setTablePageSize] = useState<TablePageSize>(() => normalizeTablePageSize(viewPreference?.tablePageSize));
  const [boardColumnLimits, setBoardColumnLimits] = useState<Record<string, number>>({});
  const [expandedCalendarDate, setExpandedCalendarDate] = useState<string | null>(null);
  const didMountTablePagination = useRef(false);
  const activeDatabaseIdRef = useRef(database.id);
  const lastAutoCalendarMonthKeyRef = useRef<string | null>(null);

  const nonTitleProperties = useMemo(() => properties.filter((property) => property.type !== "title"), [properties]);
  const boardProperty = properties.find((property) => property.id === database.board_property_id) ?? null;
  const calendarProperty = properties.find((property) => property.id === database.calendar_property_id) ?? null;
  const boardOptions = boardProperty?.type === "member"
    ? workspaceMembers.map((member) => ({ id: member.user_id, name: getMemberName(member), color: "#6B9EFF" }))
    : boardProperty?.type === "checkbox"
      ? [{ id: "true", name: "已勾选", color: "#34C759" }, { id: "false", name: "未勾选", color: "#8E8E93" }]
      : getOptions(boardProperty);
  const calendarCells = useMemo(() => monthDays(calendarMonth), [calendarMonth]);
  const filterQuery = viewPreference?.filterQuery ?? "";
  const filterPropertyId = viewPreference?.filterPropertyId ?? "";
  const filterPropertyValue = viewPreference?.filterPropertyValue ?? "";
  const advancedFilter = viewPreference?.advancedFilter ?? defaultAdvancedFilter;
  const sortField = viewPreference?.sortField ?? "updated_at";
  const sortDirection = viewPreference?.sortDirection ?? "desc";
  const visibleColumnIds = viewPreference?.visibleColumnIds ?? [];
  const savedViews = viewPreference?.savedViews ?? [];
  const activeSavedViewId = viewPreference?.activeSavedViewId ?? null;
  const effectiveVisibleColumnIds = visibleColumnIds.length > 0 ? visibleColumnIds : nonTitleProperties.map((property) => property.id);
  const visibleProperties = nonTitleProperties.filter((property) => effectiveVisibleColumnIds.includes(property.id));
  const batchProperty = nonTitleProperties.find((property) => property.id === batchPropertyId) ?? null;

  useEffect(() => {
    setDatabaseNameDraft(decodeEscapedUnicode(database.name));
    setDatabaseDescriptionDraft(decodeEscapedUnicode(database.description ?? ""));
    setDatabaseIconDraft(database.icon ?? "");
  }, [database.description, database.icon, database.name]);

  useEffect(() => {
    const validIds = nonTitleProperties.map((property) => property.id);
    const nextIds = effectiveVisibleColumnIds.filter((id) => validIds.includes(id));
    if (!isSameStringArray(effectiveVisibleColumnIds, nextIds)) {
      onPreferenceChange?.({ visibleColumnIds: nextIds.length > 0 ? nextIds : validIds });
    }
  }, [effectiveVisibleColumnIds, nonTitleProperties, onPreferenceChange]);

  const activeFilterProperty = properties.find((property) => property.id === filterPropertyId) ?? null;
  const activeFilterOptions =
    activeFilterProperty?.type === "member"
      ? workspaceMembers.map((member) => ({ id: member.user_id, name: getMemberName(member) }))
      : getOptions(activeFilterProperty).map((option) => ({ id: option.id, name: option.name }));

  function getRulePropertyValue(note: NoteWithTags, property: DatabaseProperty) {
    const value = getEffectiveValue(note, property, optimisticValues);
    if (!value) {
      return { text: "", number: null as number | null, boolean: null as boolean | null, date: "", list: [] as string[] };
    }
    return {
      text: value.value_text ?? "",
      number: value.value_number ?? null,
      boolean: value.value_boolean ?? null,
      date: normalizeDateInput(value.value_date),
      list: value.value_json ?? [],
    };
  }

  function matchesAdvancedRule(note: NoteWithTags, rule: DatabaseAdvancedFilter["rules"][number]): boolean {
    const property = properties.find((item) => item.id === rule.property_id);
    if (!property) return true;
    const ruleValue = getRulePropertyValue(note, property);
    const compareValue = (rule.value ?? "").trim();
    const compareValues = rule.values ?? [];

    switch (rule.operator) {
      case "is_empty":
        return property.type === "checkbox"
          ? ruleValue.boolean === null
          : property.type === "number" || property.type === "rating" || property.type === "progress"
            ? ruleValue.number === null
            : property.type === "single_select" || property.type === "multi_select" || property.type === "member"
              ? ruleValue.list.length === 0
              : property.type === "date"
                ? !ruleValue.date
                : !ruleValue.text;
      case "not_empty":
        return !matchesAdvancedRule(note, { ...rule, operator: "is_empty" });
      case "contains":
        return ruleValue.text.toLowerCase().includes(compareValue.toLowerCase());
      case "equals":
        if (property.type === "checkbox") return String(Boolean(ruleValue.boolean)) === compareValue;
        if (property.type === "number" || property.type === "rating" || property.type === "progress") return String(ruleValue.number ?? "") === compareValue;
        if (property.type === "date") return ruleValue.date === compareValue;
        if (property.type === "single_select" || property.type === "multi_select" || property.type === "member") return ruleValue.list.includes(compareValue);
        return ruleValue.text.toLowerCase() === compareValue.toLowerCase();
      case "not_equals":
        return !matchesAdvancedRule(note, { ...rule, operator: "equals" });
      case "gt":
      case "gte":
      case "lt":
      case "lte": {
        const left = ruleValue.number;
        const right = Number(compareValue);
        if (left === null || Number.isNaN(right)) return false;
        if (rule.operator === "gt") return left > right;
        if (rule.operator === "gte") return left >= right;
        if (rule.operator === "lt") return left < right;
        return left <= right;
      }
      case "before":
        return Boolean(ruleValue.date && compareValue && ruleValue.date < compareValue);
      case "after":
        return Boolean(ruleValue.date && compareValue && ruleValue.date > compareValue);
      case "on":
        return ruleValue.date === compareValue;
      case "on_or_before":
        return Boolean(ruleValue.date && compareValue && ruleValue.date <= compareValue);
      case "on_or_after":
        return Boolean(ruleValue.date && compareValue && ruleValue.date >= compareValue);
      case "has_any":
        return compareValues.some((value) => ruleValue.list.includes(value));
      case "has_all":
        return compareValues.every((value) => ruleValue.list.includes(value));
      default:
        return true;
    }
  }

  const filteredNotes = useMemo(() => {
    return notes.filter((note) => {
      const query = filterQuery.trim().toLowerCase();
      const matchesQuery =
        !query
        || `${decodeEscapedUnicode(note.title)}\n${decodeEscapedUnicode(note.content)}`.toLowerCase().includes(query);

      if (!matchesQuery) return false;
      if (!filterPropertyId || !filterPropertyValue) return true;

      const property = properties.find((item) => item.id === filterPropertyId);
      if (!property) return true;
      const value = getEffectiveValue(note, property, optimisticValues);
      if (property.type === "single_select" || property.type === "multi_select" || property.type === "member") {
        return (value?.value_json ?? []).includes(filterPropertyValue);
      }
      if (property.type === "checkbox") {
        return filterPropertyValue === "true" ? Boolean(value?.value_boolean) : !value?.value_boolean;
      }
      if (property.type === "date") {
        return normalizeDateInput(value?.value_date) === filterPropertyValue;
      }
      if (property.type === "number" || property.type === "rating" || property.type === "progress") {
        return String(value?.value_number ?? "") === filterPropertyValue;
      }
      const matchesLegacy = (value?.value_text ?? "").toLowerCase().includes(filterPropertyValue.toLowerCase());
      if (!matchesLegacy) return false;
      return true;
    }).filter((note) => {
      if (advancedFilter.rules.length === 0) return true;
      const results = advancedFilter.rules.map((rule) => matchesAdvancedRule(note, rule));
      return advancedFilter.mode === "or" ? results.some(Boolean) : results.every(Boolean);
    });
  }, [advancedFilter, filterPropertyId, filterPropertyValue, filterQuery, notes, optimisticValues, properties]);

  const sortedNotes = useMemo(
    () => sortNotes(filteredNotes, properties, sortField, sortDirection, optimisticValues),
    [filteredNotes, optimisticValues, properties, sortDirection, sortField],
  );
  const tableTotalPages = Math.max(1, Math.ceil(sortedNotes.length / tablePageSize));
  const normalizedTablePage = Math.min(tablePage, tableTotalPages);
  const tablePageStart = (normalizedTablePage - 1) * tablePageSize;
  const pagedTableNotes = sortedNotes.slice(tablePageStart, tablePageStart + tablePageSize);
  const pagedTableNoteIds = pagedTableNotes.map((note) => note.id);
  const sortedNoteIds = sortedNotes.map((note) => note.id);
  const selectedSortedCount = selectedRecordIds.filter((id) => sortedNoteIds.includes(id)).length;
  const allPagedSelected = pagedTableNoteIds.length > 0 && pagedTableNoteIds.every((id) => selectedRecordIds.includes(id));
  const allFilteredSelected = sortedNoteIds.length > 0 && sortedNoteIds.every((id) => selectedRecordIds.includes(id));

  useEffect(() => {
    if (activeDatabaseIdRef.current !== database.id) {
      activeDatabaseIdRef.current = database.id;
      return;
    }
    if (!didMountTablePagination.current) {
      didMountTablePagination.current = true;
      return;
    }
    setTablePage(1);
    onPreferenceChange?.({ tablePage: 1 });
  }, [advancedFilter, database.id, filterPropertyId, filterPropertyValue, filterQuery, sortDirection, sortField]);

  useEffect(() => {
    if (tablePage > tableTotalPages) setTablePage(tableTotalPages);
  }, [tablePage, tableTotalPages]);

  useEffect(() => {
    const nextPageSize = normalizeTablePageSize(viewPreference?.tablePageSize);
    const nextPage = Math.max(1, viewPreference?.tablePage ?? 1);
    if (nextPageSize !== tablePageSize) setTablePageSize(nextPageSize);
    if (nextPage !== tablePage) setTablePage(nextPage);
  }, [database.id, viewPreference?.tablePage, viewPreference?.tablePageSize]);

  const notesByBoard = useMemo(() => {
    if (!boardProperty) return new Map<string, NoteWithTags[]>();
    const map = new Map<string, NoteWithTags[]>();
    for (const option of boardOptions) map.set(option.id, []);
    map.set(ungroupedBoardId, []);
    for (const note of sortedNotes) {
      const value = getEffectiveValue(note, boardProperty, optimisticValues);
      const current = boardProperty.type === "checkbox"
        ? value?.value_boolean === true ? "true" : value?.value_boolean === false ? "false" : null
        : value?.value_json?.[0];
      const key = current && map.has(current) ? current : ungroupedBoardId;
      map.get(key)!.push(note);
    }
    return map;
  }, [boardOptions, boardProperty, optimisticValues, sortedNotes]);

  const notesWithoutCalendarDate = useMemo(() => {
    if (!calendarProperty) return [];
    return sortedNotes.filter((note) => !normalizeDateInput(getEffectiveValue(note, calendarProperty, optimisticValues)?.value_date));
  }, [calendarProperty, optimisticValues, sortedNotes]);

  const calendarMonthSummary = useMemo(() => {
    if (!calendarProperty) return { firstDatedMonth: null as Date | null, currentMonthHasNotes: false, autoKey: "" };

    let firstDatedMonth: Date | null = null;
    let currentMonthHasNotes = false;
    const currentMonthKey = getMonthKey(calendarMonth);
    const datedKeys: string[] = [];

    for (const note of sortedNotes) {
      const month = monthFromDateInput(getEffectiveValue(note, calendarProperty, optimisticValues)?.value_date);
      if (!month) continue;
      const monthKey = getMonthKey(month);
      datedKeys.push(`${note.id}:${monthKey}`);
      if (!firstDatedMonth) firstDatedMonth = month;
      if (monthKey === currentMonthKey) currentMonthHasNotes = true;
    }

    return {
      firstDatedMonth,
      currentMonthHasNotes,
      autoKey: `${database.id}:${calendarProperty.id}:${datedKeys.join("|")}`,
    };
  }, [calendarMonth, calendarProperty, database.id, optimisticValues, sortedNotes]);

  useEffect(() => {
    if (activeView !== "calendar" || !calendarProperty || !calendarMonthSummary.firstDatedMonth) return;
    if (calendarMonthSummary.currentMonthHasNotes) return;
    if (lastAutoCalendarMonthKeyRef.current === calendarMonthSummary.autoKey) return;

    lastAutoCalendarMonthKeyRef.current = calendarMonthSummary.autoKey;
    if (getMonthKey(calendarMonth) !== getMonthKey(calendarMonthSummary.firstDatedMonth)) {
      setCalendarMonth(calendarMonthSummary.firstDatedMonth);
    }
  }, [activeView, calendarMonth, calendarMonthSummary, calendarProperty]);

  function updatePreference(patch: Partial<DatabaseViewPreference>) {
    onPreferenceChange?.(patch);
  }

  function updateTablePage(nextPage: number) {
    const normalizedPage = Math.max(1, Math.floor(nextPage));
    setTablePage(normalizedPage);
    updatePreference({ tablePage: normalizedPage });
  }

  function updateTablePageSize(size: number) {
    const normalizedSize = normalizeTablePageSize(size);
    setTablePageSize(normalizedSize);
    setTablePage(1);
    updatePreference({ tablePage: 1, tablePageSize: normalizedSize });
  }

  function updateTablePageWith(updater: (page: number) => number) {
    updateTablePage(updater(normalizedTablePage));
  }

  function updateAdvancedFilter(next: DatabaseAdvancedFilter) {
    updatePreference({ advancedFilter: next });
  }

  function getCurrentViewSnapshot(): DatabaseViewSnapshot {
    return {
      view: activeView,
      visibleColumnIds: effectiveVisibleColumnIds,
      filterQuery,
      filterPropertyId,
      filterPropertyValue,
      advancedFilter,
      sortField,
      sortDirection,
    };
  }

  function saveCurrentView() {
    const name = savedViewName.trim();
    if (!name) return;
    const savedView = {
      ...getCurrentViewSnapshot(),
      name,
    };
    if (onCreateSavedView) {
      void Promise.resolve(onCreateSavedView(savedView));
    } else {
      const fallbackSavedView: DatabaseView = {
        ...savedView,
        id: crypto.randomUUID(),
        database_id: database.id,
        created_by_user_id: "",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      updatePreference({
        savedViews: [fallbackSavedView, ...savedViews.filter((view) => view.name !== name)].slice(0, 12),
        activeSavedViewId: fallbackSavedView.id,
      });
    }
    setSavedViewName("");
  }

  function applySavedView(savedView: DatabaseView) {
    onViewChange(savedView.view);
    updatePreference({
      view: savedView.view,
      visibleColumnIds: savedView.visibleColumnIds,
      filterQuery: savedView.filterQuery,
      filterPropertyId: savedView.filterPropertyId,
      filterPropertyValue: savedView.filterPropertyValue,
      advancedFilter: savedView.advancedFilter,
      sortField: savedView.sortField,
      sortDirection: savedView.sortDirection,
      activeSavedViewId: savedView.id,
    });
  }

  async function confirmDeleteSavedView() {
    if (!deleteSavedViewTargetId) return;
    setDestructiveActionLoading(true);
    try {
      if (onDeleteSavedView) {
        await onDeleteSavedView(deleteSavedViewTargetId);
      } else {
        updatePreference({
          savedViews: savedViews.filter((savedView) => savedView.id !== deleteSavedViewTargetId),
          activeSavedViewId: activeSavedViewId === deleteSavedViewTargetId ? null : activeSavedViewId,
        });
      }
      setDeleteSavedViewTargetId(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "视图删除失败");
    } finally {
      setDestructiveActionLoading(false);
    }
  }

  async function confirmDeleteTemplate() {
    if (!deleteTemplateTargetId || !onDeleteTemplate) return;
    setDestructiveActionLoading(true);
    try {
      await onDeleteTemplate(deleteTemplateTargetId);
      setDeleteTemplateTargetId(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "模板删除失败");
    } finally {
      setDestructiveActionLoading(false);
    }
  }

  async function confirmDeleteProperty() {
    if (!deletePropertyTargetId) return;
    setDestructiveActionLoading(true);
    try {
      await onDeleteProperty(deletePropertyTargetId);
      setDeletePropertyTargetId(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "属性删除失败");
    } finally {
      setDestructiveActionLoading(false);
    }
  }

  function updateActiveSavedView() {
    if (!activeSavedViewId) return;
    const payload = getCurrentViewSnapshot();
    if (onUpdateSavedView) {
      void Promise.resolve(onUpdateSavedView(activeSavedViewId, payload));
      return;
    }
    updatePreference({
      savedViews: savedViews.map((savedView) => (
        savedView.id === activeSavedViewId
          ? { ...savedView, ...payload, updated_at: new Date().toISOString() }
          : savedView
      )),
    });
  }

  function addAdvancedFilterRule() {
    const firstProperty = nonTitleProperties[0];
    if (!firstProperty) return;
    updateAdvancedFilter({
      ...advancedFilter,
      rules: [
        ...advancedFilter.rules,
        {
          id: crypto.randomUUID(),
          property_id: firstProperty.id,
          operator: firstProperty.type === "single_select" || firstProperty.type === "multi_select" || firstProperty.type === "member" ? "has_any" : firstProperty.type === "date" ? "on" : "contains",
          value: "",
          values: [],
        },
      ],
    });
  }

  function updateAdvancedFilterRule(ruleId: string, patch: Partial<DatabaseAdvancedFilter["rules"][number]>) {
    updateAdvancedFilter({
      ...advancedFilter,
      rules: advancedFilter.rules.map((rule) => (rule.id === ruleId ? { ...rule, ...patch } : rule)),
    });
  }

  function removeAdvancedFilterRule(ruleId: string) {
    updateAdvancedFilter({
      ...advancedFilter,
      rules: advancedFilter.rules.filter((rule) => rule.id !== ruleId),
    });
  }

  function commitNoteValue(noteId: string, property: DatabaseProperty, payload: DatabaseValuePayload, failureMessage = "属性值更新失败，已回滚") {
    setOptimisticValues((current) => ({
      ...current,
      [noteId]: {
        ...(current[noteId] ?? {}),
        [property.id]: payload,
      },
    }));
    Promise.resolve(onUpdateNoteValue(noteId, payload)).catch(() => {
      setOptimisticValues((current) => {
        const next = { ...current };
        const noteValues = { ...(next[noteId] ?? {}) };
        delete noteValues[property.id];
        if (Object.keys(noteValues).length === 0) delete next[noteId];
        else next[noteId] = noteValues;
        return next;
      });
      toast.error(failureMessage);
    });
  }

  function submitProperty() {
    const name = propertyName.trim();
    if (!name) return;
    void Promise.resolve(onCreateProperty({ name, type: propertyType })).then(() => {
      setPropertyName("");
      setPropertyType("text");
    });
  }

  function openOptionEditor(property: DatabaseProperty) {
    setEditingOptionsPropertyId(property.id);
    setOptionDrafts(getOptions(property).map((option) => ({ ...option })));
  }

  async function saveOptionEditor(property: DatabaseProperty) {
    const currentOptions = getOptions(property);
    const nextOptions = optionDrafts
      .map((option) => ({ ...option, name: option.name.trim(), color: option.color || optionColors[0] }))
      .filter((option) => option.name.length > 0);
    const nextIds = new Set(nextOptions.map((option) => option.id));
    const removedIds = currentOptions.map((option) => option.id).filter((id) => !nextIds.has(id));
    await onUpdateProperty(property.id, { config: { ...property.config, options: nextOptions } });
    if (removedIds.length > 0) {
      await Promise.all(
        notes.map((note) => {
          const currentValue = note.database_values?.[property.id]?.value_json ?? [];
          const cleaned = currentValue.filter((id) => !removedIds.includes(id));
          if (cleaned.length === currentValue.length) return Promise.resolve();
          return Promise.resolve(onUpdateNoteValue(note.id, { property_id: property.id, value_json: cleaned }));
        }),
      );
    }
    setEditingOptionsPropertyId(null);
    setOptionDrafts([]);
  }

  function moveProperty(index: number, delta: -1 | 1) {
    const targetIndex = index + delta;
    if (targetIndex < 0 || targetIndex >= properties.length) return;
    const current = properties[index];
    const target = properties[targetIndex];
    void Promise.all([
      onUpdateProperty(current.id, { sort_order: target.sort_order }),
      onUpdateProperty(target.id, { sort_order: current.sort_order }),
    ]);
  }

  function toggleVisibleColumn(propertyId: string) {
    const source = effectiveVisibleColumnIds;
    updatePreference({
      visibleColumnIds: source.includes(propertyId)
        ? source.filter((id) => id !== propertyId)
        : [...source, propertyId],
    });
  }

  function toggleRecordSelection(noteId: string) {
    setSelectedRecordIds((current) => (current.includes(noteId) ? current.filter((id) => id !== noteId) : [...current, noteId]));
  }

  function clearRecordSelection() {
    setSelectedRecordIds([]);
  }

  function setCurrentPageSelection(checked: boolean) {
    setSelectedRecordIds((current) => {
      if (!checked) return current.filter((id) => !pagedTableNoteIds.includes(id));
      return Array.from(new Set([...current, ...pagedTableNoteIds]));
    });
  }

  function setFilteredSelection(checked: boolean) {
    setSelectedRecordIds((current) => {
      if (!checked) return current.filter((id) => !sortedNoteIds.includes(id));
      return sortedNoteIds;
    });
  }

  function runBatchAction(action: "archive" | "unarchive" | "duplicate") {
    if (selectedRecordIds.length === 0 || !onBatchNotes) return;
    void Promise.resolve(onBatchNotes({ note_ids: selectedRecordIds, action })).then(clearRecordSelection);
  }

  function getBatchOptions(property: DatabaseProperty) {
    if (property.type === "member") {
      return workspaceMembers.map((member) => ({ id: member.user_id, name: getMemberName(member) }));
    }
    return getOptions(property).map((option) => ({ id: option.id, name: option.name }));
  }

  function updateBatchMultiValue(optionId: string, checked: boolean) {
    const current = batchValue.split(",").map((item) => item.trim()).filter(Boolean);
    const next = checked
      ? Array.from(new Set([...current, optionId]))
      : current.filter((id) => id !== optionId);
    setBatchValue(next.join(","));
  }

  function buildBatchValuePayload(property: DatabaseProperty): DatabaseValuePayload | null {
    const payload: DatabaseValuePayload = { property_id: property.id };
    if (property.type === "checkbox") {
      payload.value_boolean = batchValue === "" ? null : batchValue === "true";
      return payload;
    }
    if (property.type === "number" || property.type === "rating" || property.type === "progress") {
      const nextNumber = batchValue === "" ? null : Number(batchValue);
      if (nextNumber !== null && !Number.isFinite(nextNumber)) {
        toast.error("请输入有效数字");
        return null;
      }
      payload.value_number = nextNumber;
      return payload;
    }
    if (property.type === "date") {
      payload.value_date = batchValue || null;
      return payload;
    }
    if (property.type === "single_select") {
      payload.value_json = batchValue ? [batchValue] : [];
      return payload;
    }
    if (property.type === "multi_select" || property.type === "member") {
      payload.value_json = batchValue ? batchValue.split(",").map((item) => item.trim()).filter(Boolean) : [];
      return payload;
    }
    payload.value_text = batchValue;
    return payload;
  }

  function runBatchValueUpdate() {
    if (selectedRecordIds.length === 0 || !onBatchNotes || !batchPropertyId) return;
    const property = nonTitleProperties.find((item) => item.id === batchPropertyId);
    if (!property) return;
    const payload = buildBatchValuePayload(property);
    if (!payload) return;
    void Promise.resolve(onBatchNotes({ note_ids: selectedRecordIds, action: "update_values", values: [payload] })).then(() => {
      setBatchValue("");
      setShowMobileToolDrawer(false);
      clearRecordSelection();
    });
  }

  function renderBatchValueInput(property: DatabaseProperty, labelPrefix = "batch") {
    const commonClassName = "h-8 w-44 rounded-[10px]";
    if (property.type === "checkbox") {
      return (
        <select
          value={batchValue}
          onChange={(event) => setBatchValue(event.target.value)}
          className="h-8 rounded-[10px] border border-input bg-background/80 px-2 text-xs outline-none"
          aria-label={`${labelPrefix}-value-checkbox`}
        >
          <option value="">清空勾选</option>
          <option value="true">已勾选</option>
          <option value="false">未勾选</option>
        </select>
      );
    }
    if (property.type === "number" || property.type === "rating" || property.type === "progress") {
      const max = property.type === "rating" ? 5 : property.type === "progress" ? 100 : undefined;
      const placeholder = property.type === "rating" ? "0-5" : property.type === "progress" ? "0-100" : "数字";
      return (
        <Input
          type="number"
          min={property.type === "rating" || property.type === "progress" ? 0 : undefined}
          max={max}
          value={batchValue}
          onChange={(event) => setBatchValue(event.target.value)}
          placeholder={placeholder}
          className={commonClassName}
          aria-label={`${labelPrefix}-value-number`}
        />
      );
    }
    if (property.type === "date") {
      return (
        <Input
          type="date"
          value={batchValue}
          onChange={(event) => setBatchValue(event.target.value)}
          className={commonClassName}
          aria-label={`${labelPrefix}-value-date`}
        />
      );
    }
    if (property.type === "single_select" || (property.type === "member" && property.config.multi === false)) {
      return (
        <select
          value={batchValue}
          onChange={(event) => setBatchValue(event.target.value)}
          className="h-8 rounded-[10px] border border-input bg-background/80 px-2 text-xs outline-none"
          aria-label={`${labelPrefix}-value-single`}
        >
          <option value="">清空</option>
          {getBatchOptions(property).map((option) => (
            <option key={option.id} value={option.id}>{option.name}</option>
          ))}
        </select>
      );
    }
    if (property.type === "multi_select" || property.type === "member") {
      const selectedIds = new Set(batchValue.split(",").map((item) => item.trim()).filter(Boolean));
      return (
        <div className="flex max-w-full flex-wrap gap-1 rounded-[10px] border border-border/70 bg-background/70 px-2 py-1" aria-label={`${labelPrefix}-value-multi`}>
          {getBatchOptions(property).map((option) => (
            <label key={option.id} className="flex items-center gap-1 rounded-full bg-black/[0.04] px-2 py-1 text-xs dark:bg-white/[0.06]">
              <input
                type="checkbox"
                checked={selectedIds.has(option.id)}
                onChange={(event) => updateBatchMultiValue(option.id, event.target.checked)}
              />
              {option.name}
            </label>
          ))}
          {getBatchOptions(property).length === 0 ? <span className="text-xs text-muted-foreground">没有可选项</span> : null}
        </div>
      );
    }
    return (
      <Input
        value={batchValue}
        onChange={(event) => setBatchValue(event.target.value)}
        placeholder="新值"
        className={commonClassName}
        aria-label={`${labelPrefix}-value-text`}
      />
    );
  }

  function getTemplateDefaultOptions(property: DatabaseProperty) {
    if (property.type === "member") {
      return workspaceMembers.map((member) => ({ id: member.user_id, name: getMemberName(member) }));
    }
    return getOptions(property).map((option) => ({ id: option.id, name: option.name }));
  }

  function updateTemplateDefaultDraft(propertyId: string, value: string) {
    setTemplateDefaultDrafts((current) => ({ ...current, [propertyId]: value }));
  }

  function updateTemplateDefaultMultiValue(propertyId: string, optionId: string, checked: boolean) {
    const current = (templateDefaultDrafts[propertyId] ?? "").split(",").map((item) => item.trim()).filter(Boolean);
    const next = checked
      ? Array.from(new Set([...current, optionId]))
      : current.filter((id) => id !== optionId);
    updateTemplateDefaultDraft(propertyId, next.join(","));
  }

  function buildTemplateDefaultValues(drafts = templateDefaultDrafts): DatabaseValuePayload[] | null {
    const values: DatabaseValuePayload[] = [];
    for (const property of nonTitleProperties) {
      const raw = (drafts[property.id] ?? "").trim();
      if (!raw) continue;
      if (property.type === "checkbox") {
        values.push({ property_id: property.id, value_boolean: raw === "true" });
        continue;
      }
      if (property.type === "number" || property.type === "rating" || property.type === "progress") {
        const nextNumber = Number(raw);
        if (!Number.isFinite(nextNumber)) {
          toast.error("请输入有效数字");
          return null;
        }
        values.push({ property_id: property.id, value_number: nextNumber });
        continue;
      }
      if (property.type === "date") {
        values.push({ property_id: property.id, value_date: raw });
        continue;
      }
      if (property.type === "single_select" || (property.type === "member" && property.config.multi === false)) {
        values.push({ property_id: property.id, value_json: [raw] });
        continue;
      }
      if (property.type === "multi_select" || property.type === "member") {
        values.push({ property_id: property.id, value_json: raw.split(",").map((item) => item.trim()).filter(Boolean) });
        continue;
      }
      values.push({ property_id: property.id, value_text: raw });
    }
    return values;
  }

  function resetTemplateEditor() {
    setEditingTemplateId(null);
    setTemplateName("");
    setTemplateTitle("");
    setTemplateContent("");
    setTemplateDefaultDrafts({});
  }

  function templateDefaultDraftsFromValues(values: DatabaseRecordTemplate["default_values"]) {
    const drafts: Record<string, string> = {};
    for (const value of values ?? []) {
      const property = nonTitleProperties.find((item) => item.id === value.property_id);
      if (!property) continue;
      if (property.type === "checkbox") {
        if (typeof value.value_boolean === "boolean") drafts[property.id] = value.value_boolean ? "true" : "false";
        continue;
      }
      if (property.type === "number" || property.type === "rating" || property.type === "progress") {
        if (typeof value.value_number === "number") drafts[property.id] = String(value.value_number);
        continue;
      }
      if (property.type === "date") {
        drafts[property.id] = normalizeDateInput(value.value_date);
        continue;
      }
      if (property.type === "single_select" || property.type === "multi_select" || property.type === "member") {
        drafts[property.id] = (value.value_json ?? []).join(",");
        continue;
      }
      drafts[property.id] = value.value_text ?? "";
    }
    return drafts;
  }

  function startTemplateEdit(template: DatabaseRecordTemplate) {
    setEditingTemplateId(template.id);
    setTemplateName(template.name);
    setTemplateTitle(template.title);
    setTemplateContent(template.content);
    setTemplateDefaultDrafts(templateDefaultDraftsFromValues(template.default_values));
  }

  function saveTemplate() {
    const defaultValues = buildTemplateDefaultValues();
    if (!defaultValues) return;
    const payload = { name: templateName.trim(), title: templateTitle, content: templateContent, default_values: defaultValues };
    const action = editingTemplateId && onUpdateTemplate
      ? onUpdateTemplate(editingTemplateId, payload)
      : onCreateTemplate?.(payload);
    void Promise.resolve(action).then(resetTemplateEditor);
  }

  function renderTemplateDefaultInput(property: DatabaseProperty) {
    const value = templateDefaultDrafts[property.id] ?? "";
    const commonClassName = "min-w-0 rounded-[10px]";
    if (property.type === "checkbox") {
      return (
        <select
          value={value}
          onChange={(event) => updateTemplateDefaultDraft(property.id, event.target.value)}
          className="rounded-[10px] border border-input bg-background/80 px-3 py-2 text-sm outline-none"
          aria-label={`template-default-checkbox-${property.id}`}
        >
          <option value="">不预填</option>
          <option value="true">已勾选</option>
          <option value="false">未勾选</option>
        </select>
      );
    }
    if (property.type === "number" || property.type === "rating" || property.type === "progress") {
      return (
        <Input
          type="number"
          min={property.type === "rating" || property.type === "progress" ? 0 : undefined}
          max={property.type === "rating" ? 5 : property.type === "progress" ? 100 : undefined}
          value={value}
          onChange={(event) => updateTemplateDefaultDraft(property.id, event.target.value)}
          placeholder={property.type === "rating" ? "0-5" : property.type === "progress" ? "0-100" : "数字"}
          className={commonClassName}
          aria-label={`template-default-number-${property.id}`}
        />
      );
    }
    if (property.type === "date") {
      return (
        <Input
          type="date"
          value={value}
          onChange={(event) => updateTemplateDefaultDraft(property.id, event.target.value)}
          className={commonClassName}
          aria-label={`template-default-date-${property.id}`}
        />
      );
    }
    if (property.type === "single_select" || (property.type === "member" && property.config.multi === false)) {
      return (
        <select
          value={value}
          onChange={(event) => updateTemplateDefaultDraft(property.id, event.target.value)}
          className="rounded-[10px] border border-input bg-background/80 px-3 py-2 text-sm outline-none"
          aria-label={`template-default-single-${property.id}`}
        >
          <option value="">不预填</option>
          {getTemplateDefaultOptions(property).map((option) => (
            <option key={option.id} value={option.id}>{option.name}</option>
          ))}
        </select>
      );
    }
    if (property.type === "multi_select" || property.type === "member") {
      const selectedIds = new Set(value.split(",").map((item) => item.trim()).filter(Boolean));
      const options = getTemplateDefaultOptions(property);
      return (
        <div className="flex min-w-0 flex-wrap gap-1 rounded-[10px] border border-border/70 bg-background/70 px-2 py-1" aria-label={`template-default-multi-${property.id}`}>
          {options.map((option) => (
            <label key={option.id} className="flex items-center gap-1 rounded-full bg-black/[0.04] px-2 py-1 text-xs dark:bg-white/[0.06]">
              <input
                type="checkbox"
                checked={selectedIds.has(option.id)}
                aria-label={`template-default-option-${property.id}-${option.id}`}
                onChange={(event) => updateTemplateDefaultMultiValue(property.id, option.id, event.target.checked)}
              />
              {option.name}
            </label>
          ))}
          {options.length === 0 ? <span className="text-xs text-muted-foreground">没有可选项</span> : null}
        </div>
      );
    }
    return (
      <Input
        value={value}
        onChange={(event) => updateTemplateDefaultDraft(property.id, event.target.value)}
        placeholder="默认值"
        className={commonClassName}
        aria-label={`template-default-text-${property.id}`}
      />
    );
  }

  function renderTableCell(note: NoteWithTags, property: DatabaseProperty) {
    const value = getEffectiveValue(note, property, optimisticValues);

    return (
      <DatabaseTableCell
        property={property}
        value={value}
        workspaceMembers={workspaceMembers}
        onCommit={(payload) => commitNoteValue(note.id, property, payload)}
      />
    );
  }

  const editableSortProperties = nonTitleProperties.filter((property) => property.type === "number" || property.type === "date" || property.type === "rating" || property.type === "progress");
  const editingOptionsProperty = editingOptionsPropertyId ? properties.find((property) => property.id === editingOptionsPropertyId) ?? null : null;
  const deletePropertyTarget = deletePropertyTargetId ? properties.find((property) => property.id === deletePropertyTargetId) ?? null : null;
  const deletePropertyValueCount = deletePropertyTarget
    ? notes.filter((note) => {
        const value = note.database_values?.[deletePropertyTarget.id];
        if (!value) return false;
        return Boolean(
          value.value_text
            || value.value_number !== null && value.value_number !== undefined
            || value.value_boolean !== null && value.value_boolean !== undefined
            || value.value_date
            || (value.value_json?.length ?? 0) > 0,
        );
      }).length
    : 0;

  return (
    <div className="h-full min-w-0 overflow-y-auto bg-[var(--surface-list)] md:flex md:flex-col md:overflow-hidden">
      <input
        ref={importInputRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file && onImportCsv) {
            void Promise.resolve(onImportCsv(file)).finally(() => {
              event.currentTarget.value = "";
            });
          }
        }}
      />
      <div className="min-w-0 border-b px-3 py-3 sm:px-4 sm:py-4" style={{ borderColor: "var(--border-subtle)" }}>
        <DatabaseToolbar
          database={database}
          templates={templates}
          activeView={activeView}
          selectedTemplateId={selectedTemplateId}
          onSelectedTemplateChange={setSelectedTemplateId}
          onToggleDatabaseEditor={() => setShowDatabaseEditor((value) => !value)}
          onTogglePropertyManager={() => setShowPropertyManager((value) => !value)}
          onToggleViewOptions={() => setShowViewOptions((value) => !value)}
          onExportCsv={onExportCsv}
          onImportCsvClick={onImportCsv ? () => importInputRef.current?.click() : undefined}
          onCreateNote={onCreateNote}
          onRequestDeleteDatabase={onRequestDeleteDatabase}
          onViewChange={onViewChange}
        />
        {false ? (
          <>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Database</div>
            <div className="mt-1 flex items-center gap-2">
              <h2 className="truncate text-2xl font-bold tracking-tight">
                {normalizeDisplayIcon(database.icon) ? `${normalizeDisplayIcon(database.icon)} ` : ""}
                {decodeEscapedUnicode(database.name)}
              </h2>
              <Button size="icon" variant="ghost" className="h-8 w-8 rounded-[10px]" onClick={() => setShowDatabaseEditor((value) => !value)}>
                <Edit3 className="h-3.5 w-3.5" />
              </Button>
            </div>
            {database.description ? <p className="mt-1 text-sm text-muted-foreground">{decodeEscapedUnicode(database.description ?? "")}</p> : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" className="rounded-[12px]" aria-label="manage-properties" onClick={() => setShowPropertyManager((value) => !value)}>
              <Settings2 className="h-3.5 w-3.5" />
              属性
            </Button>
            <Button size="sm" variant="outline" className="rounded-[12px]" onClick={() => setShowViewOptions((value) => !value)}>
              <Filter className="h-3.5 w-3.5" />
              视图
            </Button>
            {onExportCsv ? <Button size="sm" variant="outline" className="rounded-[12px]" onClick={() => void onExportCsv?.()}>CSV 导出</Button> : null}
            {onImportCsv ? <Button size="sm" variant="outline" className="rounded-[12px]" onClick={() => importInputRef.current?.click()}>CSV 导入</Button> : null}
            {templates.length > 0 ? (
              <select
                value={selectedTemplateId}
                onChange={(event) => setSelectedTemplateId(event.target.value)}
                className="h-9 rounded-[12px] border border-input bg-background/80 px-2 text-sm outline-none"
                aria-label="record-template"
              >
                <option value="">空白模板</option>
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>{template.name}</option>
                ))}
              </select>
            ) : null}
            <Button size="sm" className="rounded-[12px]" onClick={() => onCreateNote(selectedTemplateId || null)}>
              <Plus className="h-3.5 w-3.5" />
              新建记录
            </Button>
            <Button size="sm" variant="outline" className="rounded-[12px] text-destructive" onClick={onRequestDeleteDatabase}>
              <Trash2 className="h-3.5 w-3.5" />
              删除
            </Button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {viewTabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.key}
                type="button"
                className={cn(
                  "inline-flex items-center gap-2 rounded-[12px] border px-3 py-2 text-sm transition-colors",
                  activeView === tab.key
                    ? "border-[#007aff]/20 bg-[#007aff]/8 text-[#007aff]"
                    : "border-border/70 bg-white/70 text-foreground/75 dark:bg-white/[0.04]",
                )}
                onClick={() => onViewChange(tab.key)}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </button>
            );
          })}
        </div>

          </>
        ) : null}

        {showDatabaseEditor ? (
          <div className="mt-4 grid gap-2 rounded-[18px] border border-border/70 bg-white/70 p-3 dark:bg-white/[0.04] md:grid-cols-[120px_1fr_1fr_auto]">
            <Input value={databaseIconDraft} onChange={(event) => setDatabaseIconDraft(event.target.value)} placeholder="图标" className="rounded-[12px]" />
            <Input value={databaseNameDraft} onChange={(event) => setDatabaseNameDraft(event.target.value)} placeholder="数据库名称" className="rounded-[12px]" />
            <Input value={databaseDescriptionDraft} onChange={(event) => setDatabaseDescriptionDraft(event.target.value)} placeholder="描述" className="rounded-[12px]" />
            <Button
              className="rounded-[12px]"
              disabled={!databaseNameDraft.trim()}
              onClick={() =>
                void Promise.resolve(
                  onUpdateDatabaseInfo({
                    name: databaseNameDraft.trim(),
                    description: databaseDescriptionDraft.trim() || null,
                    icon: databaseIconDraft.trim() || null,
                  }),
                ).then(() => setShowDatabaseEditor(false))
              }
            >
              保存
            </Button>
          </div>
        ) : null}

        {activeView === "table" ? (
          <div className="mt-4 flex items-center justify-between gap-2 rounded-[16px] border border-border/70 bg-white/75 p-2 shadow-sm dark:bg-white/[0.04] md:hidden">
            <div className="min-w-0">
              <div className="text-sm font-semibold">表格工具</div>
              <div className="truncate text-xs text-muted-foreground">
                {selectedRecordIds.length > 0 ? `已选择 ${selectedRecordIds.length} 条` : "筛选、排序、列显示和批量操作"}
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="shrink-0 rounded-[12px]"
              onClick={() => setShowMobileToolDrawer(true)}
              aria-label="open-mobile-database-tools"
            >
              <Filter className="h-3.5 w-3.5" />
              工具
            </Button>
          </div>
        ) : null}

        {showPropertyManager ? (
          <DatabasePropertyManager>
            <div className="mb-3 grid gap-2 md:grid-cols-[1fr_140px_auto]">
              <Input value={propertyName} onChange={(event) => setPropertyName(event.target.value)} placeholder="属性名" className="rounded-[12px]" />
              <select
                value={propertyType}
                onChange={(event) => setPropertyType(event.target.value as DatabaseProperty["type"])}
                className="rounded-[12px] border border-input bg-background/80 px-3 py-2 text-sm outline-none"
              >
                {propertyTypeOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <Button className="rounded-[12px]" onClick={submitProperty}>
                添加属性
              </Button>
            </div>

            <div className="space-y-2">
              {properties.map((property, index) => (
                <div key={property.id} className="grid gap-2 rounded-[12px] border border-border/70 px-3 py-2 md:grid-cols-[1fr_120px_90px_90px_auto]">
                  <Input
                    value={property.name}
                    disabled={property.type === "title"}
                    onChange={(event) => void onUpdateProperty(property.id, { name: event.target.value })}
                    className="rounded-[10px]"
                  />
                  <div className="flex items-center text-sm text-muted-foreground">{property.type}</div>
                  <Button size="sm" variant="outline" className="rounded-[10px]" disabled={index === 0} onClick={() => moveProperty(index, -1)}>
                    上移
                  </Button>
                  <Button size="sm" variant="outline" className="rounded-[10px]" disabled={index === properties.length - 1} onClick={() => moveProperty(index, 1)}>
                    下移
                  </Button>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    {property.type === "single_select" || property.type === "multi_select" ? (
                      <Button size="sm" variant="outline" className="rounded-[10px]" aria-label={`edit-options-${property.id}`} onClick={() => openOptionEditor(property)}>
                        选项
                      </Button>
                    ) : null}
                    {property.type === "member" ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="rounded-[10px]"
                        onClick={() => void onUpdateProperty(property.id, { config: { ...property.config, multi: property.config.multi === false } })}
                      >
                        成员：{property.config.multi === false ? "单选" : "多选"}
                      </Button>
                    ) : null}
                    {property.type !== "title" ? (
                      <Button size="sm" variant="outline" className="rounded-[10px] text-destructive" aria-label={`delete-property-${property.id}`} onClick={() => setDeletePropertyTargetId(property.id)}>
                        删除
                      </Button>
                    ) : (
                      <div className="text-xs text-muted-foreground">系统字段，不可删除</div>
                    )}
                  </div>
                </div>
              ))}
              {properties.length === 0 ? <p className="rounded-[12px] border border-dashed border-border/70 p-4 text-sm text-muted-foreground">还没有属性。</p> : null}
            </div>

            {editingOptionsProperty ? (
              <div className="mt-4 rounded-[14px] border border-border/70 bg-background/55 p-3">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div className="font-semibold">编辑“{editingOptionsProperty.name}”选项</div>
                  <Button size="icon" variant="ghost" className="h-8 w-8 rounded-[10px]" onClick={() => setEditingOptionsPropertyId(null)}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
                <div className="space-y-2">
                  {optionDrafts.map((option, index) => (
                    <div key={option.id} className="grid gap-2 md:grid-cols-[42px_1fr_auto]">
                      <input
                        type="color"
                        value={option.color}
                        onChange={(event) => setOptionDrafts((items) => items.map((item) => (item.id === option.id ? { ...item, color: event.target.value } : item)))}
                        className="h-10 w-10 rounded-[10px] border border-border/70 bg-transparent p-1"
                        aria-label={`选项 ${index + 1} 颜色`}
                      />
                      <Input
                        value={option.name}
                        onChange={(event) => setOptionDrafts((items) => items.map((item) => (item.id === option.id ? { ...item, name: event.target.value } : item)))}
                        placeholder="选项名称"
                        className="rounded-[10px]"
                      />
                      <Button size="sm" variant="outline" className="rounded-[10px] text-destructive" onClick={() => setOptionDrafts((items) => items.filter((item) => item.id !== option.id))}>
                        删除
                      </Button>
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex flex-wrap justify-end gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="rounded-[10px]"
                    onClick={() => setOptionDrafts((items) => [...items, { id: crypto.randomUUID(), name: "", color: optionColors[items.length % optionColors.length] }])}
                  >
                    添加选项
                  </Button>
                  <Button size="sm" className="rounded-[10px]" onClick={() => void saveOptionEditor(editingOptionsProperty)}>
                    保存选项
                  </Button>
                </div>
              </div>
            ) : null}

            {deletePropertyTarget ? (
              <div className="mt-4 rounded-[14px] border border-destructive/20 bg-destructive/5 p-3" aria-label="property-delete-impact">
                <div className="mb-2 font-semibold text-destructive">确认删除属性</div>
                <p className="text-sm text-muted-foreground">
                  删除“{deletePropertyTarget.name}”会移除这个字段和已有属性值。当前有 {deletePropertyValueCount} 条记录填写过该属性。
                  {database.board_property_id === deletePropertyTarget.id ? " 该属性正在驱动看板，删除后看板会取消分组字段。" : ""}
                  {database.calendar_property_id === deletePropertyTarget.id ? " 该属性正在驱动日历，删除后日历会取消日期字段。" : ""}
                </p>
                <div className="mt-3 flex justify-end gap-2">
                  <Button size="sm" variant="outline" className="rounded-[10px]" onClick={() => setDeletePropertyTargetId(null)}>
                    取消
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    className="rounded-[10px]"
                    aria-label="confirm-delete-property"
                    disabled={destructiveActionLoading}
                    onClick={() => void confirmDeleteProperty()}
                  >
                    {destructiveActionLoading ? "删除中..." : "删除属性"}
                  </Button>
                </div>
              </div>
            ) : null}

            <div className="mt-4 grid gap-2 md:grid-cols-2">
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">看板分组属性</div>
                <select
                  value={database.board_property_id ?? ""}
                  onChange={(event) => void onUpdateDatabaseField({ board_property_id: event.target.value || null })}
                  className="w-full rounded-[12px] border border-input bg-background/80 px-3 py-2 text-sm outline-none"
                >
                  <option value="">未设置</option>
                  {properties.filter((property) => property.type === "single_select" || property.type === "member" || property.type === "checkbox").map((property) => (
                    <option key={property.id} value={property.id}>
                      {property.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">日历日期属性</div>
                <select
                  value={database.calendar_property_id ?? ""}
                  onChange={(event) => void onUpdateDatabaseField({ calendar_property_id: event.target.value || null })}
                  className="w-full rounded-[12px] border border-input bg-background/80 px-3 py-2 text-sm outline-none"
                >
                  <option value="">未设置</option>
                  {properties.filter((property) => property.type === "date").map((property) => (
                    <option key={property.id} value={property.id}>
                      {property.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </DatabasePropertyManager>
        ) : null}

        {(onCreateTemplate || templates.length > 0) ? (
          <div className="mt-4 rounded-[18px] border border-border/70 bg-white/70 p-3 dark:bg-white/[0.04]">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-sm font-semibold">记录模板</div>
                <div className="text-xs text-muted-foreground">用于数据库中新建记录时预填标题和正文。</div>
              </div>
              {(onCreateTemplate || onUpdateTemplate) ? (
                <div className="grid flex-1 gap-2 md:max-w-2xl md:grid-cols-[150px_1fr_auto]">
                  <Input value={templateName} onChange={(event) => setTemplateName(event.target.value)} placeholder="模板名" className="rounded-[12px]" />
                  <Input value={templateTitle} onChange={(event) => setTemplateTitle(event.target.value)} placeholder="默认标题" className="rounded-[12px]" />
                  <Button
                    size="sm"
                    className="rounded-[12px]"
                    disabled={!templateName.trim() || (!editingTemplateId && !onCreateTemplate)}
                    onClick={saveTemplate}
                  >
                    {editingTemplateId ? "更新模板" : "保存模板"}
                  </Button>
                  {editingTemplateId ? (
                    <Button size="sm" variant="outline" className="rounded-[12px]" onClick={resetTemplateEditor}>
                      取消编辑
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </div>
            {(onCreateTemplate || onUpdateTemplate) ? (
              <div className="mb-3 space-y-2">
                <textarea
                  value={templateContent}
                  onChange={(event) => setTemplateContent(event.target.value)}
                  placeholder="默认正文（可选）"
                  className="min-h-20 w-full rounded-[12px] border border-input bg-background/80 px-3 py-2 text-sm outline-none"
                />
                <div className="rounded-[14px] border border-border/70 bg-background/50 p-3">
                  <div className="mb-2 text-xs font-semibold text-muted-foreground">默认属性值</div>
                  <div className="grid gap-2 md:grid-cols-2">
                    {nonTitleProperties.map((property) => (
                      <div key={property.id} className="grid gap-1 rounded-[12px] border border-border/60 bg-white/60 p-2 dark:bg-white/[0.04]">
                        <div className="text-xs font-medium">{property.name}</div>
                        {renderTemplateDefaultInput(property)}
                      </div>
                    ))}
                    {nonTitleProperties.length === 0 ? <div className="text-xs text-muted-foreground">还没有可预填的属性。</div> : null}
                  </div>
                </div>
              </div>
            ) : null}
            <div className="space-y-2">
              {templates.map((template) => (
                <div key={template.id} className="flex flex-wrap items-center justify-between gap-2 rounded-[12px] border border-border/70 px-3 py-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{template.name}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {template.title || "空标题"} · {template.content ? "含正文" : "无正文"} · {template.default_values?.length ?? 0} 个默认属性
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {onUpdateTemplate ? (
                      <Button size="sm" variant="outline" className="rounded-[10px]" onClick={() => startTemplateEdit(template)}>
                        编辑
                      </Button>
                    ) : null}
                    {onDeleteTemplate ? (
                      <Button size="sm" variant="outline" className="rounded-[10px] text-destructive" onClick={() => setDeleteTemplateTargetId(template.id)}>
                        删除
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))}
              {templates.length === 0 ? <div className="rounded-[12px] border border-dashed border-border/70 px-3 py-3 text-xs text-muted-foreground">还没有数据库模板。</div> : null}
            </div>
          </div>
        ) : null}

        {showViewOptions ? (
          <div className="mt-4 hidden rounded-[18px] border border-border/70 bg-white/70 p-3 dark:bg-white/[0.04] md:block">
            <div className="grid gap-2 md:grid-cols-[1fr_160px_160px_150px_120px_auto]">
              <div className="relative">
                <Input value={filterQuery} onChange={(event) => updatePreference({ filterQuery: event.target.value })} placeholder="筛选标题或正文" className="rounded-[12px] pr-9" />
                {filterQuery ? (
                  <button
                    type="button"
                    className="absolute right-2 top-2 rounded-md p-1 text-muted-foreground hover:bg-black/5"
                    onClick={() => updatePreference({ filterQuery: "" })}
                  >
                    <X className="h-4 w-4" />
                  </button>
                ) : null}
              </div>
              <select
                value={filterPropertyId}
                onChange={(event) => updatePreference({ filterPropertyId: event.target.value, filterPropertyValue: "" })}
                className="rounded-[12px] border border-input bg-background/80 px-3 py-2 text-sm outline-none"
              >
                <option value="">不按属性过滤</option>
                {nonTitleProperties.map((property) => (
                  <option key={property.id} value={property.id}>
                    {property.name}
                  </option>
                ))}
              </select>
              {activeFilterProperty?.type === "single_select" || activeFilterProperty?.type === "multi_select" || activeFilterProperty?.type === "member" ? (
                <select
                  value={filterPropertyValue}
                  onChange={(event) => updatePreference({ filterPropertyValue: event.target.value })}
                  className="rounded-[12px] border border-input bg-background/80 px-3 py-2 text-sm outline-none"
                >
                  <option value="">全部值</option>
                  {activeFilterOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name}
                    </option>
                  ))}
                </select>
              ) : activeFilterProperty?.type === "checkbox" ? (
                <select
                  value={filterPropertyValue}
                  onChange={(event) => updatePreference({ filterPropertyValue: event.target.value })}
                  className="rounded-[12px] border border-input bg-background/80 px-3 py-2 text-sm outline-none"
                >
                  <option value="">全部值</option>
                  <option value="true">是</option>
                  <option value="false">否</option>
                </select>
              ) : activeFilterProperty?.type === "date" ? (
                <Input type="date" value={filterPropertyValue} onChange={(event) => updatePreference({ filterPropertyValue: event.target.value })} className="rounded-[12px]" />
              ) : (
                <Input value={filterPropertyValue} onChange={(event) => updatePreference({ filterPropertyValue: event.target.value })} placeholder="属性值过滤" className="rounded-[12px]" />
              )}
              <select
                value={sortField}
                onChange={(event) => updatePreference({ sortField: event.target.value })}
                className="rounded-[12px] border border-input bg-background/80 px-3 py-2 text-sm outline-none"
              >
                <option value="updated_at">更新时间</option>
                <option value="title">标题</option>
                {editableSortProperties.map((property) => (
                  <option key={property.id} value={property.id}>
                    {property.name}
                  </option>
                ))}
              </select>
              <select
                value={sortDirection}
                onChange={(event) => updatePreference({ sortDirection: event.target.value as DatabaseSortDirection })}
                className="rounded-[12px] border border-input bg-background/80 px-3 py-2 text-sm outline-none"
              >
                <option value="desc">降序</option>
                <option value="asc">升序</option>
              </select>
              <Button
                variant="outline"
                className="rounded-[12px]"
                onClick={() => updatePreference({ filterQuery: "", filterPropertyId: "", filterPropertyValue: "", advancedFilter: { mode: "and", rules: [] }, sortField: "updated_at", sortDirection: "desc" })}
              >
                <RotateCcw className="h-4 w-4" />
              </Button>
            </div>

            <div className="mt-3 rounded-[14px] border border-border/60 bg-background/45 p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold">保存视图</div>
                  <div className="text-xs text-muted-foreground">保存当前视图类型、筛选、排序和表格列，下次可一键恢复。</div>
                </div>
                <div className="flex w-full min-w-0 flex-col gap-2 sm:min-w-[240px] sm:flex-1 sm:flex-row sm:justify-end md:flex-none">
                  <Input
                    value={savedViewName}
                    onChange={(event) => setSavedViewName(event.target.value)}
                    placeholder="例如：本周任务"
                    className="w-full rounded-[12px] sm:max-w-[220px]"
                  />
                  <Button size="sm" className="rounded-[12px]" disabled={!savedViewName.trim()} onClick={saveCurrentView}>
                    另存为新视图
                  </Button>
                  <Button size="sm" variant="outline" className="rounded-[12px]" disabled={!activeSavedViewId} onClick={updateActiveSavedView}>
                    更新当前视图
                  </Button>
                </div>
              </div>
              {savedViews.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {savedViews.map((savedView) => (
                    <span
                      key={savedView.id}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs",
                        activeSavedViewId === savedView.id
                          ? "border-[#007aff]/25 bg-[#007aff]/10 text-[#007aff]"
                          : "border-border/70 bg-white/70 text-muted-foreground dark:bg-white/[0.04]",
                      )}
                    >
                      <button type="button" className="font-medium" onClick={() => applySavedView(savedView)}>
                        {savedView.name}
                      </button>
                      <button type="button" aria-label={`delete-saved-view-${savedView.id}`} className="rounded-full p-0.5 hover:bg-black/5" onClick={() => setDeleteSavedViewTargetId(savedView.id)}>
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              ) : (
                <div className="rounded-[12px] border border-dashed border-border/70 px-3 py-2 text-xs text-muted-foreground">
                  还没有保存视图。可以先调好筛选、排序或列显示，再保存成常用视图。
                </div>
              )}
            </div>

            <div className="mt-3 rounded-[14px] border border-border/60 bg-background/45 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold">高级筛选</div>
                  <div className="text-xs text-muted-foreground">支持多条件 AND / OR，并可随视图一起保存。</div>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={advancedFilter.mode}
                    onChange={(event) => updateAdvancedFilter({ ...advancedFilter, mode: event.target.value === "or" ? "or" : "and" })}
                    className="rounded-[12px] border border-input bg-background/80 px-3 py-2 text-sm outline-none"
                  >
                    <option value="and">AND</option>
                    <option value="or">OR</option>
                  </select>
                  <Button size="sm" variant="outline" className="rounded-[12px]" onClick={addAdvancedFilterRule} disabled={nonTitleProperties.length === 0}>
                    添加条件
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                {advancedFilter.rules.map((rule) => {
                  const property = properties.find((item) => item.id === rule.property_id) ?? nonTitleProperties[0] ?? null;
                  const propertyOptions = property?.type === "member"
                    ? workspaceMembers.map((member) => ({ id: member.user_id, name: getMemberName(member) }))
                    : getOptions(property).map((option) => ({ id: option.id, name: option.name }));
                  const isMultiValue = property?.type === "single_select" || property?.type === "multi_select" || property?.type === "member";
                  const isDateValue = property?.type === "date";
                  const isNumericValue = property?.type === "number" || property?.type === "rating" || property?.type === "progress";

                  return (
                    <div key={rule.id} className="grid gap-2 rounded-[12px] border border-border/60 p-3 md:grid-cols-[180px_140px_1fr_auto]">
                      <select
                        value={rule.property_id}
                        onChange={(event) => updateAdvancedFilterRule(rule.id, { property_id: event.target.value })}
                        className="rounded-[12px] border border-input bg-background/80 px-3 py-2 text-sm outline-none"
                      >
                        {nonTitleProperties.map((item) => (
                          <option key={item.id} value={item.id}>{item.name}</option>
                        ))}
                      </select>
                      <select
                        value={rule.operator}
                        onChange={(event) => updateAdvancedFilterRule(rule.id, { operator: event.target.value as DatabaseFilterOperator })}
                        className="rounded-[12px] border border-input bg-background/80 px-3 py-2 text-sm outline-none"
                      >
                        {advancedFilterOperators.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                      {isMultiValue ? (
                        <select
                          multiple={rule.operator === "has_all" || rule.operator === "has_any"}
                          value={rule.operator === "has_all" || rule.operator === "has_any" ? rule.values ?? [] : rule.value ?? ""}
                          onChange={(event) => {
                            if (rule.operator === "has_all" || rule.operator === "has_any") {
                              updateAdvancedFilterRule(rule.id, { values: Array.from(event.currentTarget.selectedOptions).map((option) => option.value) });
                            } else {
                              updateAdvancedFilterRule(rule.id, { value: event.currentTarget.value });
                            }
                          }}
                          className={cn("rounded-[12px] border border-input bg-background/80 px-3 text-sm outline-none", rule.operator === "has_all" || rule.operator === "has_any" ? "min-h-20 py-2" : "py-2")}
                        >
                          {(rule.operator === "has_all" || rule.operator === "has_any") ? null : <option value="">选择值</option>}
                          {propertyOptions.map((option) => (
                            <option key={option.id} value={option.id}>{option.name}</option>
                          ))}
                        </select>
                      ) : isDateValue ? (
                        <Input type="date" value={rule.value ?? ""} onChange={(event) => updateAdvancedFilterRule(rule.id, { value: event.target.value })} className="rounded-[12px]" />
                      ) : (
                        <Input
                          type={isNumericValue ? "number" : "text"}
                          value={rule.value ?? ""}
                          onChange={(event) => updateAdvancedFilterRule(rule.id, { value: event.target.value })}
                          placeholder="筛选值"
                          className="rounded-[12px]"
                        />
                      )}
                      <Button size="sm" variant="outline" className="rounded-[12px] text-destructive" onClick={() => removeAdvancedFilterRule(rule.id)}>
                        删除
                      </Button>
                    </div>
                  );
                })}
                {advancedFilter.rules.length === 0 ? (
                  <div className="rounded-[12px] border border-dashed border-border/70 px-3 py-2 text-xs text-muted-foreground">
                    还没有高级筛选条件。
                  </div>
                ) : null}
              </div>
            </div>

            {activeView === "table" ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {nonTitleProperties.map((property) => (
                  <button
                    key={property.id}
                    type="button"
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs transition-colors",
                      effectiveVisibleColumnIds.includes(property.id)
                        ? "border-[#007aff]/20 bg-[#007aff]/8 text-[#007aff]"
                        : "border-border/70 bg-white/70 text-muted-foreground dark:bg-white/[0.04]",
                    )}
                    onClick={() => toggleVisibleColumn(property.id)}
                  >
                    {property.name}
                  </button>
                ))}
                {nonTitleProperties.length === 0 ? <span className="text-xs text-muted-foreground">还没有可显示的属性列。</span> : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {showMobileToolDrawer && activeView === "table" ? (
        <div className="fixed inset-0 z-50 md:hidden" aria-label="mobile-database-tools">
          <button
            type="button"
            className="absolute inset-0 bg-black/35"
            aria-label="close-mobile-database-tools-backdrop"
            onClick={() => setShowMobileToolDrawer(false)}
          />
          <div className="absolute inset-x-0 bottom-0 max-h-[86vh] overflow-y-auto rounded-t-[28px] border border-border/70 bg-background p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <div className="text-base font-semibold">表格工具</div>
                <div className="text-xs text-muted-foreground">移动端集中处理筛选、排序和批量操作。</div>
              </div>
              <Button size="icon" variant="ghost" className="h-9 w-9 rounded-full" aria-label="close-mobile-database-tools" onClick={() => setShowMobileToolDrawer(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="space-y-4">
              <section className="rounded-[18px] border border-border/70 bg-white/70 p-3 dark:bg-white/[0.04]">
                <div className="mb-2 text-sm font-semibold">筛选和排序</div>
                <div className="space-y-2">
                  <Input value={filterQuery} onChange={(event) => updatePreference({ filterQuery: event.target.value })} placeholder="筛选标题或正文" className="rounded-[12px]" aria-label="mobile-filter-query" />
                  <select
                    value={filterPropertyId}
                    onChange={(event) => updatePreference({ filterPropertyId: event.target.value, filterPropertyValue: "" })}
                    className="w-full rounded-[12px] border border-input bg-background/80 px-3 py-2 text-sm outline-none"
                    aria-label="mobile-filter-property"
                  >
                    <option value="">不按属性过滤</option>
                    {nonTitleProperties.map((property) => (
                      <option key={property.id} value={property.id}>{property.name}</option>
                    ))}
                  </select>
                  {activeFilterProperty?.type === "single_select" || activeFilterProperty?.type === "multi_select" || activeFilterProperty?.type === "member" ? (
                    <select
                      value={filterPropertyValue}
                      onChange={(event) => updatePreference({ filterPropertyValue: event.target.value })}
                      className="w-full rounded-[12px] border border-input bg-background/80 px-3 py-2 text-sm outline-none"
                      aria-label="mobile-filter-value"
                    >
                      <option value="">全部值</option>
                      {activeFilterOptions.map((option) => (
                        <option key={option.id} value={option.id}>{option.name}</option>
                      ))}
                    </select>
                  ) : activeFilterProperty?.type === "checkbox" ? (
                    <select
                      value={filterPropertyValue}
                      onChange={(event) => updatePreference({ filterPropertyValue: event.target.value })}
                      className="w-full rounded-[12px] border border-input bg-background/80 px-3 py-2 text-sm outline-none"
                      aria-label="mobile-filter-value"
                    >
                      <option value="">全部值</option>
                      <option value="true">是</option>
                      <option value="false">否</option>
                    </select>
                  ) : activeFilterProperty?.type === "date" ? (
                    <Input type="date" value={filterPropertyValue} onChange={(event) => updatePreference({ filterPropertyValue: event.target.value })} className="rounded-[12px]" aria-label="mobile-filter-value" />
                  ) : (
                    <Input value={filterPropertyValue} onChange={(event) => updatePreference({ filterPropertyValue: event.target.value })} placeholder="属性值过滤" className="rounded-[12px]" aria-label="mobile-filter-value" />
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    <select
                      value={sortField}
                      onChange={(event) => updatePreference({ sortField: event.target.value })}
                      className="rounded-[12px] border border-input bg-background/80 px-3 py-2 text-sm outline-none"
                      aria-label="mobile-sort-field"
                    >
                      <option value="updated_at">更新时间</option>
                      <option value="title">标题</option>
                      {editableSortProperties.map((property) => (
                        <option key={property.id} value={property.id}>{property.name}</option>
                      ))}
                    </select>
                    <select
                      value={sortDirection}
                      onChange={(event) => updatePreference({ sortDirection: event.target.value as DatabaseSortDirection })}
                      className="rounded-[12px] border border-input bg-background/80 px-3 py-2 text-sm outline-none"
                      aria-label="mobile-sort-direction"
                    >
                      <option value="desc">降序</option>
                      <option value="asc">升序</option>
                    </select>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full rounded-[12px]"
                    onClick={() => updatePreference({ filterQuery: "", filterPropertyId: "", filterPropertyValue: "", advancedFilter: { mode: "and", rules: [] }, sortField: "updated_at", sortDirection: "desc" })}
                  >
                    重置筛选排序
                  </Button>
                </div>
              </section>

              <section className="rounded-[18px] border border-border/70 bg-white/70 p-3 dark:bg-white/[0.04]">
                <div className="mb-2 text-sm font-semibold">列显示</div>
                <div className="flex flex-wrap gap-2">
                  {nonTitleProperties.map((property) => (
                    <button
                      key={property.id}
                      type="button"
                      className={cn(
                        "rounded-full border px-3 py-1 text-xs transition-colors",
                        effectiveVisibleColumnIds.includes(property.id)
                          ? "border-[#007aff]/20 bg-[#007aff]/8 text-[#007aff]"
                          : "border-border/70 bg-white/70 text-muted-foreground dark:bg-white/[0.04]",
                      )}
                      aria-label={`mobile-toggle-column-${property.id}`}
                      onClick={() => toggleVisibleColumn(property.id)}
                    >
                      {property.name}
                    </button>
                  ))}
                  {nonTitleProperties.length === 0 ? <span className="text-xs text-muted-foreground">还没有可显示的属性列。</span> : null}
                </div>
              </section>

              <section className="rounded-[18px] border border-border/70 bg-white/70 p-3 dark:bg-white/[0.04]">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="text-sm font-semibold">批量操作</div>
                  <span className="text-xs text-muted-foreground">已选择 {selectedRecordIds.length} 条</span>
                </div>
                <div className="space-y-2">
                  {sortedNotes.length > pagedTableNotes.length ? (
                    <Button size="sm" variant="outline" className="w-full rounded-[12px]" onClick={() => setFilteredSelection(!allFilteredSelected)}>
                      {allFilteredSelected ? "取消筛选结果全选" : `全选当前筛选结果（${sortedNotes.length}）`}
                    </Button>
                  ) : null}
                  <div className="grid grid-cols-2 gap-2">
                    <Button size="sm" variant="outline" className="rounded-[12px]" disabled={selectedRecordIds.length === 0} onClick={() => runBatchAction("archive")}>
                      归档
                    </Button>
                    <Button size="sm" variant="outline" className="rounded-[12px]" disabled={selectedRecordIds.length === 0} onClick={() => runBatchAction("duplicate")}>
                      复制
                    </Button>
                  </div>
                  <select
                    value={batchPropertyId}
                    onChange={(event) => { setBatchPropertyId(event.target.value); setBatchValue(""); }}
                    className="w-full rounded-[12px] border border-input bg-background/80 px-3 py-2 text-sm outline-none"
                    aria-label="mobile-batch-property-select"
                  >
                    <option value="">批量编辑属性</option>
                    {nonTitleProperties.map((property) => (
                      <option key={property.id} value={property.id}>{property.name}</option>
                    ))}
                  </select>
                  {batchProperty ? renderBatchValueInput(batchProperty, "mobile-batch") : null}
                  <Button size="sm" variant="outline" className="w-full rounded-[12px]" disabled={!batchProperty || selectedRecordIds.length === 0} onClick={runBatchValueUpdate}>
                    应用批量修改
                  </Button>
                  <Button size="sm" variant="ghost" className="w-full rounded-[12px]" disabled={selectedRecordIds.length === 0} onClick={clearRecordSelection}>
                    清空选择
                  </Button>
                </div>
              </section>
            </div>
          </div>
        </div>
      ) : null}

      <div className="p-3 sm:p-4 md:min-h-0 md:flex-1 md:overflow-auto">
        {activeView === "table" && selectedRecordIds.length > 0 ? (
          <div className="mb-3 hidden flex-wrap items-center gap-2 rounded-[14px] border border-border/70 bg-white/80 p-2 text-sm dark:bg-white/[0.05] md:flex">
            <span className="text-xs text-muted-foreground">已选择 {selectedRecordIds.length} 条</span>
            {sortedNotes.length > pagedTableNotes.length ? (
              allFilteredSelected ? (
                <Button size="sm" variant="ghost" className="rounded-[10px]" onClick={() => setFilteredSelection(false)}>
                  取消筛选结果全选
                </Button>
              ) : (
                <Button size="sm" variant="outline" className="rounded-[10px]" onClick={() => setFilteredSelection(true)}>
                  全选当前筛选结果（{sortedNotes.length}）
                </Button>
              )
            ) : null}
            <Button size="sm" variant="outline" className="rounded-[10px]" onClick={() => runBatchAction("archive")}>
              <Archive className="h-3.5 w-3.5" />
              归档
            </Button>
            <Button size="sm" variant="outline" className="rounded-[10px]" onClick={() => runBatchAction("duplicate")}>
              <CopyPlus className="h-3.5 w-3.5" />
              复制
            </Button>
            <select
              value={batchPropertyId}
              onChange={(event) => { setBatchPropertyId(event.target.value); setBatchValue(""); }}
              className="h-8 rounded-[10px] border border-input bg-background/80 px-2 text-xs outline-none"
              aria-label="batch-property-select"
            >
              <option value="">批量编辑属性</option>
              {nonTitleProperties.map((property) => (
                <option key={property.id} value={property.id}>{property.name}</option>
              ))}
            </select>
            {batchProperty ? (
              renderBatchValueInput(batchProperty)
            ) : null}
            {batchProperty ? (
              <Button size="sm" variant="outline" className="rounded-[10px]" onClick={runBatchValueUpdate}>应用</Button>
            ) : null}
            <Button size="sm" variant="ghost" className="rounded-[10px]" onClick={clearRecordSelection}>清空</Button>
          </div>
        ) : null}

        {activeView === "table" && duplicateGroups.length > 0 ? (
          <div className="mb-3 rounded-[14px] border border-amber-500/20 bg-amber-500/[0.06] px-3 py-2 text-xs text-muted-foreground">
            发现 {duplicateGroups.length} 组重复标题。最多一组：{duplicateGroups[0]?.title}（{duplicateGroups[0]?.notes.length ?? 0} 条）。
          </div>
        ) : null}

        {activeView === "table" ? (
          <DatabaseTableView
            notes={notes}
            sortedNotes={sortedNotes}
            pagedTableNotes={pagedTableNotes}
            visibleProperties={visibleProperties}
            selectedNoteId={selectedNoteId}
            selectedRecordIds={selectedRecordIds}
            allPagedSelected={allPagedSelected}
            selectedSortedCount={selectedSortedCount}
            tablePageStart={tablePageStart}
            tablePageSize={tablePageSize}
            tablePageSizes={tablePageSizes}
            normalizedTablePage={normalizedTablePage}
            tableTotalPages={tableTotalPages}
            workspaceMembers={workspaceMembers}
            onSelectNote={onSelectNote}
            onUpdateNoteTitle={onUpdateNoteTitle}
            onSetTablePageSize={updateTablePageSize}
            onSetTablePage={updateTablePageWith}
            onSetCurrentPageSelection={setCurrentPageSelection}
            onToggleRecordSelection={toggleRecordSelection}
            renderTableCell={renderTableCell}
            formatValue={(note, property, members) => formatValue(note, property, members, optimisticValues)}
          />
        ) : null}

        {false && activeView === "table" ? (
          <div className="rounded-[18px] border border-border/70 bg-white/70 dark:bg-white/[0.04]">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 px-3 py-2 text-xs text-muted-foreground">
              <div>
                显示 {sortedNotes.length === 0 ? 0 : tablePageStart + 1}-{Math.min(tablePageStart + pagedTableNotes.length, sortedNotes.length)} / {sortedNotes.length} 条
                {selectedSortedCount > 0 ? ` · 当前筛选已选 ${selectedSortedCount} 条` : ""}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span>每页</span>
                <select
                  value={tablePageSize}
                  onChange={(event) => setTablePageSize(Number(event.target.value) as (typeof tablePageSizes)[number])}
                  className="h-8 rounded-[10px] border border-input bg-background/80 px-2 text-xs outline-none"
                  aria-label="database-table-page-size"
                >
                  {tablePageSizes.map((size) => (
                    <option key={size} value={size}>{size}</option>
                  ))}
                </select>
                <Button size="sm" variant="outline" className="h-8 rounded-[10px]" disabled={normalizedTablePage <= 1} onClick={() => setTablePage((page) => Math.max(1, page - 1))}>
                  上一页
                </Button>
                <span>{normalizedTablePage}/{tableTotalPages}</span>
                <Button size="sm" variant="outline" className="h-8 rounded-[10px]" disabled={normalizedTablePage >= tableTotalPages} onClick={() => setTablePage((page) => Math.min(tableTotalPages, page + 1))}>
                  下一页
                </Button>
              </div>
            </div>
            <div className="overflow-x-auto">
            <table className="hidden min-w-full text-sm md:table">
              <thead className="bg-black/[0.03] dark:bg-white/[0.03]">
                <tr>
                  <th className="sticky left-0 z-10 bg-black/[0.03] px-3 py-2 text-left dark:bg-[#171717]">
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={allPagedSelected}
                        onChange={(event) => setCurrentPageSelection(event.target.checked)}
                        aria-label="select-all-records"
                      />
                      标题
                    </div>
                  </th>
                  {visibleProperties.map((property) => (
                    <th key={property.id} className="px-3 py-2 text-left">
                      {property.name}
                    </th>
                  ))}
                  <th className="px-3 py-2 text-left">更新于</th>
                </tr>
              </thead>
              <tbody>
                {pagedTableNotes.map((note) => (
                  <tr key={note.id} className={cn("border-t border-border/60", selectedNoteId === note.id && "bg-[#007aff]/[0.05]")}>
                    <td className="sticky left-0 z-10 bg-white/95 px-3 py-2 dark:bg-[#171717]">
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={selectedRecordIds.includes(note.id)}
                          onChange={() => toggleRecordSelection(note.id)}
                          aria-label={`select-record-${note.id}`}
                        />
                        <Input
                          value={decodeEscapedUnicode(note.title || "")}
                          onChange={(event) => void onUpdateNoteTitle(note.id, event.target.value)}
                          onFocus={() => onSelectNote(note.id)}
                          placeholder="无标题"
                          className="h-9 min-w-[220px] rounded-[10px] font-medium"
                        />
                      </div>
                    </td>
                    {visibleProperties.map((property) => (
                      <td key={property.id} className="px-3 py-2 text-muted-foreground">
                        {renderTableCell(note, property)}
                      </td>
                    ))}
                    <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{new Date(note.updated_at).toLocaleDateString("zh-CN")}</td>
                  </tr>
                ))}
                {sortedNotes.length === 0 ? (
                  <tr>
                    <td className="px-3 py-10 text-center text-muted-foreground" colSpan={visibleProperties.length + 2}>
                      {notes.length === 0 ? "这个数据库还没有记录。" : "没有符合当前筛选条件的记录。"}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
            </div>
            <div className="space-y-3 md:hidden">
              {pagedTableNotes.map((note) => (
                <div
                  key={note.id}
                  className={cn(
                    "w-full rounded-[18px] border border-border/70 bg-white/80 p-4 text-left shadow-sm dark:bg-white/[0.05]",
                    selectedNoteId === note.id && "border-[#007aff]/30 bg-[#007aff]/[0.06]",
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <button type="button" onClick={() => onSelectNote(note.id)} className="min-w-0 flex-1 text-left">
                      <div className="line-clamp-2 font-semibold">{decodeEscapedUnicode(note.title || "无标题")}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{new Date(note.updated_at).toLocaleDateString("zh-CN")} 更新</div>
                    </button>
                    <label className="flex shrink-0 items-center gap-2 rounded-full bg-[#007aff]/10 px-2 py-1 text-[11px] font-medium text-[#007aff]">
                      <input
                        type="checkbox"
                        checked={selectedRecordIds.includes(note.id)}
                        onChange={() => toggleRecordSelection(note.id)}
                        aria-label={`select-record-mobile-${note.id}`}
                      />
                      选择
                    </label>
                  </div>
                  {visibleProperties.length > 0 ? (
                    <div className="mt-3 grid gap-2">
                      {visibleProperties.slice(0, 6).map((property) => (
                        <div key={property.id} className="flex items-center justify-between gap-3 rounded-[12px] bg-black/[0.03] px-3 py-2 text-xs dark:bg-white/[0.04]">
                          <span className="shrink-0 text-muted-foreground">{property.name}</span>
                          <span className="min-w-0 truncate font-medium">{formatValue(note, property, workspaceMembers, optimisticValues) || "-"}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
              {sortedNotes.length === 0 ? (
                <div className="rounded-[18px] border border-dashed border-border/70 bg-white/70 p-6 text-center text-sm text-muted-foreground dark:bg-white/[0.04]">
                  {notes.length === 0 ? "这个数据库还没有记录。" : "没有符合当前筛选条件的记录。"}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {activeView === "board" ? (
          <DatabaseBoardView
            boardProperty={boardProperty}
            boardOptions={boardOptions}
            ungroupedBoardId={ungroupedBoardId}
            notesByBoard={notesByBoard}
            nonTitleProperties={nonTitleProperties}
            selectedNoteId={selectedNoteId}
            workspaceMembers={workspaceMembers}
            boardColumnLimits={boardColumnLimits}
            boardInitialColumnLimit={boardInitialColumnLimit}
            onSelectNote={onSelectNote}
            onSetBoardColumnLimits={setBoardColumnLimits}
            onCommitNoteValue={commitNoteValue}
            formatValue={(note, property, members) => formatValue(note, property, members, optimisticValues)}
          />
        ) : null}

        {false && activeView === "board" ? (
          boardProperty ? (
            <div className="grid auto-cols-[minmax(260px,1fr)] grid-flow-col gap-3 overflow-x-auto pb-2 xl:grid-flow-row xl:grid-cols-4">
              {[...boardOptions, { id: ungroupedBoardId, name: "未分类", color: "#8E8E93" }].map((option) => {
                const columnNotes = notesByBoard.get(option.id) ?? [];
                const columnLimit = boardColumnLimits[option.id] ?? boardInitialColumnLimit;
                const visibleColumnNotes = columnNotes.slice(0, columnLimit);
                const hiddenColumnCount = Math.max(0, columnNotes.length - visibleColumnNotes.length);

                return (
                  <div
                    key={option.id}
                    aria-label={`board-column-${option.id}`}
                    className="min-h-[260px] rounded-[18px] border border-border/70 bg-white/70 p-3 dark:bg-white/[0.04]"
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => {
                      const noteId = event.dataTransfer.getData("text/plain");
                      if (!noteId || !boardProperty) return;
                      if (boardProperty.type === "checkbox") {
                        commitNoteValue(noteId, boardProperty, {
                          property_id: boardProperty.id,
                          value_boolean: option.id === "true" ? true : option.id === "false" ? false : null,
                        }, "看板移动失败，已回滚");
                      } else {
                        commitNoteValue(noteId, boardProperty, {
                          property_id: boardProperty.id,
                          value_json: option.id === ungroupedBoardId ? [] : [option.id],
                        }, "看板移动失败，已回滚");
                      }
                    }}
                  >
                    <div className="mb-3 flex items-center justify-between">
                      <div className="flex min-w-0 items-center gap-2 font-semibold">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: option.color }} />
                        <span className="truncate">{option.name}</span>
                      </div>
                      <div className="text-xs text-muted-foreground">{columnNotes.length}</div>
                    </div>
                    <div className="space-y-2">
                      {visibleColumnNotes.map((note) => (
                        <button
                          key={note.id}
                          draggable
                          onDragStart={(event) => event.dataTransfer.setData("text/plain", note.id)}
                          onClick={() => onSelectNote(note.id)}
                          className={cn(
                            "min-h-[118px] w-full rounded-[14px] border border-border/70 bg-white/85 px-3 py-3 text-left shadow-sm dark:bg-white/[0.06]",
                            selectedNoteId === note.id && "border-[#007aff]/30 bg-[#007aff]/[0.06]",
                          )}
                        >
                          <div className="line-clamp-2 font-medium">{decodeEscapedUnicode(note.title || "无标题")}</div>
                          <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                            {nonTitleProperties.slice(0, 3).map((property) => (
                              <div key={property.id} className="flex gap-1">
                                <span className="shrink-0">{property.name}:</span>
                                <span className="truncate">{formatValue(note, property, workspaceMembers, optimisticValues) || "-"}</span>
                              </div>
                            ))}
                          </div>
                          <div className="mt-2 text-[11px] text-muted-foreground">{new Date(note.updated_at).toLocaleDateString("zh-CN")}</div>
                        </button>
                      ))}
                      {hiddenColumnCount > 0 ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="w-full rounded-[12px]"
                          onClick={() => setBoardColumnLimits((current) => ({ ...current, [option.id]: columnLimit + boardInitialColumnLimit }))}
                        >
                          再显示 {Math.min(boardInitialColumnLimit, hiddenColumnCount)} 条
                        </Button>
                      ) : null}
                      {columnNotes.length === 0 ? <p className="rounded-[12px] border border-dashed border-border/70 p-3 text-xs text-muted-foreground">暂无记录</p> : null}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-[18px] border border-border/70 bg-white/70 p-6 text-sm text-muted-foreground dark:bg-white/[0.04]">
              先在属性管理里选择一个单选属性作为看板分组字段。
            </div>
          )
        ) : null}

        {activeView === "calendar" ? (
          <DatabaseCalendarView
            calendarProperty={calendarProperty}
            calendarMonth={calendarMonth}
            calendarCells={calendarCells}
            sortedNotes={sortedNotes}
            notesWithoutCalendarDate={notesWithoutCalendarDate}
            expandedCalendarDate={expandedCalendarDate}
            selectedNoteId={selectedNoteId}
            calendarVisibleNotesPerDay={calendarVisibleNotesPerDay}
            onSetCalendarMonth={setCalendarMonth}
            onSetExpandedCalendarDate={setExpandedCalendarDate}
            onSelectNote={onSelectNote}
            onCommitNoteValue={commitNoteValue}
            getDateValue={(note, property) => normalizeDateInput(getEffectiveValue(note, property, optimisticValues)?.value_date)}
          />
        ) : null}

        {false && activeView === "calendar" ? (
          calendarProperty ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Button size="sm" variant="outline" className="rounded-[12px]" onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1))}>
                  <ChevronLeft className="h-4 w-4" />
                  上个月
                </Button>
                <div className="text-sm font-semibold">
                  {calendarMonth.getFullYear()} 年 {calendarMonth.getMonth() + 1} 月
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" className="rounded-[12px]" onClick={() => setCalendarMonth(new Date())}>
                    今天
                  </Button>
                  <Button size="sm" variant="outline" className="rounded-[12px]" onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1))}>
                    下个月
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              {notesWithoutCalendarDate.length > 0 ? (
                <div className="rounded-[14px] border border-border/70 bg-white/70 p-3 text-xs text-muted-foreground dark:bg-white/[0.04]">
                  {notesWithoutCalendarDate.length} 条记录没有日期，不会显示在日历网格中。
                </div>
              ) : null}
              {expandedCalendarDate ? (
                <div className="rounded-[14px] border border-[#007aff]/20 bg-[#007aff]/[0.06] p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="text-sm font-semibold">{expandedCalendarDate} 的全部记录</div>
                    <Button size="sm" variant="ghost" className="h-8 rounded-[10px]" onClick={() => setExpandedCalendarDate(null)}>
                      收起
                    </Button>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {sortedNotes
                      .filter((note) => calendarProperty ? normalizeDateInput(getEffectiveValue(note, calendarProperty, optimisticValues)?.value_date) === expandedCalendarDate : false)
                      .map((note) => (
                        <button
                          key={note.id}
                          type="button"
                          onClick={() => onSelectNote(note.id)}
                          className="rounded-[12px] border border-border/70 bg-white/80 px-3 py-2 text-left text-xs font-medium dark:bg-white/[0.05]"
                        >
                          {decodeEscapedUnicode(note.title || "无标题")}
                        </button>
                      ))}
                  </div>
                </div>
              ) : null}
              <div className="grid grid-cols-7 gap-2 text-xs text-muted-foreground">
                {["一", "二", "三", "四", "五", "六", "日"].map((label) => (
                  <div key={label} className="px-2 py-1 text-center">
                    {label}
                  </div>
                ))}
                {calendarCells.map((date) => {
                  const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
                  const dayNotes = sortedNotes.filter((note) => calendarProperty ? normalizeDateInput(getEffectiveValue(note, calendarProperty, optimisticValues)?.value_date) === iso : false);
                  const visibleDayNotes = dayNotes.slice(0, calendarVisibleNotesPerDay);
                  const hiddenDayCount = Math.max(0, dayNotes.length - visibleDayNotes.length);
                  const inMonth = date.getMonth() === calendarMonth.getMonth();
                  return (
                    <div
                      key={iso}
                      aria-label={`calendar-day-${iso}`}
                      className={cn(
                        "min-h-[120px] rounded-[14px] border border-border/60 bg-white/70 p-2 dark:bg-white/[0.04]",
                        !inMonth && "opacity-45",
                      )}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) => {
                        const noteId = event.dataTransfer.getData("text/plain");
                        if (!noteId) return;
                        if (calendarProperty) commitNoteValue(noteId, calendarProperty, { property_id: calendarProperty.id, value_date: iso }, "日历移动失败，已回滚");
                      }}
                    >
                      <div className="mb-2 text-xs font-semibold">{date.getDate()}</div>
                      <div className="space-y-1">
                        {visibleDayNotes.map((note) => (
                          <button
                            key={note.id}
                            draggable
                            onDragStart={(event) => event.dataTransfer.setData("text/plain", note.id)}
                            onClick={() => onSelectNote(note.id)}
                            className={cn(
                              "block w-full rounded-[10px] bg-[#007aff]/10 px-2 py-1 text-left text-xs text-[#007aff]",
                              selectedNoteId === note.id && "bg-[#007aff]/20",
                            )}
                          >
                            {decodeEscapedUnicode(note.title || "无标题")}
                          </button>
                        ))}
                        {hiddenDayCount > 0 ? (
                          <button
                            type="button"
                            className="block w-full rounded-[10px] border border-dashed border-[#007aff]/30 px-2 py-1 text-left text-xs text-[#007aff]"
                            onClick={() => setExpandedCalendarDate(iso)}
                          >
                            还有 {hiddenDayCount} 条
                          </button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="rounded-[18px] border border-border/70 bg-white/70 p-6 text-sm text-muted-foreground dark:bg-white/[0.04]">
              先在属性管理里选择一个日期属性作为日历字段。
            </div>
          )
        ) : null}
      </div>

      <ConfirmDialog
        open={Boolean(deleteTemplateTargetId)}
        title="删除数据库模板"
        description="该模板会被删除，已创建的记录不会受影响。"
        confirmLabel="删除模板"
        destructive
        loading={destructiveActionLoading}
        onOpenChange={(open) => {
          if (destructiveActionLoading) return;
          if (!open) setDeleteTemplateTargetId(null);
        }}
        onConfirm={() => void confirmDeleteTemplate()}
      />

      <ConfirmDialog
        open={Boolean(deleteSavedViewTargetId)}
        title="删除保存视图"
        description="保存视图会被移除，不会删除数据库记录。"
        confirmLabel="删除视图"
        destructive
        loading={destructiveActionLoading}
        onOpenChange={(open) => {
          if (destructiveActionLoading) return;
          if (!open) setDeleteSavedViewTargetId(null);
        }}
        onConfirm={() => void confirmDeleteSavedView()}
      />
    </div>
  );
}
