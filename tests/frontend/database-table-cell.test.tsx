import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DatabaseTableCell } from "@/components/database/DatabaseTableCell";
import type { DatabaseProperty } from "@/types/database";

const baseProperty = {
  id: "prop-1",
  database_id: "db-1",
  name: "Property",
  config: {},
  sort_order: 1,
  created_at: "x",
  updated_at: "x",
} satisfies Omit<DatabaseProperty, "type">;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("DatabaseTableCell", () => {
  it("commits number values inline", () => {
    const onCommit = vi.fn();
    render(
      <DatabaseTableCell
        property={{ ...baseProperty, type: "number" }}
        value={{ property_id: "prop-1", type: "number", value_number: 3 }}
        workspaceMembers={[]}
        onCommit={onCommit}
      />,
    );

    fireEvent.change(screen.getByDisplayValue("3"), { target: { value: "5" } });

    expect(onCommit).toHaveBeenCalledWith({ property_id: "prop-1", value_number: 5 });
  });

  it("commits single select option changes", () => {
    const onCommit = vi.fn();
    render(
      <DatabaseTableCell
        property={{
          ...baseProperty,
          type: "single_select",
          config: { options: [{ id: "todo", name: "Todo", color: "#6B9EFF" }] },
        }}
        value={{ property_id: "prop-1", type: "single_select", value_json: [] }}
        workspaceMembers={[]}
        onCommit={onCommit}
      />,
    );

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "todo" } });

    expect(onCommit).toHaveBeenCalledWith({ property_id: "prop-1", value_json: ["todo"] });
  });

  it("limits single-member properties to one selected member", () => {
    const onCommit = vi.fn();
    render(
      <DatabaseTableCell
        property={{ ...baseProperty, type: "member", config: { multi: false } }}
        value={{ property_id: "prop-1", type: "member", value_json: [] }}
        workspaceMembers={[{
          id: "member-1",
          workspace_id: "ws-1",
          user_id: "u1",
          role: "editor",
          created_at: "x",
          updated_at: "x",
          email: "member@example.com",
          display_name: "Member",
          avatar_url: null,
        }]}
        onCommit={onCommit}
      />,
    );

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "u1" } });

    expect(onCommit).toHaveBeenCalledWith({ property_id: "prop-1", value_json: ["u1"] });
  });
});
