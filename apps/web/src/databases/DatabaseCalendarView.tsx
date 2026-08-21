import type { CalendarAssignmentInput, DatabaseProperty, DatabaseRecord, DatabaseView } from "@nexus/contracts";
import { useEffect, useRef, useState } from "react";
import { recordTitle, replaceRecord } from "./database-view-utils";

function monthDates(records: readonly DatabaseRecord[], propertyId: string) {
  const firstDate = records.map((record) => record.values[propertyId]).find((value): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(value));
  const month = firstDate?.slice(0, 7) ?? new Date().toISOString().slice(0, 7);
  const [year, monthNumber] = month.split("-").map(Number);
  const days = new Date(Date.UTC(year!, monthNumber!, 0)).getUTCDate();
  return Array.from({ length: days }, (_, index) => `${month}-${String(index + 1).padStart(2, "0")}`);
}

export function DatabaseCalendarView({
  properties,
  records,
  view,
  onRecordsChange,
  onCalendarAssign,
}: {
  properties: readonly DatabaseProperty[];
  records: readonly DatabaseRecord[];
  view: DatabaseView;
  onRecordsChange(records: DatabaseRecord[]): void;
  onCalendarAssign?(input: CalendarAssignmentInput): Promise<DatabaseRecord>;
}) {
  const propertyId = view.config.settings.date_property_id ?? undefined;
  const dateProperty = properties.find((property) => property.id === propertyId && property.type === "date");
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [moreDate, setMoreDate] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const latestRecords = useRef(records);
  const operations = useRef(new Map<string, string>());
  const queues = useRef(new Map<string, Promise<void>>());
  const confirmedRecords = useRef(new Map<string, DatabaseRecord>());
  const draggedRecord = useRef<string | null>(null);
  const recordSetKey = records.map((record) => `${record.id}:${record.revision}`).join("|");
  latestRecords.current = records;

  useEffect(() => { draggedRecord.current = null; setDraggedId(null); }, [recordSetKey, view.id]);

  if (!dateProperty) return <p className="database-empty">Calendar view 需要 date 字段。</p>;

  const assign = (date: string | null) => {
    const id = draggedRecord.current ?? draggedId;
    if (!id) return;
    const record = latestRecords.current.find((candidate) => candidate.id === id);
    if (!record) return;
    const optimistic = { ...record, values: { ...record.values, [dateProperty.id]: date }, revision: record.revision + 1 };
    draggedRecord.current = null;
    setDraggedId(null);
    setError(null);
    const operationId = crypto.randomUUID();
    operations.current.set(record.id, operationId);
    if (!confirmedRecords.current.has(record.id)) confirmedRecords.current.set(record.id, record);
    const next = replaceRecord(latestRecords.current, optimistic);
    latestRecords.current = next;
    onRecordsChange(next);
    const execute = async () => {
      const confirmed = confirmedRecords.current.get(record.id) ?? record;
      const input: CalendarAssignmentInput = { record_id: record.id, property_id: dateProperty.id, date, base_revision: confirmed.revision };
      try {
        const saved = await (onCalendarAssign?.(input) ?? Promise.resolve({ ...optimistic, revision: confirmed.revision + 1 }));
        confirmedRecords.current.set(record.id, saved);
        if (operations.current.get(record.id) !== operationId) return;
        operations.current.delete(record.id);
        const committed = replaceRecord(latestRecords.current, saved);
        latestRecords.current = committed;
        onRecordsChange(committed);
      } catch {
        if (operations.current.get(record.id) !== operationId) return;
        operations.current.delete(record.id);
        const restored = replaceRecord(latestRecords.current, confirmed);
        latestRecords.current = restored;
        onRecordsChange(restored);
        setError("日期分配失败，已恢复原日期。");
      }
    };
    const previous = queues.current.get(record.id) ?? Promise.resolve();
    const queued = previous.catch(() => undefined).then(execute);
    queues.current.set(record.id, queued);
    void queued.finally(() => { if (queues.current.get(record.id) === queued) queues.current.delete(record.id); });
  };

  const dates = monthDates(records, dateProperty.id);
  const undated = records.filter((record) => !record.values[dateProperty.id]);
  const overflow = moreDate ? records.filter((record) => record.values[dateProperty.id] === moreDate).slice(3) : [];

  return (
    <section className="database-calendar-view" aria-label="数据库日历">
      {error ? <p className="database-operation-error" role="alert">{error}</p> : null}
      {view.config.settings.show_undated !== false ? (
        <aside className="database-calendar-undated" data-testid="calendar-undated">
          <header><strong>未安排</strong><span>{undated.length}</span></header>
          <div>
            {undated.slice(0, 60).map((record) => (
              <article
                className="database-calendar-card"
                data-testid={`calendar-undated-${record.id}`}
                draggable
                key={record.id}
                onDragStart={() => { draggedRecord.current = record.id; setDraggedId(record.id); }}
                onDragEnd={() => { draggedRecord.current = null; setDraggedId(null); }}
              >{recordTitle(record, properties)}</article>
            ))}
          </div>
        </aside>
      ) : null}
      <div className="database-calendar-grid">
        {dates.map((date) => {
          const dated = records.filter((record) => record.values[dateProperty.id] === date);
          return (
            <section
              className="database-calendar-day"
              data-testid={`calendar-day-${date}`}
              aria-label={date}
              key={date}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => assign(date)}
            >
              <time dateTime={date}>{Number(date.slice(-2))}</time>
              {dated.slice(0, 3).map((record) => (
                <article
                  className="database-calendar-card"
                  data-testid={`calendar-card-${record.id}`}
                  draggable
                  key={record.id}
                  onDragStart={() => { draggedRecord.current = record.id; setDraggedId(record.id); }}
                  onDragEnd={() => { draggedRecord.current = null; setDraggedId(null); }}
                >{recordTitle(record, properties)}</article>
              ))}
              {dated.length > 3 ? (
                <button type="button" aria-label={`${date} 更多 ${dated.length - 3} 条`} onClick={() => setMoreDate(date)}>
                  +{dated.length - 3} more
                </button>
              ) : null}
            </section>
          );
        })}
      </div>
      {moreDate ? (
        <div className="database-calendar-more" role="dialog" aria-modal="false" aria-label={`${moreDate} 更多记录`}>
          <header><strong>{moreDate}</strong><button type="button" onClick={() => setMoreDate(null)}>关闭</button></header>
          {overflow.map((record) => (
            <article
              className="database-calendar-card"
              data-testid={`calendar-card-${record.id}`}
              draggable
              key={record.id}
              onDragStart={() => { draggedRecord.current = record.id; setDraggedId(record.id); }}
              onDragEnd={() => { draggedRecord.current = null; setDraggedId(null); }}
            >{recordTitle(record, properties)}</article>
          ))}
        </div>
      ) : null}
    </section>
  );
}
