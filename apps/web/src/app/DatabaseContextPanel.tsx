import { Plus } from "lucide-react";
import type { Database } from "@nexus/contracts";

export interface DatabaseContextPanelProps {
  databases: Database[];
  selectedDatabaseId: string | null;
  loading: boolean;
  error: string | null;
  createOpen: boolean;
  name: string;
  creating: boolean;
  onCreateRequest(): void;
  onCreateOpenChange(open: boolean): void;
  onNameChange(value: string): void;
  onCreate(): void;
  onSelect(database: Database): void;
}

export function DatabaseContextPanel({
  databases,
  selectedDatabaseId,
  loading,
  error,
  createOpen,
  name,
  creating,
  onCreateRequest,
  onCreateOpenChange,
  onNameChange,
  onCreate,
  onSelect,
}: DatabaseContextPanelProps) {
  return (
    <div className="context-content">
      <div className="context-heading">
        <div><small>STRUCTURE</small><h2>数据库</h2></div>
        <button className="primary-create-note" type="button" aria-label="新建数据库" onClick={onCreateRequest}>
          <Plus aria-hidden="true" size={17} />
          <span>新建数据库</span>
        </button>
      </div>
      {createOpen && databases.length > 0 ? (
        <form
          className="database-create-inline"
          aria-label="新建数据库表单"
          onSubmit={(event) => {
            event.preventDefault();
            onCreate();
          }}
        >
          <label>数据库名称<input aria-label="新建数据库名称" value={name} onChange={(event) => onNameChange(event.target.value)} autoFocus /></label>
          <div className="database-create-inline-actions">
            <button type="button" onClick={() => onCreateOpenChange(false)}>取消</button>
            <button type="submit" disabled={!name.trim() || creating}>{creating ? "创建中…" : "创建数据库"}</button>
          </div>
        </form>
      ) : null}
      {loading && databases.length === 0 ? <p className="database-empty" role="status">正在加载数据库…</p> : null}
      {error ? <p className="database-operation-error" role="alert">{error}</p> : null}
      {databases.map((database) => (
        <button
          key={database.id}
          className={database.id === selectedDatabaseId ? "note-row selected" : "note-row"}
          type="button"
          onClick={() => onSelect(database)}
        >
          <strong>{database.name}</strong><p>{database.description || "Structured database"}</p>
        </button>
      ))}
      {!loading && !error && databases.length === 0 ? <p className="database-empty">尚未创建数据库。</p> : null}
    </div>
  );
}
