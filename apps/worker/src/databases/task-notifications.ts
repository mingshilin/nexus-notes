import type { DatabaseProperty, WorkspaceContext } from "@nexus/contracts";

export const TASK_NOTIFICATION_TYPES = {
  assigned: "task_assigned",
  statusChanged: "task_status_changed",
} as const;

type TaskNotificationEvent = "assignment" | "status_change";
type TaskProperty = Pick<DatabaseProperty, "id" | "name" | "type" | "config">;

export interface TaskDatabaseDescriptor {
  titlePropertyId: string;
  statusPropertyId: string;
  priorityPropertyId: string;
  assigneePropertyId: string;
  dueDatePropertyId: string;
  descriptionPropertyId: string;
}

export interface TaskRecordChange {
  id: string;
  revision: number;
  previousValues: Readonly<Record<string, unknown>>;
  nextValues: Readonly<Record<string, unknown>>;
  isCreate?: boolean;
}

export interface TaskNotificationIntent {
  notificationId: string;
  userId: string;
  type: (typeof TASK_NOTIFICATION_TYPES)[keyof typeof TASK_NOTIFICATION_TYPES];
  payloadJson: string;
  dedupeKey: string;
  deepLink: string;
}

export interface TaskNotificationStatementInput {
  context: Pick<WorkspaceContext, "workspaceId">;
  databaseId: string;
  properties: readonly TaskProperty[];
  records: readonly TaskRecordChange[];
  now: string;
  condition?: string;
  conditionBindings?: readonly unknown[];
}

export interface TaskNotificationWriter {
  prepare(input: TaskNotificationStatementInput): D1PreparedStatement[];
}

const MAX_TASK_NOTIFICATION_INTENTS = 500;

