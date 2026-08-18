import { HttpError, jsonSuccess } from "../http";
import { getNoteById, listNotes, type NoteWithTagsRow } from "../db/queries";
import { strToU8, zipSync } from "fflate";

type NoteExportFormat = "md" | "txt" | "html" | "csv" | "pdf" | "docx";
type AllExportFormat = "json" | "zip" | "csv" | "pdf" | "docx" | "html" | "txt";

type MarkdownBlock =
  | { type: "heading"; level: number; text: string }
  | { type: "paragraph"; lines: string[] }
  | { type: "blockquote"; lines: string[] }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "task-list"; items: Array<{ checked: boolean; text: string }> }
  | { type: "table"; rows: string[][] }
  | { type: "code"; language: string; code: string }
  | { type: "hr" };

function markdownEscape(value: string) {
  return value.replace(/\r\n/g, "\n");
}

function encodeFileName(value: string) {
  return value.replace(/[^\w.-]+/g, "_");
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeXml(value: string) {
  return escapeHtml(value).replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function renderInlineHtml(value: string) {
  let output = escapeHtml(value);
  output = output.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img alt="$1" src="$2" />');
  output = output.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  output = output.replace(/\[\[([^\]]+)\]\]/g, '<span class="wiki-link">$1</span>');
  output = output.replace(/`([^`]+)`/g, "<code>$1</code>");
  output = output.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  output = output.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  return output;
}

function isTableSeparator(line: string) {
  return /^[:\-\s|]+$/.test(line) && line.includes("-");
}

function splitTableRow(line: string) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((item) => item.trim());
}

function parseMarkdownBlocks(content: string): MarkdownBlock[] {
  const lines = markdownEscape(content).split("\n");
  const blocks: MarkdownBlock[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const current = lines[index] ?? "";
    const trimmed = current.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith("```")) {
      const language = trimmed.slice(3).trim();
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !(lines[index] ?? "").trim().startsWith("```")) {
        codeLines.push(lines[index] ?? "");
        index += 1;
      }
      blocks.push({ type: "code", language, code: codeLines.join("\n") });
      continue;
    }

    if (/^#{1,6}\s+/.test(trimmed)) {
      const match = trimmed.match(/^(#{1,6})\s+(.*)$/);
      blocks.push({
        type: "heading",
        level: match?.[1].length ?? 1,
        text: match?.[2]?.trim() ?? trimmed,
      });
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      blocks.push({ type: "hr" });
      continue;
    }

    if (trimmed.startsWith(">")) {
      const quoteLines: string[] = [];
      while (index < lines.length) {
        const line = lines[index] ?? "";
        if (!line.trim().startsWith(">")) break;
        quoteLines.push(line.replace(/^>\s?/, ""));
        index += 1;
      }
      index -= 1;
      blocks.push({ type: "blockquote", lines: quoteLines });
      continue;
    }

    if (trimmed.startsWith("|") && isTableSeparator((lines[index + 1] ?? "").trim())) {
      const rows: string[][] = [splitTableRow(trimmed)];
      index += 2;
      while (index < lines.length) {
        const line = (lines[index] ?? "").trim();
        if (!line.startsWith("|")) break;
        rows.push(splitTableRow(line));
        index += 1;
      }
      index -= 1;
      blocks.push({ type: "table", rows });
      continue;
    }

    if (/^-\s\[[xX\s]\]\s+/.test(trimmed)) {
      const items: Array<{ checked: boolean; text: string }> = [];
      while (index < lines.length) {
        const line = (lines[index] ?? "").trim();
        if (!/^-+\s\[[xX\s]\]\s+/.test(line) && !/^-\s\[[xX\s]\]\s+/.test(line)) break;
        items.push({
          checked: /^-\s\[[xX]\]/.test(line),
          text: line.replace(/^-\s\[[xX\s]\]\s+/, "").trim(),
        });
        index += 1;
      }
      index -= 1;
      blocks.push({ type: "task-list", items });
      continue;
    }

    if (/^[-*+]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (index < lines.length) {
        const line = (lines[index] ?? "").trim();
        if (!/^[-*+]\s+/.test(line)) break;
        items.push(line.replace(/^[-*+]\s+/, "").trim());
        index += 1;
      }
      index -= 1;
      blocks.push({ type: "list", ordered: false, items });
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = [];
      while (index < lines.length) {
        const line = (lines[index] ?? "").trim();
        if (!/^\d+\.\s+/.test(line)) break;
        items.push(line.replace(/^\d+\.\s+/, "").trim());
        index += 1;
      }
      index -= 1;
      blocks.push({ type: "list", ordered: true, items });
      continue;
    }

    const paragraphLines: string[] = [trimmed];
    while (index + 1 < lines.length) {
      const next = (lines[index + 1] ?? "").trim();
      if (
        !next ||
        next.startsWith("```") ||
        /^#{1,6}\s+/.test(next) ||
        /^(-{3,}|\*{3,}|_{3,})$/.test(next) ||
        next.startsWith(">") ||
        /^[-*+]\s+/.test(next) ||
        /^\d+\.\s+/.test(next) ||
        /^-\s\[[xX\s]\]\s+/.test(next) ||
        (next.startsWith("|") && isTableSeparator((lines[index + 2] ?? "").trim()))
      ) {
        break;
      }
      index += 1;
      paragraphLines.push(next);
    }
    blocks.push({ type: "paragraph", lines: paragraphLines });
  }

  return blocks;
}

