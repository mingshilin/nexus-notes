import type { DatabaseNoteValue, DatabaseProperty, SelectOption, UpdateDatabaseNoteValuesPayload } from "@/types/database";
import type { WorkspaceMember } from "@/types/workspace";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type DatabaseValuePayload = UpdateDatabaseNoteValuesPayload["values"][number];

interface DatabaseTableCellProps {
  property: DatabaseProperty;
  value: DatabaseNoteValue | null;
  workspaceMembers: WorkspaceMember[];
  onCommit: (payload: DatabaseValuePayload) => void;
}

function getOptions(property: DatabaseProperty): SelectOption[] {
  return Array.isArray(property.config.options) ? property.config.options : [];
}

function getMemberName(member: WorkspaceMember) {
  return member.display_name || member.email || member.user_id;
}

function normalizeDateInput(value: string | null | undefined) {
  return value ? value.slice(0, 10) : "";
}

export function DatabaseTableCell({ property, value, workspaceMembers, onCommit }: DatabaseTableCellProps) {
  const options = getOptions(property);
  const valueJson = value?.value_json ?? [];

  if (property.type === "checkbox") {
    return (
      <input
        type="checkbox"
        checked={Boolean(value?.value_boolean)}
        onChange={(event) => onCommit({ property_id: property.id, value_boolean: event.target.checked })}
        className="h-4 w-4"
      />
    );
  }

  if (property.type === "number" || property.type === "rating" || property.type === "progress") {
    return (
      <Input
        type="number"
        value={value?.value_number ?? ""}
        onChange={(event) =>
          onCommit({
            property_id: property.id,
            value_number: event.target.value === "" ? null : Number(event.target.value),
          })
        }
        className="h-9 min-w-[120px] rounded-[10px]"
        min={property.type === "rating" ? 0 : property.type === "progress" ? 0 : undefined}
        max={property.type === "rating" ? 5 : property.type === "progress" ? 100 : undefined}
        step={property.type === "progress" ? 5 : 1}
      />
    );
  }

  if (property.type === "date") {
    return (
      <Input
        type="date"
        value={normalizeDateInput(value?.value_date)}
        onChange={(event) => onCommit({ property_id: property.id, value_date: event.target.value || null })}
        className="h-9 min-w-[140px] rounded-[10px]"
      />
    );
  }

  if (property.type === "url" || property.type === "email" || property.type === "phone") {
    return (
      <Input
        type={property.type === "url" ? "url" : property.type === "email" ? "email" : "tel"}
        value={value?.value_text ?? ""}
        onChange={(event) => onCommit({ property_id: property.id, value_text: event.target.value })}
        className="h-9 min-w-[180px] rounded-[10px]"
      />
    );
  }

  if (property.type === "single_select") {
    return (
      <select
        value={valueJson[0] ?? ""}
        onChange={(event) => onCommit({ property_id: property.id, value_json: event.target.value ? [event.target.value] : [] })}
        className="h-9 min-w-[140px] rounded-[10px] border border-input bg-background/80 px-2 text-sm outline-none"
      >
        <option value="">未设置</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </select>
    );
  }

  if (property.type === "multi_select" || property.type === "member") {
    const selectOptions =
      property.type === "member"
        ? workspaceMembers.map((member) => ({ id: member.user_id, name: getMemberName(member) }))
        : options.map((option) => ({ id: option.id, name: option.name }));
    const isSingleMember = property.type === "member" && property.config.multi === false;

    return (
      <select
        multiple={!isSingleMember}
        value={isSingleMember ? valueJson[0] ?? "" : valueJson}
        onChange={(event) => {
          const next = isSingleMember
            ? event.currentTarget.value ? [event.currentTarget.value] : []
            : Array.from(event.currentTarget.selectedOptions).map((option) => option.value);
          onCommit({ property_id: property.id, value_json: next });
        }}
        className={cn(
          "min-w-[150px] rounded-[10px] border border-input bg-background/80 px-2 text-sm outline-none",
          isSingleMember ? "h-9" : "min-h-20 py-1",
        )}
      >
        {isSingleMember ? <option value="">未设置</option> : null}
        {selectOptions.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </select>
    );
  }

  return (
    <Input
      value={value?.value_text ?? ""}
      onChange={(event) => onCommit({ property_id: property.id, value_text: event.target.value })}
      className="h-9 min-w-[160px] rounded-[10px]"
    />
  );
}
