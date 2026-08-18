import { useEffect, useRef, useState, type ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface MoreMenuProps {
  triggerLabel?: string;
  children: ReactNode;
  trigger?: ReactNode;
  menuClassName?: string;
  align?: "left" | "right";
}

export function MoreMenu({
  triggerLabel = "更多操作",
  children,
  trigger,
  menuClassName,
  align = "right",
}: MoreMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      {trigger ? (
        <div
          className="contents"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-label={triggerLabel}
        >
          {trigger}
        </div>
      ) : (
        <Button
          size="icon"
          variant="ghost"
          className={cn("rounded-xl", open && "bg-[#007aff]/10 text-[#007aff]")}
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-label={triggerLabel}
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      )}
      {open ? (
        <div
          className={cn(
            "mac-glass absolute top-11 z-40 w-64 rounded-[18px] p-1.5 shadow-lg",
            align === "right" ? "right-0" : "left-0",
            menuClassName,
          )}
        >
          <div
            className="scrollbar-subtle max-h-[min(70dvh,32rem)] space-y-1 overflow-y-auto"
            onClick={(event) => {
              const target = event.target as HTMLElement;
              if (target.closest("[data-keep-open='true']")) return;
              setOpen(false);
            }}
          >
            {children}
          </div>
        </div>
      ) : null}
    </div>
  );
}
