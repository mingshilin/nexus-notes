import { describe, expect, it } from "vitest";

import { recordInteraction } from "../src/performance/interaction-budget";

describe("interaction budget", () => {
  it("classifies shell time over 100ms without blocking navigation", () => {
    const metric = recordInteraction("workspace-shell", 10, 136);

    expect(metric).toEqual({
      name: "workspace-shell",
      startedAt: 10,
      endedAt: 136,
      durationMs: 126,
      budgetMs: 100,
      overBudget: true,
    });
  });
});
