import type { DatabaseProperty } from "@nexus/contracts";

export function DatabaseRecordForm({ properties, values, disabled, onChange, onSubmit }: { properties: readonly DatabaseProperty[]; values: Record<string, unknown>; disabled: boolean; onChange(id: string, value: unknown): void; onSubmit(): void }) {
  return <section aria-label="记录表单"><h2>创建记录</h2><PropertyValueFields properties={properties} values={values} onChange={onChange} /><button type="button" disabled={disabled} onClick={onSubmit}>创建记录</button></section>;
}

export function PropertyValueFields({ properties, values, onChange }: { properties: readonly DatabaseProperty[]; values: Record<string, unknown>; onChange(id: string, value: unknown): void }) {
  return <>{properties.filter((property) => !property.hidden && !property.read_only).map((property) => {
    const value = values[property.id] ?? (property.type === "checkbox" ? false : "");
    const options = (property.config as { options?: { id: string; name: string }[] }).options ?? [];
    if (property.type === "checkbox") return <label key={property.id}>{property.name}<input aria-label={property.name} type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(property.id, event.target.checked)} /></label>;
    if (property.type === "select") return <label key={property.id}>{property.name}<select aria-label={property.name} value={String(value)} onChange={(event) => onChange(property.id, event.target.value)}><option value="">请选择</option>{options.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select></label>;
    if (property.type === "multi_select") return <label key={property.id}>{property.name}<select aria-label={property.name} multiple value={Array.isArray(value) ? value.map(String) : []} onChange={(event) => onChange(property.id, Array.from(event.currentTarget.selectedOptions, (option) => option.value))}>{options.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select></label>;
    const inputType = property.type === "number" ? "number" : property.type === "date" ? "date" : property.type === "email" ? "email" : property.type === "url" ? "url" : "text";
    return <label key={property.id}>{property.name}<input aria-label={property.name} type={inputType} value={String(value)} onChange={(event) => onChange(property.id, event.target.value)} /></label>;
  })}</>;
}
