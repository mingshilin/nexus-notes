import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../worker/db/queries", () => ({
  getDatabaseById: vi.fn(),
  getDatabaseFieldPermission: vi.fn(),
  getDatabasePropertyById: vi.fn(),
  listDatabasePermissions: vi.fn(),
}));

import { getDatabaseById, getDatabaseFieldPermission, getDatabasePropertyById, listDatabasePermissions } from "../../worker/db/queries";
import { assertDatabaseReadable, assertDatabaseWritable, assertFieldReadable, assertFieldWritable } from "../../worker/permissions/databases";

const database = {
  id: "db-1",
  workspace_id: "ws-1",
  name: "Projects",
  description: null,
  icon: null,
  created_by_user_id: "u1",
  board_property_id: null,
  calendar_property_id: null,
  created_at: "x",
  updated_at: "x",
};

const property = {
  id: "prop-1",
  database_id: "db-1",
  name: "Private",
  type: "text" as const,
  config: {},
  config_json: "{}",
  sort_order: 1,
  created_at: "x",
  updated_at: "x",
};

function context(role: "owner" | "editor" | "viewer" = "viewer") {
  return {
    db: {} as D1Database,
    workspaceId: "ws-1",
    databaseId: "db-1",
    userId: "u2",
    workspaceRole: role,
  };
}

describe("database permission helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getDatabaseById).mockResolvedValue(database);
    vi.mocked(getDatabasePropertyById).mockResolvedValue(property);
    vi.mocked(getDatabaseFieldPermission).mockResolvedValue({
      id: "fp-1",
      property_id: "prop-1",
      viewer_roles: ["owner", "editor", "viewer"],
      editor_roles: ["owner", "editor"],
      created_at: "x",
      updated_at: "x",
    });
    vi.mocked(listDatabasePermissions).mockResolvedValue([]);
  });

  it("inherits workspace roles when no database override exists", async () => {
    await expect(assertDatabaseReadable(context("viewer"))).resolves.toMatchObject({ role: "viewer" });
    await expect(assertDatabaseWritable(context("viewer"))).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });
    await expect(assertDatabaseWritable(context("editor"))).resolves.toMatchObject({ role: "editor" });
  });

  it("uses member permissions before workspace role permissions", async () => {
    vi.mocked(listDatabasePermissions).mockResolvedValue([
      { id: "p1", database_id: "db-1", subject_type: "workspace_role", subject_id: "viewer", role: "viewer", created_at: "x", updated_at: "x" },
      { id: "p2", database_id: "db-1", subject_type: "member", subject_id: "u2", role: "editor", created_at: "x", updated_at: "x" },
    ]);

    await expect(assertDatabaseWritable(context("viewer"))).resolves.toMatchObject({ role: "editor" });
  });

  it("denies unmatched users when explicit database permissions exist", async () => {
    vi.mocked(listDatabasePermissions).mockResolvedValue([
      { id: "p1", database_id: "db-1", subject_type: "workspace_role", subject_id: "editor", role: "editor", created_at: "x", updated_at: "x" },
    ]);

    await expect(assertDatabaseReadable(context("viewer"))).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });
  });

  it("rejects missing databases before permission checks", async () => {
    vi.mocked(getDatabaseById).mockResolvedValue(null);

    await expect(assertDatabaseReadable(context("owner"))).rejects.toMatchObject({ status: 404, code: "NOT_FOUND" });
  });

  it("checks field read roles after database read permission", async () => {
    vi.mocked(getDatabaseFieldPermission).mockResolvedValue({
      id: "fp-1",
      property_id: "prop-1",
      viewer_roles: ["owner", "editor"],
      editor_roles: ["owner"],
      created_at: "x",
      updated_at: "x",
    });

    await expect(assertFieldReadable({ ...context("viewer"), propertyId: "prop-1" })).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });
    await expect(assertFieldReadable({ ...context("editor"), propertyId: "prop-1" })).resolves.toMatchObject({ property });
  });

  it("checks field write roles after database write permission", async () => {
    vi.mocked(getDatabaseFieldPermission).mockResolvedValue({
      id: "fp-1",
      property_id: "prop-1",
      viewer_roles: ["owner", "editor", "viewer"],
      editor_roles: ["owner"],
      created_at: "x",
      updated_at: "x",
    });

    await expect(assertFieldWritable({ ...context("editor"), propertyId: "prop-1" })).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });
    await expect(assertFieldWritable({ ...context("owner"), propertyId: "prop-1" })).resolves.toMatchObject({ property });
  });
});
