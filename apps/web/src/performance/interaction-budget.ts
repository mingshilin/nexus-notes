const responsiveShellBudgetMs = 100;

export interface InteractionMetric {
  name: string;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  budgetMs: number;
  overBudget: boolean;
}

export function recordInteraction(name: string, startedAt: number, now = performance.now()): InteractionMetric {
  const durationMs = Math.max(0, now - startedAt);
  return {
    name,
    startedAt,
    endedAt: now,
    durationMs,
    budgetMs: responsiveShellBudgetMs,
    overBudget: durationMs > responsiveShellBudgetMs,
  };
}
