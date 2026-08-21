import type { DatabaseProperty, DatabaseRecord } from "@nexus/contracts";

export function recordTitle(record: DatabaseRecord, properties: readonly DatabaseProperty[]) {
  const property = properties.find((candidate) => candidate.type === "text" && !candidate.hidden);
  const value = property ? record.values[property.id] : undefined;
  return typeof value === "string" && value.trim() ? value : `Record ${record.id}`;
}

export function displayValue(value: unknown) {
  if (value === null || value === undefined) return "—";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "boolean") return value ? "✓" : "";
  return String(value);
}

export function replaceRecord(records: readonly DatabaseRecord[], updated: DatabaseRecord) {
  return records.map((record) => record.id === updated.id ? updated : record);
}
