import { describe, expect, it } from "vitest";

import { AuthSessionSchema, WorkspaceMembershipSummarySchema } from "../src";

const session = {
  user: {
    id: "user-1",
    email: "user@example.test",
    displayName: "User",
  },
  workspaces: [
    {
      id: "ws-1",
      name: "User's workspace",
      slug: "personal-user-1",
      role: "owner",
      revision: 1,
    },
  ],
  active_workspace_id: "ws-1",
};

describe("auth contracts", () => {
  it("exposes a bounded create-workspace input contract", async () => {
    const contracts = await import("../src");
    const schema = contracts.CreateWorkspaceInputSchema as { safeParse(value: unknown): { success: boolean; data?: unknown } };

    expect(schema).toBeDefined();
    expect(schema.safeParse({ name: "  研究团队  " })).toEqual({
      success: true,
      data: { name: "研究团队" },
    });
    expect(schema.safeParse({ name: "" }).success).toBe(false);
  });

  it("validates the safe authenticated session payload", () => {
    expect(AuthSessionSchema.parse(session)).toEqual(session);
    expect(AuthSessionSchema.safeParse({ ...session, active_workspace_id: null, workspaces: [] }).success).toBe(true);
  });

  it("rejects unsafe workspace membership fields and invalid revisions", () => {
    expect(WorkspaceMembershipSummarySchema.safeParse({
      ...session.workspaces[0],
      capabilities: ["admin"],
    }).success).toBe(false);
    expect(WorkspaceMembershipSummarySchema.safeParse({
      ...session.workspaces[0],
      revision: 0,
    }).success).toBe(false);
  });
});
