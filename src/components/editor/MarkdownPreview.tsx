import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { replaceWikiLinks, slugifyHeading, toggleTaskAtLine } from "@/lib/markdown";
import { RichCodeBlock } from "./RichCodeBlock";
import { TaskBlock } from "./TaskBlock";

interface MarkdownPreviewProps {
  content: string;
  onChangeContent: (content: string) => void;
  onOpenWikiLink: (title: string) => void;
  interactive?: boolean;
}

function getPlainText(children: React.ReactNode): string {
  if (typeof children === "string") return children;
  if (Array.isArray(children)) return children.map(getPlainText).join("");
  if (children && typeof children === "object" && "props" in children) {
    return getPlainText((children as { props?: { children?: React.ReactNode } }).props?.children);
  }
  return "";
}

export function MarkdownPreview({ content, onChangeContent, onOpenWikiLink, interactive = true }: MarkdownPreviewProps) {
  const renderedContent = replaceWikiLinks(content, (title) => `[${title}](note://${encodeURIComponent(title)})`);

  return (
    <article className="markdown-preview mx-auto max-w-[760px] px-6 py-8 md:px-10 lg:py-12">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1({ children }) {
            const text = getPlainText(children);
            return <h1 id={slugifyHeading(text)}>{children}</h1>;
          },
          h2({ children }) {
            const text = getPlainText(children);
            return <h2 id={slugifyHeading(text)}>{children}</h2>;
          },
          h3({ children }) {
            const text = getPlainText(children);
            return <h3 id={slugifyHeading(text)}>{children}</h3>;
          },
          a({ href, children }) {
            if (href?.startsWith("note://")) {
              const title = decodeURIComponent(href.replace("note://", ""));
              if (!interactive) {
                return <span className="rounded bg-[#007aff]/10 px-1 text-[#007aff] dark:text-[#7ab8ff]">{children}</span>;
              }
              return (
                <button
                  type="button"
                  className="rounded bg-[#007aff]/10 px-1 text-[#007aff] transition-colors hover:bg-[#007aff]/18 dark:text-[#7ab8ff]"
                  onClick={() => onOpenWikiLink(title)}
                >
                  {children}
                </button>
              );
            }
            return (
              <a href={href} target="_blank" rel="noreferrer">
                {children}
              </a>
            );
          },
          li({ node, children, ...props }) {
            const element = node as unknown as {
              properties?: { className?: string[] };
              position?: { start?: { line?: number } };
              children?: Array<{ properties?: { checked?: boolean } }>;
            };
            const isTask = element.properties?.className?.includes("task-list-item");
            if (isTask) {
              const lineIndex = Math.max(0, (element.position?.start?.line ?? 1) - 1);
              const checked = Boolean(element.children?.[0]?.properties?.checked);
              return (
                <li className="list-none" {...props}>
                  <TaskBlock checked={checked} onToggle={interactive ? () => onChangeContent(toggleTaskAtLine(content, lineIndex)) : undefined}>
                    {children}
                  </TaskBlock>
                </li>
              );
            }
            return <li {...props}>{children}</li>;
          },
          code({ className, children }) {
            const code = String(children).replace(/\n$/, "");
            const language = /language-(\w+)/.exec(className ?? "")?.[1];
            if (language) return <RichCodeBlock language={language} code={code} />;
            if (code.includes("\n")) return <RichCodeBlock code={code} />;
            return <code className={className}>{children}</code>;
          },
        }}
      >
        {renderedContent || "*还没有内容*"}
      </ReactMarkdown>
    </article>
  );
}
