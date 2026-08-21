import type { DatabaseProperty, DatabaseRecord } from "@nexus/contracts";

import { displayValue } from "./database-view-utils";

export function DatabaseTableView({
  properties,
  records,
  page,
  pageSize,
  onPageChange,
  hasNextPage = false,
}: {
  properties: readonly DatabaseProperty[];
  records: readonly DatabaseRecord[];
  page: number;
  pageSize: number;
  onPageChange(page: number): void;
  hasNextPage?: boolean;
}) {
  const pageCount = Math.max(1, Math.ceil(records.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const start = (safePage - 1) * pageSize;
  const rows = records.slice(start, start + pageSize);
  const end = Math.min(start + rows.length, records.length);

  return (
    <section className="database-table-view" aria-label="数据库表格">
      <div className="database-table-scroll">
        <table>
          <thead><tr>{properties.map((property) => <th key={property.id} scope="col">{property.name}</th>)}</tr></thead>
          <tbody>
            {rows.map((record) => (
              <tr className="database-record-row" key={record.id}>
                {properties.map((property) => <td key={property.id}>{displayValue(record.values[property.id])}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <footer className="database-pagination">
        <span>{records.length === 0 ? "0 / 0" : `${start + 1}–${end} / ${records.length}`}</span>
        <div>
          <button type="button" disabled={safePage <= 1} onClick={() => onPageChange(safePage - 1)}>上一页</button>
          <button type="button" disabled={safePage >= pageCount && !hasNextPage} onClick={() => onPageChange(safePage + 1)}>下一页</button>
        </div>
      </footer>
    </section>
  );
}
