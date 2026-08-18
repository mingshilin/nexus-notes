import type { NoteLink } from "@/types/note";
import { decodeEscapedUnicode } from "@/lib/utils";

interface BacklinksPanelProps {
  links: NoteLink[];
  backlinks: NoteLink[];
  onOpenLink: (titleOrId: string, isId?: boolean) => void;
}

export function BacklinksPanel({ links, backlinks, onOpenLink }: BacklinksPanelProps) {
  return (
    <div className="space-y-5">
      <section>
        <div className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
          出链 <span className="rounded bg-muted px-1.5 py-0.5">{links.length}</span>
        </div>
        <div className="space-y-2">
          {links.map((link) => (
            <button
              key={link.id}
              type="button"
              className="w-full rounded-[12px] border border-border bg-white/70 p-3 text-left text-sm transition-colors hover:border-[#007aff]/30 dark:bg-white/[0.04]"
              onClick={() => onOpenLink(link.target_note_id ?? link.target_title, Boolean(link.target_note_id))}
            >
              [[{decodeEscapedUnicode(link.target_note_title ?? link.target_title)}]]
            </button>
          ))}
          {links.length === 0 ? <p className="text-xs text-muted-foreground">当前笔记没有出链。</p> : null}
        </div>
      </section>

      <section>
        <div className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
          反向链接 <span className="rounded bg-muted px-1.5 py-0.5">{backlinks.length}</span>
        </div>
        <div className="space-y-2">
          {backlinks.map((link) => (
            <button
              key={link.id}
              type="button"
              className="w-full rounded-[12px] border border-border bg-white/70 p-3 text-left text-sm transition-colors hover:border-[#007aff]/30 dark:bg-white/[0.04]"
              onClick={() => onOpenLink(link.source_note_id, true)}
            >
              <span className="block font-medium">{decodeEscapedUnicode(link.source_title ?? "无标题笔记")}</span>
              <span className="mt-1 block text-xs text-muted-foreground">
                提到 [[{decodeEscapedUnicode(link.target_title)}]]
              </span>
            </button>
          ))}
          {backlinks.length === 0 ? <p className="text-xs text-muted-foreground">还没有其他笔记链接到这里。</p> : null}
        </div>
      </section>
    </div>
  );
}

