import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Brain, CalendarDays, Clipboard, Paperclip, Search, ShieldCheck, Sparkles } from "lucide-react";
import { cn, decodeEscapedUnicode } from "@/lib/utils";
import type { DatabasePermissionRole } from "@/types/database";
import type { WorkspaceMember } from "@/types/workspace";

export type KnowledgeTab = "overview" | "smart" | "collab" | "attachments" | "capture" | "calendar" | "ai";
export type WorkspaceRole = "owner" | "editor" | "viewer";
export type PermissionEntry = { subject_type: "workspace_role" | "member"; subject_id: string; role: DatabasePermissionRole };
export type FieldPermissionRow = { id: string; name: string; viewer_roles: WorkspaceRole[]; editor_roles: WorkspaceRole[] };
export type FeedLogWithKind = { id: string; action: string; entity_type: string; entity_id: string; created_at: string; feedKind: string };
export type SmartSearchHitSource = { label: string; excerpt: string };
export type SmartSearchResult = { kind: "note" | "attachment"; id: string; title: string; detail: string; noteId: string; hitSources: SmartSearchHitSource[] };
export type DuplicateTitleGroup = { title: string; notes: Array<{ id: string; title: string; content: string; updated_at: string; tags: Array<{ id: string }> }> };

export const tabs: Array<{ id: KnowledgeTab; label: string; icon: LucideIcon }> = [
  { id: "overview", label: "总览", icon: Brain },
  { id: "smart", label: "智能视图", icon: Search },
  { id: "collab", label: "协作安全", icon: ShieldCheck },
  { id: "attachments", label: "附件 OCR", icon: Paperclip },
  { id: "capture", label: "捕获导入", icon: Clipboard },
  { id: "calendar", label: "日历任务", icon: CalendarDays },
  { id: "ai", label: "AI 辅助", icon: Sparkles },
];

export const workspaceRoles: WorkspaceRole[] = ["owner", "editor", "viewer"];
export const databaseRoles: DatabasePermissionRole[] = ["viewer", "editor", "admin"];

export function displayText(value?: string | null, fallback = "未命名") {
  return decodeEscapedUnicode(value || fallback);
}

export function formatTime(value?: string | null) {
  if (!value) return "未知时间";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未知时间";
  return date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function formatDate(value?: string | null) {
  if (!value) return "未设置";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });
}

export function Card({ title, icon: Icon, actions, children }: { title: string; icon: LucideIcon; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-[22px] border border-border/70 bg-white/72 p-4 shadow-sm dark:bg-white/[0.04]">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Icon className="h-4 w-4 text-primary" />
          {title}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function EmptyLine({ children }: { children: ReactNode }) {
  return <p className="rounded-[14px] border border-dashed border-border/70 px-3 py-6 text-center text-sm text-muted-foreground">{children}</p>;
}

export function StatusPill({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "good" | "warn" | "bad" | "info" }) {
  const classes = {
    muted: "bg-muted text-muted-foreground",
    good: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
    warn: "bg-amber-500/14 text-amber-700 dark:text-amber-300",
    bad: "bg-red-500/12 text-red-700 dark:text-red-300",
    info: "bg-primary/12 text-primary",
  };
  return <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium", classes[tone])}>{children}</span>;
}

export function Highlight({ text, query }: { text: string; query: string }) {
  const cleanQuery = query.trim();
  if (!cleanQuery) return <>{text}</>;
  const index = text.toLowerCase().indexOf(cleanQuery.toLowerCase());
  if (index < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, index)}
      <mark className="rounded bg-yellow-200/80 px-0.5 text-yellow-950">{text.slice(index, index + cleanQuery.length)}</mark>
      {text.slice(index + cleanQuery.length)}
    </>
  );
}

export function memberLabel(member: WorkspaceMember) {
  return member.display_name || member.email || member.user_id;
}
