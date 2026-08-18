import { Database as DatabaseIcon, Folder, Tag } from "lucide-react";
import type { ReactNode } from "react";
import type { Database, DatabaseProperty } from "@/types/database";
import type { Folder as FolderType, NoteWithTags, Tag as TagType } from "@/types/note";
import type { WorkspaceMember } from "@/types/workspace";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TagChip } from "@/components/notes/TagChip";
import { decodeEscapedUnicode, normalizeDisplayIcon } from "@/lib/utils";

interface NotePropertiesProps {
  note: NoteWithTags;
  folders: FolderType[];
  allTags: TagType[];
  databases?: Database[];
  databaseProperties?: DatabaseProperty[];
  workspaceMembers?: WorkspaceMember[];
  tagName: string;
  tagLoading: boolean;
  onTagNameChange: (value: string) => void;
  onAssignFolder: (folderId: string | null) => void;
  onToggleTag: (tagId: string) => void;
  onCreateTag: () => void;
  onAssignDatabase?: (databaseId: string | null) => void;
  onUpdateDatabaseValue?: (
    payload: {
      property_id: string;
      value_text?: string | null;
      value_number?: number | null;
      value_boolean?: boolean | null;
      value_date?: string | null;
      value_json?: string[] | null;
    },
  ) => void;
}

function memberName(member: WorkspaceMember) {
  return member.display_name || member.email || member.user_id;
}

function PropertyRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-2 rounded-[12px] border border-border/60 px-3 py-2 text-sm">
      <span className="text-xs font-semibold text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