function memberIds(value: unknown) {
  const values = typeof value === "string"
    ? [value]
    : Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : [];
  return [...new Set(values.map((item) => item.trim()).filter(Boolean))].sort();
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

function valueChanged(left: unknown, right: unknown) {
  return stableJson(left ?? null) !== stableJson(right ?? null);
}

function configOf(property: TaskProperty) {
  return property.config && typeof property.config === "object" && !Array.isArray(property.config)
    ? property.config as Record<string, unknown>
    : {};
}

function selectOptionIds(property: TaskProperty) {
  const options = configOf(property).options;
  if (!Array.isArray(options)) return [];
  return options
    .map((option) => option && typeof option === "object" && typeof (option as { id?: unknown }).id === "string"
      ? (option as { id: string }).id
      : "")
    .filter(Boolean)
    .sort();
}

function hasExactOptions(property: TaskProperty, expected: readonly string[]) {
  return stableJson(selectOptionIds(property)) === stableJson([...expected].sort());
}

/** Identify the shipped task blueprint without treating arbitrary databases as task boards. */
export function detectTaskDatabase(properties: readonly TaskProperty[]): TaskDatabaseDescriptor | null {
  const title = properties.find((property) => property.name === "任务名称" && property.type === "text" && configOf(property).max_length === 500);
  const status = properties.find((property) => property.name === "状态" && property.type === "select" && hasExactOptions(property, ["todo", "in-progress", "done", "cancelled"]));
  const priority = properties.find((property) => property.name === "优先级" && property.type === "select" && hasExactOptions(property, ["low", "medium", "high"]));
  const assignee = properties.find((property) => property.name === "负责人" && property.type === "member" && configOf(property).allow_multiple === false);
  const dueDate = properties.find((property) => property.name === "截止日期" && property.type === "date");
  const description = properties.find((property) => property.name === "描述" && property.type === "text" && configOf(property).max_length === 20_000);
  if (!title || !status || !priority || !assignee || !dueDate || !description) return null;
  return {
    titlePropertyId: title.id,
    statusPropertyId: status.id,
    priorityPropertyId: priority.id,
    assigneePropertyId: assignee.id,
    dueDatePropertyId: dueDate.id,
    descriptionPropertyId: description.id,
  };
}

export function taskNotificationDedupeKey(
  databaseId: string,
  recordId: string,
  revision: number,
  event: TaskNotificationEvent,
  userId: string,
) {
  return `task:${databaseId}:record:${recordId}:revision:${revision}:${event === "assignment" ? "assigned" : "status_changed"}:${userId}`;
}

export function buildTaskNotificationIntents(
  input: {
    databaseId: string;
    properties: readonly TaskProperty[];
    records: readonly TaskRecordChange[];
    createId(): string;
  },
) {
  const task = detectTaskDatabase(input.properties);
  if (!task) return [];

  const intents: TaskNotificationIntent[] = [];
  const seen = new Set<string>();
  const records = [...input.records].sort((left, right) => left.id.localeCompare(right.id));
  const add = (record: TaskRecordChange, event: TaskNotificationEvent, userId: string) => {
    const dedupeKey = taskNotificationDedupeKey(input.databaseId, record.id, record.revision, event, userId);
    if (seen.has(dedupeKey) || intents.length >= MAX_TASK_NOTIFICATION_INTENTS) return;
    seen.add(dedupeKey);
    intents.push({
      notificationId: input.createId(),
      userId,
      type: event === "assignment" ? TASK_NOTIFICATION_TYPES.assigned : TASK_NOTIFICATION_TYPES.statusChanged,
      payloadJson: JSON.stringify({
        event,
        database_id: input.databaseId,
        record_id: record.id,
        revision: record.revision,
      }),
      dedupeKey,
      deepLink: `/databases/${encodeURIComponent(input.databaseId)}/records/${encodeURIComponent(record.id)}`,
    });
  };

  for (const record of records) {
    const previousAssignees = memberIds(record.previousValues[task.assigneePropertyId]);
    const nextAssignees = memberIds(record.nextValues[task.assigneePropertyId]);
    if (record.isCreate) {
      for (const userId of nextAssignees) add(record, "assignment", userId);
      continue;
    }
    if (valueChanged(previousAssignees, nextAssignees)) {
      for (const userId of nextAssignees) add(record, "assignment", userId);
    }
    if (valueChanged(record.previousValues[task.statusPropertyId], record.nextValues[task.statusPropertyId])) {
      for (const userId of nextAssignees) add(record, "status_change", userId);
    }
  }
  return intents;
}

export function prepareTaskNotificationStatements(
  db: D1Database,
  createId: () => string,
  input: TaskNotificationStatementInput,
) {
  const intents = buildTaskNotificationIntents({
    databaseId: input.databaseId,
    properties: input.properties,
    records: input.records,
    createId,
  });
  if (intents.length === 0) return [];
  const condition = input.condition ?? "1 = 1";
  const conditionBindings = input.conditionBindings ?? [];
  const serializedIntents = intents.map((intent) => ({
    notification_id: intent.notificationId,
    user_id: intent.userId,
    type: intent.type,
    payload_json: intent.payloadJson,
    dedupe_key: intent.dedupeKey,
    deep_link: intent.deepLink,
  }));
  return [db.prepare(
    `INSERT INTO notifications
     (id, workspace_id, user_id, type, payload_json, read_at, revision, created_at, dedupe_key, deep_link, updated_at)
     SELECT
       json_extract(intent.value, '$.notification_id'),
       ?,
       json_extract(intent.value, '$.user_id'),
       json_extract(intent.value, '$.type'),
       json_extract(intent.value, '$.payload_json'),
       NULL,
       1,
       ?,
       json_extract(intent.value, '$.dedupe_key'),
       json_extract(intent.value, '$.deep_link'),
       ?
     FROM json_each(?) AS intent
     WHERE EXISTS (
       SELECT 1 FROM workspace_members member
       JOIN users recipient ON recipient.id = member.user_id
       WHERE member.workspace_id = ?
         AND member.user_id = json_extract(intent.value, '$.user_id')
         AND recipient.status = 'active'
     ) AND ${condition}
     ON CONFLICT(workspace_id, user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`,
  ).bind(
    input.context.workspaceId,
    input.now,
    input.now,
    JSON.stringify(serializedIntents),
    input.context.workspaceId,
    ...conditionBindings,
  )];
}

export function createTaskNotificationWriter(db: D1Database, createId: () => string): TaskNotificationWriter {
  return {
    prepare: (input) => prepareTaskNotificationStatements(db, createId, input),
  };
}
