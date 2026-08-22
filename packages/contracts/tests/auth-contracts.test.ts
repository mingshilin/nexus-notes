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
