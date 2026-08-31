import type { CsvPreview, Database, DatabaseComment, DatabasePermission, DatabaseProperty, DatabaseRecord, DatabaseStats, DatabaseTemplate, DatabaseView, FieldPermission } from "@nexus/contracts";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { DatabaseClient } from "../data/database-client";
import type { CollaborationClient, CollaborationMember } from "../data/collaboration-client";
import { DatabaseBulkForm } from "./DatabaseBulkCsvForms";
import { DatabaseCommentForm, DatabasePermissionForm } from "./DatabaseCollaborationForms";
import { propertyConfig, type PropertyType, downloadCsvBlob, normalizeFieldValue } from "./database-form-utils";
import { DatabaseCsvManager, DatabaseOverviewPanel, DatabasePermissionMatrix, parseCsvHeaders } from "./DatabaseManagementPanels";
import { DatabasePropertyEditor } from "./DatabasePropertyEditor";
import { DatabaseRecordForm } from "./DatabaseRecordForm";
import { DatabaseTemplateForm, DatabaseViewForm } from "./DatabaseViewTemplateForms";

type Panel = "overview" | "database" | "record" | "property" | "view" | "template" | "comment" | "bulk" | "permission" | "csv";
const panels: readonly [Panel, string][] = [["overview", "概览"], ["database", "设置"], ["record", "记录"], ["property", "属性"], ["view", "视图"], ["template", "模板"], ["comment", "评论"], ["bulk", "批量"], ["permission", "权限"], ["csv", "导入导出"]];
const CANCELLED_OPERATION = Symbol("cancelled-operation");
const COMMITTED_STALE_OPERATION = Symbol("committed-stale-operation");
const COMPLETED_WITH_WARNING = Symbol("completed-with-warning");

type ControllerRef = { current: AbortController | null };

function abortRequest(ref: ControllerRef) {
  ref.current?.abort();
  ref.current = null;
}

function cancelRequest(ref: ControllerRef, controller: AbortController) {
  if (ref.current === controller) ref.current = null;
  controller.abort();
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError"
    || error instanceof Error && error.name === "AbortError";
}

