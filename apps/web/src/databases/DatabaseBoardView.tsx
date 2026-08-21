import type { BoardMoveInput, DatabaseProperty, DatabaseRecord, DatabaseView } from "@nexus/contracts";
import { useEffect, useRef, useState } from "react";
import { recordTitle, replaceRecord } from "./database-view-utils";

interface SelectOption { id: string; name: string; color?: string }

export function DatabaseBoardView({
  properties,
  records,
  view,
  onRecordsChange,
  onBoardMove,
}: {
  properties: readonly DatabaseProperty[];
  records: readonly DatabaseRecord[];
  view: DatabaseView;
  onRecordsChange(records: DatabaseRecord[]): void;
  onBoardMove?(input: BoardMoveInput): Promise<DatabaseRecord>;
}) {
  const groupingId = view.config.grouping?.property_id;
  const grouping = properties.find((property) => property.id === groupingId && property.type === "select");
  const options = Array.isArray((grouping?.config as { options?: unknown } | undefined)?.options)
    ? (grouping!.config as { options: SelectOption[] }).options
    : [];
  const groups: SelectOption[] = [...options, { id: "__ungrouped", name: "未分组" }];
  const segmentSize = view.config.settings.segment_size ?? 60;
  const [limits, setLimits] = useState<Record<string, number>>({});
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const latestRecords = useRef(records);
  const operations = useRef(new Map<string, string>());
  const draggedRecord = useRef<string | null>(null);
  const recordSetKey = records.map((record) => `${record.id}:${record.revision}`).join("|");
  latestRecords.current = records;

  useEffect(() => setLimits({}), [view.id, segmentSize]);
  useEffect(() => { draggedRecord.current = null; setDraggedId(null); }, [recordSetKey, view.id]);

  const move = (optionId: string) => {
    const id = draggedRecord.current ?? draggedId;
    if (!id || !grouping) return;
    const record = latestRecords.current.find((candidate) => candidate.id === id);
    if (!record) return;
    const value = optionId === "__ungrouped" ? null : optionId;
    const optimistic = { ...record, values: { ...record.values, [grouping.id]: value }, revision: record.revision + 1 };
    const input: BoardMoveInput = { record_id: record.id, property_id: grouping.id, option_id: value, base_revision: record.revision };
    setError(null);
    draggedRecord.current = null;
    setDraggedId(null);
    const operationId = crypto.randomUUID();
    operations.current.set(record.id, operationId);
    const next = replaceRecord(latestRecords.current, optimistic);
    latestRecords.current = next;
    onRecordsChange(next);
    void (onBoardMove?.(input) ?? Promise.resolve(optimistic)).then((saved) => {
      if (operations.current.get(record.id) !== operationId) return;
      const committed = replaceRecord(latestRecords.current, saved);
      latestRecords.current = committed;
      onRecordsChange(committed);
    }).catch(() => {
      if (operations.current.get(record.id) !== operationId) return;
      const restored = replaceRecord(latestRecords.current, record);
      latestRecords.current = restored;
      onRecordsChange(restored);
      setError("移动失败，已恢复原位置。");
    });
  };

  if (!grouping) return <p className="database-empty">Board view 需要 select 分组字段。</p>;

  return (
    <section className="database-board-view" aria-label="数据库看板">
      {error ? <p className="database-operation-error" role="alert">{error}</p> : null}
      <div className="database-board-columns">
        {groups.map((group) => {
          const grouped = records.filter((record) => (record.values[grouping.id] ?? "__ungrouped") === group.id);
          const limit = limits[group.id] ?? segmentSize;
          return (
            <section
              className="database-board-column"
              data-testid={`board-column-${group.id}`}
              key={group.id}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => move(group.id)}
            >
              <header><strong>{group.name}</strong><span>{grouped.length}</span></header>
              {grouped.slice(0, limit).map((record) => (
                <article
                  className="database-board-card"
                  data-testid={`board-card-${record.id}`}
                  draggable
                  key={record.id}
                  onDragStart={() => { draggedRecord.current = record.id; setDraggedId(record.id); }}
                  onDragEnd={() => { draggedRecord.current = null; setDraggedId(null); }}
                >{recordTitle(record, properties)}</article>
              ))}
              {grouped.length > limit ? (
                <button type="button" onClick={() => setLimits((current) => ({ ...current, [group.id]: limit + segmentSize }))}>
                  加载更多 {grouped.length - limit}
                </button>
              ) : null}
            </section>
          );
        })}
      </div>
    </section>
  );
}
