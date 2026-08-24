import { Temporal } from "@js-temporal/polyfill";

type RecurrenceEnd =
  | { type: "never" }
  | { type: "until"; date: string }
  | { type: "count"; count: number };

type Recurrence =
  | { frequency: "daily"; interval: number; ends: RecurrenceEnd }
  | { frequency: "weekly"; interval: number; weekdays: readonly string[]; ends: RecurrenceEnd }
  | { frequency: "monthly"; interval: number; month_day: number | "last"; ends: RecurrenceEnd };

const weekdayNumber: Record<string, number> = { MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6, SU: 7 };

function fields(local: Temporal.PlainDateTime, timezone: string) {
  return {
    timeZone: timezone,
    year: local.year,
    month: local.month,
    day: local.day,
    hour: local.hour,
    minute: local.minute,
    second: local.second,
    millisecond: local.millisecond,
  };
}

function sameLocal(left: Temporal.PlainDateTime, right: Temporal.PlainDateTime) {
  return Temporal.PlainDateTime.compare(left, right) === 0;
}

function resolveWallTime(local: Temporal.PlainDateTime, timezone: string) {
  const earlier = Temporal.ZonedDateTime.from(fields(local, timezone), { disambiguation: "earlier" });
  if (sameLocal(earlier.toPlainDateTime(), local)) return earlier;
  let candidate = local;
  for (let index = 0; index < 180; index += 1) {
    candidate = candidate.add({ minutes: 1 });
    const resolved = Temporal.ZonedDateTime.from(fields(candidate, timezone), { disambiguation: "earlier" });
    if (sameLocal(resolved.toPlainDateTime(), candidate)) return resolved;
  }
  throw new RangeError("Unable to resolve reminder wall time");
}

function ended(ends: RecurrenceEnd, occurrenceCount: number, localDate: Temporal.PlainDate) {
  if (ends.type === "count") return occurrenceCount >= ends.count;
  if (ends.type === "until") return Temporal.PlainDate.compare(localDate, Temporal.PlainDate.from(ends.date)) > 0;
  return false;
}

export function reminderLocalAnchor(remindAt: string, timezone: string) {
  return Temporal.Instant.from(remindAt)
    .toZonedDateTimeISO(timezone)
    .toPlainDateTime()
    .toString({ smallestUnit: "second" });
}

export function nextReminderOccurrence(input: {
  anchorLocal: string;
  currentAt: string;
  timezone: string;
  occurrenceCount: number;
  recurrence: Recurrence;
}) {
  if (input.recurrence.ends.type === "count" && input.occurrenceCount >= input.recurrence.ends.count) return null;
  const anchor = Temporal.PlainDateTime.from(input.anchorLocal);
  const current = Temporal.Instant.from(input.currentAt).toZonedDateTimeISO(input.timezone).toPlainDateTime();
  let next: Temporal.PlainDateTime;

  if (input.recurrence.frequency === "daily") {
    next = current.add({ days: input.recurrence.interval }).with({
      hour: anchor.hour, minute: anchor.minute, second: anchor.second, millisecond: anchor.millisecond,
    });
  } else if (input.recurrence.frequency === "monthly") {
    const monthStart = anchor.toPlainDate().with({ day: 1 }).add({ months: input.occurrenceCount * input.recurrence.interval });
    const targetDay = input.recurrence.month_day === "last"
      ? monthStart.daysInMonth
      : Math.min(input.recurrence.month_day, monthStart.daysInMonth);
    next = monthStart.with({ day: targetDay }).toPlainDateTime(anchor.toPlainTime());
    while (Temporal.PlainDateTime.compare(next, current) <= 0) {
      const following = next.toPlainDate().with({ day: 1 }).add({ months: input.recurrence.interval });
      const day = input.recurrence.month_day === "last" ? following.daysInMonth : Math.min(input.recurrence.month_day, following.daysInMonth);
      next = following.with({ day }).toPlainDateTime(anchor.toPlainTime());
    }
  } else {
    const weekdays = new Set(input.recurrence.weekdays.map((day) => weekdayNumber[day]).filter(Boolean));
    const anchorWeek = anchor.toPlainDate().subtract({ days: anchor.dayOfWeek - 1 });
    let date = current.toPlainDate();
    for (;;) {
      date = date.add({ days: 1 });
      const week = date.subtract({ days: date.dayOfWeek - 1 });
      const weeksSinceAnchor = Math.floor(anchorWeek.until(week, { largestUnit: "weeks" }).weeks);
      if (weeksSinceAnchor >= 0 && weeksSinceAnchor % input.recurrence.interval === 0 && weekdays.has(date.dayOfWeek)) break;
    }
    next = date.toPlainDateTime(anchor.toPlainTime());
  }

  if (ended(input.recurrence.ends, input.occurrenceCount, next.toPlainDate())) return null;
  return resolveWallTime(next, input.timezone).toInstant().toString({ smallestUnit: "millisecond" });
}
