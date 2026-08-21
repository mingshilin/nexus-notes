import type { DatabaseProperty, DatabaseRecord } from "@nexus/contracts";

export function DatabaseBulkForm({ records, properties, selectedIds, propertyId, value, disabled, onSelectionChange, onPropertyChange, onValueChange, onSubmit }: { records: readonly DatabaseRecord[]; properties: readonly DatabaseProperty[]; selectedIds: readonly string[]; propertyId: string; value: string; disabled: boolean; onSelectionChange(id: string, selected: boolean): void; onPropertyChange(value: string): void; onValueChange(value: string): void; onSubmit(): void }) {
  return <section aria-label="批量编辑表单"><h2>批量编辑</h2><fieldset><legend>选择记录</legend>{records.map((record) => <label key={record.id}><input type="checkbox" checked={selectedIds.includes(record.id)} onChange={(event) => onSelectionChange(record.id, event.target.checked)} />{record.id}</label>)}</fieldset><label>字段<select value={propertyId} onChange={(event) => onPropertyChange(event.target.value)}>{properties.map((property) => <option key={property.id} value={property.id}>{property.name}</option>)}</select></label><label>新值<input value={value} onChange={(event) => onValueChange(event.target.value)} /></label><button type="button" disabled={disabled} onClick={onSubmit}>预览并应用</button></section>;
}

export function DatabaseCsvForm({ csv, disabled, onCsvChange, onImport, onExport }: { csv: string; disabled: boolean; onCsvChange(value: string): void; onImport(): void; onExport(): void }) {
  return <section aria-label="CSV 表单"><h2>CSV 导入与导出</h2><label>CSV 内容<textarea value={csv} onChange={(event) => onCsvChange(event.target.value)} /></label><button type="button" disabled={disabled} onClick={onImport}>导入 CSV</button><button type="button" disabled={disabled} onClick={onExport}>导出全部 CSV</button></section>;
}