export function NoteProperties({
  note,
  folders,
  allTags,
  databases = [],
  databaseProperties = [],
  workspaceMembers = [],
  tagName,
  tagLoading,
  onTagNameChange,
  onAssignFolder,
  onToggleTag,
  onCreateTag,
  onAssignDatabase,
  onUpdateDatabaseValue,
}: NotePropertiesProps) {
  return (
    <div className="space-y-5 rounded-[14px] border border-border/70 bg-white/72 p-3 shadow-xs dark:bg-white/[0.04]">
      <section className="space-y-2">
        <div className="flex items-center gap-1.5 text-[12px] font-semibold text-foreground/75">
          <Folder className="h-3.5 w-3.5" />
          文件夹
        </div>
        <select
          value={note.folder_id ?? ""}
          onChange={(event) => onAssignFolder(event.target.value || null)}
          className="h-10 w-full rounded-[12px] border border-input bg-white/72 px-3 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/25 dark:bg-white/[0.05]"
        >
          <option value="">Inbox</option>
          {folders.map((folder) => (
            <option key={folder.id} value={folder.id}>
              {decodeEscapedUnicode(folder.name)}
            </option>
          ))}
        </select>
      </section>

      <section className="space-y-2">
        <div className="flex items-center gap-1.5 text-[12px] font-semibold text-foreground/75">
          <DatabaseIcon className="h-3.5 w-3.5" />
          数据库
        </div>
        <select
          value={note.database_id ?? ""}
          onChange={(event) => onAssignDatabase?.(event.target.value || null)}
          className="h-10 w-full rounded-[12px] border border-input bg-white/72 px-3 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/25 dark:bg-white/[0.05]"
        >
          <option value="">不属于任何数据库</option>
          {databases.map((database) => (
            <option key={database.id} value={database.id}>
              {normalizeDisplayIcon(database.icon) ? `${normalizeDisplayIcon(database.icon)} ` : ""}
              {decodeEscapedUnicode(database.name)}
            </option>
          ))}
        </select>
      </section>

      {note.database_id && databaseProperties.length > 0 ? (
        <section className="space-y-2">
          <div className="text-[12px] font-semibold text-foreground/75">数据库属性</div>
          <div className="space-y-2">
            {databaseProperties.map((property) => {
              const value = note.database_values?.[property.id];
              const optionList = Array.isArray(property.config.options) ? property.config.options : [];
              if (property.type === "title") return null;
              if (property.type === "checkbox") {
                return (
                  <PropertyRow key={property.id} label={property.name}>
                    <input
                      type="checkbox"
                      checked={Boolean(value?.value_boolean)}
                      onChange={(event) => onUpdateDatabaseValue?.({ property_id: property.id, value_boolean: event.target.checked })}
                      className="h-4 w-4"
                    />
                  </PropertyRow>
                );
              }
              if (property.type === "number") {
                return (
                  <PropertyRow key={property.id} label={property.name}>
                    <Input
                      type="number"
                      value={value?.value_number ?? ""}
                      onChange={(event) => onUpdateDatabaseValue?.({ property_id: property.id, value_number: event.target.value === "" ? null : Number(event.target.value) })}
                      className="h-9 rounded-[10px] bg-white/72 dark:bg-white/[0.05]"
                    />
                  </PropertyRow>
                );
              }
              if (property.type === "date") {
                return (
                  <PropertyRow key={property.id} label={property.name}>
                    <Input
                      type="date"
                      value={value?.value_date?.slice(0, 10) ?? ""}
                      onChange={(event) => onUpdateDatabaseValue?.({ property_id: property.id, value_date: event.target.value || null })}
                      className="h-9 rounded-[10px] bg-white/72 dark:bg-white/[0.05]"
                    />
                  </PropertyRow>
                );
              }
              if (property.type === "single_select") {
                return (
                  <PropertyRow key={property.id} label={property.name}>
                    <select
                      value={value?.value_json?.[0] ?? ""}
                      onChange={(event) => onUpdateDatabaseValue?.({ property_id: property.id, value_json: event.target.value ? [event.target.value] : [] })}
                      className="h-9 w-full rounded-[10px] border border-input bg-white/72 px-3 text-sm shadow-xs outline-none dark:bg-white/[0.05]"
                    >
                      <option value="">未设置</option>
                      {optionList.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.name}
                        </option>
                      ))}
                    </select>
                  </PropertyRow>
                );
              }
              if (property.type === "multi_select") {
                return (
                  <PropertyRow key={property.id} label={property.name}>
                    <select
                      multiple
                      value={value?.value_json ?? []}
                      onChange={(event) =>
                        onUpdateDatabaseValue?.({
                          property_id: property.id,
                          value_json: Array.from(event.target.selectedOptions).map((option) => option.value),
                        })
                      }
                      className="min-h-20 w-full rounded-[10px] border border-input bg-white/72 px-3 py-2 text-sm shadow-xs outline-none dark:bg-white/[0.05]"
                    >
                      {optionList.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.name}
                        </option>
                      ))}
                    </select>
                  </PropertyRow>
                );
              }
              if (property.type === "member") {
                const single = property.config.multi === false;
                return (
                  <PropertyRow key={property.id} label={property.name}>
                    <select
                      multiple={!single}
                      value={single ? value?.value_json?.[0] ?? "" : value?.value_json ?? []}
                      onChange={(event) =>
                        onUpdateDatabaseValue?.({
                          property_id: property.id,
                          value_json: single
                            ? event.currentTarget.value ? [event.currentTarget.value] : []
                            : Array.from(event.currentTarget.selectedOptions).map((option) => option.value),
                        })
                      }
                      className={`${single ? "h-9" : "min-h-20"} w-full rounded-[10px] border border-input bg-white/72 px-3 py-2 text-sm shadow-xs outline-none dark:bg-white/[0.05]`}
                    >
                      {single ? <option value="">未设置</option> : null}
                      {workspaceMembers.map((member) => (
                        <option key={member.user_id} value={member.user_id}>
                          {memberName(member)}
                        </option>
                      ))}
                    </select>
                  </PropertyRow>
                );
              }
              return (
                <PropertyRow key={property.id} label={property.name}>
                  <Input
                    value={value?.value_text ?? ""}
                    onChange={(event) => onUpdateDatabaseValue?.({ property_id: property.id, value_text: event.target.value })}
                    className="h-9 rounded-[10px] bg-white/72 dark:bg-white/[0.05]"
                  />
                </PropertyRow>
              );
            })}
          </div>
        </section>
      ) : null}

      <section className="space-y-2">
        <div className="flex items-center gap-1.5 text-[12px] font-semibold text-foreground/75">
          <Tag className="h-3.5 w-3.5" />
          标签
        </div>
        <div className="flex flex-wrap gap-1.5">
          {allTags.map((tag) => (
            <TagChip key={tag.id} tag={tag} active={note.tags.some((item) => item.id === tag.id)} onClick={() => onToggleTag(tag.id)} />
          ))}
        </div>
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <Input
            value={tagName}
            onChange={(event) => onTagNameChange(event.target.value)}
            placeholder="新建标签"
            className="h-10 rounded-[12px] bg-white/72 dark:bg-white/[0.05]"
          />
          <Button size="sm" className="rounded-[12px]" onClick={onCreateTag} disabled={tagLoading}>
            新增
          </Button>
        </div>
      </section>
    </div>
  );
}
