import { Fragment, type ReactNode } from "react";

function safeHref(value: string) {
  const normalized = value.trim();
  try {
    const url = new URL(normalized, window.location.origin);
    return ["http:", "https:", "mailto:"].includes(url.protocol) ? normalized : null;
  } catch {
    return null;
  }
}

function renderInline(value: string): ReactNode[] {
  const pattern = /(`[^`]+`|\[([^\]]+)\]\(((?:[^()]|\([^()]*\))*)\))/gu;
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(value)) !== null) {
    if (match.index > cursor) nodes.push(value.slice(cursor, match.index));
    const token = match[0];
    if (token.startsWith("`")) {
      nodes.push(<code key={`code-${match.index}`}>{token.slice(1, -1)}</code>);
    } else {
      const label = match[2] ?? "";
      const href = safeHref(match[3] ?? "");
      nodes.push(href
        ? <a key={`link-${match.index}`} href={href} target="_blank" rel="noreferrer">{label}</a>
        : <Fragment key={`text-${match.index}`}>{label}</Fragment>);
    }
    cursor = match.index + token.length;
  }
  if (cursor < value.length) nodes.push(value.slice(cursor));
  return nodes;
}

function isBlockStart(line: string) {
  return /^#{1,3}\s|^```|^[-*]\s(?:\[[ xX]\]\s)?/u.test(line);
}

function renderBlocks(content: string) {
  const lines = content.replace(/\r\n?/gu, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = /^```\s*([\w-]*)\s*$/u.exec(line);
    if (fence) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/u.test(lines[index] ?? "")) {
        code.push(lines[index] ?? "");
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push(
        <pre className="markdown-code-block" key={`code-block-${index}`}>
          <code data-language={fence[1] || undefined}>{code.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    const heading = /^(#{1,3})\s+(.+)$/u.exec(line);
    if (heading) {
      const level = heading[1]!.length;
      const Heading = `h${level}` as "h1" | "h2" | "h3";
      blocks.push(<Heading key={`heading-${index}`}>{renderInline(heading[2]!)}</Heading>);
      index += 1;
      continue;
    }

    if (/^[-*]\s(?:\[[ xX]\]\s)?/u.test(line)) {
      const items: ReactNode[] = [];
      while (index < lines.length && /^[-*]\s(?:\[[ xX]\]\s)?/u.test(lines[index] ?? "")) {
        const item = lines[index] ?? "";
        const task = /^[-*]\s\[([ xX])\]\s+(.+)$/u.exec(item);
        const text = task ? task[2]! : item.replace(/^[-*]\s+/u, "");
        items.push(
          <li key={`list-item-${index}`} className={task ? "markdown-task-item" : undefined}>
            {task ? <span className="markdown-task-marker" aria-hidden="true">{task[1]!.toLowerCase() === "x" ? "✓" : "○"}</span> : null}
            <span>{renderInline(text)}</span>
          </li>,
        );
        index += 1;
      }
      blocks.push(<ul className="markdown-list" key={`list-${index}`}>{items}</ul>);
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length && lines[index]?.trim() && !isBlockStart(lines[index] ?? "")) {
      paragraph.push(lines[index] ?? "");
      index += 1;
    }
    if (paragraph.length) blocks.push(<p key={`paragraph-${index}`}>{renderInline(paragraph.join(" "))}</p>);
  }

  return blocks;
}

export function MarkdownPreview({ content }: { content: string }) {
  return (
    <div className="markdown-note-preview" aria-label="Markdown 预览">
      {content.trim() ? renderBlocks(content) : <p className="markdown-preview-empty">开始记录你的想法。</p>}
    </div>
  );
}
