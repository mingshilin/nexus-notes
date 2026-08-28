import type {
  CreateDatabasePropertyInput,
  CreateDatabaseViewInput,
  Database,
  DatabaseProperty,
  DatabaseTemplate,
  DatabaseView,
} from "@nexus/contracts";
import type { DatabaseClient } from "../data/database-client";

export interface TaskDatabaseSetup {
  database: Database;
  properties: DatabaseProperty[];
  views: DatabaseView[];
  template: DatabaseTemplate;
}

type TaskDatabaseClient = Pick<DatabaseClient, "createDatabase" | "createProperty" | "createView" | "createTemplate" | "deleteDatabase">;

const statusOptions = [
  { id: "todo", name: "待处理", color: "" },
  { id: "in-progress", name: "进行中", color: "" },
  { id: "done", name: "已完成", color: "" },
  { id: "cancelled", name: "已取消", color: "" },
] as const;

const priorityOptions = [
  { id: "low", name: "低", color: "" },
  { id: "medium", name: "中", color: "" },
  { id: "high", name: "高", color: "" },
] as const;

function propertyDefinitions(): CreateDatabasePropertyInput[] {
  return [
    { name: "任务名称", type: "text", config: { max_length: 500 }, position: 0, hidden: false, read_only: false },
    { name: "状态", type: "select", config: { options: [...statusOptions] }, position: 1, hidden: false, read_only: false },
    { name: "优先级", type: "select", config: { options: [...priorityOptions] }, position: 2, hidden: false, read_only: false },
    { name: "负责人", type: "member", config: { allow_multiple: false }, position: 3, hidden: false, read_only: false },
    { name: "截止日期", type: "date", config: {}, position: 4, hidden: false, read_only: false },
    { name: "描述", type: "text", config: { max_length: 20_000 }, position: 5, hidden: false, read_only: false },
  ];
}

function viewConfig(propertyIds: Record<string, string>, type: DatabaseView["type"]): CreateDatabaseViewInput["config"] {
  const visibleColumns = Object.values(propertyIds);
  return {
    filters: [],
    sorts: [{ property_id: propertyIds.priority, direction: "desc" }, { property_id: propertyIds.dueDate, direction: "asc" }],
    grouping: type === "board" ? { property_id: propertyIds.status } : null,
    visible_columns: visibleColumns,
    page_size: 50,
    settings: type === "calendar"
      ? { date_property_id: propertyIds.dueDate, show_undated: true, week_start: "monday" }
      : { row_height: "default", card_properties: [propertyIds.priority, propertyIds.assignee, propertyIds.dueDate] },
  };
}

export async function createTaskDatabase(client: TaskDatabaseClient, requestedName = "任务管理") {
  const name = requestedName.trim();
  if (!name) throw new Error("任务数据库名称不能为空");
  const database = await client.createDatabase({
    name,
    description: "团队任务：状态、优先级、负责人、截止日期和关联笔记。",
  });

  try {
    const createdProperties: DatabaseProperty[] = [];
    for (const definition of propertyDefinitions()) {
      createdProperties.push(await client.createProperty(database.id, definition));
    }
    const propertyIds = {
      title: createdProperties[0]!.id,
      status: createdProperties[1]!.id,
      priority: createdProperties[2]!.id,
      assignee: createdProperties[3]!.id,
      dueDate: createdProperties[4]!.id,
      description: createdProperties[5]!.id,
    };
    const createdViews: DatabaseView[] = [];
    for (const [position, definition] of ([
      ["任务列表", "table"],
      ["按状态看板", "board"],
      ["截止日期日历", "calendar"],
    ] as const).entries()) {
      const [viewName, type] = definition;
      createdViews.push(await client.createView(database.id, {
        name: viewName,
        type,
        position,
        config: viewConfig(propertyIds, type),
      }));
    }
    const template = await client.createTemplate(database.id, {
      name: "新任务",
      default_values: {
        [propertyIds.status]: "todo",
        [propertyIds.priority]: "medium",
      },
    });
    return { database, properties: createdProperties, views: createdViews, template } satisfies TaskDatabaseSetup;
  } catch (error) {
    // The database is still empty when setup fails; remove it so users do not get a partial template.
    try {
      await client.deleteDatabase(database.id, { base_revision: database.revision });
    } catch {
      // Preserve the setup error. The caller can surface the database ID for manual cleanup if needed.
    }
    throw error;
  }
}