export function DatabaseToolsDrawer({ open, views, activeViewId, database, databases = [database], databaseId, properties, records, templates = [], client, collaborationClient, onOpenChange, onViewChange, onMutation, onBulkPreview }: {
  open: boolean; views: readonly DatabaseView[]; activeViewId: string; database: Database; databases?: readonly Database[]; databaseId: string; properties: readonly DatabaseProperty[]; records: readonly DatabaseRecord[]; templates?: readonly DatabaseTemplate[]; client?: DatabaseClient; collaborationClient?: CollaborationClient; onOpenChange(open: boolean): void; onViewChange(viewId: string): void; onMutation?(): void; onBulkPreview?(mutations: { record_id: string; base_revision: number; values: Record<string, unknown> }[]): Promise<void>;
}) {
  const [panel, setPanel] = useState<Panel>("overview");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [stats, setStats] = useState<DatabaseStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [statsRetry, setStatsRetry] = useState(0);
  const [recordValues, setRecordValues] = useState<Record<string, unknown>>({});
  const [propertyName, setPropertyName] = useState("");
  const [propertyType, setPropertyType] = useState<PropertyType>("text");
  const [options, setOptions] = useState("");
  const [relationDatabaseId, setRelationDatabaseId] = useState("");
  const [comments, setComments] = useState<DatabaseComment[]>([]);
  const [commentRecordId, setCommentRecordId] = useState(records[0]?.id ?? "");
  const [commentBody, setCommentBody] = useState("");
  const [selectedRecordIds, setSelectedRecordIds] = useState<string[]>([]);
  const [bulkPropertyId, setBulkPropertyId] = useState(properties[0]?.id ?? "");
  const [bulkValue, setBulkValue] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [templateValues, setTemplateValues] = useState<Record<string, unknown>>(templates[0]?.default_values ?? {});
  const [viewName, setViewName] = useState("");
  const [viewType, setViewType] = useState<DatabaseView["type"]>("table");
  const [subjectType, setSubjectType] = useState<DatabasePermission["subject_type"]>("user");
  const [subjectId, setSubjectId] = useState("");
  const [role, setRole] = useState<"owner" | "editor" | "viewer">("viewer");
  const [databasePermissions, setDatabasePermissions] = useState<DatabasePermission[]>([]);
  const [fieldPermissions, setFieldPermissions] = useState<FieldPermission[]>([]);
  const [members, setMembers] = useState<CollaborationMember[]>([]);
  const [permissionPropertyId, setPermissionPropertyId] = useState(properties[0]?.id ?? "");
  const [csv, setCsv] = useState("");
  const [csvMappings, setCsvMappings] = useState<Record<string, string>>({});
  const [csvPreview, setCsvPreview] = useState<CsvPreview | null>(null);
  const [csvPreviewError, setCsvPreviewError] = useState<string | null>(null);
  const [csvPreviewLoading, setCsvPreviewLoading] = useState(false);
  const [databaseName, setDatabaseName] = useState(database.name);
  const [databaseDescription, setDatabaseDescription] = useState(database.description);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [selectedPropertyId, setSelectedPropertyId] = useState("");
  const [selectedRecordId, setSelectedRecordId] = useState("");
  const [selectedViewId, setSelectedViewId] = useState("");
  const [selectedCommentId, setSelectedCommentId] = useState("");
  const [fieldCanRead, setFieldCanRead] = useState(true);
  const [fieldCanWrite, setFieldCanWrite] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  const committedDatabaseIdRef = useRef(databaseId);
  const currentDatabaseIdRef = useRef(databaseId);
  const committedPanelRef = useRef<Panel>(panel);
  const currentPanelRef = useRef<Panel>(panel);
  const databaseGenerationRef = useRef(0);
  const panelGenerationRef = useRef(0);
  const mountedRef = useRef(true);
  const statsControllerRef = useRef<AbortController | null>(null);
  const commentsControllerRef = useRef<AbortController | null>(null);
  const databasePermissionsControllerRef = useRef<AbortController | null>(null);
  const fieldPermissionsControllerRef = useRef<AbortController | null>(null);
  const databasePermissionSaveControllerRef = useRef<AbortController | null>(null);
  const fieldPermissionSaveControllerRef = useRef<AbortController | null>(null);
  const databasePermissionsSequenceRef = useRef(0);
  const fieldPermissionsSequenceRef = useRef(0);
  const membersControllerRef = useRef<AbortController | null>(null);
  const csvPreviewControllerRef = useRef<AbortController | null>(null);

  currentDatabaseIdRef.current = databaseId;
  currentPanelRef.current = panel;
  const databaseChanged = committedDatabaseIdRef.current !== databaseId;
  const renderedPanel: Panel = databaseChanged ? "overview" : panel;
  const visibleStats = databaseChanged ? null : stats;
  const visibleStatsLoading = databaseChanged ? false : statsLoading;
  const visibleStatsError = databaseChanged ? null : statsError;
  const visibleComments = databaseChanged ? [] : comments;
  const visibleDatabasePermissions = databaseChanged ? [] : databasePermissions;
  const visibleFieldPermissions = databaseChanged ? [] : fieldPermissions;
  const visibleMembers = databaseChanged ? [] : members;
  const visibleCommentRecordId = databaseChanged ? records[0]?.id ?? "" : commentRecordId;
  const visiblePermissionPropertyId = databaseChanged ? properties[0]?.id ?? "" : permissionPropertyId;
  const visibleSubjectId = databaseChanged ? "" : subjectId;
  const visibleSelectedRecordId = databaseChanged ? "" : selectedRecordId;
  const visibleSelectedPropertyId = databaseChanged ? "" : selectedPropertyId;
  const visibleSelectedViewId = databaseChanged ? "" : selectedViewId;
  const visibleSelectedCommentId = databaseChanged ? "" : selectedCommentId;
  const visibleCsvPreview = databaseChanged ? null : csvPreview;
  const visibleCsvPreviewError = databaseChanged ? null : csvPreviewError;

  const scopeIsCurrent = (
    requestDatabaseId: string,
    requestDatabaseGeneration: number,
    requestPanel?: Panel,
    requestPanelGeneration?: number,
  ) => mountedRef.current
    && currentDatabaseIdRef.current === requestDatabaseId
    && databaseGenerationRef.current === requestDatabaseGeneration
    && (requestPanel === undefined || currentPanelRef.current === requestPanel)
    && (requestPanelGeneration === undefined || panelGenerationRef.current === requestPanelGeneration);

  const requestIsCurrent = (
    controller: AbortController,
    requestDatabaseId: string,
    requestDatabaseGeneration: number,
    requestPanel?: Panel,
    requestPanelGeneration?: number,
    ownerRef?: ControllerRef,
  ) => !controller.signal.aborted
    && scopeIsCurrent(requestDatabaseId, requestDatabaseGeneration, requestPanel, requestPanelGeneration)
    && (ownerRef === undefined || ownerRef.current === controller);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRequest(statsControllerRef);
      abortRequest(commentsControllerRef);
      abortRequest(databasePermissionsControllerRef);
      abortRequest(fieldPermissionsControllerRef);
      abortRequest(databasePermissionSaveControllerRef);
      abortRequest(fieldPermissionSaveControllerRef);
      abortRequest(membersControllerRef);
      abortRequest(csvPreviewControllerRef);
    };
  }, []);

  useEffect(() => {
    if (!open) {
      if (wasOpen.current) triggerRef.current?.focus();
      wasOpen.current = false;
      return;
    }
    wasOpen.current = true;
    const viewport = window.visualViewport;
    const updateInset = () => document.documentElement.style.setProperty("--database-drawer-keyboard", `${Math.max(0, window.innerHeight - (viewport?.height ?? window.innerHeight) - (viewport?.offsetTop ?? 0))}px`);
    updateInset(); viewport?.addEventListener("resize", updateInset); viewport?.addEventListener("scroll", updateInset); closeRef.current?.focus();
    return () => { viewport?.removeEventListener("resize", updateInset); viewport?.removeEventListener("scroll", updateInset); };
  }, [open]);

  useLayoutEffect(() => {
    if (committedDatabaseIdRef.current === databaseId) return;
    committedDatabaseIdRef.current = databaseId;
    databaseGenerationRef.current += 1;
    abortRequest(statsControllerRef);
    abortRequest(commentsControllerRef);
    abortRequest(databasePermissionsControllerRef);
    abortRequest(fieldPermissionsControllerRef);
    abortRequest(databasePermissionSaveControllerRef);
    abortRequest(fieldPermissionSaveControllerRef);
    databasePermissionsSequenceRef.current += 1;
    fieldPermissionsSequenceRef.current += 1;
    abortRequest(membersControllerRef);
    abortRequest(csvPreviewControllerRef);
    setPanel("overview");
    setFeedback(null);
    setStats(null);
    setStatsLoading(false);
    setStatsError(null);
    setPending(false);
    setComments([]);
    setCommentRecordId(records[0]?.id ?? "");
    setCommentBody("");
    setSelectedCommentId("");
    setDatabasePermissions([]);
    setFieldPermissions([]);
    setMembers([]);
    setSubjectId("");
    setSelectedRecordIds([]);
    setSelectedRecordId("");
    setRecordValues({});
    setSelectedPropertyId("");
    setSelectedViewId("");
    setPermissionPropertyId(properties[0]?.id ?? "");
    setFieldCanRead(true);
    setFieldCanWrite(false);
    setCsvPreview(null);
    setCsvPreviewError(null);
    setCsvPreviewLoading(false);
    setCsvMappings({});
    setDatabaseName(database.name);
    setDatabaseDescription(database.description);
    setDeleteConfirmation("");
  }, [database.id, database.name, database.description, databaseId, properties, records]);

  useLayoutEffect(() => {
    if (committedPanelRef.current === panel) return;
    const previousPanel = committedPanelRef.current;
    committedPanelRef.current = panel;
    panelGenerationRef.current += 1;
    abortRequest(commentsControllerRef);
    abortRequest(databasePermissionsControllerRef);
    abortRequest(fieldPermissionsControllerRef);
    abortRequest(databasePermissionSaveControllerRef);
    abortRequest(fieldPermissionSaveControllerRef);
    databasePermissionsSequenceRef.current += 1;
    fieldPermissionsSequenceRef.current += 1;
    abortRequest(membersControllerRef);
    abortRequest(csvPreviewControllerRef);
    setPending(false);
    setFeedback(null);
    if (previousPanel === "csv" && panel !== "csv") setCsvPreviewLoading(false);
  }, [panel]);

  useEffect(() => {
    if (!open || !client) return;
    abortRequest(statsControllerRef);
    const controller = new AbortController();
    statsControllerRef.current = controller;
    const requestDatabaseId = databaseId;
    const requestDatabaseGeneration = databaseGenerationRef.current;
    const isCurrent = () => requestIsCurrent(controller, requestDatabaseId, requestDatabaseGeneration, undefined, undefined, statsControllerRef);
    setStatsLoading(true);
    setStatsError(null);
    void Promise.resolve().then(() => client.getStats(requestDatabaseId, controller.signal)).then((value) => {
      if (isCurrent()) setStats(value);
    }).catch(() => {
      if (isCurrent()) setStatsError("数据库概览暂时无法加载，请稍后重试。");
    }).finally(() => {
      if (isCurrent()) {
        setStatsLoading(false);
        if (statsControllerRef.current === controller) statsControllerRef.current = null;
      }
    });
    return () => cancelRequest(statsControllerRef, controller);
  }, [client, databaseId, open, statsRetry]);

  useEffect(() => {
    if (!open || panel !== "comment" || !client || !commentRecordId) return;
    abortRequest(commentsControllerRef);
    const controller = new AbortController();
    commentsControllerRef.current = controller;
    const requestDatabaseId = databaseId;
    const requestRecordId = commentRecordId;
    const requestDatabaseGeneration = databaseGenerationRef.current;
    const requestPanelGeneration = panelGenerationRef.current;
    const isCurrent = () => requestIsCurrent(controller, requestDatabaseId, requestDatabaseGeneration, "comment", requestPanelGeneration, commentsControllerRef)
      && currentPanelRef.current === "comment";
    setComments([]);
    void Promise.resolve().then(() => client.listComments(requestDatabaseId, requestRecordId, controller.signal)).then((items) => {
      if (isCurrent()) setComments(items);
    }).catch(() => {
      if (isCurrent()) setComments([]);
    });
    return () => cancelRequest(commentsControllerRef, controller);
  }, [client, commentRecordId, databaseId, open, panel]);

  useEffect(() => {
    if (!open || panel !== "permission" || !client) return;
    abortRequest(databasePermissionsControllerRef);
    const controller = new AbortController();
    databasePermissionsControllerRef.current = controller;
    const requestDatabaseId = databaseId;
    const requestDatabaseGeneration = databaseGenerationRef.current;
    const requestPanelGeneration = panelGenerationRef.current;
    const requestSequence = ++databasePermissionsSequenceRef.current;
    const isCurrent = () => requestIsCurrent(controller, requestDatabaseId, requestDatabaseGeneration, "permission", requestPanelGeneration, databasePermissionsControllerRef)
      && databasePermissionsSequenceRef.current === requestSequence;
    setDatabasePermissions([]);
    void Promise.resolve().then(() => client.listDatabasePermissions(requestDatabaseId, controller.signal)).then((items) => {
      if (isCurrent()) setDatabasePermissions(items);
    }).catch(() => {
      if (isCurrent()) setDatabasePermissions([]);
    });
    return () => cancelRequest(databasePermissionsControllerRef, controller);
  }, [client, databaseId, open, panel]);

  useEffect(() => {
    if (!open || panel !== "permission" || !collaborationClient) {
      if (!collaborationClient) {
        abortRequest(membersControllerRef);
        setMembers([]);
        setSubjectId("");
      }
      return;
    }
    abortRequest(membersControllerRef);
    const controller = new AbortController();
    membersControllerRef.current = controller;
    const requestDatabaseId = databaseId;
    const requestDatabaseGeneration = databaseGenerationRef.current;
    const requestPanelGeneration = panelGenerationRef.current;
    const isCurrent = () => requestIsCurrent(controller, requestDatabaseId, requestDatabaseGeneration, "permission", requestPanelGeneration, membersControllerRef);
    setMembers([]);
    setSubjectId("");
    void Promise.resolve().then(() => collaborationClient.listMembers(controller.signal)).then((items) => {
      if (!isCurrent()) return;
      setMembers(items);
      setSubjectId((current) => subjectType === "user" && items.some((item) => item.user_id === current)
        ? current
        : subjectType === "user" ? items[0]?.user_id ?? "" : current);
    }).catch(() => {
      if (isCurrent()) setMembers([]);
    });
    return () => cancelRequest(membersControllerRef, controller);
  }, [collaborationClient, databaseId, open, panel, subjectType]);

  useEffect(() => {
    if (!open || panel !== "permission" || !client || properties.length === 0) return;
    abortRequest(fieldPermissionsControllerRef);
    const controller = new AbortController();
    fieldPermissionsControllerRef.current = controller;
    const requestDatabaseId = databaseId;
    const requestDatabaseGeneration = databaseGenerationRef.current;
    const requestPanelGeneration = panelGenerationRef.current;
    const requestSequence = ++fieldPermissionsSequenceRef.current;
    const isCurrent = () => requestIsCurrent(controller, requestDatabaseId, requestDatabaseGeneration, "permission", requestPanelGeneration, fieldPermissionsControllerRef)
      && fieldPermissionsSequenceRef.current === requestSequence;
    setFieldPermissions([]);
    void Promise.all(properties.map((property) => client.listFieldPermissions(requestDatabaseId, property.id, controller.signal)))
      .then((items) => {
        if (isCurrent()) setFieldPermissions(items.flat());
      })
      .catch(() => {
        if (isCurrent()) setFieldPermissions([]);
      });
    return () => cancelRequest(fieldPermissionsControllerRef, controller);
  }, [client, databaseId, open, panel, properties]);

  useEffect(() => {
    const headers = parseCsvHeaders(csv);
    setCsvMappings((current) => Object.fromEntries(headers.map((header) => {
      const existing = current[header];
      const matched = properties.find((property) => property.name.localeCompare(header, undefined, { sensitivity: "accent" }) === 0);
      return [header, existing ?? matched?.id ?? ""];
    })));
    abortRequest(csvPreviewControllerRef);
    setCsvPreview(null);
    setCsvPreviewError(null);
    setCsvPreviewLoading(false);
  }, [csv, databaseId, properties]);

  useEffect(() => {
    setDatabaseName(database.name);
    setDatabaseDescription(database.description);
    setDeleteConfirmation("");
  }, [database.id, database.description, database.name]);

  useEffect(() => {
    const selected = templates.find((template) => template.id === templateId);
    if (!selected) return;
    setTemplateName(selected.name);
    setTemplateValues(selected.default_values);
  }, [templateId, templates]);

  const run = async (command: () => Promise<unknown>, message = "操作已完成。") => {
    if (pending || !client) return;
    const requestDatabaseId = databaseId;
    const requestDatabaseGeneration = databaseGenerationRef.current;
    const requestPanel = panel;
    const requestPanelGeneration = panelGenerationRef.current;
    const isCurrent = () => scopeIsCurrent(requestDatabaseId, requestDatabaseGeneration, requestPanel, requestPanelGeneration);
    setPending(true); setFeedback(null);
    let result: unknown;
    try {
      result = await command();
    } catch (error) {
      if (isCurrent() && !isAbortError(error)) setFeedback("操作失败，未保存本地更改。");
      if (isCurrent()) setPending(false);
      return;
    }

    if (result === CANCELLED_OPERATION) {
      if (isCurrent()) setPending(false);
      return;
    }

    const committedWhileStale = result === COMMITTED_STALE_OPERATION;
    if (committedWhileStale || isCurrent()) {
      // Cache invalidation is best effort and must not turn a committed write into a failed one.
      try {
        onMutation?.();
      } catch {
        // The command already committed; a parent refresh can be retried independently.
      }
    }

    if (result === COMMITTED_STALE_OPERATION || result === COMPLETED_WITH_WARNING) {
      if (isCurrent()) setPending(false);
      return;
    }

    if (isCurrent()) {
      setFeedback(message);
      setPending(false);
    }
  };
  const validate = (condition: unknown, message: string) => condition ? true : (setFeedback(message), false);
  const changeOpen = (next: boolean) => {
    if (!next) triggerRef.current?.focus();
    onOpenChange(next);
  };
  const disabled = !client || pending || csvPreviewLoading;
  const changeSubjectType = (next: DatabasePermission["subject_type"]) => {
    setSubjectType(next);
    setSubjectId(next === "role" ? "viewer" : "");
  };
  const selectedProperty = properties.find((property) => property.id === visibleSelectedPropertyId);
  const selectedRecord = records.find((record) => record.id === visibleSelectedRecordId);
  const selectedView = views.find((view) => view.id === visibleSelectedViewId);
  const selectedTemplate = templates.find((template) => template.id === templateId);
  const selectedComment = visibleComments.find((comment) => comment.id === visibleSelectedCommentId);
  const recordLabels = Object.fromEntries(records.map((record) => {
    const label = properties.map((property) => record.values[property.id]).find((value) => typeof value === "string" && value.trim());
    return [record.id, typeof label === "string" ? label : record.id];
  }));
  const normalizedTemplateValues = () => Object.fromEntries(properties.flatMap((property) => {
    const value = normalizeFieldValue(property, templateValues[property.id]);
    return value === undefined ? [] : [[property.id, value]];
  }));
  const submitRecord = () => {
    const values = Object.fromEntries(Object.entries(recordValues).map(([id, value]) => [id, normalizeFieldValue(properties.find((property) => property.id === id)!, value)]).filter(([, value]) => value !== undefined));
    if (validate(Object.keys(values).length > 0, "请至少填写一个字段。")) void run(() => client!.createRecord(databaseId, { note_id: null, values }));
  };
  const submitProperty = () => {
    const config = propertyConfig(propertyType, options, relationDatabaseId);
    if (!validate(propertyName.trim(), "请输入属性名称。") || !validate(config !== null, propertyType === "relation" ? "请选择关联数据库。" : "select 字段至少需要一个选项。")) return;
    void run(() => client!.createProperty(databaseId, { name: propertyName.trim(), type: propertyType, config, position: properties.length, hidden: false, read_only: false }));
  };
  const submitBulk = () => {
    if (!validate(selectedRecordIds.length > 0, "请选择至少一条记录。") || !validate(selectedRecordIds.length <= 100, "一次最多编辑 100 条记录。")) return;
    const property = properties.find((candidate) => candidate.id === bulkPropertyId); if (!property) return;
    const mutations = records.filter((record) => selectedRecordIds.includes(record.id)).map((record) => ({ record_id: record.id, base_revision: record.revision, values: { [property.id]: normalizeFieldValue(property, bulkValue) } }));
    void run(() => onBulkPreview ? onBulkPreview(mutations) : client!.bulkEdit(databaseId, { mutations }), "已保存批量更新。");
  };
  const saveDatabasePermission = () => {
    if (!validate(subjectId.trim(), subjectType === "user" ? "请选择成员。" : "请选择工作区角色。")) return;
    const requestDatabaseId = databaseId;
    const requestDatabaseGeneration = databaseGenerationRef.current;
    const requestPanel = panel;
    const requestPanelGeneration = panelGenerationRef.current;
    const requestSubjectType = subjectType;
    const requestSubjectId = subjectId.trim();
    const requestRole = role;
    const current = visibleDatabasePermissions.find((permission) => permission.subject_type === requestSubjectType && permission.subject_id === requestSubjectId);
    void run(async () => {
      let committed = false;
      abortRequest(databasePermissionSaveControllerRef);
      const controller = new AbortController();
      databasePermissionSaveControllerRef.current = controller;
      const requestSequence = ++databasePermissionsSequenceRef.current;
      const isCurrent = () => requestIsCurrent(controller, requestDatabaseId, requestDatabaseGeneration, requestPanel, requestPanelGeneration, databasePermissionSaveControllerRef)
        && databasePermissionsSequenceRef.current === requestSequence;
      try {
        await client!.setDatabasePermission(requestDatabaseId, {
          subject_type: requestSubjectType,
          subject_id: requestSubjectId,
          role: requestRole,
          base_revision: current?.revision ?? 1,
        });
        committed = true;
        if (!isCurrent()) return COMMITTED_STALE_OPERATION;
        try {
          const items = await client!.listDatabasePermissions(requestDatabaseId, controller.signal);
          if (!isCurrent()) return COMMITTED_STALE_OPERATION;
          setDatabasePermissions(items);
        } catch (error) {
          if (!isCurrent() || isAbortError(error)) return committed ? COMMITTED_STALE_OPERATION : CANCELLED_OPERATION;
          setFeedback("权限已保存，但权限列表刷新失败，请稍后重试。");
          return COMPLETED_WITH_WARNING;
        }
      } catch (error) {
        if (!isCurrent() || isAbortError(error)) return committed ? COMMITTED_STALE_OPERATION : CANCELLED_OPERATION;
        throw error;
      } finally {
        if (databasePermissionSaveControllerRef.current === controller) databasePermissionSaveControllerRef.current = null;
      }
    });
  };
  const saveFieldPermission = () => {
    if (!validate(subjectId.trim(), subjectType === "user" ? "请选择成员。" : "请选择工作区角色。")) return;
    const requestDatabaseId = databaseId;
    const requestDatabaseGeneration = databaseGenerationRef.current;
    const requestPanel = panel;
    const requestPanelGeneration = panelGenerationRef.current;
    const requestSubjectType = subjectType;
    const requestPropertyId = visiblePermissionPropertyId;
    const requestSubjectId = subjectId.trim();
    const requestCanRead = fieldCanRead;
    const requestCanWrite = fieldCanWrite;
    const current = visibleFieldPermissions.find((permission) => permission.property_id === requestPropertyId && permission.subject_type === requestSubjectType && permission.subject_id === requestSubjectId);
    void run(async () => {
      let committed = false;
      abortRequest(fieldPermissionSaveControllerRef);
      const controller = new AbortController();
      fieldPermissionSaveControllerRef.current = controller;
      const requestSequence = ++fieldPermissionsSequenceRef.current;
      const isCurrent = () => requestIsCurrent(controller, requestDatabaseId, requestDatabaseGeneration, requestPanel, requestPanelGeneration, fieldPermissionSaveControllerRef)
        && fieldPermissionsSequenceRef.current === requestSequence;
      try {
        await client!.setFieldPermission(requestDatabaseId, requestPropertyId, {
          subject_type: requestSubjectType,
          subject_id: requestSubjectId,
          can_read: requestCanRead,
          can_write: requestCanWrite,
          base_revision: current?.revision ?? 1,
        });
        committed = true;
        if (!isCurrent()) return COMMITTED_STALE_OPERATION;
        try {
          const updated = await client!.listFieldPermissions(requestDatabaseId, requestPropertyId, controller.signal);
          if (!isCurrent()) return COMMITTED_STALE_OPERATION;
          setFieldPermissions((items) => [...items.filter((item) => item.property_id !== requestPropertyId), ...updated]);
        } catch (error) {
          if (!isCurrent() || isAbortError(error)) return committed ? COMMITTED_STALE_OPERATION : CANCELLED_OPERATION;
          setFeedback("字段权限已保存，但列表刷新失败，请稍后重试。");
          return COMPLETED_WITH_WARNING;
        }
      } catch (error) {
        if (!isCurrent() || isAbortError(error)) return committed ? COMMITTED_STALE_OPERATION : CANCELLED_OPERATION;
        throw error;
      } finally {
        if (fieldPermissionSaveControllerRef.current === controller) fieldPermissionSaveControllerRef.current = null;
      }
    });
  };
  const deleteDatabasePermission = (permission: DatabasePermission) => {
    const requestDatabaseId = databaseId;
    const requestDatabaseGeneration = databaseGenerationRef.current;
    const requestPanel = panel;
    const requestPanelGeneration = panelGenerationRef.current;
    void run(async () => {
      await client!.deleteDatabasePermission(requestDatabaseId, permission.id, { base_revision: permission.revision });
      if (!scopeIsCurrent(requestDatabaseId, requestDatabaseGeneration, requestPanel, requestPanelGeneration)) return COMMITTED_STALE_OPERATION;
      setDatabasePermissions((current) => current.filter((item) => item.id !== permission.id));
    });
  };
  const deleteFieldPermission = (permission: FieldPermission) => {
    const requestDatabaseId = databaseId;
    const requestDatabaseGeneration = databaseGenerationRef.current;
    const requestPanel = panel;
    const requestPanelGeneration = panelGenerationRef.current;
    void run(async () => {
      await client!.deleteFieldPermission(requestDatabaseId, permission.property_id, permission.id, { base_revision: permission.revision });
      if (!scopeIsCurrent(requestDatabaseId, requestDatabaseGeneration, requestPanel, requestPanelGeneration)) return COMMITTED_STALE_OPERATION;
      setFieldPermissions((current) => current.filter((item) => item.id !== permission.id));
    });
  };
  const previewCsv = async () => {
    if (disabled || !client) return;
    abortRequest(csvPreviewControllerRef);
    const controller = new AbortController();
    csvPreviewControllerRef.current = controller;
    const requestDatabaseId = databaseId;
    const requestDatabaseGeneration = databaseGenerationRef.current;
    const requestPanelGeneration = panelGenerationRef.current;
    const requestCsv = csv;
    const requestMappings = { ...csvMappings };
    const isCurrent = () => requestIsCurrent(controller, requestDatabaseId, requestDatabaseGeneration, "csv", requestPanelGeneration, csvPreviewControllerRef);
    setCsvPreviewLoading(true);
    setCsvPreviewError(null);
    setFeedback(null);
    try {
      const previewInput = { csv: requestCsv, header_property_ids: requestMappings };
      const preview = await client.previewCsv(requestDatabaseId, previewInput, controller.signal);
      if (isCurrent()) {
        setCsvPreview(preview);
        setCsvPreviewError(null);
      }
    } catch {
      if (isCurrent()) {
        setCsvPreview(null);
        setCsvPreviewError("CSV 预览失败，已保留当前内容和字段映射，请重试。");
      }
    } finally {
      if (isCurrent()) {
        setCsvPreviewLoading(false);
        if (csvPreviewControllerRef.current === controller) csvPreviewControllerRef.current = null;
      }
    }
  };
  const duplicateStructure = () => run(async () => {
    const copy = await client!.createDatabase({ name: `${database.name} 副本`, description: database.description });
    const propertyIds = new Map<string, string>();
    for (const property of properties) {
      const created = await client!.createProperty(copy.id, {
        name: property.name,
        type: property.type,
        config: property.config,
        position: property.position,
        hidden: property.hidden,
        read_only: property.read_only,
      });
      propertyIds.set(property.id, created.id);
    }
    const remap = (propertyId: string) => propertyIds.get(propertyId) ?? propertyId;
    for (const view of views) {
      await client!.createView(copy.id, {
        name: view.name,
        type: view.type,
        position: view.position,
        config: {
          ...view.config,
          visible_columns: view.config.visible_columns.map(remap),
          filters: view.config.filters.map((filter) => ({ ...filter, property_id: remap(filter.property_id) })),
          sorts: view.config.sorts.map((sort) => ({ ...sort, property_id: remap(sort.property_id) })),
          grouping: view.config.grouping ? { ...view.config.grouping, property_id: remap(view.config.grouping.property_id) } : null,
        },
      });
    }
    for (const template of templates) {
      await client!.createTemplate(copy.id, {
        name: template.name,
        default_values: Object.fromEntries(Object.entries(template.default_values).map(([propertyId, value]) => [remap(propertyId), value])),
      });
    }
  }, "数据库结构已复制。");

  const trapFocus = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") { changeOpen(false); return; }
    if (event.key !== "Tab") return;
    const nodes = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])'));
    if (!nodes.length) return;
    const first = nodes[0]!; const last = nodes[nodes.length - 1]!;
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };

  const drawer = (
    <aside className="database-tools-drawer" role="dialog" aria-modal="true" aria-label="数据库工具" data-scroll-owner="drawer" onKeyDown={trapFocus}>
      <header>
        <div><p className="eyebrow">DATABASE MANAGEMENT</p><h2>数据库管理中心</h2></div>
        <button ref={closeRef} type="button" onClick={() => changeOpen(false)}>关闭</button>
      </header>
      {views.length ? <label className="database-active-view">当前视图<select aria-label="视图" value={activeViewId} onChange={(event) => onViewChange(event.target.value)}>{views.map((view) => <option key={view.id} value={view.id}>{view.name}</option>)}</select></label> : null}
      <nav className="database-tools-tabs" aria-label="数据库操作">{panels.map(([id, label]) =>
        <button className={renderedPanel === id ? "active" : ""} key={id} type="button" onClick={() => { setPanel(id); setFeedback(null); }}>{label}</button>,
      )}</nav>
      <div className="database-tools-form">
        {renderedPanel === "overview" ? <DatabaseOverviewPanel stats={visibleStats} loading={visibleStatsLoading} error={visibleStatsError} onRetry={() => setStatsRetry((value) => value + 1)} /> : null}
        {renderedPanel === "database" ? <section aria-label="数据库表单">
          <h2>数据库设置</h2>
          <label>数据库名称<input value={databaseName} onChange={(event) => setDatabaseName(event.target.value)} /></label>
          <label>描述<textarea value={databaseDescription} onChange={(event) => setDatabaseDescription(event.target.value)} /></label>
          <div className="database-tools-actions">
            <button type="button" disabled={disabled} onClick={() => { if (validate(databaseName.trim(), "请输入数据库名称。")) void run(() => client!.updateDatabase(databaseId, { base_revision: database.revision, name: databaseName.trim(), description: databaseDescription })); }}>保存数据库</button>
            <button type="button" disabled={disabled} onClick={() => void duplicateStructure()}>复制结构</button>
          </div>
          <section className="database-danger-zone" aria-label="危险操作">
            <h3>危险操作</h3>
            <p>删除前会先解除笔记与数据库的关联，笔记正文不会被删除。</p>
            <label>输入数据库名称以确认删除<input value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} /></label>
            <button type="button" disabled={disabled || deleteConfirmation !== database.name} onClick={() => void run(() => client!.deleteDatabase(databaseId, { base_revision: database.revision }), "数据库已删除。")}>删除数据库</button>
          </section>
        </section> : null}
        {renderedPanel === "record" ? <>
          <DatabaseRecordForm properties={properties} values={recordValues} disabled={disabled} onChange={(id, value) => setRecordValues((current) => ({ ...current, [id]: value }))} onSubmit={submitRecord} />
          <label>选择记录<select value={selectedRecordId} onChange={(event) => { const next = records.find((record) => record.id === event.target.value); setSelectedRecordId(event.target.value); setRecordValues(next?.values ?? {}); }}><option value="">请选择</option>{records.map((record) => <option key={record.id} value={record.id}>{recordLabels[record.id]}</option>)}</select></label>
          {selectedRecord ? <div className="database-tools-actions"><button type="button" disabled={disabled} onClick={() => void run(() => client!.updateRecord(databaseId, selectedRecord.id, { base_revision: selectedRecord.revision, values: Object.fromEntries(Object.entries(recordValues).map(([id, value]) => [id, normalizeFieldValue(properties.find((property) => property.id === id)!, value)]).filter(([, value]) => value !== undefined)) }))}>保存记录</button><button type="button" disabled={disabled} onClick={() => void run(() => client!.deleteRecord(databaseId, selectedRecord.id, { base_revision: selectedRecord.revision }), "记录已删除。")}>删除记录</button></div> : null}
        </> : null}
        {renderedPanel === "property" ? <>
          <DatabasePropertyEditor name={propertyName} type={propertyType} options={options} relationDatabaseId={relationDatabaseId} databases={databases} disabled={disabled} onNameChange={setPropertyName} onTypeChange={setPropertyType} onOptionsChange={setOptions} onRelationDatabaseChange={setRelationDatabaseId} onSubmit={submitProperty} />
          <label>选择属性<select value={selectedPropertyId} onChange={(event) => { const next = properties.find((property) => property.id === event.target.value); setSelectedPropertyId(event.target.value); if (next) { setPropertyName(next.name); setPropertyType(next.type as PropertyType); setOptions(((next.config as { options?: { name: string }[] }).options ?? []).map((option) => option.name).join(", ")); setRelationDatabaseId((next.config as { target_database_id?: string }).target_database_id ?? ""); } }}><option value="">请选择</option>{properties.map((property) => <option key={property.id} value={property.id}>{property.name}</option>)}</select></label>
          {selectedProperty ? <div className="database-tools-actions"><button type="button" disabled={disabled} onClick={() => { const config = propertyConfig(selectedProperty.type as PropertyType, options, relationDatabaseId); if (config) void run(() => client!.updateProperty(databaseId, selectedProperty.id, { base_revision: selectedProperty.revision, name: propertyName.trim(), config, position: selectedProperty.position, hidden: selectedProperty.hidden, read_only: selectedProperty.read_only })); }}>保存属性</button><button type="button" disabled={disabled} onClick={() => void run(() => client!.deleteProperty(databaseId, selectedProperty.id, { base_revision: selectedProperty.revision }), "属性已删除。")}>删除属性</button></div> : null}
        </> : null}
        {renderedPanel === "view" ? <>
          <label>选择视图<select value={selectedViewId} onChange={(event) => { const next = views.find((view) => view.id === event.target.value); setSelectedViewId(event.target.value); if (next) { setViewName(next.name); setViewType(next.type); } }}><option value="">新视图</option>{views.map((view) => <option key={view.id} value={view.id}>{view.name}</option>)}</select></label>
          <DatabaseViewForm name={viewName} type={viewType} properties={properties} position={selectedView?.position ?? views.length} editingView={selectedView} disabled={disabled} onNameChange={setViewName} onTypeChange={setViewType} onSubmit={(input) => { if (validate(input.name.trim(), "请输入视图名称。")) void run(() => client!.createView(databaseId, { ...input, name: input.name.trim() })); }} onUpdate={(input) => { if (selectedView && validate(input.name.trim(), "请输入视图名称。")) void run(() => client!.updateView(databaseId, selectedView.id, { base_revision: selectedView.revision, name: input.name.trim(), config: input.config, position: selectedView.position })); }} />
          {selectedView ? <button type="button" disabled={disabled} onClick={() => void run(() => client!.deleteView(databaseId, selectedView.id, { base_revision: selectedView.revision }), "视图已删除。")}>删除视图</button> : null}
        </> : null}
        {renderedPanel === "template" ? <>
          <DatabaseTemplateForm templates={templates} templateId={templateId} name={templateName} records={records} properties={properties} values={templateValues} disabled={disabled} onTemplateChange={setTemplateId} onNameChange={setTemplateName} onValuesChange={(propertyId, value) => setTemplateValues((current) => ({ ...current, [propertyId]: value }))} onCreate={(name) => { if (validate(name.trim(), "请输入模板名称。")) void run(() => client!.createTemplate(databaseId, { name: name.trim(), default_values: normalizedTemplateValues() })); }} onApply={(id) => void run(() => client!.applyTemplate(databaseId, { template_id: id, records: records.slice(0, 100).map((record) => ({ record_id: record.id, base_revision: record.revision })) }))} />
          {selectedTemplate ? <><details className="database-template-preview"><summary>应用前预览</summary><dl>{properties.map((property) => <div key={property.id}><dt>{property.name}</dt><dd>{String(templateValues[property.id] ?? "未设置")}</dd></div>)}</dl></details><div className="database-tools-actions"><button type="button" disabled={disabled} onClick={() => void run(() => client!.createTemplate(databaseId, { name: `${selectedTemplate.name} 副本`, default_values: selectedTemplate.default_values }), "模板已复制。")}>复制模板</button><button type="button" disabled={disabled} onClick={() => void run(() => client!.updateTemplate(databaseId, selectedTemplate.id, { base_revision: selectedTemplate.revision, name: templateName.trim() || selectedTemplate.name, default_values: normalizedTemplateValues() }))}>保存模板</button><button type="button" disabled={disabled} onClick={() => void run(() => client!.deleteTemplate(databaseId, selectedTemplate.id, { base_revision: selectedTemplate.revision }), "模板已删除。")}>删除模板</button></div></> : null}
        </> : null}
        {renderedPanel === "comment" ? <>
          <DatabaseCommentForm records={records} recordLabels={recordLabels} recordId={visibleCommentRecordId} comments={visibleComments} body={commentBody} disabled={disabled} onRecordChange={setCommentRecordId} onBodyChange={setCommentBody} onSubmit={() => { if (validate(commentBody.trim(), "请输入评论内容。")) void run(() => client!.createComment(databaseId, commentRecordId, { record_id: commentRecordId, body: commentBody.trim() })); }} />
          <label>选择评论<select value={visibleSelectedCommentId} onChange={(event) => { const next = visibleComments.find((comment) => comment.id === event.target.value); setSelectedCommentId(event.target.value); setCommentBody(next?.body ?? ""); }}><option value="">请选择</option>{visibleComments.map((comment) => <option key={comment.id} value={comment.id}>{comment.id}</option>)}</select></label>
          {selectedComment ? <div className="database-tools-actions"><button type="button" disabled={disabled} onClick={() => void run(() => client!.updateComment(databaseId, selectedComment.id, { base_revision: (selectedComment as DatabaseComment & { revision: number }).revision, body: commentBody.trim() }))}>保存评论</button><button type="button" disabled={disabled} onClick={() => void run(() => client!.deleteComment(databaseId, selectedComment.id, { base_revision: (selectedComment as DatabaseComment & { revision: number }).revision }), "评论已删除。")}>删除评论</button></div> : null}
        </> : null}
        {renderedPanel === "bulk" ? <DatabaseBulkForm records={records} properties={properties} selectedIds={selectedRecordIds} propertyId={bulkPropertyId} value={bulkValue} disabled={disabled} onSelectionChange={(id, selected) => setSelectedRecordIds((current) => selected ? [...current, id] : current.filter((currentId) => currentId !== id))} onPropertyChange={setBulkPropertyId} onValueChange={setBulkValue} onSubmit={submitBulk} /> : null}
        {renderedPanel === "permission" ? <>
          <DatabasePermissionForm subjectType={subjectType} subjectId={visibleSubjectId} role={role} members={collaborationClient ? visibleMembers : undefined} disabled={disabled} onSubjectTypeChange={changeSubjectType} onSubjectChange={setSubjectId} onRoleChange={setRole} onSubmit={saveDatabasePermission} />
          <ul className="database-entity-list" aria-label="数据库权限列表">{visibleDatabasePermissions.map((permission) => <li key={permission.id}><span>{permission.subject_id} · {permission.role} · r{permission.revision}</span><button type="button" aria-label={`删除数据库权限 ${permission.subject_id}`} disabled={disabled} onClick={() => deleteDatabasePermission(permission)}>删除</button></li>)}</ul>
          <label>权限字段<select aria-label="权限字段" value={visiblePermissionPropertyId} onChange={(event) => setPermissionPropertyId(event.target.value)}>{properties.map((property) => <option key={property.id} value={property.id}>{property.name}</option>)}</select></label>
          <label>字段可读<input type="checkbox" checked={fieldCanRead} onChange={(event) => { setFieldCanRead(event.target.checked); if (!event.target.checked) setFieldCanWrite(false); }} /></label>
          <label>字段可写<input type="checkbox" checked={fieldCanWrite} disabled={!fieldCanRead} onChange={(event) => setFieldCanWrite(event.target.checked)} /></label>
          <button type="button" disabled={disabled || !visiblePermissionPropertyId} onClick={saveFieldPermission}>保存字段权限</button>
          <ul className="database-entity-list" aria-label="字段权限列表">{visibleFieldPermissions.filter((permission) => permission.property_id === visiblePermissionPropertyId).map((permission) => <li key={permission.id}><span>{permission.subject_id} · r{permission.revision}</span><button type="button" aria-label={`删除字段权限 ${permission.subject_id}`} disabled={disabled} onClick={() => deleteFieldPermission(permission)}>删除</button></li>)}</ul>
          <DatabasePermissionMatrix members={visibleMembers} properties={properties} databasePermissions={visibleDatabasePermissions} fieldPermissions={visibleFieldPermissions} />
        </> : null}
        {renderedPanel === "csv" ? <DatabaseCsvManager csv={csv} properties={properties} mappings={csvMappings} preview={visibleCsvPreview} previewError={visibleCsvPreviewError} disabled={disabled} onCsvChange={setCsv} onMappingChange={(header, propertyId) => { setCsvMappings((current) => ({ ...current, [header]: propertyId })); setCsvPreviewError(null); }} onPreview={() => void previewCsv()} onRetry={() => void previewCsv()} onImport={() => { if (validate(csv.trim(), "请输入 CSV 内容。")) void run(() => client!.importCsv(databaseId, { csv, header_property_ids: csvMappings }), "CSV 已导入。"); }} onExport={() => void run(async () => downloadCsvBlob(await client!.exportCsvBlob(databaseId, { property_ids: properties.map((property) => property.id), page_size: 100 })), "CSV 已导出。")} /> : null}
      </div>
      {feedback ? <p className="database-operation-feedback" role="status">{feedback}</p> : null}
    </aside>
  );

  return <><button ref={triggerRef} className="database-tools-trigger" type="button" aria-label="数据库工具" aria-expanded={open} onClick={() => changeOpen(!open)}>数据库工具</button>{open && typeof document !== "undefined" ? createPortal(drawer, document.body) : null}</>;
}
