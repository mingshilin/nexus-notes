import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function source(filePath: string) {
  return readFileSync(join(process.cwd(), filePath), "utf8");
}

describe("390px mobile overflow guards", () => {
  it("keeps login, shell, editor, database, and knowledge surfaces clipped or shrinkable", () => {
    const files = {
      auth: source("src/components/auth/AuthPanel.tsx"),
      shell: source("src/components/layout/AppShell.tsx"),
      editor: source("src/components/editor/NoteEditor.tsx"),
      editorHeader: source("src/components/editor/EditorHeader.tsx"),
      slashMenu: source("src/components/editor/SlashCommandMenu.tsx"),
      database: source("src/components/database/DatabasePage.tsx"),
      toolbar: source("src/components/database/DatabaseToolbar.tsx"),
      knowledge: source("src/components/knowledge/KnowledgeCenterPage.tsx"),
      noteList: source("src/components/notes/NoteListPanel.tsx"),
      dailyList: source("src/components/notes/DailyNoteListView.tsx"),
      noteCard: source("src/components/notes/NoteCard.tsx"),
    };

    expect(files.auth).toContain("overflow-x-hidden");
    expect(files.shell).toContain("overflow-x-hidden");
    expect(files.editor).toContain("min-w-0");
    expect(files.editor).toContain("移动端上传附件");
    expect(files.editor).toContain("showMobileAttachmentButton");
    expect(files.editor).toContain("pb-[calc(1.5rem+env(safe-area-inset-bottom))]");
    expect(files.editor).toContain("pb-[calc(3.25rem+env(safe-area-inset-bottom))]");
    expect(files.editor).toContain("onPointerDown={(event) => event.preventDefault()}");
    expect(files.editor).toContain("min-h-[22rem]");
    expect(files.editor).toContain("h-8 rounded-full");
    expect(files.slashMenu).toContain("bottom-[calc(2.75rem+env(safe-area-inset-bottom))]");
    expect(files.slashMenu).toContain("max-w-[calc(100vw-2rem)]");
    expect(files.database).toContain("h-full min-w-0 overflow-y-auto");
    expect(files.toolbar).toContain("flex max-w-full min-w-0 flex-nowrap");
    expect(files.knowledge).toContain("h-full min-w-0 overflow-y-auto");
    expect(files.knowledge).toContain("overflow-x-auto");
    expect(files.noteList).toContain("flex h-full min-w-0 flex-col overflow-hidden");
    expect(files.noteList).toContain("DailyNoteListView");
    expect(files.dailyList).toContain("overflow-hidden");
    expect(files.dailyList).toContain("grid-cols-[32px_minmax(0,1fr)_auto_32px]");
    expect(files.dailyList).toContain("w-full min-w-0");
    expect(files.noteList).toContain("grid min-w-0 max-w-full gap-1.5 overflow-hidden");
    expect(files.noteList).toContain("grid-cols-[minmax(0,1fr)_minmax(104px,120px)]");
    expect(files.noteList).toContain("h-9 w-full min-w-0 max-w-full");
    expect(files.noteList).toContain("flex min-w-0 max-w-full flex-wrap");
    expect(files.noteList).not.toContain("scrollbar-subtle -mx-1 flex flex-nowrap");
    expect(files.noteCard).toContain("p-3 sm:p-4");
    expect(files.noteCard).toContain("line-clamp-1 min-h-[1.35rem]");
    expect(files.shell).toContain("mac-window relative");
    expect(files.shell).toContain("w-[400px]");
    expect(files.shell).not.toContain("top-[168px]");
    expect(files.shell).toContain('data-testid="mobile-top-toolbar"');
    expect(files.shell).toContain("transition-[height,transform,opacity,padding]");
    expect(files.shell).toContain("h-0 -translate-y-full border-b-0");
    expect(files.editorHeader).toContain("关闭信息");
    expect(files.editorHeader).toContain('size="sm"');
    expect(files.shell).toContain('document.addEventListener("scroll"');
    expect(files.shell).toContain('document.addEventListener("focusin"');
    expect(files.shell).toContain("translate-y-full pointer-events-none");
    expect(files.shell).toContain("pb-[env(safe-area-inset-bottom)]");
  });

  it("does not force mobile saved-view controls wider than the viewport", () => {
    const database = source("src/components/database/DatabasePage.tsx");

    expect(database).toContain("w-full min-w-0 flex-col");
    expect(database).toContain("sm:min-w-[240px]");
    expect(database).toContain("w-full rounded-[12px] sm:max-w-[220px]");
  });

  it("keeps mobile inbox chrome compact enough to expose notes in the first viewport", () => {
    const noteList = source("src/components/notes/NoteListPanel.tsx");

    expect(noteList).toContain("hidden items-center gap-2");
    expect(noteList).toContain("mb-1 flex min-w-0 items-center gap-2");
    expect(noteList).toContain("py-0.5 text-[10px]");
    expect(noteList).toContain("2xl:max-w-[34ch] 2xl:whitespace-normal");
    expect(noteList).toContain("text-muted-foreground 2xl:flex");
    expect(noteList).toContain("hidden grid-cols-3 gap-2 2xl:grid");
    expect(noteList).toContain("h-7 min-w-0 rounded-[10px]");
    expect(noteList).toContain("待整理 {total} · 今日 {inboxTodayCount}");
    expect(noteList).toContain("h-10 border-transparent");
    expect(noteList).toContain("compactFiltersCollapsed");
    expect(noteList).toContain("aria-expanded={mobileFiltersOpen}");
    expect(noteList).toContain('showCompactFilterToggle && "pb-1.5 pt-2 sm:pb-2 sm:pt-3"');
    expect(noteList).toContain('showCompactFilterToggle && "mb-1.5 space-y-1.5 sm:mb-2 sm:space-y-2"');
    expect(noteList).toContain('showCompactFilterToggle && "hidden xl:block"');
    expect(noteList).toContain('showCompactFilterToggle && "py-1.5 sm:py-2"');
    expect(noteList).not.toContain('compactFiltersCollapsed && "hidden xl:block"');
    expect(noteList).not.toContain('compactFiltersCollapsed && "hidden xl:flex"');
    expect(noteList).toContain("px-3 py-2 sm:px-4 sm:py-3");
    expect(noteList).toContain('<ScrollArea className="min-h-0 flex-1">');
    expect(noteList).toContain("xl:sticky xl:top-0 xl:z-10");
    expect(noteList).toContain('hasPagination ? "flex" : "hidden sm:flex"');
    expect(noteList).toContain("px-3 py-1.5 text-xs");
    expect(noteList).toContain('!hasPagination && "hidden"');
  });
});
