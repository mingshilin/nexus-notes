import { describe, expect, it, vi } from "vitest";
import { createTaskDatabase } from "../src/databases/task-database";

function client() {
  let propertyNumber = 0;
  let viewNumber = 0;
  return {
    createDatabase: vi.fn(async (input: { name: string; description: string }) => ({
      id: "task-db",
      workspace_id: "ws-1",
      name: input.name,
      description: input.description,
      created_by: "user-1",
      revision: 1,
      created_at: "2026-08-28T00:00:00.000Z",
      updated_at: "2026-08-28T00:00:00.000Z",
    })),
    createProperty: vi.fn(async (_databaseId: string, input: { name: string; type: string; config: unknown; position: number; hidden: boolean; read_only: boolean }) => ({
      id: `property-${++propertyNumber}`,
      workspace_id: "ws-1",
      database_id: "task-db",
      ...input,
      revision: 1,
      created_at: "2026-08-28T00:00:00.000Z",
      updated_at: "2026-08-28T00:00:00.000Z",
    })),
    createView: vi.fn(async (_databaseId: string, input: { name: string; type: string; config: unknown; position: number }) => ({
      id: `view-${++viewNumber}`,
      workspace_id: "ws-1",
      database_id: "task-db",
      ...input,
      revision: 1,
      created_at: "2026-08-28T00:00:00.000Z",
      updated_at: "2026-08-28T00:00:00.000Z",
    })),
    createTemplate: vi.fn(async (_databaseId: string, input: { name: string; default_values: Record<string, unknown> }) => ({
      id: "template-1",
      workspace_id: "ws-1",
      database_id: "task-db",
      ...input,
      revision: 1,
      created_at: "2026-08-28T00:00:00.000Z",
      updated_at: "2026-08-28T00:00:00.000Z",
    })),
    deleteDatabase: vi.fn(async () => ({ id: "task-db" })),
  };
}

describe("createTaskDatabase", () => {
  it("creates typed task properties, three views, and a usable default template", async () => {
    const api = client();
    const result = await createTaskDatabase(api as never, "团队任务");

    expect(result.database.name).toBe("团队任务");
    expect(api.createProperty).toHaveBeenCalledTimes(6);
    expect(api.createProperty.mock.calls.map(([, input]) => input.name)).toEqual([
      "任务名称", "状态", "优先级", "负责人", "截止日期", "描述",
    ]);
    expect(api.createProperty.mock.calls.map(([, input]) => input.type)).toEqual([
      "text", "select", "select", "member", "date", "text",
    ]);
    expect(api.createView).toHaveBeenCalledTimes(3);
    expect(api.createView.mock.calls.map(([, input]) => input.type)).toEqual(["table", "board", "calendar"]);
    const templateInput = api.createTemplate.mock.calls[0]![1] as { default_values: Record<string, unknown> };
    expect(templateInput.default_values).toMatchObject({
      "property-2": "todo",
      "property-3": "medium",
    });
    expect(api.deleteDatabase).not.toHaveBeenCalled();
  });

  it("cleans up the newly created database if blueprint setup fails", async () => {
    const api = client();
    api.createView.mockRejectedValueOnce(new Error("view failed"));

    await expect(createTaskDatabase(api as never, "不完整任务库")).rejects.toThrow("view failed");
    expect(api.deleteDatabase).toHaveBeenCalledWith("task-db", { base_revision: 1 });
  });
});
