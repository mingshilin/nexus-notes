import { describe, expect, it } from "vitest";

import { applyMigration } from "./d1";

describe("D1 migration helper", () => {
  it("executes one migration through a single D1 batch", async () => {
    let prepareCalls = 0;
    let batchCalls = 0;
    let batchedStatements: unknown[] = [];
    const db = {
      prepare(sql: string) {
        prepareCalls += 1;
        return { sql };
      },
      async batch(statements: unknown[]) {
        batchCalls += 1;
        batchedStatements = statements;
        return [];
      },
    } as unknown as D1Database;

    await applyMigration(db, "../../migrations/0022_ai_note_actions.sql");

    expect(batchCalls).toBe(1);
    expect(prepareCalls).toBeGreaterThan(1);
    expect(batchedStatements).toHaveLength(prepareCalls);
  });
});
