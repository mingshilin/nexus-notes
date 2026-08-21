import type { Database, DatabaseComment, DatabasePermission, DatabaseProperty, DatabaseRecord, DatabaseTemplate, DatabaseView, FieldPermission } from "@nexus/contracts";
import { useEffect, useRef, useState } from "react";

import type { DatabaseClient } from "../data/database-client";
import { DatabaseBulkForm, DatabaseCsvForm } from "./DatabaseBulkCsvForms";
import { DatabaseCommentForm, DatabasePermissionForm } from "./DatabaseCollaborationForms";
import { propertyConfig, type PropertyType, downloadCsvBlob, normalizeFieldValue } from "./database-form-utils";
import { DatabasePropertyEditor } from "./DatabasePropertyEditor";
import { DatabaseRecordForm } from "./DatabaseRecordForm";
import { DatabaseTemplateForm, DatabaseViewForm } from "./DatabaseViewTemplateForms";

type Panel = "database" | "record" | "property" | "view" | "template" | "comment" | "bulk" | "permission" | "csv";
const panels: readonly [Panel, string][] = [["database", "数据库"], ["record", "记录"], ["property", "属性"], ["view", "视图"], ["template", "模板"], ["comment", "评论"], ["bulk", "批量"], ["permission", "权限"], ["csv", "CSV"]];

