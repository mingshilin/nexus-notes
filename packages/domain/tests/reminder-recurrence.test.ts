import { describe, expect, it } from "vitest";
import { nextReminderOccurrence, reminderLocalAnchor } from "../src/reminder-recurrence";

describe("reminder recurrence", () => {
  it("preserves the local wall time anchor", () => {
    expect(reminderLocalAnchor("2026-08-25T01:30:00.000Z", "Asia/Shanghai")).toBe("2026-08-25T09:30:00");
  });
  it("clamps a missing monthly day to the final day without drifting the anchor", () => {
    expect(nextReminderOccurrence({
      anchorLocal: "2026-01-31T09:00:00",
      currentAt: "2026-01-31T01:00:00.000Z",
      timezone: "Asia/Shanghai",
      occurrenceCount: 1,
      recurrence: { frequency: "monthly", interval: 1, month_day: 31, ends: { type: "never" } },
    })).toBe("2026-02-28T01:00:00.000Z");
  });

  it("selects the next configured weekday and enforces count endings", () => {
    const input = {
      anchorLocal: "2026-08-24T09:00:00",
      currentAt: "2026-08-24T01:00:00.000Z",
      timezone: "Asia/Shanghai",
      recurrence: { frequency: "weekly" as const, interval: 1, weekdays: ["MO", "WE"] as const, ends: { type: "count" as const, count: 3 } },
    };
    expect(nextReminderOccurrence({ ...input, occurrenceCount: 1 })).toBe("2026-08-26T01:00:00.000Z");
    expect(nextReminderOccurrence({ ...input, currentAt: "2026-08-26T01:00:00.000Z", occurrenceCount: 3 })).toBeNull();
  });

  it("moves a nonexistent DST wall time to the first valid instant after the gap", () => {
    expect(nextReminderOccurrence({
      anchorLocal: "2026-03-07T02:30:00",
      currentAt: "2026-03-07T07:30:00.000Z",
      timezone: "America/New_York",
      occurrenceCount: 1,
      recurrence: { frequency: "daily", interval: 1, ends: { type: "never" } },
    })).toBe("2026-03-08T07:00:00.000Z");
  });
});
