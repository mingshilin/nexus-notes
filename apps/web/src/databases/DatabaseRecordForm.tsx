import type { DatabaseProperty } from "@nexus/contracts";

export function DatabaseRecordForm({ properties, values, disabled, onChange, onSubmit }: { properties: readonly DatabaseProperty[]; values: Record<string, unknown>; disabled: boolean; onChange(id: string, value: unknown): void; onSubmit(): void }) {
  return <section aria-label="记录表单"><h2>创建记录</h2><PropertyValueFields properties={properties} values={values} onChange={onChange} /><button type="button" disabled={disabled} onClick={onSubmit}>创建记录</button></section>;
}

export function PropertyValueFields({ properties, values, onChange }: { properties: readonly DatabaseProperty[]; values: Record<string, unknown>; onChange(id: string, value: unknown): void }) {
  return <>{properties.filter((property) => !property.hidden && !property.read_only).map((property) => {
    return <label key={property.id}>{property.name}<PropertyValueInput property={property} value={values[property.id]} ariaLabel={property.name} onChange={(value) => onChange(property.id, value)} /></label>;
  })}</>;
}

export function emptyPropertyValue(property: DatabaseProperty) {
  if (property.type === "checkbox") return false;
  if (property.type === "multi_select" || ((property.type === "member" || property.type === "relation") && (property.config as { allow_multiple?: boolean }).allow_multiple === true)) return [];
  return "";
}

export function PropertyValueInput({ property, value = emptyPropertyValue(property), ariaLabel, onChange }: {
  property: DatabaseProperty;
  value?: unknown;
  ariaLabel: string;
  onChange(value: unknown): void;
}) {
  const options = (property.config as { options?: { id: string; name: string }[] }).options ?? [];
  if (property.type === "checkbox") {
    return <input aria-label={ariaLabel} type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} />;
  }
  if (property.type === "select") {
    return <select aria-label={ariaLabel} value={String(value ?? "")} onChange={(event) => onChange(event.target.value)}><option value="">请选择</option>{options.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select>;
  }
  if (property.type === "multi_select") {
    return <select aria-label={ariaLabel} multiple value={Array.isArray(value) ? value.map(String) : []} onChange={(event) => onChange(Array.from(event.currentTarget.selectedOptions, (option) => option.value))}>{options.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select>;
  }
  const multipleReference = (property.type === "member" || property.type === "relation") && (property.config as { allow_multiple?: boolean }).allow_multiple === true;
  const display = multipleReference && Array.isArray(value) ? value.join(", ") : String(value ?? "");
  const inputType = property.type === "number" ? "number" : property.type === "date" ? "date" : property.type === "email" ? "email" : property.type === "url" ? "url" : "text";
  return <input aria-label={ariaLabel} type={inputType} value={display} onChange={(event) => {
    if (property.type === "number") onChange(event.target.value === "" ? "" : Number(event.target.value));
    else if (multipleReference) onChange(event.target.value.split(",").map((item) => item.trim()).filter(Boolean));
    else onChange(event.target.value);
  }} />;
}
