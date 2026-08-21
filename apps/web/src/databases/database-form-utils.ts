import type { DatabaseProperty } from "@nexus/contracts";

export const propertyTypes = ["text", "number", "checkbox", "select", "multi_select", "date", "url", "email", "member", "relation"] as const;
export type PropertyType = typeof propertyTypes[number];

export function propertyConfig(type: PropertyType, rawOptions: string, relationDatabaseId: string) {
  if (type === "select" || type === "multi_select") {
    const options = rawOptions.split(",").map((name) => name.trim()).filter(Boolean).map((name) => ({ id: name.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/(^-|-$)/gu, ""), name, color: "" }));
    return options.length ? { options } : null;
  }
  if (type === "relation") return relationDatabaseId ? { target_database_id: relationDatabaseId } : null;
  return {};
}

export function normalizeFieldValue(property: DatabaseProperty, value: unknown) {
  if (value === "") return undefined;
  if (property.type === "number") return Number(value);
  if (property.type === "member" || property.type === "relation") return String(value).split(",").map((item) => item.trim()).filter(Boolean);
  return value;
}

export function downloadCsv(csv: string) {
  downloadCsvBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }));
}

export function downloadCsvBlob(blob: Blob) {
  if (typeof document === "undefined" || typeof URL.createObjectURL !== "function") return;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = "database-export.csv"; anchor.click(); URL.revokeObjectURL(url);
}