function renderBlocksToHtml(title: string, blocks: MarkdownBlock[]) {
  const body = blocks
    .map((block) => {
      switch (block.type) {
        case "heading":
          return `<h${block.level}>${renderInlineHtml(block.text)}</h${block.level}>`;
        case "paragraph":
          return `<p>${block.lines.map((line) => renderInlineHtml(line)).join("<br />")}</p>`;
        case "blockquote":
          return `<blockquote>${block.lines.map((line) => `<p>${renderInlineHtml(line)}</p>`).join("")}</blockquote>`;
        case "list":
          return `<${block.ordered ? "ol" : "ul"}>${block.items.map((item) => `<li>${renderInlineHtml(item)}</li>`).join("")}</${block.ordered ? "ol" : "ul"}>`;
        case "task-list":
          return `<ul class="task-list">${block.items
            .map((item) => `<li><input type="checkbox" disabled ${item.checked ? "checked" : ""} /> <span>${renderInlineHtml(item.text)}</span></li>`)
            .join("")}</ul>`;
        case "table": {
          const [header, ...rows] = block.rows;
          return `<table><thead><tr>${header.map((cell) => `<th>${renderInlineHtml(cell)}</th>`).join("")}</tr></thead><tbody>${rows
            .map((row) => `<tr>${row.map((cell) => `<td>${renderInlineHtml(cell)}</td>`).join("")}</tr>`)
            .join("")}</tbody></table>`;
        }
        case "code":
          return `<pre><code data-language="${escapeHtml(block.language)}">${escapeHtml(block.code)}</code></pre>`;
        case "hr":
          return "<hr />";
        default:
          return "";
      }
    })
    .join("\n");

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: light; }
    body { font-family: "PingFang SC", "Microsoft YaHei", "Noto Sans SC", -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif; margin: 0; padding: 32px; line-height: 1.75; color: #111827; background: #fff; }
    h1,h2,h3,h4,h5,h6 { margin: 1.2em 0 0.5em; line-height: 1.3; }
    p, ul, ol, blockquote, pre, table { margin: 0 0 1rem; }
    blockquote { border-left: 4px solid #93c5fd; padding: 0.25rem 0 0.25rem 1rem; background: #eff6ff; color: #334155; }
    code { font-family: "SFMono-Regular", Consolas, monospace; background: #f3f4f6; padding: 0.125rem 0.35rem; border-radius: 4px; }
    pre { background: #111827; color: #f9fafb; padding: 1rem; border-radius: 12px; overflow: auto; }
    pre code { background: transparent; padding: 0; color: inherit; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid #d1d5db; padding: 0.5rem 0.625rem; text-align: left; vertical-align: top; }
    thead { background: #f9fafb; }
    .task-list { list-style: none; padding-left: 0; }
    .task-list li { display: flex; gap: 0.5rem; align-items: flex-start; }
    img { max-width: 100%; height: auto; border-radius: 10px; }
    hr { border: 0; border-top: 1px solid #d1d5db; margin: 1.5rem 0; }
    .wiki-link { color: #2563eb; font-weight: 600; }
  </style>
</head>
<body>
  <article>
    ${body}
  </article>
</body>
</html>`;
}

function blockToTextLines(block: MarkdownBlock) {
  switch (block.type) {
    case "heading":
      return [`${"#".repeat(block.level)} ${block.text}`, ""];
    case "paragraph":
      return [block.lines.join(" "), ""];
    case "blockquote":
      return [...block.lines.map((line) => `> ${line}`), ""];
    case "list":
      return [...block.items.map((item, index) => `${block.ordered ? `${index + 1}.` : "-"} ${item}`), ""];
    case "task-list":
      return [...block.items.map((item) => `- [${item.checked ? "x" : " "}] ${item.text}`), ""];
    case "table":
      return [...block.rows.map((row) => row.join(" | ")), ""];
    case "code":
      return ["```" + (block.language || ""), ...block.code.split("\n"), "```", ""];
    case "hr":
      return ["---", ""];
    default:
      return [""];
  }
}

function blocksToPlainText(blocks: MarkdownBlock[]) {
  return blocks.flatMap((block) => blockToTextLines(block)).join("\n").trim();
}

function parseMarkdownTable(content: string) {
  const blocks = parseMarkdownBlocks(content);
  return blocks.find((block): block is Extract<MarkdownBlock, { type: "table" }> => block.type === "table")?.rows ?? [];
}

function parseTasks(content: string) {
  const blocks = parseMarkdownBlocks(content);
  const taskBlock = blocks.find((block): block is Extract<MarkdownBlock, { type: "task-list" }> => block.type === "task-list");
  return taskBlock?.items.map((item) => [item.checked ? "已完成" : "未完成", item.text]) ?? [];
}

function csvEscape(value: string) {
  if (/["\n,]/.test(value)) {
    return `"${value.replace(/"/g, "\"\"")}"`;
  }
  return value;
}

function noteToCsvRows(note: NoteWithTagsRow) {
  const tableRows = parseMarkdownTable(note.content);
  if (tableRows.length > 0) return tableRows;
  const taskRows = parseTasks(note.content);
  if (taskRows.length > 0) return [["状态", "任务"], ...taskRows];
  const blocks = parseMarkdownBlocks(note.content);
  return [["标题", "内容"], [note.title || "无标题笔记", blocksToPlainText(blocks)]];
}

function rowsToCsv(rows: string[][]) {
  return rows.map((row) => row.map((cell) => csvEscape(cell)).join(",")).join("\n");
}

function buildPdfLines(text: string) {
  return text
    .split("\n")
    .flatMap((line) => {
      if (line.length <= 58) return [line];
      const chunks: string[] = [];
      for (let index = 0; index < line.length; index += 58) {
        chunks.push(line.slice(index, index + 58));
      }
      return chunks;
    });
}

function buildSimplePdf(text: string) {
  const lines = buildPdfLines(text).slice(0, 2200);
  const linesPerPage = 48;
  const pageCount = Math.max(1, Math.ceil(lines.length / linesPerPage));
  const objects: string[] = [];
  objects.push("1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj");
  const pageObjectIds = Array.from({ length: pageCount }, (_, index) => 3 + index * 2);
  objects.push(`2 0 obj << /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageCount} >> endobj`);
  objects.push(`${3 + pageCount * 2} 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj`);

  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const pageId = 3 + pageIndex * 2;
    const contentId = pageId + 1;
    const pageLines = lines.slice(pageIndex * linesPerPage, (pageIndex + 1) * linesPerPage);
    const content = pageLines
      .map((line, lineIndex) => {
        const safe = line.replace(/[()\\]/g, "\\$&");
        const y = 790 - lineIndex * 15;
        return `BT /F1 11 Tf 42 ${y} Td (${safe}) Tj ET`;
      })
      .join("\n");
    objects.push(`${pageId} 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${3 + pageCount * 2} 0 R >> >> /Contents ${contentId} 0 R >> endobj`);
    objects.push(`${contentId} 0 obj << /Length ${content.length} >> stream\n${content}\nendstream endobj`);
  }

  let body = "%PDF-1.4\n";
  const offsets: number[] = [0];
  for (const obj of objects) {
    offsets.push(body.length);
    body += `${obj}\n`;
  }
  const xrefStart = body.length;
  body += `xref\n0 ${objects.length + 1}\n`;
  body += "0000000000 65535 f \n";
  for (let index = 1; index < offsets.length; index += 1) {
    body += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  body += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return new TextEncoder().encode(body);
}

function paragraphXml(text: string, options?: { bold?: boolean; size?: number }) {
  const runProps = [
    options?.bold ? "<w:b/>" : "",
    options?.size ? `<w:sz w:val="${options.size}"/><w:szCs w:val="${options.size}"/>` : "",
  ].join("");
  return `<w:p><w:r>${runProps ? `<w:rPr>${runProps}</w:rPr>` : ""}<w:t xml:space="preserve">${escapeXml(text || " ")}</w:t></w:r></w:p>`;
}

function blocksToDocxXml(blocks: MarkdownBlock[]) {
  const xml: string[] = [];
  for (const block of blocks) {
    switch (block.type) {
      case "heading":
        xml.push(paragraphXml(block.text, { bold: true, size: Math.max(24, 40 - block.level * 4) }));
        break;
      case "paragraph":
        xml.push(paragraphXml(block.lines.join(" ")));
        break;
      case "blockquote":
        block.lines.forEach((line) => xml.push(paragraphXml(`> ${line}`)));
        break;
      case "list":
        block.items.forEach((item, index) => xml.push(paragraphXml(`${block.ordered ? `${index + 1}.` : "-"} ${item}`)));
        break;
      case "task-list":
        block.items.forEach((item) => xml.push(paragraphXml(`[${item.checked ? "x" : " "}] ${item.text}`)));
        break;
      case "table":
        block.rows.forEach((row) => xml.push(paragraphXml(row.join(" | "))));
        break;
      case "code":
        xml.push(paragraphXml(`\`\`\`${block.language}`));
        block.code.split("\n").forEach((line) => xml.push(paragraphXml(line)));
        xml.push(paragraphXml("```"));
        break;
      case "hr":
        xml.push(paragraphXml("------------------------"));
        break;
    }
  }
  return xml.join("\n");
}

function buildSimpleDocx(title: string, blocks: MarkdownBlock[]) {
  const files = {
    "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`),
    "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`),
    "word/document.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas"
 xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
 xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"
 xmlns:v="urn:schemas-microsoft-com:vml"
 xmlns:wp14="http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing"
 xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
 xmlns:w10="urn:schemas-microsoft-com:office:word"
 xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${paragraphXml(title, { bold: true, size: 42 })}
    ${blocksToDocxXml(blocks)}
    <w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr>
  </w:body>
</w:document>`),
  };
  return zipSync(files, { level: 0 });
}

function downloadResponse(
  body: BodyInit,
  fileName: string,
  contentType: string,
) {
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": contentType,
      "content-disposition": `attachment; filename="${fileName}"`,
    },
  });
}

function noteToMarkdown(note: NoteWithTagsRow) {
  const safeTitle = note.title.trim() || "Untitled";
  return `# ${safeTitle}\n\n${markdownEscape(note.content)}\n`;
}

function buildAllText(notes: NoteWithTagsRow[]) {
  return notes
    .map((note, index) => {
      const body = blocksToPlainText(parseMarkdownBlocks(note.content));
      return `${index + 1}. ${note.title || "无标题笔记"}\n${body}\n`;
    })
    .join("\n");
}

export async function handleExportNote(
  db: D1Database,
  userId: string,
  workspaceId: string,
  noteId: string,
  format: string,
) {
  const note = await getNoteById(db, userId, workspaceId, noteId, true);
  if (!note) throw new HttpError(404, "NOT_FOUND", "note not found");

  const normalizedFormat = format as NoteExportFormat;
  const title = note.title.trim() || "无标题笔记";
  const safeName = encodeFileName(title || note.id);
  const markdown = noteToMarkdown(note);
  const blocks = parseMarkdownBlocks(note.content);
  const plainText = blocksToPlainText(blocks);
  const html = renderBlocksToHtml(title, blocks);

  if (normalizedFormat === "md") {
    return downloadResponse(markdown, `${safeName}.md`, "text/markdown; charset=utf-8");
  }
  if (normalizedFormat === "txt") {
    return downloadResponse(`${title}\n\n${plainText}\n`, `${safeName}.txt`, "text/plain; charset=utf-8");
  }
  if (normalizedFormat === "html") {
    return downloadResponse(html, `${safeName}.html`, "text/html; charset=utf-8");
  }
  if (normalizedFormat === "csv") {
    return downloadResponse(rowsToCsv(noteToCsvRows(note)), `${safeName}.csv`, "text/csv; charset=utf-8");
  }
  if (normalizedFormat === "pdf") {
    return downloadResponse(buildSimplePdf(`${title}\n\n${plainText}`), `${safeName}.pdf`, "application/pdf");
  }
  if (normalizedFormat === "docx") {
    return downloadResponse(
      buildSimpleDocx(title, blocks),
      `${safeName}.docx`,
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
  }
  throw new HttpError(400, "VALIDATION_ERROR", "unsupported export format");
}

export async function handleExportAll(
  db: D1Database,
  userId: string,
  workspaceId: string,
  format: string,
) {
  const result = await listNotes(db, userId, workspaceId, {
    page: 1,
    pageSize: 100000,
    deletedMode: "include",
  });
  const notes = result.items;
  const normalizedFormat = format as AllExportFormat;

  if (normalizedFormat === "json") {
    return jsonSuccess(
      {
        exported_at: new Date().toISOString(),
        notes,
      },
      {
        headers: {
          "content-disposition": 'attachment; filename="nexus-notes-export.json"',
        },
      },
    );
  }

  if (normalizedFormat === "txt") {
    return downloadResponse(buildAllText(notes), "nexus-notes-export.txt", "text/plain; charset=utf-8");
  }

  if (normalizedFormat === "html") {
    const sections = notes
      .map((note) => {
        const blocks = parseMarkdownBlocks(note.content);
        return `<section><h1>${escapeHtml(note.title || "无标题笔记")}</h1>${renderBlocksToHtml(note.title || "无标题笔记", blocks)
          .split("<body>")[1]
          ?.split("</body>")[0] ?? ""}</section>`;
      })
      .join("\n<hr />\n");
    const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>Nexus Notes 导出</title></head><body>${sections}</body></html>`;
    return downloadResponse(html, "nexus-notes-export.html", "text/html; charset=utf-8");
  }

  if (normalizedFormat === "csv") {
    const rows = [["标题", "内容", "创建时间", "更新时间", "已删除", "已归档"]];
    for (const note of notes) {
      rows.push([
        note.title || "无标题笔记",
        blocksToPlainText(parseMarkdownBlocks(note.content)),
        note.created_at,
        note.updated_at,
        note.deleted_at ? "是" : "否",
        note.archived_at ? "是" : "否",
      ]);
    }
    return downloadResponse(rowsToCsv(rows), "nexus-notes-export.csv", "text/csv; charset=utf-8");
  }

  if (normalizedFormat === "pdf") {
    return downloadResponse(buildSimplePdf(buildAllText(notes)), "nexus-notes-export.pdf", "application/pdf");
  }

  if (normalizedFormat === "docx") {
    const mergedBlocks: MarkdownBlock[] = [];
    notes.forEach((note, index) => {
      mergedBlocks.push({ type: "heading", level: 1, text: `${index + 1}. ${note.title || "无标题笔记"}` });
      mergedBlocks.push(...parseMarkdownBlocks(note.content));
      mergedBlocks.push({ type: "hr" });
    });
    return downloadResponse(
      buildSimpleDocx("Nexus Notes 导出", mergedBlocks),
      "nexus-notes-export.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
  }

  if (normalizedFormat === "zip") {
    const files: Record<string, Uint8Array> = {};
    notes.forEach((note, index) => {
      const suffix = note.deleted_at ? "trashed" : note.archived_at ? "archived" : "active";
      const name = `${String(index + 1).padStart(3, "0")}-${encodeFileName(note.title || note.id)}-${suffix}.md`;
      files[name] = strToU8(noteToMarkdown(note));
    });
    return downloadResponse(zipSync(files, { level: 0 }), "nexus-notes-export.zip", "application/zip");
  }

  throw new HttpError(400, "VALIDATION_ERROR", "unsupported export format");
}
