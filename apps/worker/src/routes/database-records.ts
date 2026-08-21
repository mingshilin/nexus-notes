import {
  BoardMoveInputSchema,
  BulkEditRecordsInputSchema,
  CalendarAssignmentInputSchema,
  CreateDatabaseRecordInputSchema,
  CsvExportInputSchema,
  CsvImportInputSchema,
  DeleteDatabaseRecordInputSchema,
  UpdateDatabaseRecordInputSchema,
} from "@nexus/contracts";

import { type DatabaseRegistry, type DatabaseRepositoryFactory, recordListOptions, recordSearchOptions } from "./database-route-types";

// A 2 MiB UTF-8 CSV may expand up to sixfold when encoded as a JSON string.
const CSV_IMPORT_JSON_BODY_LIMIT = 12 * 1024 * 1024 + 16 * 1024;

export function registerDatabaseRecordRoutes<TEnv>(
  registry: DatabaseRegistry<TEnv>,
  createRepository: DatabaseRepositoryFactory<TEnv>,
) {
  registry.register({
    method: "GET", path: "/api/v2/databases/:databaseId/records", auth: "workspace",
    handler: async ({ request, env, workspace, params }) => ({
      data: await createRepository(env).listRecords(workspace!, params.databaseId!, recordListOptions(request)),
    }),
  });
  registry.register({
    method: "GET", path: "/api/v2/databases/:databaseId/records/search", auth: "workspace",
    handler: async ({ request, env, workspace, params }) => ({
      data: await createRepository(env).searchRecords(workspace!, params.databaseId!, recordSearchOptions(request)),
    }),
  });
  registry.register({
    method: "POST", path: "/api/v2/databases/:databaseId/records", auth: "workspace", body: CreateDatabaseRecordInputSchema,
    handler: async ({ env, workspace, params, body }) => ({
      status: 201,
      data: { record: await createRepository(env).createRecord(workspace!, params.databaseId!, body) },
    }),
  });
  registry.register({
    method: "GET", path: "/api/v2/databases/:databaseId/records/:recordId", auth: "workspace",
    handler: async ({ env, workspace, params }) => ({
      data: { record: await createRepository(env).getRecord(workspace!, params.databaseId!, params.recordId!) },
    }),
  });
  registry.register({
    method: "PATCH", path: "/api/v2/databases/:databaseId/records/:recordId", auth: "workspace", body: UpdateDatabaseRecordInputSchema,
    handler: async ({ env, workspace, params, body }) => ({
      data: { record: await createRepository(env).updateRecord(workspace!, params.databaseId!, params.recordId!, body) },
    }),
  });
  registry.register({
    method: "DELETE", path: "/api/v2/databases/:databaseId/records/:recordId", auth: "workspace", body: DeleteDatabaseRecordInputSchema,
    handler: async ({ env, workspace, params, body }) => ({
      data: await createRepository(env).deleteRecord(workspace!, params.databaseId!, params.recordId!, body),
    }),
  });
  registry.register({
    method: "POST", path: "/api/v2/databases/:databaseId/records/bulk", auth: "workspace", body: BulkEditRecordsInputSchema,
    handler: async ({ env, workspace, params, body }) => ({
      data: await createRepository(env).bulkEditRecords(workspace!, params.databaseId!, body),
    }),
  });
  registry.register({
    method: "POST", path: "/api/v2/databases/:databaseId/board-move", auth: "workspace", body: BoardMoveInputSchema,
    handler: async ({ env, workspace, params, body }) => ({
      data: { record: await createRepository(env).boardMove(workspace!, params.databaseId!, body) },
    }),
  });
  registry.register({
    method: "POST", path: "/api/v2/databases/:databaseId/calendar-assign", auth: "workspace", body: CalendarAssignmentInputSchema,
    handler: async ({ env, workspace, params, body }) => ({
      data: { record: await createRepository(env).calendarAssign(workspace!, params.databaseId!, body) },
    }),
  });
  registry.register({
    method: "POST", path: "/api/v2/databases/:databaseId/import/csv", auth: "workspace", body: CsvImportInputSchema,
    bodyLimitBytes: CSV_IMPORT_JSON_BODY_LIMIT,
    timeoutMs: 30_000,
    handler: async ({ env, workspace, params, body }) => ({
      status: 201,
      data: await createRepository(env).importCsv(workspace!, params.databaseId!, body),
    }),
  });
  registry.register({
    method: "POST", path: "/api/v2/databases/:databaseId/export/csv", auth: "workspace", body: CsvExportInputSchema,
    handler: async ({ env, workspace, params, body }) => ({
      data: await createRepository(env).exportCsv(workspace!, params.databaseId!, body),
    }),
  });
}
