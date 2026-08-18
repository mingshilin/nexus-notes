import type { AllExportFormat, NoteExportFormat } from "@/api/export";

export const NOTE_EXPORT_FORMATS: NoteExportFormat[] = ["md", "txt", "html", "csv", "pdf", "docx"];
export const ALL_EXPORT_FORMATS: AllExportFormat[] = ["zip", "json", "csv", "pdf", "docx", "html", "txt"];

export function getExportFormatLabel(format: NoteExportFormat | AllExportFormat) {
  return format.toUpperCase();
}
