import { useEffect, useRef, useState } from "react";

export interface CommandAction {
  id: string;
  label: string;
  description: string;
  keywords?: readonly string[];
  shortcut?: string;
  onSelect(): void;
}

export interface CommandPaletteProps {
  open: boolean;
  query: string;
  actions: readonly CommandAction[];
  onQueryChange(query: string): void;
  onClose(): void;
}

export function CommandPalette({ open, query, actions, onQueryChange, onClose }: CommandPaletteProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const matchingActions = actions.filter((action) => {
    if (!normalizedQuery) return true;
    return [action.label, action.description, ...(action.keywords ?? [])]
      .join(" ")
      .toLocaleLowerCase()
      .includes(normalizedQuery);
  });

  useEffect(() => {
    if (open) inputRef.current?.focus();
    setActiveIndex(0);
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  if (!open) return null;

  const selectActive = () => {
    const action = matchingActions[activeIndex];
    if (action) action.onSelect();
  };

  return (
    <div className="command-palette-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="command-palette" role="dialog" aria-modal="true" aria-labelledby="command-palette-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className="command-palette-heading">
          <div>
            <p className="eyebrow">NEXUS COMMANDS</p>
            <h2 id="command-palette-title">快速操作</h2>
          </div>
          <kbd>Esc</kbd>
        </header>
        <label className="command-palette-search">
          <span className="sr-only">搜索命令</span>
          <input
            ref={inputRef}
            type="search"
            role="searchbox"
            aria-label="搜索命令"
            placeholder="搜索功能，例如：新建、数据库、设置"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                onClose();
              } else if (event.key === "ArrowDown") {
                event.preventDefault();
                setActiveIndex((index) => matchingActions.length ? (index + 1) % matchingActions.length : 0);
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setActiveIndex((index) => matchingActions.length ? (index - 1 + matchingActions.length) % matchingActions.length : 0);
              } else if (event.key === "Enter") {
                event.preventDefault();
                selectActive();
              }
            }}
          />
        </label>
        {matchingActions.length ? (
          <div className="command-palette-list" role="listbox" aria-label="可执行命令">
            {matchingActions.map((action, index) => (
              <button
                key={action.id}
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                className={index === activeIndex ? "active" : undefined}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={action.onSelect}
              >
                <span>
                  <strong>{action.label}</strong>
                  <small>{action.description}</small>
                </span>
                {action.shortcut ? <kbd>{action.shortcut}</kbd> : null}
              </button>
            ))}
          </div>
        ) : (
          <p className="command-palette-empty" role="status">没有匹配的功能。试试“新建笔记”或“设置”。</p>
        )}
      </section>
    </div>
  );
}
