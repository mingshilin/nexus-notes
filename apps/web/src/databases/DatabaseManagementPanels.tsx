import type {
  CsvPreview,
  DatabasePermission,
  DatabaseProperty,
  DatabaseStats,
  FieldPermission,
} from "@nexus/contracts";
import { useState } from "react";
import type { CollaborationMember } from "../data/collaboration-client";

const roleLabel = {
  owner: "所有者",
  editor: "编辑者",
  viewer: "只读成员",
} as const;

export function DatabaseOverviewPanel({
  stats,
  loading,
  error,
  onRetry,
}: {
  stats: DatabaseStats | null;
  loading: boolean;
  error: string | null;
  onRetry?(): void;
}) {
  if (loading) return <p className="database-management-state" role="status">正在加载数据库概览…</p>;
  if (error) return <div className="database-management-error"><p className="database-operation-error" role="alert">{error}</p>{onRetry ? <button type="button" onClick={onRetry}>重试数据库概览</button> : null}</div>;
  if (!stats) return <p className="database-management-state">暂无统计信息。</p>;
  const metrics = [
    ["记录", stats.record_count],
    ["属性", stats.property_count],
    ["视图", stats.view_count],
    ["模板", stats.template_count],
    ["评论", stats.comment_count],
  ] as const;
  return (
    <section className="database-management-overview" aria-label="数据库概览">
      <div className="database-management-role">
        <span>当前权限</span>
        <strong>{roleLabel[stats.role]}</strong>
      </div>
      <div className="database-stat-grid">
        {metrics.map(([label, value]) => <article key={label}><strong>{value}</strong><span>{label}</span></article>)}
      </div>
      <dl className="database-management-summary">
        <div><dt>最近更新</dt><dd>{new Date(stats.updated_at).toLocaleString()}</dd></div>
        {stats.database_permission_count !== null
          ? <div><dt>权限覆盖</dt><dd>{stats.database_permission_count} 个数据库规则 · {stats.field_permission_count ?? 0} 个字段规则</dd></div>
          : null}
      </dl>
    </section>
  );
}

function explicitRole(member: CollaborationMember, permissions: readonly DatabasePermission[]) {
  return permissions.find((permission) => permission.subject_type === "user" && permission.subject_id === member.user_id)?.role
    ?? permissions.find((permission) => permission.subject_type === "role" && permission.subject_id === member.role)?.role
    ?? member.role;
}

export function DatabasePermissionMatrix({
  members,
  properties,
  databasePermissions,
  fieldPermissions,
}: {
  members: readonly CollaborationMember[];
  properties: readonly DatabaseProperty[];
  databasePermissions: readonly DatabasePermission[];
  fieldPermissions: readonly FieldPermission[];
}) {
  if (!members.length) return <p className="database-management-state">连接工作区成员后可查看最终生效权限。</p>;
  return (
    <div className="database-permission-matrix-wrap">
      <ul className="database-member-access-list" aria-label="成员有效权限">
        {members.map((member) => <li key={member.user_id}>
          <span><strong>{member.display_name}</strong><small>{member.email}</small></span>
          <span>继承 {member.role}</span>
          <span>最终 {explicitRole(member, databasePermissions)}</span>
        </li>)}
      </ul>
      <table className="database-permission-matrix" aria-label="字段权限矩阵">
        <thead><tr><th>成员</th>{properties.map((property) => <th key={property.id}>{property.name}</th>)}</tr></thead>
        <tbody>{members.map((member) => {
          const role = explicitRole(member, databasePermissions);
          return <tr key={member.user_id}><th>{member.display_name}</th>{properties.map((property) => {
            const permission = fieldPermissions.find((candidate) =>
              candidate.property_id === property.id
              && ((candidate.subject_type === "user" && candidate.subject_id === member.user_id)
                || (candidate.subject_type === "role" && candidate.subject_id === member.role)),
            );
            const canRead = permission?.can_read ?? true;
            const canWrite = permission?.can_write ?? role !== "viewer";
            return <td key={property.id}>{canRead ? (canWrite ? "读写" : "只读") : "隐藏"}</td>;
          })}</tr>;
        })}</tbody>
      </table>
    </div>
  );
}

