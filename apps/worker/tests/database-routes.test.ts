import { describe, expect, it, vi } from "vitest";

const workspace = {
  workspaceId: "ws-1",
  userId: "user-1",
  role: "editor",
  capabilities: new Set<string>(),
};

function request(path: string, method = "GET", body?: unknown) {
  const headers = new Headers({ "x-workspace-id": "ws-1" });
  if (body !== undefined) headers.set("content-type", "application/json");
  return new Request(`https://beta.test${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function repositoryDouble() {
  const entity = { id: "entity-1", revision: 1 };
  return {
    listDatabases: vi.fn(async () => []),
    createDatabase: vi.fn(async () => entity),
    getDatabase: vi.fn(async () => ({ database: entity, properties: [], views: [], templates: [], role: "editor" })),
    updateDatabase: vi.fn(async () => ({ ...entity, revision: 2 })),
    deleteDatabase: vi.fn(async () => ({ id: entity.id })),
    createProperty: vi.fn(async () => entity), updateProperty: vi.fn(async () => entity), deleteProperty: vi.fn(async () => ({ id: entity.id })),
    listRecords: vi.fn(async () => ({ items: [], next_cursor: null })),
    searchRecords: vi.fn(async () => ({ items: [], next_cursor: null })),
    createRecord: vi.fn(async () => entity), getRecord: vi.fn(async () => entity), updateRecord: vi.fn(async () => entity), deleteRecord: vi.fn(async () => ({ id: entity.id })),
    bulkEditRecords: vi.fn(async () => ({ items: [entity] })), boardMove: vi.fn(async () => entity), calendarAssign: vi.fn(async () => entity),
    createView: vi.fn(async () => entity), updateView: vi.fn(async () => entity), deleteView: vi.fn(async () => ({ id: entity.id })),
    createTemplate: vi.fn(async () => entity), updateTemplate: vi.fn(async () => entity), deleteTemplate: vi.fn(async () => ({ id: entity.id })), applyTemplate: vi.fn(async () => ({ items: [entity] })),
    listComments: vi.fn(async () => []), createComment: vi.fn(async () => entity), updateComment: vi.fn(async () => entity), deleteComment: vi.fn(async () => ({ id: entity.id })),
    setDatabasePermission: vi.fn(async () => entity), setFieldPermission: vi.fn(async () => entity),
    listDatabasePermissions: vi.fn(async () => [entity]), listFieldPermissions: vi.fn(async () => [entity]),
    deleteDatabasePermission: vi.fn(async () => ({ id: entity.id })), deleteFieldPermission: vi.fn(async () => ({ id: entity.id })),
    importCsv: vi.fn(async () => ({ items: [entity], imported_count: 1 })), exportCsv: vi.fn(async () => ({ csv: "Name\r\nOne", next_cursor: null })),
  };
}

const viewConfig = { filters: [], sorts: [], grouping: null, visible_columns: [], page_size: 50, settings: {} };

describe("v2 structured database routes", () => {
  it("registers all CRUD, permission, atomic mutation, search, and CSV endpoints", async () => {
    const worker = await import("../src/index") as Record<string, any>;
    expect(worker.registerDatabaseRoutes).toBeTypeOf("function");
    const repository = repositoryDouble();
    const registry = worker.createRouteRegistry({
      requestId: () => "req-db",
      authenticate: vi.fn(async () => ({ userId: "user-1" })),
      authorizeWorkspace: vi.fn(async () => workspace),
    });
    worker.registerDatabaseRoutes(registry, () => repository);

    const cases: Array<[string, string, unknown?]> = [
      ["GET", "/api/v2/databases"],
      ["POST", "/api/v2/databases", { name: "Projects", description: "" }],
      ["GET", "/api/v2/databases/db-1"],
      ["PATCH", "/api/v2/databases/db-1", { base_revision: 1, name: "Roadmap" }],
      ["DELETE", "/api/v2/databases/db-1", { base_revision: 1 }],
      ["POST", "/api/v2/databases/db-1/properties", { name: "Name", type: "text", config: {}, position: 0 }],
      ["PATCH", "/api/v2/databases/db-1/properties/prop-1", { base_revision: 1, name: "Title" }],
      ["DELETE", "/api/v2/databases/db-1/properties/prop-1", { base_revision: 1 }],
      ["GET", "/api/v2/databases/db-1/records?cursor=next&view_id=view-1&limit=25"],
      ["GET", "/api/v2/databases/db-1/records/search?q=alpha&limit=20"],
      ["POST", "/api/v2/databases/db-1/records", { note_id: null, values: {} }],
      ["GET", "/api/v2/databases/db-1/records/record-1"],
      ["PATCH", "/api/v2/databases/db-1/records/record-1", { base_revision: 1, values: { "prop-1": "Two" } }],
      ["DELETE", "/api/v2/databases/db-1/records/record-1", { base_revision: 1 }],
      ["POST", "/api/v2/databases/db-1/records/bulk", { mutations: [{ record_id: "record-1", base_revision: 1, values: { "prop-1": "Two" } }] }],
      ["POST", "/api/v2/databases/db-1/board-move", { record_id: "record-1", property_id: "prop-1", option_id: "done", base_revision: 1 }],
      ["POST", "/api/v2/databases/db-1/calendar-assign", { record_id: "record-1", property_id: "due", date: null, base_revision: 1 }],
      ["POST", "/api/v2/databases/db-1/views", { name: "All", type: "table", config: viewConfig, position: 0 }],
      ["PATCH", "/api/v2/databases/db-1/views/view-1", { base_revision: 1, config: viewConfig }],
      ["DELETE", "/api/v2/databases/db-1/views/view-1", { base_revision: 1 }],
      ["POST", "/api/v2/databases/db-1/templates", { name: "Default", default_values: {} }],
      ["PATCH", "/api/v2/databases/db-1/templates/template-1", { base_revision: 1, name: "Starter" }],
      ["DELETE", "/api/v2/databases/db-1/templates/template-1", { base_revision: 1 }],
      ["POST", "/api/v2/databases/db-1/templates/apply", { template_id: "template-1", records: [{ record_id: "record-1", base_revision: 1 }] }],
      ["GET", "/api/v2/databases/db-1/records/record-1/comments"],
      ["POST", "/api/v2/databases/db-1/records/record-1/comments", { record_id: "record-1", body: "Review" }],
      ["PATCH", "/api/v2/databases/db-1/comments/comment-1", { base_revision: 1, body: "Resolved" }],
      ["DELETE", "/api/v2/databases/db-1/comments/comment-1", { base_revision: 1 }],
      ["PUT", "/api/v2/databases/db-1/permissions", { subject_type: "user", subject_id: "user-2", role: "viewer", base_revision: 1 }],
      ["GET", "/api/v2/databases/db-1/permissions"],
      ["DELETE", "/api/v2/databases/db-1/permissions/permission-1", { base_revision: 1 }],
      ["PUT", "/api/v2/databases/db-1/properties/prop-1/permissions", { subject_type: "role", subject_id: "viewer", can_read: true, can_write: false, base_revision: 1 }],
      ["GET", "/api/v2/databases/db-1/properties/prop-1/permissions"],
      ["DELETE", "/api/v2/databases/db-1/properties/prop-1/permissions/permission-1", { base_revision: 1 }],
      ["POST", "/api/v2/databases/db-1/import/csv", { csv: "Name\r\nOne", header_property_ids: { Name: "prop-1" } }],
      ["POST", "/api/v2/databases/db-1/export/csv", { property_ids: ["prop-1"], cursor: null, page_size: 100 }],
    ];
    const responses = await Promise.all(cases.map(([method, path, body]) => registry.fetch(request(path, method, body), {})));

    expect(responses.every((response: Response) => response.status >= 200 && response.status < 300)).toBe(true);
    const mutationMethods = [
      "createDatabase", "updateDatabase", "deleteDatabase", "createProperty", "updateProperty", "deleteProperty",
      "createRecord", "updateRecord", "deleteRecord", "bulkEditRecords", "boardMove", "calendarAssign",
      "createView", "updateView", "deleteView", "createTemplate", "updateTemplate", "deleteTemplate", "applyTemplate",
      "createComment", "updateComment", "deleteComment", "setDatabasePermission", "deleteDatabasePermission",
      "setFieldPermission", "deleteFieldPermission", "importCsv",
    ];
    for (const method of mutationMethods) {
      const mutation = repository[method as keyof typeof repository] as ReturnType<typeof vi.fn>;
      expect(mutation).toHaveBeenCalled();
      expect(mutation.mock.calls[0]?.[0]).toEqual({ ...workspace, requestId: "req-db" });
    }
    expect(repository.listRecords).toHaveBeenCalledWith(workspace, "db-1", { cursor: "next", view_id: "view-1", limit: 25 });
    expect(repository.searchRecords).toHaveBeenCalledWith(workspace, "db-1", { query: "alpha", cursor: null, limit: 20 });
    expect(repository.createComment).toHaveBeenCalledWith(
      { ...workspace, requestId: "req-db" }, "db-1", { record_id: "record-1", body: "Review" },
    );
    expect(repository.listDatabasePermissions).toHaveBeenCalledWith(workspace, "db-1");
    expect(repository.deleteFieldPermission).toHaveBeenCalledWith(
      { ...workspace, requestId: "req-db" }, "db-1", "prop-1", "permission-1", { base_revision: 1 },
    );
    const databasePermissionsResponse = await responses[cases.findIndex(([method, path]) => method === "GET" && path === "/api/v2/databases/db-1/permissions")]!.json();
    const fieldPermissionsResponse = await responses[cases.findIndex(([method, path]) => method === "GET" && path === "/api/v2/databases/db-1/properties/prop-1/permissions")]!.json();
    const permission = { id: "entity-1", revision: 1 };
    expect(databasePermissionsResponse).toEqual({ success: true, data: { items: [permission] }, request_id: "req-db" });
    expect(fieldPermissionsResponse).toEqual({ success: true, data: { items: [permission] }, request_id: "req-db" });
  });

  it("rejects unknown body keys before repository calls and requires workspace auth", async () => {
    const worker = await import("../src/index") as Record<string, any>;
    const repository = repositoryDouble();
    const registry = worker.createRouteRegistry({
      requestId: () => "req-invalid",
      authenticate: vi.fn(async () => ({ userId: "user-1" })),
      authorizeWorkspace: vi.fn(async () => workspace),
    });
    worker.registerDatabaseRoutes(registry, () => repository);

    const invalid = await registry.fetch(request("/api/v2/databases", "POST", { name: "Projects", surprise: true }), {});
    expect(invalid.status).toBe(400);
    expect(repository.createDatabase).not.toHaveBeenCalled();

    const noWorkspace = await registry.fetch(new Request("https://beta.test/api/v2/databases"), {});
    expect(noWorkspace.status).toBe(400);
  });

  it("accepts the advertised CSV payload through the route-specific JSON body boundary", async () => {
    const worker = await import("../src/index") as Record<string, any>;
    const repository = repositoryDouble();
    const registry = worker.createRouteRegistry({
      requestId: () => "req-csv-limit",
      authenticate: vi.fn(async () => ({ userId: "user-1" })),
      authorizeWorkspace: vi.fn(async () => workspace),
    });
    worker.registerDatabaseRoutes(registry, () => repository);
    const csv = `Name\r\n${"x".repeat(1024 * 1024 + 128)}`;

    const response = await registry.fetch(request("/api/v2/databases/db-1/import/csv", "POST", {
      csv, header_property_ids: { Name: "prop-1" },
    }), {});

    expect(response.status).toBe(201);
    expect(repository.importCsv).toHaveBeenCalledWith(
      { ...workspace, requestId: "req-csv-limit" }, "db-1", expect.objectContaining({ csv }),
    );
  });

  it("wires database routes into the default Beta worker", async () => {
    const worker = await import("../src/index") as Record<string, any>;
    const betaWorker = worker.createBetaWorker();
    const response = await betaWorker.fetch(request("/api/v2/databases"), {
      DB: {}, APP_BASE_URL: "https://beta.test", RATE_LIMIT_SECRET: "rate-limit-secret-at-least-32-characters",
      TURNSTILE_SECRET_KEY: "turnstile-secret", RESEND_API_KEY: "resend-secret", EMAIL_FROM: "Nexus <notes@beta.test>",
    });
    expect(response.status).toBe(401);
  });
});
