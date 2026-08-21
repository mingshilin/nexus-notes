export class DatabaseCsvError extends Error {
  constructor(
    readonly code: "CSV_FILE_LIMIT" | "CSV_ROW_LIMIT" | "CSV_DUPLICATE_HEADER" | "CSV_MALFORMED" | "CSV_COLUMN_COUNT",
    message: string,
  ) {
    super(message);
    this.name = "DatabaseCsvError";
  }
}

export interface DatabaseCsvLimits {
  maxBytes?: number;
  maxRows?: number;
}

function pushRow(rows: string[][], row: string[], field: string) {
  row.push(field);
  rows.push(row);
}

export function parseDatabaseCsv(source: string, limits: DatabaseCsvLimits = {}) {
  const maxBytes = limits.maxBytes ?? 2 * 1024 * 1024;
  const maxRows = limits.maxRows ?? 1_000;
  if (new TextEncoder().encode(source).byteLength > maxBytes) {
    throw new DatabaseCsvError("CSV_FILE_LIMIT", "CSV file exceeds the allowed size");
  }
  const input = source.startsWith("\uFEFF") ? source.slice(1) : source;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let quoteClosed = false;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index]!;
    if (quoted) {
      if (character === '"') {
        if (input[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
          quoteClosed = true;
        }
      } else if (character === "\r" && input[index + 1] === "\n") {
        field += "\n";
        index += 1;
      } else {
        field += character;
      }
      continue;
    }

    if (quoteClosed && character !== "," && character !== "\r" && character !== "\n") {
      throw new DatabaseCsvError("CSV_MALFORMED", "Unexpected content after a quoted field");
    }
    if (character === '"') {
      if (field.length > 0 || quoteClosed) throw new DatabaseCsvError("CSV_MALFORMED", "Unexpected quote in an unquoted field");
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
      quoteClosed = false;
    } else if (character === "\r" || character === "\n") {
      pushRow(rows, row, field);
      row = [];
      field = "";
      quoteClosed = false;
      if (character === "\r" && input[index + 1] === "\n") index += 1;
    } else {
      field += character;
    }
  }

  if (quoted) throw new DatabaseCsvError("CSV_MALFORMED", "Quoted CSV field is not closed");
  if (field.length > 0 || row.length > 0 || quoteClosed) pushRow(rows, row, field);
  if (rows.length === 0 || rows[0]!.every((header) => !header)) {
    throw new DatabaseCsvError("CSV_MALFORMED", "CSV header is required");
  }

  const headers = rows[0]!;
  const canonicalHeaders = headers.map((header) => header.trim().toLocaleLowerCase());
  if (canonicalHeaders.some((header, index) => !header || canonicalHeaders.indexOf(header) !== index)) {
    throw new DatabaseCsvError("CSV_DUPLICATE_HEADER", "CSV headers must be non-empty and unique");
  }
  const dataRows = rows.slice(1);
  if (dataRows.length > maxRows) throw new DatabaseCsvError("CSV_ROW_LIMIT", "CSV row limit exceeded");
  if (dataRows.some((dataRow) => dataRow.length !== headers.length)) {
    throw new DatabaseCsvError("CSV_COLUMN_COUNT", "CSV rows must match the header column count");
  }
  return { headers, rows: dataRows };
}

export function escapeSpreadsheetFormula(value: string) {
  return /^\s*[=+\-@]/u.test(value) ? `'${value}` : value;
}

function serializeCell(value: string) {
  const escaped = escapeSpreadsheetFormula(value);
  return /[",\r\n]/u.test(escaped) ? `"${escaped.replaceAll('"', '""')}"` : escaped;
}

export function serializeDatabaseCsv(rows: readonly (readonly string[])[]) {
  return rows.map((row) => row.map(serializeCell).join(",")).join("\r\n");
}
