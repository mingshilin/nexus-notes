import type { BoardMoveInput, DatabaseProperty, DatabaseRecord, DatabaseView } from "@nexus/contracts";
import { useEffect, useState } from "react";

import { runOptimisticMutation } from "../data/database-state";
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

  useEffect(() => setLimits({}), [view.id, segmentSize]);

  const move = (optionId: string) => {
    if (!draggedId || !grouping) return;
    const record = records.find((candidate) => candidate.id === draggedId);
    if (!record) return;
    const value = optionId === "__ungrouped" ? null : optionId;
    const optimistic = { ...record, values: { ...record.values, [grouping.id]: value }, revision: record.revision + 1 };
    const input: BoardMoveInput = { record_id: record.id, property_id: grouping.id, option_id: value, base_revision: record.revision };
    setError(null);
    setDraggedId(null);
    void runOptimisticMutation({
      snapshot: () => [...records],
      apply: () => onRecordsChange(replaceRecord(records, optimistic)),
      command: () => onBoardMove?.(input) ?? Promise.resolve(optimistic),
      restore: (snapshot) => onRecordsChange(snapshot),
      commit: (saved) => onRecordsChange(replaceRecord(records, saved)),
    }).catch(() => setError("移动失败，已恢复原位置。"));
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
                  onDragStart={() => setDraggedId(record.id)}
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
