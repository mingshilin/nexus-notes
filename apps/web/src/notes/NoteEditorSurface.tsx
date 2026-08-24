import { Code2, Heading1, Heading2, List, Paperclip, Quote, SquareCheck } from "lucide-react";
import { useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type RefObject } from "react";

interface EditorCommand {
  id: string;
  label: string;
  description: string;
  insert: string;
}

const commands: EditorCommand[] = [
  { id: "heading-1", label: "标题 1", description: "一级标题", insert: "# " },
  { id: "heading-2", label: "标题 2", description: "二级标题", insert: "## " },
  { id: "bullet-list", label: "无序列表", description: "创建一个项目列表", insert: "- " },
  { id: "task-list", label: "任务清单", description: "创建一个可勾选任务", insert: "- [ ] " },
  { id: "quote", label: "引用", description: "插入引用块", insert: "> " },
  { id: "code-block", label: "代码块", description: "插入 TypeScript 代码块", insert: "```ts\n\n```" },
];

const toolbarCommands = [
  { id: "heading-1", label: "标题 1", icon: Heading1 },
  { id: "heading-2", label: "标题 2", icon: Heading2 },
  { id: "bullet-list", label: "无序列表", icon: List },
  { id: "task-list", label: "任务清单", icon: SquareCheck },
  { id: "quote", label: "引用", icon: Quote },
  { id: "code-block", label: "代码块", icon: Code2 },
] as const;

interface NoteEditorSurfaceProps {
  value: string;
  onChange(value: string): void;
  readOnly?: boolean;
  ariaLabel: string;
  placeholder?: string;
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
  onFocus?(): void;
  onBlur?(): void;
  onUploadAttachment?(file: File): void | Promise<void>;
  uploadingAttachment?: boolean;
}

function slashState(value: string, cursor: number) {
  const lineStart = value.lastIndexOf("\n", Math.max(0, cursor - 1)) + 1;
  const lineBeforeCursor = value.slice(lineStart, cursor);
  const slashOffset = lineBeforeCursor.lastIndexOf("/");
  if (slashOffset < 0) return null;
  const query = lineBeforeCursor.slice(slashOffset + 1);
  if (query.includes(" ")) return null;
  return { start: lineStart + slashOffset, query };
}

export function NoteEditorSurface({
  value,
  onChange,
  readOnly = false,
  ariaLabel,
  placeholder = "开始写作，输入 / 唤起命令…",
  textareaRef: forwardedTextareaRef,
  onFocus,
  onBlur,
  onUploadAttachment,
  uploadingAttachment = false,
}: NoteEditorSurfaceProps) {
  const localTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const textareaRef = forwardedTextareaRef ?? localTextareaRef;
  const pendingCursorRef = useRef<number | null>(null);
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashStart, setSlashStart] = useState<number | null>(null);
  const [slashQuery, setSlashQuery] = useState("");
  const [activeCommandIndex, setActiveCommandIndex] = useState(0);

  useLayoutEffect(() => {
    const cursor = pendingCursorRef.current;
    if (cursor === null) return;
    pendingCursorRef.current = null;
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.focus();
    textarea.setSelectionRange(cursor, cursor);
  }, [textareaRef, value]);

  const filteredCommands = useMemo(() => {
    const query = slashQuery.trim().toLocaleLowerCase();
    return commands.filter((command) => !query || `${command.id} ${command.label} ${command.description}`.toLocaleLowerCase().includes(query));
  }, [slashQuery]);

  const replaceSelection = (insert: string, startOverride?: number, endOverride?: number) => {
    const textarea = textareaRef.current;
    const start = startOverride ?? textarea?.selectionStart ?? value.length;
    const end = endOverride ?? textarea?.selectionEnd ?? start;
    onChange(`${value.slice(0, start)}${insert}${value.slice(end)}`);
    pendingCursorRef.current = start + insert.length;
  };

  const selectCommand = (command: EditorCommand) => {
    if (readOnly) return;
    const textarea = textareaRef.current;
    const cursor = textarea?.selectionStart ?? value.length;
    if (slashStart === null) {
      replaceSelection(command.insert);
    } else {
      replaceSelection(command.insert, slashStart, cursor);
    }
    setSlashOpen(false);
    setSlashStart(null);
    setSlashQuery("");
  };

  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const nextValue = event.target.value;
    onChange(nextValue);
    // Some IME/input events report the old zero position while the controlled
    // value has already been replaced. Treat that case as a caret at the end.
    const cursor = event.target.selectionStart > 0 || nextValue.length === 0
      ? event.target.selectionStart
      : nextValue.length;
    const nextSlash = slashState(nextValue, cursor);
    if (!nextSlash) {
      setSlashOpen(false);
      setSlashStart(null);
      return;
    }
    setSlashStart(nextSlash.start);
    setSlashQuery(nextSlash.query);
    setActiveCommandIndex(0);
    setSlashOpen(true);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!slashOpen) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveCommandIndex((index) => Math.min(index + 1, Math.max(0, filteredCommands.length - 1)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveCommandIndex((index) => Math.max(0, index - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const command = filteredCommands[activeCommandIndex];
      if (command) selectCommand(command);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setSlashOpen(false);
    }
  };

  return (
    <div className="note-editor-surface">
      <div className="note-editor-markdown-toolbar" role="toolbar" aria-label="Markdown 工具">
        {toolbarCommands.map(({ id, label, icon: Icon }) => {
          const command = commands.find((item) => item.id === id)!;
          return (
            <button key={id} type="button" aria-label={label} title={label} disabled={readOnly} onClick={() => selectCommand(command)}>
              <Icon aria-hidden="true" size={15} />
              <span>{label}</span>
            </button>
          );
        })}
        {onUploadAttachment ? <label className="note-editor-attachment-action">
          <Paperclip aria-hidden="true" size={15} />
          <span>{uploadingAttachment ? "上传中…" : "插入附件"}</span>
          <input
            aria-label="插入附件"
            type="file"
            accept="application/pdf,image/jpeg,image/png,image/webp,text/plain"
            disabled={readOnly || uploadingAttachment}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.currentTarget.value = "";
              if (file) void onUploadAttachment(file);
            }}
          />
        </label> : null}
      </div>
      <div className="note-editor-surface-body">
        <textarea
          ref={textareaRef}
          aria-label={ariaLabel}
          value={value}
          disabled={readOnly}
          placeholder={placeholder}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={onFocus}
          onBlur={onBlur}
        />
        {slashOpen && filteredCommands.length > 0 ? (
          <div className="note-slash-menu" role="listbox" aria-label="斜杠命令">
            {filteredCommands.map((command, index) => (
              <button
                key={command.id}
                type="button"
                role="option"
                aria-selected={index === activeCommandIndex}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectCommand(command)}
              >
                <strong>{command.label}</strong>
                <span>{command.description}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
