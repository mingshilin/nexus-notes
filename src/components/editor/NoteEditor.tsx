import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Paperclip } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import type { EditorMode } from "@/store/useAppStore";
import { FloatingToolbar } from "./FloatingToolbar";
import { LazyMarkdownPreview } from "./markdownPreviewLoader";
import { SlashCommandMenu, slashCommands, type SlashCommand } from "./SlashCommandMenu";

interface NoteEditorProps {
  title: string;
  content: string;
  editorMode: EditorMode;
  titleAutoFocus?: boolean;
  readOnly?: boolean;
  insertRequest?: { id: number; text: string } | null;
  onTitleChange: (value: string) => void;
  onContentChange: (value: string) => void;
  onOpenWikiLink: (title: string) => void;
  onUploadAttachment?: (file: File) => Promise<string>;
}

function PreviewPaneFallback() {
  return (
    <div className="mx-auto max-w-[760px] px-6 py-8 md:px-10 lg:py-12">
      <div className="space-y-4 rounded-[24px] border border-border/70 bg-white/50 p-6 dark:bg-white/[0.03]">
        <div className="h-5 w-28 animate-pulse rounded-full bg-muted/70" />
        <div className="h-9 w-2/3 animate-pulse rounded-xl bg-muted/60" />
        <div className="space-y-3 pt-2">
          <div className="h-4 w-full animate-pulse rounded-full bg-muted/50" />
          <div className="h-4 w-[92%] animate-pulse rounded-full bg-muted/50" />
          <div className="h-4 w-[78%] animate-pulse rounded-full bg-muted/50" />
        </div>
        <p className="pt-1 text-sm text-muted-foreground">正在加载预览...</p>
      </div>
    </div>
  );
}

