export type DatabaseAccessRole = "owner" | "editor" | "viewer";
export type DatabaseAction = "read" | "write" | "manage";

export function canUseDatabase(role: DatabaseAccessRole, action: DatabaseAction) {
  if (role === "owner") return true;
  if (role === "editor") return action !== "manage";
  return action === "read";
}

export function resolveFieldAccess(
  databaseRole: DatabaseAccessRole,
  permission?: { can_read: boolean; can_write: boolean },
) {
  const defaults = databaseRole === "editor"
    ? { canRead: true, canWrite: true }
    : databaseRole === "owner" ? { canRead: true, canWrite: true } : { canRead: true, canWrite: false };
  if (!permission) return defaults;
  return {
    canRead: permission.can_read,
    canWrite: permission.can_read && permission.can_write && databaseRole !== "viewer",
  };
}

interface FilterableProperty {
  id: string;
  hidden: boolean;
}

interface FilterableRecord {
  values: Record<string, unknown>;
}

interface FilterableTemplate {
  default_values: Record<string, unknown>;
}

function pickValues(values: Record<string, unknown>, readable: ReadonlySet<string>) {
  return Object.fromEntries(Object.entries(values).filter(([propertyId]) => readable.has(propertyId)));
}

export function filterDatabaseFields<
  TProperty extends FilterableProperty,
  TRecord extends FilterableRecord,
  TTemplate extends FilterableTemplate,
>(input: {
  properties: readonly TProperty[];
  readablePropertyIds: ReadonlySet<string>;
  records: readonly TRecord[];
  templates: readonly TTemplate[];
}) {
  const readable = new Set(
    input.properties
      .filter((property) => !property.hidden && input.readablePropertyIds.has(property.id))
      .map((property) => property.id),
  );
  return {
    properties: input.properties.filter((property) => readable.has(property.id)),
    records: input.records.map((record) => ({ ...record, values: pickValues(record.values, readable) })),
    templates: input.templates.map((template) => ({
      ...template,
      default_values: pickValues(template.default_values, readable),
    })),
  };
}
