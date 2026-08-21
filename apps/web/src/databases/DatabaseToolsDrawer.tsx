import type { DatabaseView } from "@nexus/contracts";
import { useState } from "react";

import type { DatabaseClient } from "../data/database-client";

const actions = ["create-database", "update-database", "delete-database", "create-property", "update-property", "delete-property", "create-record", "update-record", "delete-record", "bulk-edit", "create-view", "update-view", "delete-view", "create-template", "update-template", "delete-template", "apply-template", "create-comment", "update-comment", "delete-comment", "set-database-permission", "set-field-permission", "import-csv", "export-csv"] as const;
type Action = typeof actions[number];

export function DatabaseToolsDrawer({ open, views, activeViewId, databaseId, client, onOpenChange, onViewChange, onMutation }: {
  open: boolean;
  views: readonly DatabaseView[];
  activeViewId: string;
  databaseId: string;
  client?: DatabaseClient;
  onOpenChange(open: boolean): void;
  onViewChange(viewId: string): void;
  onMutation?(): void;
}) {
  const [action, setAction] = useState<Action>("create-record");
  const [payload, setPayload] = useState('{"values": {}}');
  const [feedback, setFeedback] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const execute = async () => {
    if (!client || pending) return;
    let value: Record<string, any>;
    try { value = JSON.parse(payload) as Record<string, any>; } catch { setFeedback("操作数据必须是有效 JSON。"); return; }
    setPending(true); setFeedback(null);
    try {
      let result: unknown;
      switch (action) {
        case "create-database": result = await client.createDatabase(value as any); break;
        case "update-database": result = await client.updateDatabase(databaseId, value as any); break;
        case "delete-database": result = await client.deleteDatabase(databaseId, value as any); break;
        case "create-property": result = await client.createProperty(databaseId, value as any); break;
        case "update-property": result = await client.updateProperty(databaseId, value.id, withoutId(value) as any); break;
        case "delete-property": result = await client.deleteProperty(databaseId, value.id, withoutId(value) as any); break;
        case "create-record": result = await client.createRecord(databaseId, value as any); break;
        case "update-record": result = await client.updateRecord(databaseId, value.id, withoutId(value) as any); break;
        case "delete-record": result = await client.deleteRecord(databaseId, value.id, withoutId(value) as any); break;
        case "bulk-edit": result = await client.bulkEdit(databaseId, value as any); break;
        case "create-view": result = await client.createView(databaseId, value as any); break;
        case "update-view": result = await client.updateView(databaseId, value.id, withoutId(value) as any); break;
        case "delete-view": result = await client.deleteView(databaseId, value.id, withoutId(value) as any); break;
        case "create-template": result = await client.createTemplate(databaseId, value as any); break;
        case "update-template": result = await client.updateTemplate(databaseId, value.id, withoutId(value) as any); break;
        case "delete-template": result = await client.deleteTemplate(databaseId, value.id, withoutId(value) as any); break;
        case "apply-template": result = await client.applyTemplate(databaseId, value as any); break;
        case "create-comment": result = await client.createComment(databaseId, value.record_id, value as any); break;
        case "update-comment": result = await client.updateComment(databaseId, value.id, withoutId(value) as any); break;
        case "delete-comment": result = await client.deleteComment(databaseId, value.id, withoutId(value) as any); break;
        case "set-database-permission": result = await client.setDatabasePermission(databaseId, value as any); break;
        case "set-field-permission": result = await client.setFieldPermission(databaseId, value.property_id, withoutId(value, "property_id") as any); break;
        case "import-csv": result = await client.importCsv(databaseId, value as any); break;
        case "export-csv": result = await client.exportCsv(databaseId, value as any); break;
      }
      if (action === "export-csv" && typeof (result as { csv?: unknown }).csv === "string") downloadCsv((result as { csv: string }).csv);
      setFeedback(action === "export-csv" ? "CSV 已导出。" : "操作已完成。");
      onMutation?.();
    } catch { setFeedback("操作失败，未保存本地更改。"); } finally { setPending(false); }
  };

  return <>
    <button className="database-tools-trigger" type="button" aria-label="数据库工具" aria-expanded={open} onClick={() => onOpenChange(!open)}>数据库工具</button>
    {open ? <aside className="database-tools-drawer" role="dialog" aria-modal="false" aria-label="数据库工具">
      <header><strong>数据库工具</strong><button type="button" onClick={() => onOpenChange(false)}>关闭</button></header>
      <label>视图<select value={activeViewId} onChange={(event) => onViewChange(event.target.value)}>{views.map((view) => <option key={view.id} value={view.id}>{view.name}</option>)}</select></label>
      <details open><summary>数据操作</summary>
        <label>数据库操作<select aria-label="数据库操作" value={action} onChange={(event) => setAction(event.target.value as Action)}>{actions.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
        <label>操作数据 JSON<textarea aria-label="操作数据 JSON" value={payload} onChange={(event) => setPayload(event.target.value)} spellCheck={false} /></label>
        <button type="button" disabled={!client || pending} onClick={() => void execute()}>执行操作</button>
      </details>
      {feedback ? <p className="database-operation-feedback" role="status">{feedback}</p> : null}
    </aside> : null}
  </>;
}

function withoutId(value: Record<string, any>, id = "id") { const { [id]: _id, ...input } = value; return input; }

function downloadCsv(csv: string) {
  if (typeof document === "undefined" || typeof URL.createObjectURL !== "function") return;
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = "database-export.csv"; anchor.click(); URL.revokeObjectURL(url);
}
