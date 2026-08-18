import { escapeRegExp } from "@/lib/utils";

export interface OutlineItem {
  id: string;
  level: 1 | 2 | 3;
  text: string;
}

export interface TaskItem {
  index: number;
  checked: boolean;
  text: string;
}

export function slugifyHeading(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-")
    .slice(0, 80);
}

export function extractOutline(markdown: string): OutlineItem[] {
  return markdown
    .split("\n")
    .map((line) => {
      const match = /^(#{1,3})\s+(.+)$/.exec(line.trim());
      if (!match) return null;
      const text = match[2].trim();
      return {
        id: slugifyHeading(text),
        level: match[1].length as 1 | 2 | 3,
        text,
      };
    })
    .filter((item): item is OutlineItem => Boolean(item));
}

export function extractWikiTitles(markdown: string) {
  const titles: string[] = [];
  for (const match of markdown.matchAll(/\[\[([^\]\n]{1,160})\]\]/g)) {
    const title = match[1]?.trim();
    if (title) titles.push(title);
  }
  return Array.from(new Set(titles));
}

export function extractTasks(markdown: string): TaskItem[] {
  return markdown
    .split("\n")
    .map((line, index) => {
      const match = /^(\s*)-\s+\[( |x|X)\]\s+(.+)$/.exec(line);
      if (!match) return null;
      return {
        index,
        checked: match[2].toLowerCase() === "x",
        text: match[3],
      };
    })
    .filter((item): item is TaskItem => Boolean(item));
}

export function toggleTaskAtLine(markdown: string, lineIndex: number) {
  const lines = markdown.split("\n");
  const line = lines[lineIndex];
  if (!line) return markdown;
  lines[lineIndex] = line.replace(/-\s+\[( |x|X)\]/, (_, state: string) =>
    state.toLowerCase() === "x" ? "- [ ]" : "- [x]",
  );
  return lines.join("\n");
}

export function replaceWikiLinks(markdown: string, replacer: (title: string) => string) {
  return markdown.replace(/\[\[([^\]\n]{1,160})\]\]/g, (_, title: string) =>
    replacer(title.trim()),
  );
}

export function containsWikiTitle(markdown: string, title: string) {
  return new RegExp(`\\[\\[${escapeRegExp(title)}\\]\\]`, "i").test(markdown);
}
