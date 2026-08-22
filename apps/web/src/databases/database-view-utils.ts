import type { DatabaseProperty, DatabaseRecord, DatabaseView } from "@nexus/contracts";

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

function isEmpty(value: unknown) {
  return value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0);
}

function compare(value: unknown, expected: unknown) {
  if (Array.isArray(expected)) {
    if (expected.length === 0) return isEmpty(value);
    return Array.isArray(value)
      && value.length === expected.length
      && value.every((item, index) => String(item) === String(expected[index]));
  }
  if (Array.isArray(value)) return value.some((item) => String(item) === String(expected));
  return String(value) === String(expected);
}

function contains(value: unknown, expected: unknown) {
  if (Array.isArray(value)) {
    const member = Array.isArray(expected) ? expected[0] : expected;
    return value.some((item) => String(item) === String(member));
  }
  return String(value ?? "").toLowerCase().includes(String(expected ?? "").toLowerCase());
}

function matches(record: DatabaseRecord, view: DatabaseView) {
  return view.config.filters.every((filter) => {
    const value = record.values[filter.property_id];
    const needle = filter.value;
    switch (filter.operator) {
      case "equals": return compare(value, needle);
      case "not_equals": return !compare(value, needle);
      case "contains": return contains(value, needle);
      case "not_contains": return !contains(value, needle);
      case "is_empty": return isEmpty(value);
      case "is_not_empty": return !isEmpty(value);
      case "before": return typeof value === "string" && typeof needle === "string" && value < needle;
      case "after": return typeof value === "string" && typeof needle === "string" && value > needle;
    }
  });
}

export function executeView(records: readonly DatabaseRecord[], view: DatabaseView) {
  return [...records.filter((record) => matches(record, view))].sort((left, right) => {
    for (const sort of view.config.sorts) {
      const a = left.values[sort.property_id];
      const b = right.values[sort.property_id];
      const result = typeof a === "number" && typeof b === "number"
        ? a - b
        : String(a ?? "").localeCompare(String(b ?? ""));
      if (result !== 0) return sort.direction === "asc" ? result : -result;
    }
    return left.id.localeCompare(right.id);
  });
}

export function visibleProperties(properties: readonly DatabaseProperty[], view: DatabaseView) {
  const allowed = new Set(view.config.visible_columns);
  return properties.filter((property) => !property.hidden && allowed.has(property.id));
}
