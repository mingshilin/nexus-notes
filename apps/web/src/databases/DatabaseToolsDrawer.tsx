import type { DatabaseProperty, DatabaseRecord, DatabaseTemplate, DatabaseView } from "@nexus/contracts";
import { useEffect, useRef, useState } from "react";

import type { DatabaseClient } from "../data/database-client";
import { DatabaseBulkForm, DatabaseCsvForm } from "./DatabaseBulkCsvForms";
import { DatabaseCommentForm, DatabasePermissionForm } from "./DatabaseCollaborationForms";
import { propertyConfig, type PropertyType, downloadCsv, normalizeFieldValue } from "./database-form-utils";
import { DatabasePropertyEditor } from "./DatabasePropertyEditor";
import { DatabaseRecordForm } from "./DatabaseRecordForm";
import { DatabaseTemplateForm, DatabaseViewForm } from "./DatabaseViewTemplateForms";

type Panel = "record" | "property" | "view" | "template" | "comment" | "bulk" | "permission" | "csv";
const panels: readonly [Panel, string][] = [["record", "记录"], ["property", "属性"], ["view", "视图"], ["template", "模板"], ["comment", "评论"], ["bulk", "批量"], ["permission", "权限"], ["csv", "CSV"]];

export function DatabaseToolsDrawer({ open, views, activeViewId, databaseId, properties, records, templates = [], client, onOpenChange, onViewChange, onMutation, onBulkPreview }: {
  open: boolean; views: readonly DatabaseView[]; activeViewId: string; databaseId: string; properties: readonly DatabaseProperty[]; records: readonly DatabaseRecord[]; templates?: readonly DatabaseTemplate[]; client?: DatabaseClient; onOpenChange(open: boolean): void; onViewChange(viewId: string): void; onMutation?(): void; onBulkPreview?(mutations: { record_id: string; base_revision: number; values: Record<string, unknown> }[]): Promise<void>;
}) {
  const [panel, setPanel] = useState<Panel>("record");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [recordValues, setRecordValues] = useState<Record<string, unknown>>({});
  const [propertyName, setPropertyName] = useState("");
  const [propertyType, setPropertyType] = useState<PropertyType>("text");
  const [options, setOptions] = useState("");
  const [relationDatabaseId, setRelationDatabaseId] = useState("");
  const [comments, setComments] = useState<{ id: string; body: string }[]>([]);
  const [commentRecordId, setCommentRecordId] = useState(records[0]?.id ?? "");
  const [commentBody, setCommentBody] = useState("");
  const [selectedRecordIds, setSelectedRecordIds] = useState<string[]>([]);
  const [bulkPropertyId, setBulkPropertyId] = useState(properties[0]?.id ?? "");
  const [bulkValue, setBulkValue] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [viewName, setViewName] = useState("");
  const [viewType, setViewType] = useState<DatabaseView["type"]>("table");
  const [subjectId, setSubjectId] = useState("");
  const [role, setRole] = useState<"owner" | "editor" | "viewer">("viewer");
  const [csv, setCsv] = useState("");
  const closeRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const viewport = window.visualViewport;
    const updateInset = () => document.documentElement.style.setProperty("--database-drawer-keyboard", `${Math.max(0, window.innerHeight - (viewport?.height ?? window.innerHeight) - (viewport?.offsetTop ?? 0))}px`);
    updateInset(); viewport?.addEventListener("resize", updateInset); viewport?.addEventListener("scroll", updateInset); closeRef.current?.focus();
    return () => { viewport?.removeEventListener("resize", updateInset); viewport?.removeEventListener("scroll", updateInset); };
  }, [open]);
  useEffect(() => { if (panel === "comment" && client && commentRecordId) void client.listComments(databaseId, commentRecordId).then(setComments).catch(() => setComments([])); }, [client, commentRecordId, databaseId, panel]);

  const run = async (command: () => Promise<unknown>, message = "操作已完成。") => {
    if (pending || !client) return;
    setPending(true); setFeedback(null);
    try { await command(); setFeedback(message); onMutation?.(); } catch { setFeedback("操作失败，未保存本地更改。"); } finally { setPending(false); }
  };
  const validate = (condition: unknown, message: string) => condition ? true : (setFeedback(message), false);
  const changeOpen = (next: boolean) => {
    if (!next) triggerRef.current?.focus();
    onOpenChange(next);
  };
  const disabled = !client || pending;
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

  return <><button ref={triggerRef} className="database-tools-trigger" type="button" aria-label="数据库工具" aria-expanded={open} onClick={() => changeOpen(!open)}>数据库工具</button>{open ? <aside className="database-tools-drawer" role="dialog" aria-modal="true" aria-label="数据库工具" onKeyDown={(event) => { if (event.key === "Escape") changeOpen(false); }}><header><strong>数据库工具</strong><button ref={closeRef} type="button" onClick={() => changeOpen(false)}>关闭</button></header><label>视图<select value={activeViewId} onChange={(event) => onViewChange(event.target.value)}>{views.map((view) => <option key={view.id} value={view.id}>{view.name}</option>)}</select></label><nav className="database-tools-tabs" aria-label="数据库操作">{panels.map(([id, label]) => <button className={panel === id ? "active" : ""} key={id} type="button" onClick={() => { setPanel(id); setFeedback(null); }}>{label}</button>)}</nav><div className="database-tools-form">
    {panel === "record" ? <DatabaseRecordForm properties={properties} values={recordValues} disabled={disabled} onChange={(id, value) => setRecordValues((current) => ({ ...current, [id]: value }))} onSubmit={submitRecord} /> : null}
    {panel === "property" ? <DatabasePropertyEditor name={propertyName} type={propertyType} options={options} relationDatabaseId={relationDatabaseId} databaseId={databaseId} disabled={disabled} onNameChange={setPropertyName} onTypeChange={setPropertyType} onOptionsChange={setOptions} onRelationDatabaseChange={setRelationDatabaseId} onSubmit={submitProperty} /> : null}
    {panel === "view" ? <DatabaseViewForm name={viewName} type={viewType} properties={properties} position={views.length} disabled={disabled} onNameChange={setViewName} onTypeChange={setViewType} onSubmit={(input) => { if (validate(input.name.trim(), "请输入视图名称。")) void run(() => client!.createView(databaseId, { ...input, name: input.name.trim() })); }} /> : null}
    {panel === "template" ? <DatabaseTemplateForm templates={templates} templateId={templateId} name={templateName} records={records} disabled={disabled} onTemplateChange={setTemplateId} onNameChange={setTemplateName} onCreate={(name) => { if (validate(name.trim(), "请输入模板名称。")) void run(() => client!.createTemplate(databaseId, { name: name.trim(), default_values: recordValues })); }} onApply={(id) => void run(() => client!.applyTemplate(databaseId, { template_id: id, records: records.slice(0, 100).map((record) => ({ record_id: record.id, base_revision: record.revision })) }))} /> : null}
    {panel === "comment" ? <DatabaseCommentForm records={records} recordId={commentRecordId} comments={comments} body={commentBody} disabled={disabled} onRecordChange={setCommentRecordId} onBodyChange={setCommentBody} onSubmit={() => { if (validate(commentBody.trim(), "请输入评论内容。")) void run(() => client!.createComment(databaseId, commentRecordId, { record_id: commentRecordId, body: commentBody.trim() })); }} /> : null}
    {panel === "bulk" ? <DatabaseBulkForm records={records} properties={properties} selectedIds={selectedRecordIds} propertyId={bulkPropertyId} value={bulkValue} disabled={disabled} onSelectionChange={(id, selected) => setSelectedRecordIds((current) => selected ? [...current, id] : current.filter((currentId) => currentId !== id))} onPropertyChange={setBulkPropertyId} onValueChange={setBulkValue} onSubmit={submitBulk} /> : null}
    {panel === "permission" ? <DatabasePermissionForm subjectId={subjectId} role={role} disabled={disabled} onSubjectChange={setSubjectId} onRoleChange={setRole} onSubmit={() => { if (validate(subjectId.trim(), "请输入成员或角色 ID。")) void run(() => client!.setDatabasePermission(databaseId, { subject_type: "user", subject_id: subjectId.trim(), role, base_revision: 1 })); }} /> : null}
    {panel === "csv" ? <DatabaseCsvForm csv={csv} disabled={disabled} onCsvChange={setCsv} onImport={() => { if (validate(csv.trim(), "请输入 CSV 内容。")) void run(() => client!.importCsv(databaseId, { csv, header_property_ids: Object.fromEntries(properties.map((property) => [property.name, property.id])) })); }} onExport={() => void run(async () => downloadCsv(await client!.exportAllCsv(databaseId, { property_ids: properties.map((property) => property.id), page_size: 100 })), "CSV 已导出。")} /> : null}
  </div>{feedback ? <p className="database-operation-feedback" role="status">{feedback}</p> : null}</aside> : null}</>;
}