export function NoteEditor({
  title,
  content,
  editorMode,
  titleAutoFocus,
  readOnly = false,
  insertRequest = null,
  onTitleChange,
  onContentChange,
  onOpenWikiLink,
  onUploadAttachment,
}: NoteEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashStart, setSlashStart] = useState<number | null>(null);
  const [slashQuery, setSlashQuery] = useState("");
  const [slashIndex, setSlashIndex] = useState(0);
  const [showToolbar, setShowToolbar] = useState(true);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const lastInsertIdRef = useRef<number>(-1);
  const mobileAttachmentHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [mobileAttachmentVisible, setMobileAttachmentVisible] = useState(false);

  const showEditor = editorMode === "write" || editorMode === "split";
  const showPreview = editorMode === "preview" || editorMode === "split";
  const showMobileAttachmentButton = Boolean(onUploadAttachment) && (mobileAttachmentVisible || uploadingAttachment);
  const filteredSlashCommands = useMemo(() => {
    const q = slashQuery.trim().toLowerCase();
    return slashCommands.filter((item) => !q || item.label.toLowerCase().includes(q));
  }, [slashQuery]);

  useEffect(() => {
    return () => {
      if (mobileAttachmentHideTimerRef.current) clearTimeout(mobileAttachmentHideTimerRef.current);
    };
  }, []);

  function updateSlashState(value: string, cursor: number) {
    const lineStart = value.lastIndexOf("\n", cursor - 1) + 1;
    const lineBeforeCursor = value.slice(lineStart, cursor);
    const slashIndexInLine = lineBeforeCursor.lastIndexOf("/");
    if (slashIndexInLine < 0) {
      setSlashOpen(false);
      return;
    }
    const query = lineBeforeCursor.slice(slashIndexInLine + 1);
    if (query.includes(" ")) {
      setSlashOpen(false);
      return;
    }
    setSlashStart(lineStart + slashIndexInLine);
    setSlashQuery(query);
    setSlashIndex(0);
    setSlashOpen(true);
  }

  function replaceRange(start: number, end: number, insert: string) {
    const next = `${content.slice(0, start)}${insert}${content.slice(end)}`;
    onContentChange(next);
    window.requestAnimationFrame(() => {
      const nextCursor = start + insert.length;
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(nextCursor, nextCursor);
    });
  }

  function insertText(insert: string) {
    const textarea = textareaRef.current;
    const start = textarea?.selectionStart ?? content.length;
    const end = textarea?.selectionEnd ?? start;
    replaceRange(start, end, insert);
  }

  function showMobileAttachmentActions() {
    if (mobileAttachmentHideTimerRef.current) clearTimeout(mobileAttachmentHideTimerRef.current);
    setMobileAttachmentVisible(true);
  }

  function scheduleMobileAttachmentHide() {
    if (mobileAttachmentHideTimerRef.current) clearTimeout(mobileAttachmentHideTimerRef.current);
    mobileAttachmentHideTimerRef.current = setTimeout(() => {
      setMobileAttachmentVisible(false);
    }, 700);
  }

  useEffect(() => {
    if (!insertRequest || insertRequest.id === lastInsertIdRef.current || readOnly) return;
    lastInsertIdRef.current = insertRequest.id;
    insertText(insertRequest.text);
  }, [insertRequest, readOnly]);

  function isSupportedAttachment(file: File) {
    return file.type.startsWith("image/") || file.type === "application/pdf";
  }

  async function insertAttachment(file: File) {
    if (!onUploadAttachment || readOnly) return;
    setUploadingAttachment(true);
    try {
      const url = await onUploadAttachment(file);
      const label = file.name.replace(/\.[a-z0-9]+$/i, "") || "附件";
      insertText(file.type.startsWith("image/") ? `![${label}](${url})` : `[${label}](${url})`);
    } finally {
      setUploadingAttachment(false);
    }
  }

  function insertCommand(command: SlashCommand) {
    if (command.disabled || readOnly) return;
    if (slashStart === null) {
      insertText(command.insert);
      return;
    }

    const textarea = textareaRef.current;
    const cursor = textarea?.selectionStart ?? slashStart + slashQuery.length + 1;
    const before = content.slice(0, slashStart);
    const after = content.slice(cursor);
    const next = `${before}${command.insert}${after}`;
    onContentChange(next);
    setSlashOpen(false);

    window.requestAnimationFrame(() => {
      const nextCursor = before.length + command.insert.length;
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(nextCursor, nextCursor);
    });
  }

  return (
    <div
      className={
        editorMode === "split"
          ? "grid h-full min-h-0 min-w-0 xl:grid-cols-[minmax(0,1fr)_minmax(340px,0.88fr)]"
          : "grid h-full min-h-0 min-w-0"
      }
    >
      {showEditor ? (
        <div className="relative flex min-h-0 flex-col overflow-hidden">
          <div className="hidden shrink-0 items-center gap-2 px-4 pt-3 lg:flex">
            <FloatingToolbar visible={showToolbar && !slashOpen} onInsert={insertText} />
            <Button
              size="sm"
              variant="outline"
              className="rounded-[10px]"
              onClick={() => uploadInputRef.current?.click()}
              disabled={uploadingAttachment || readOnly}
            >
              <Paperclip className="mr-1 h-4 w-4" />
              {uploadingAttachment ? "上传中..." : "附件"}
            </Button>
            <input
              ref={uploadInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif,application/pdf"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) {
                  void insertAttachment(file);
                }
                event.currentTarget.value = "";
              }}
            />
          </div>

          <div
            className={
              showMobileAttachmentButton
                ? "scrollbar-subtle flex h-full justify-center overflow-y-auto px-3 pb-[calc(3.25rem+env(safe-area-inset-bottom))] pt-1 sm:px-4 md:px-8 md:pb-16 md:pt-5 xl:pt-2"
                : "scrollbar-subtle flex h-full justify-center overflow-y-auto px-3 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-1 sm:px-4 md:px-8 md:pb-16 md:pt-5 xl:pt-2"
            }
          >
            <div className="w-full max-w-[760px]">
              <input
                value={title}
                onChange={(event) => onTitleChange(event.target.value)}
                onFocus={showMobileAttachmentActions}
                onBlur={scheduleMobileAttachmentHide}
                className="mb-2 h-auto w-full border-0 bg-transparent px-0 py-0 text-[24px] font-bold leading-tight tracking-tight text-foreground outline-none placeholder:text-muted-foreground/42 sm:mb-3 sm:text-[30px] md:mb-5 md:text-[40px]"
                placeholder="输入标题..."
                autoFocus={titleAutoFocus}
                readOnly={readOnly}
              />

              <Textarea
                ref={textareaRef}
                value={content}
                readOnly={readOnly}
                onFocus={() => {
                  setShowToolbar(true);
                  showMobileAttachmentActions();
                }}
                onBlur={scheduleMobileAttachmentHide}
                onPaste={(event) => {
                  if (readOnly || !onUploadAttachment) return;
                  const file = Array.from(event.clipboardData.files).find(isSupportedAttachment);
                  if (!file) return;
                  event.preventDefault();
                  void insertAttachment(file);
                }}
                onDrop={(event) => {
                  if (readOnly || !onUploadAttachment) return;
                  const file = Array.from(event.dataTransfer.files).find(isSupportedAttachment);
                  if (!file) return;
                  event.preventDefault();
                  void insertAttachment(file);
                }}
                onDragOver={(event) => {
                  if (!readOnly && onUploadAttachment) event.preventDefault();
                }}
                onChange={(event) => {
                  onContentChange(event.target.value);
                  updateSlashState(event.target.value, event.target.selectionStart);
                }}
                onKeyDown={(event) => {
                  if (!slashOpen) return;
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    setSlashIndex((value) => Math.min(value + 1, Math.max(filteredSlashCommands.length - 1, 0)));
                  }
                  if (event.key === "ArrowUp") {
                    event.preventDefault();
                    setSlashIndex((value) => Math.max(value - 1, 0));
                  }
                  if (event.key === "Enter") {
                    event.preventDefault();
                    const command = filteredSlashCommands[slashIndex];
                    if (command) insertCommand(command);
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    setSlashOpen(false);
                  }
                }}
                className="scrollbar-subtle min-h-[22rem] resize-none rounded-none border-transparent bg-transparent px-0 pb-14 text-[15px] leading-8 shadow-none placeholder:text-muted-foreground/44 focus-visible:border-transparent focus-visible:ring-0 md:min-h-[32rem] md:pb-24 md:text-[16px]"
                placeholder="开始写作，输入 / 唤起命令..."
              />

              {showMobileAttachmentButton ? (
                <div className="pointer-events-none sticky bottom-[calc(2.75rem+env(safe-area-inset-bottom))] z-20 mt-2 flex justify-end lg:hidden">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="pointer-events-auto h-8 rounded-full bg-background/92 px-3 text-xs shadow-lg backdrop-blur"
                    onPointerDown={(event) => event.preventDefault()}
                    onClick={() => uploadInputRef.current?.click()}
                    disabled={uploadingAttachment || readOnly}
                    aria-label="移动端上传附件"
                  >
                    <Paperclip className="mr-1 h-4 w-4" />
                    {uploadingAttachment ? "上传中..." : "附件"}
                  </Button>
                </div>
              ) : null}

              <SlashCommandMenu
                open={slashOpen}
                query={slashQuery}
                activeIndex={slashIndex}
                onHover={setSlashIndex}
                onSelect={insertCommand}
              />
            </div>
          </div>
        </div>
      ) : null}

      {showPreview ? (
        <div className="scrollbar-subtle min-h-0 overflow-y-auto border-l" style={{ borderColor: "var(--border-subtle)" }}>
          <Suspense fallback={<PreviewPaneFallback />}>
            <LazyMarkdownPreview content={content} onChangeContent={onContentChange} onOpenWikiLink={onOpenWikiLink} />
          </Suspense>
        </div>
      ) : null}
    </div>
  );
}
