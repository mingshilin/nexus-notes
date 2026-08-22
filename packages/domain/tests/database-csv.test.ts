import { describe, expect, it } from "vitest";

async function loadDomain() {
  return await import("../src/index") as Record<string, unknown>;
}

describe("database CSV boundaries", () => {
  it("parses BOM, quoted delimiters, embedded newlines and quotes across CRLF/LF", async () => {
    const { parseDatabaseCsv } = await loadDomain() as { parseDatabaseCsv: Function };
    expect(parseDatabaseCsv).toBeTypeOf("function");
    const parsed = parseDatabaseCsv('\uFEFFName,Note,Empty\r\n"Alpha, Inc.","line 1\nline ""2""",\r\nBeta,plain,');

    expect(parsed).toEqual({
      headers: ["Name", "Note", "Empty"],
      rows: [
        ["Alpha, Inc.", 'line 1\nline "2"', ""],
        ["Beta", "plain", ""],
      ],
    });
  });

  it("rejects duplicate headers, malformed quotes, and bounded file or row overflow", async () => {
    const { parseDatabaseCsv } = await loadDomain() as { parseDatabaseCsv: Function };

    expect(() => parseDatabaseCsv("Name,Name\nA,B")).toThrow(expect.objectContaining({ code: "CSV_DUPLICATE_HEADER" }));
    expect(() => parseDatabaseCsv('Name\n"open')).toThrow(expect.objectContaining({ code: "CSV_MALFORMED" }));
    expect(() => parseDatabaseCsv("A\n1\n2", { maxRows: 1 })).toThrow(expect.objectContaining({ code: "CSV_ROW_LIMIT" }));
    expect(() => parseDatabaseCsv("A\n1234", { maxBytes: 3 })).toThrow(expect.objectContaining({ code: "CSV_FILE_LIMIT" }));
  });

  it("escapes spreadsheet formulas before RFC 4180 serialization", async () => {
    const domain = await loadDomain();
    const escapeFormula = domain.escapeSpreadsheetFormula as Function;
    const serialize = domain.serializeDatabaseCsv as Function;
    expect(escapeFormula).toBeTypeOf("function");
    expect(serialize).toBeTypeOf("function");

    expect(["=1+1", "+cmd", "-2+3", "@SUM(A1)", "  =hidden"].map((value) => escapeFormula(value))).toEqual([
      "'=1+1", "'+cmd", "'-2+3", "'@SUM(A1)", "'  =hidden",
    ]);
    expect(serialize([["Name", "Value"], ["Alpha, Inc.", '=1+1'], ['A"B', "line 1\nline 2"]])).toBe(
      'Name,Value\r\n"Alpha, Inc.",\'=1+1\r\n"A""B","line 1\nline 2"',
    );
  });
});