export function parseCsvHeaders(csv: string) {
  const line = csv.replace(/^\uFEFF/u, "").split(/\r?\n/u, 1)[0] ?? "";
  const headers: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]!;
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      headers.push(value.trim());
      value = "";
    } else {
      value += character;
    }
  }
  if (value || line.endsWith(",")) headers.push(value.trim());
  return headers.filter(Boolean);
}

export function DatabaseCsvManager({
  csv,
  properties,
  mappings,
  preview,
  previewError,
  disabled,
  onCsvChange,
  onMappingChange,
  onPreview,
  onRetry,
  onImport,
  onExport,
}: {
  csv: string;
  properties: readonly DatabaseProperty[];
  mappings: Readonly<Record<string, string>>;
  preview: CsvPreview | null;
  previewError?: string | null;
  disabled: boolean;
  onCsvChange(value: string): void;
  onMappingChange(header: string, propertyId: string): void;
  onPreview(): void;
  onRetry?(): void;
  onImport(): void;
  onExport(): void;
}) {
  const headers = parseCsvHeaders(csv);
  const mappingComplete = headers.length > 0 && headers.every((header) => mappings[header]);
  const [fileError, setFileError] = useState<string | null>(null);
  const handleCsvChange = (value: string) => {
    setFileError(null);
    onCsvChange(value);
  };
  const readFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      handleCsvChange(await file.text());
    } catch {
      setFileError("CSV 文件读取失败，请重新选择文件或直接粘贴内容。");
    }
  };
  return (
    <section className="database-csv-manager" aria-label="CSV 表单">
      <h2>导入与导出</h2>
      <label>选择 CSV 文件<input aria-label="选择 CSV 文件" type="file" accept=".csv,text/csv" onChange={(event) => void readFile(event.target.files?.[0])} /></label>
      {fileError ? <p className="database-operation-error" role="alert">{fileError}</p> : null}
      <label>CSV 内容<textarea value={csv} onChange={(event) => handleCsvChange(event.target.value)} /></label>
      {headers.length ? <fieldset className="database-csv-mapping"><legend>字段映射</legend>{headers.map((header) =>
        <label key={header}>{header}<select aria-label={`字段映射 ${header}`} value={mappings[header] ?? ""} onChange={(event) => onMappingChange(header, event.target.value)}>
          <option value="">忽略</option>
          {properties.map((property) => <option key={property.id} value={property.id}>{property.name}</option>)}
        </select></label>,
      )}</fieldset> : null}
      <div className="database-tools-actions">
        <button type="button" disabled={disabled || !mappingComplete} onClick={onPreview}>预览 CSV</button>
        <button type="button" disabled={disabled || !preview || preview.errors.length > 0} onClick={onImport}>确认导入</button>
        <button type="button" disabled={disabled || properties.length === 0} onClick={onExport}>导出当前视图 CSV</button>
      </div>
      {previewError ? <div className="database-csv-preview-error" role="alert">
        <p>{previewError}</p>
        {onRetry ? <button type="button" disabled={disabled} onClick={onRetry}>重试 CSV 预览</button> : null}
      </div> : null}
      {preview ? <section className="database-csv-preview" aria-label="CSV 预览">
        <p>共 {preview.total_rows} 行，预览 {preview.rows.length} 行。</p>
        {preview.errors.length ? <ul className="database-csv-errors">{preview.errors.map((error) =>
          <li key={`${error.row_number}:${error.code}`}>第 {error.row_number} 行 · {error.code} · {error.message}</li>,
        )}</ul> : null}
        {preview.rows.length ? <div className="database-table-scroll"><table><thead><tr><th>行</th>{headers.map((header) => <th key={header}>{header}</th>)}</tr></thead>
          <tbody>{preview.rows.map((row) => <tr key={row.row_number}><th>{row.row_number}</th>{headers.map((header) =>
            <td key={header}>{String(row.values[mappings[header]!] ?? "")}</td>,
          )}</tr>)}</tbody></table></div> : null}
      </section> : null}
    </section>
  );
}