export function DatabaseToolsDrawer({ open, views, activeViewId, database, databaseId, properties, records, templates = [], client, onOpenChange, onViewChange, onMutation, onBulkPreview }: {
  open: boolean; views: readonly DatabaseView[]; activeViewId: string; database: Database; databaseId: string; properties: readonly DatabaseProperty[]; records: readonly DatabaseRecord[]; templates?: readonly DatabaseTemplate[]; client?: DatabaseClient; onOpenChange(open: boolean): void; onViewChange(viewId: string): void; onMutation?(): void; onBulkPreview?(mutations: { record_id: string; base_revision: number; values: Record<string, unknown> }[]): Promise<void>;
}) {
  const [panel, setPanel] = useState<Panel>("record");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
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
  const [viewName, setViewName] = useState("");
  const [viewType, setViewType] = useState<DatabaseView["type"]>("table");
  const [subjectId, setSubjectId] = useState("");
  const [role, setRole] = useState<"owner" | "editor" | "viewer">("viewer");
  const [databasePermissions, setDatabasePermissions] = useState<DatabasePermission[]>([]);
  const [fieldPermissions, setFieldPermissions] = useState<FieldPermission[]>([]);
  const [permissionPropertyId, setPermissionPropertyId] = useState(properties[0]?.id ?? "");
  const [csv, setCsv] = useState("");
  const [databaseName, setDatabaseName] = useState(database.name);
  const [databaseDescription, setDatabaseDescription] = useState(database.description);
  const [selectedPropertyId, setSelectedPropertyId] = useState("");
  const [selectedRecordId, setSelectedRecordId] = useState("");
  const [selectedViewId, setSelectedViewId] = useState("");
  const [selectedCommentId, setSelectedCommentId] = useState("");
  const [fieldCanRead, setFieldCanRead] = useState(true);
  const [fieldCanWrite, setFieldCanWrite] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);

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
  useEffect(() => { if (panel === "comment" && client && commentRecordId) void client.listComments(databaseId, commentRecordId).then(setComments).catch(() => setComments([])); }, [client, commentRecordId, databaseId, panel]);
  useEffect(() => {
    if (!open || panel !== "permission" || !client) return;
    void client.listDatabasePermissions(databaseId).then(setDatabasePermissions).catch(() => setDatabasePermissions([]));
  }, [client, databaseId, open, panel]);
  useEffect(() => {
    if (!open || panel !== "permission" || !client || !permissionPropertyId) return;
    void client.listFieldPermissions(databaseId, permissionPropertyId).then(setFieldPermissions).catch(() => setFieldPermissions([]));
  }, [client, databaseId, open, panel, permissionPropertyId]);

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
  const selectedProperty = properties.find((property) => property.id === selectedPropertyId);
  const selectedRecord = records.find((record) => record.id === selectedRecordId);
  const selectedView = views.find((view) => view.id === selectedViewId);
  const selectedTemplate = templates.find((template) => template.id === templateId);
  const selectedComment = comments.find((comment) => comment.id === selectedCommentId);
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

  const trapFocus = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") { changeOpen(false); return; }
    if (event.key !== "Tab") return;
    const nodes = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])'));
    if (!nodes.length) return;
    const first = nodes[0]!; const last = nodes[nodes.length - 1]!;
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };

  return <><button ref={triggerRef} className="database-tools-trigger" type="button" aria-label="数据库工具" aria-expanded={open} onClick={() => changeOpen(!open)}>数据库工具</button>{open ? <aside className="database-tools-drawer" role="dialog" aria-modal="true" aria-label="数据库工具" onKeyDown={trapFocus}><header><strong>数据库工具</strong><button ref={closeRef} type="button" onClick={() => changeOpen(false)}>关闭</button></header>{views.length ? <label>视图<select value={activeViewId} onChange={(event) => onViewChange(event.target.value)}>{views.map((view) => <option key={view.id} value={view.id}>{view.name}</option>)}</select></label> : null}<nav className="database-tools-tabs" aria-label="数据库操作">{panels.map(([id, label]) => <button className={panel === id ? "active" : ""} key={id} type="button" onClick={() => { setPanel(id); setFeedback(null); }}>{label}</button>)}</nav><div className="database-tools-form">
    {panel === "database" ? <section aria-label="数据库表单"><h2>数据库</h2><label>数据库名称<input value={databaseName} onChange={(event) => setDatabaseName(event.target.value)} /></label><label>描述<textarea value={databaseDescription} onChange={(event) => setDatabaseDescription(event.target.value)} /></label><button type="button" disabled={disabled} onClick={() => { if (validate(databaseName.trim(), "请输入数据库名称。")) void run(() => client!.updateDatabase(databaseId, { base_revision: database.revision, name: databaseName.trim(), description: databaseDescription })); }}>保存数据库</button><button type="button" disabled={disabled} onClick={() => void run(() => client!.deleteDatabase(databaseId, { base_revision: database.revision }), "数据库已删除。")}>删除数据库</button></section> : null}
    {panel === "record" ? <><DatabaseRecordForm properties={properties} values={recordValues} disabled={disabled} onChange={(id, value) => setRecordValues((current) => ({ ...current, [id]: value }))} onSubmit={submitRecord} /><label>选择记录<select value={selectedRecordId} onChange={(event) => { const next = records.find((record) => record.id === event.target.value); setSelectedRecordId(event.target.value); setRecordValues(next?.values ?? {}); }}><option value="">请选择</option>{records.map((record) => <option key={record.id} value={record.id}>{record.id}</option>)}</select></label>{selectedRecord ? <div className="database-tools-actions"><button type="button" disabled={disabled} onClick={() => void run(() => client!.updateRecord(databaseId, selectedRecord.id, { base_revision: selectedRecord.revision, values: Object.fromEntries(Object.entries(recordValues).map(([id, value]) => [id, normalizeFieldValue(properties.find((property) => property.id === id)!, value)]).filter(([, value]) => value !== undefined)) }))}>保存记录</button><button type="button" disabled={disabled} onClick={() => void run(() => client!.deleteRecord(databaseId, selectedRecord.id, { base_revision: selectedRecord.revision }), "记录已删除。")}>删除记录</button></div> : null}</> : null}
    {panel === "property" ? <><DatabasePropertyEditor name={propertyName} type={propertyType} options={options} relationDatabaseId={relationDatabaseId} databaseId={databaseId} disabled={disabled} onNameChange={setPropertyName} onTypeChange={setPropertyType} onOptionsChange={setOptions} onRelationDatabaseChange={setRelationDatabaseId} onSubmit={submitProperty} /><label>选择属性<select value={selectedPropertyId} onChange={(event) => { const next = properties.find((property) => property.id === event.target.value); setSelectedPropertyId(event.target.value); if (next) { setPropertyName(next.name); setPropertyType(next.type as PropertyType); setOptions(((next.config as { options?: { name: string }[] }).options ?? []).map((option) => option.name).join(", ")); setRelationDatabaseId((next.config as { target_database_id?: string }).target_database_id ?? ""); } }}><option value="">请选择</option>{properties.map((property) => <option key={property.id} value={property.id}>{property.name}</option>)}</select></label>{selectedProperty ? <div className="database-tools-actions"><button type="button" disabled={disabled} onClick={() => { const config = propertyConfig(selectedProperty.type as PropertyType, options, relationDatabaseId); if (config) void run(() => client!.updateProperty(databaseId, selectedProperty.id, { base_revision: selectedProperty.revision, name: propertyName.trim(), config, position: selectedProperty.position, hidden: selectedProperty.hidden, read_only: selectedProperty.read_only })); }}>保存属性</button><button type="button" disabled={disabled} onClick={() => void run(() => client!.deleteProperty(databaseId, selectedProperty.id, { base_revision: selectedProperty.revision }), "属性已删除。")}>删除属性</button></div> : null}</> : null}
    {panel === "view" ? <><label>选择视图<select value={selectedViewId} onChange={(event) => { const next = views.find((view) => view.id === event.target.value); setSelectedViewId(event.target.value); if (next) { setViewName(next.name); setViewType(next.type); } }}><option value="">新视图</option>{views.map((view) => <option key={view.id} value={view.id}>{view.name}</option>)}</select></label><DatabaseViewForm name={viewName} type={viewType} properties={properties} position={selectedView?.position ?? views.length} editingView={selectedView} disabled={disabled} onNameChange={setViewName} onTypeChange={setViewType} onSubmit={(input) => { if (validate(input.name.trim(), "请输入视图名称。")) void run(() => client!.createView(databaseId, { ...input, name: input.name.trim() })); }} onUpdate={(input) => { if (selectedView && validate(input.name.trim(), "请输入视图名称。")) void run(() => client!.updateView(databaseId, selectedView.id, { base_revision: selectedView.revision, name: input.name.trim(), config: input.config, position: selectedView.position })); }} />{selectedView ? <button type="button" disabled={disabled} onClick={() => void run(() => client!.deleteView(databaseId, selectedView.id, { base_revision: selectedView.revision }), "视图已删除。")}>删除视图</button> : null}</> : null}
    {panel === "template" ? <><DatabaseTemplateForm templates={templates} templateId={templateId} name={templateName} records={records} disabled={disabled} onTemplateChange={setTemplateId} onNameChange={setTemplateName} onCreate={(name) => { if (validate(name.trim(), "请输入模板名称。")) void run(() => client!.createTemplate(databaseId, { name: name.trim(), default_values: recordValues })); }} onApply={(id) => void run(() => client!.applyTemplate(databaseId, { template_id: id, records: records.slice(0, 100).map((record) => ({ record_id: record.id, base_revision: record.revision })) }))} />{selectedTemplate ? <div className="database-tools-actions"><button type="button" disabled={disabled} onClick={() => void run(() => client!.updateTemplate(databaseId, selectedTemplate.id, { base_revision: selectedTemplate.revision, name: templateName.trim() || selectedTemplate.name, default_values: recordValues }))}>保存模板</button><button type="button" disabled={disabled} onClick={() => void run(() => client!.deleteTemplate(databaseId, selectedTemplate.id, { base_revision: selectedTemplate.revision }), "模板已删除。")}>删除模板</button></div> : null}</> : null}
    {panel === "comment" ? <><DatabaseCommentForm records={records} recordId={commentRecordId} comments={comments} body={commentBody} disabled={disabled} onRecordChange={setCommentRecordId} onBodyChange={setCommentBody} onSubmit={() => { if (validate(commentBody.trim(), "请输入评论内容。")) void run(() => client!.createComment(databaseId, commentRecordId, { record_id: commentRecordId, body: commentBody.trim() })); }} /><label>选择评论<select value={selectedCommentId} onChange={(event) => { const next = comments.find((comment) => comment.id === event.target.value); setSelectedCommentId(event.target.value); setCommentBody(next?.body ?? ""); }}><option value="">请选择</option>{comments.map((comment) => <option key={comment.id} value={comment.id}>{comment.id}</option>)}</select></label>{selectedComment ? <div className="database-tools-actions"><button type="button" disabled={disabled} onClick={() => void run(() => client!.updateComment(databaseId, selectedComment.id, { base_revision: (selectedComment as DatabaseComment & { revision: number }).revision, body: commentBody.trim() }))}>保存评论</button><button type="button" disabled={disabled} onClick={() => void run(() => client!.deleteComment(databaseId, selectedComment.id, { base_revision: (selectedComment as DatabaseComment & { revision: number }).revision }), "评论已删除。")}>删除评论</button></div> : null}</> : null}
    {panel === "bulk" ? <DatabaseBulkForm records={records} properties={properties} selectedIds={selectedRecordIds} propertyId={bulkPropertyId} value={bulkValue} disabled={disabled} onSelectionChange={(id, selected) => setSelectedRecordIds((current) => selected ? [...current, id] : current.filter((currentId) => currentId !== id))} onPropertyChange={setBulkPropertyId} onValueChange={setBulkValue} onSubmit={submitBulk} /> : null}
    {panel === "permission" ? <><DatabasePermissionForm subjectId={subjectId} role={role} disabled={disabled} onSubjectChange={setSubjectId} onRoleChange={setRole} onSubmit={() => { if (!validate(subjectId.trim(), "请输入成员或角色 ID。")) return; const current = databasePermissions.find((permission) => permission.subject_type === "user" && permission.subject_id === subjectId.trim()); void run(async () => { await client!.setDatabasePermission(databaseId, { subject_type: "user", subject_id: subjectId.trim(), role, base_revision: current?.revision ?? 1 }); setDatabasePermissions(await client!.listDatabasePermissions(databaseId)); }); }} />
      <ul className="database-entity-list" aria-label="数据库权限列表">{databasePermissions.map((permission) => <li key={permission.id}><span>{permission.subject_id} · {permission.role} · r{permission.revision}</span><button type="button" aria-label={`删除数据库权限 ${permission.subject_id}`} disabled={disabled} onClick={() => void run(async () => { await client!.deleteDatabasePermission(databaseId, permission.id, { base_revision: permission.revision }); setDatabasePermissions((current) => current.filter((item) => item.id !== permission.id)); })}>删除</button></li>)}</ul>
      <label>权限字段<select aria-label="权限字段" value={permissionPropertyId} onChange={(event) => setPermissionPropertyId(event.target.value)}>{properties.map((property) => <option key={property.id} value={property.id}>{property.name}</option>)}</select></label>
      <label>字段可读<input type="checkbox" checked={fieldCanRead} onChange={(event) => { setFieldCanRead(event.target.checked); if (!event.target.checked) setFieldCanWrite(false); }} /></label><label>字段可写<input type="checkbox" checked={fieldCanWrite} disabled={!fieldCanRead} onChange={(event) => setFieldCanWrite(event.target.checked)} /></label><button type="button" disabled={disabled || !permissionPropertyId} onClick={() => { if (!validate(subjectId.trim(), "请输入成员或角色 ID。")) return; const current = fieldPermissions.find((permission) => permission.subject_type === "user" && permission.subject_id === subjectId.trim()); void run(async () => { await client!.setFieldPermission(databaseId, permissionPropertyId, { subject_type: "user", subject_id: subjectId.trim(), can_read: fieldCanRead, can_write: fieldCanWrite, base_revision: current?.revision ?? 1 }); setFieldPermissions(await client!.listFieldPermissions(databaseId, permissionPropertyId)); }); }}>保存字段权限</button><ul className="database-entity-list" aria-label="字段权限列表">{fieldPermissions.map((permission) => <li key={permission.id}><span>{permission.subject_id} · r{permission.revision}</span><button type="button" aria-label={`删除字段权限 ${permission.subject_id}`} disabled={disabled} onClick={() => void run(async () => { await client!.deleteFieldPermission(databaseId, permission.property_id, permission.id, { base_revision: permission.revision }); setFieldPermissions((current) => current.filter((item) => item.id !== permission.id)); })}>删除</button></li>)}</ul></> : null}
    {panel === "csv" ? <DatabaseCsvForm csv={csv} disabled={disabled} onCsvChange={setCsv} onImport={() => { if (validate(csv.trim(), "请输入 CSV 内容。")) void run(() => client!.importCsv(databaseId, { csv, header_property_ids: Object.fromEntries(properties.map((property) => [property.name, property.id])) })); }} onExport={() => void run(async () => downloadCsvBlob(await client!.exportCsvBlob(databaseId, { property_ids: properties.map((property) => property.id), page_size: 100 })), "CSV 已导出。")} /> : null}
  </div>{feedback ? <p className="database-operation-feedback" role="status">{feedback}</p> : null}</aside> : null}</>;
}
