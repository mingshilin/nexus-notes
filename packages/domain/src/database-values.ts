export type DatabaseValuePropertyType =
  | "text"
  | "number"
  | "checkbox"
  | "select"
  | "multi_select"
  | "date"
  | "url"
  | "email"
  | "member"
  | "relation";

export interface DatabaseValueProperty {
  id: string;
  type: DatabaseValuePropertyType;
  config: Record<string, unknown>;
  hidden: boolean;
  read_only: boolean;
}

export interface DatabaseValueOptions {
  writablePropertyIds?: ReadonlySet<string>;
}

export class DatabaseValueError extends Error {
  constructor(
    readonly code: "UNKNOWN_FIELD" | "HIDDEN_FIELD" | "READ_ONLY_FIELD" | "FIELD_WRITE_DENIED" | "INVALID_FIELD_VALUE",
    readonly propertyId: string,
    message: string,
  ) {
    super(message);
    this.name = "DatabaseValueError";
  }
}

const MAX_REFERENCE_ID_LENGTH = 128;
const MAX_REFERENCE_ARRAY_LENGTH = 100;

function invalid(property: DatabaseValueProperty): never {
  throw new DatabaseValueError("INVALID_FIELD_VALUE", property.id, `Invalid value for ${property.id}`);
}

function stringIds(value: unknown, property: DatabaseValueProperty) {
  if (!Array.isArray(value) || value.length > MAX_REFERENCE_ARRAY_LENGTH
    || value.some((item) => typeof item !== "string" || !item.trim() || item.trim().length > MAX_REFERENCE_ID_LENGTH)) invalid(property);
  return [...new Set((value as string[]).map((item) => item.trim()))];
}

function selectedOptions(property: DatabaseValueProperty) {
  const options = property.config.options;
  if (!Array.isArray(options)) return new Set<string>();
  return new Set(options.flatMap((option) => {
    if (!option || typeof option !== "object" || !("id" in option) || typeof option.id !== "string") return [];
    return [option.id];
  }));
}

function isCalendarDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function normalizeSingleOrMultiple(value: unknown, property: DatabaseValueProperty) {
  const multiple = property.config.allow_multiple === true;
  if (multiple) return stringIds(value, property);
  if (typeof value !== "string" || !value.trim() || value.trim().length > MAX_REFERENCE_ID_LENGTH) invalid(property);
  return value.trim();
}

function normalizeValue(property: DatabaseValueProperty, value: unknown): unknown {
  if (value === null) return null;
  switch (property.type) {
    case "text": {
      if (typeof value !== "string") return invalid(property);
      const normalized = value.trim();
      const maxLength = typeof property.config.max_length === "number" ? property.config.max_length : 200_000;
      if (normalized.length > maxLength) return invalid(property);
      return normalized;
    }
    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value)) return invalid(property);
      const precision = typeof property.config.precision === "number" ? property.config.precision : undefined;
      return precision === undefined ? value : Number(value.toFixed(precision));
    }
    case "checkbox":
      if (typeof value !== "boolean") return invalid(property);
      return value;
    case "select": {
      if (typeof value !== "string" || !selectedOptions(property).has(value)) return invalid(property);
      return value;
    }
    case "multi_select": {
      const values = stringIds(value, property);
      const options = selectedOptions(property);
      if (values.some((item) => !options.has(item))) return invalid(property);
      return values;
    }
    case "date":
      if (typeof value !== "string" || !isCalendarDate(value)) return invalid(property);
      return value;
    case "url": {
      if (typeof value !== "string") return invalid(property);
      try {
        const url = new URL(value.trim());
        if (url.protocol !== "http:" && url.protocol !== "https:") return invalid(property);
        return url.toString();
      } catch {
        return invalid(property);
      }
    }
    case "email": {
      if (typeof value !== "string") return invalid(property);
      const email = value.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email) || email.length > 254) return invalid(property);
      return email;
    }
    case "member":
    case "relation":
      return normalizeSingleOrMultiple(value, property);
  }
}

export function normalizeDatabaseValues(
  properties: readonly DatabaseValueProperty[],
  values: Readonly<Record<string, unknown>>,
  options: DatabaseValueOptions = {},
) {
  const byId = new Map(properties.map((property) => [property.id, property]));
  const normalized: Record<string, unknown> = {};
  for (const [propertyId, value] of Object.entries(values)) {
    const property = byId.get(propertyId);
    if (!property) throw new DatabaseValueError("UNKNOWN_FIELD", propertyId, `Unknown field ${propertyId}`);
    if (property.hidden) throw new DatabaseValueError("HIDDEN_FIELD", propertyId, `Hidden field ${propertyId}`);
    if (property.read_only) throw new DatabaseValueError("READ_ONLY_FIELD", propertyId, `Read-only field ${propertyId}`);
    if (options.writablePropertyIds && !options.writablePropertyIds.has(propertyId)) {
      throw new DatabaseValueError("FIELD_WRITE_DENIED", propertyId, `Field write denied for ${propertyId}`);
    }
    normalized[propertyId] = normalizeValue(property, value);
  }
  return normalized;
}
