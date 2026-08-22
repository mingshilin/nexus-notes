import type { DatabaseProperty, DatabaseRecord } from "@nexus/contracts";
import { PropertyValueInput } from "./DatabaseRecordForm";

export function DatabaseBulkForm({ records, properties, selectedIds, propertyId, value, disabled, onSelectionChange, onPropertyChange, onValueChange, onSubmit }: { records: readonly DatabaseRecord[]; properties: readonly DatabaseProperty[]; selectedIds: readonly string[]; propertyId: string; value: unknown; disabled: boolean; onSelectionChange(id: string, selected: boolean): void; onPropertyChange(value: string): void; onValueChange(value: unknown): void; onSubmit(): void }) {
  const property = properties.find((candidate) => candidate.id === propertyId);
  return <section aria-label="批量编辑表单"><h2>批量编辑</h2><fieldset><legend>选择记录</legend>{records.map((record) => <label key={record.id}><input type="checkbox" checked={selectedIds.includes(record.id)} onChange={(event) => onSelectionChange(record.id, event.target.checked)} />{record.id}</label>)}</fieldset><label>字段<select aria-label="字段" value={propertyId} onChange={(event) => onPropertyChange(event.target.value)}>{properties.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>{property ? <label>新值<PropertyValueInput property={property} value={value} ariaLabel="新值" onChange={onValueChange} /></label> : null}<button type="button" disabled={disabled} onClick={onSubmit}>预览并应用</button></section>;
}

export function DatabaseCsvForm({ csv, disabled, onCsvChange, onImport, onExport }: { csv: string; disabled: boolean; onCsvChange(value: string): void; onImport(): void; onExport(): void }) {
  return <section aria-label="CSV 表单"><h2>CSV 导入与导出</h2><label>CSV 内容<textarea value={csv} onChange={(event) => onCsvChange(event.target.value)} /></label><button type="button" disabled={disabled} onClick={onImport}>导入 CSV</button><button type="button" disabled={disabled} onClick={onExport}>导出全部 CSV</button></section>;
}
