import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Database } from "@nexus/contracts";

import { DatabaseContextPanel } from "../src/app/DatabaseContextPanel";

const database: Database = {
  id: "db-1",
  workspace_id: "ws-1",
  name: "Projects",
  description: "Delivery",
  created_by: "user-1",
  revision: 1,
  created_at: "2026-08-31T00:00:00.000Z",
  updated_at: "2026-08-31T00:00:00.000Z",
};

describe("DatabaseContextPanel", () => {
  it("preserves database selection and inline creation callbacks", () => {
    const onCreateRequest = vi.fn();
    const onCreateOpenChange = vi.fn();
    const onNameChange = vi.fn();
    const onCreate = vi.fn();
    const onSelect = vi.fn();
    render(<DatabaseContextPanel
      databases={[database]}
      selectedDatabaseId={null}
      loading={false}
      error={null}
      createOpen
      name="Roadmap"
      creating={false}
      onCreateRequest={onCreateRequest}
      onCreateOpenChange={onCreateOpenChange}
      onNameChange={onNameChange}
      onCreate={onCreate}
      onSelect={onSelect}
    />);

    fireEvent.click(screen.getByRole("button", { name: "新建数据库" }));
    fireEvent.change(screen.getByRole("textbox", { name: "新建数据库名称" }), { target: { value: "Next" } });
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    fireEvent.submit(screen.getByRole("form", { name: "新建数据库表单" }));
    fireEvent.click(screen.getByRole("button", { name: /Projects/ }));

    expect(onCreateRequest).toHaveBeenCalledOnce();
    expect(onNameChange).toHaveBeenCalledWith("Next");
    expect(onCreateOpenChange).toHaveBeenCalledWith(false);
    expect(onCreate).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledWith(database);
  });

  it("preserves loading, error, empty, and pending states", () => {
    const { rerender } = render(<DatabaseContextPanel
      databases={[]}
      selectedDatabaseId={null}
      loading
      error="数据库失败"
      createOpen={false}
      name=""
      creating={false}
      onCreateRequest={vi.fn()}
      onCreateOpenChange={vi.fn()}
      onNameChange={vi.fn()}
      onCreate={vi.fn()}
      onSelect={vi.fn()}
    />);

    expect(screen.getByText("正在加载数据库…")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("数据库失败");

    rerender(<DatabaseContextPanel
      databases={[]}
      selectedDatabaseId={null}
      loading={false}
      error={null}
      createOpen={false}
      name=""
      creating={false}
      onCreateRequest={vi.fn()}
      onCreateOpenChange={vi.fn()}
      onNameChange={vi.fn()}
      onCreate={vi.fn()}
      onSelect={vi.fn()}
    />);
    expect(screen.getByText("尚未创建数据库。")).toBeInTheDocument();
  });
});
