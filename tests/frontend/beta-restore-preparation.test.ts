import { describe, expect, it } from "vitest";

import { prepareBetaRestoreSql } from "../../scripts/prepare-beta-restore.mjs";

describe("Beta D1 restore preparation", () => {
  it("preserves exact membership epochs without changing unrelated inserts", () => {
    const source = [
      "BEGIN TRANSACTION;",
      'INSERT INTO "workspace_members" VALUES (\'workspace-1\', \'user-1\');',
      'INSERT INTO "workspace_membership_epochs" VALUES (\'workspace-1\', \'user-1\', 7);',
      "COMMIT;",
    ].join("\n");

    const prepared = prepareBetaRestoreSql(source);

    expect(prepared).toContain('INSERT INTO "workspace_members"');
    expect(prepared).toContain('INSERT OR REPLACE INTO "workspace_membership_epochs"');
    expect(prepareBetaRestoreSql(prepared)).toBe(prepared);
  });

  it("leaves exports without membership epoch rows unchanged", () => {
    const source = 'INSERT INTO "notes" VALUES (\'note-1\');';

    expect(prepareBetaRestoreSql(source)).toBe(source);
  });
});
