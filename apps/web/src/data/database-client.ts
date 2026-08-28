import type {
  ApplyDatabaseTemplateInput,
  BoardMoveInput,
  BulkEditRecordsInput,
  CalendarAssignmentInput,
  CreateDatabaseCommentInput,
  CreateDatabaseInput,
  CreateDatabasePropertyInput,
  CreateDatabaseRecordInput,
  CreateDatabaseTemplateInput,
  CreateDatabaseViewInput,
  CsvExportInput,
  CsvImportInput,
  CsvPreview,
  Database,
  DatabaseComment,
  DatabasePermission,
  DatabasePermissionList,
  DatabaseProperty,
  DatabaseRecord,
  DatabaseTemplate,
  DatabaseStats,
  DatabaseView,
  DeleteDatabaseInput,
  DeleteDatabasePermissionInput,
  DeleteFieldPermissionInput,
  DeleteDatabaseRecordInput,
  FieldPermission,
  FieldPermissionList,
  SetDatabasePermissionInput,
  SetFieldPermissionInput,
  UpdateDatabaseCommentInput,
  UpdateDatabaseInput,
  UpdateDatabasePropertyInput,
  UpdateDatabaseRecordInput,
  UpdateDatabaseTemplateInput,
  UpdateDatabaseViewInput,
} from "@nexus/contracts";

import type { ApiClient } from "./api-client";
import type { WorkspaceQueryCache } from "./workspace-query-cache";

export interface DatabaseClientOptions {
  createId?(): string;
  now?(): number;
  userId?: string;
  queryCache?: WorkspaceQueryCache;
}

export interface DatabaseBundle {
  database: Database;
  role: "owner" | "editor" | "viewer";
  properties: DatabaseProperty[];
  views: DatabaseView[];
  templates: DatabaseTemplate[];
}

export interface DatabaseBootstrap {
  items: Database[];
  selected_database_id: string | null;
  bundle: DatabaseBundle | null;
  records: { items: DatabaseRecord[]; next_cursor: string | null };
}

interface DatabaseCacheEntry<T> {
  value: T;
  expiresAt: number;
  refreshPromise?: Promise<void>;
}

const DATABASE_CACHE_TTL_MS = 2 * 60_000;

export class DatabaseClient {
  private readonly createId: () => string;
  private readonly now: () => number;
  private readonly userId?: string;
  private readonly queryCache?: WorkspaceQueryCache;
  private readonly cache = new Map<string, DatabaseCacheEntry<unknown>>();
  private readonly latestCacheCommit = new Map<string, number>();
  private cacheGeneration = 0;
  private cacheRequestSequence = 0;

  constructor(
    private readonly client: Pick<ApiClient, "request">,
    private readonly workspaceId: string,
    options: Partial<DatabaseClientOptions> = {},
  ) {
    this.createId = options.createId ?? (() => crypto.randomUUID());
    this.now = options.now ?? (() => Date.now());
    this.userId = options.userId;
    this.queryCache = options.queryCache;
  }

  listDatabases(signal?: AbortSignal) {
    const load = (requestSignal?: AbortSignal) => this.query<{ items: Database[] }>(
      "/api/v2/databases",
      `databases:${this.workspaceId}`,
      requestSignal,
    ).then(({ items }) => items);
    const shared = this.shared("databases", load, signal);
    if (shared) return shared;
    return this.cached("databases", load, signal);
  }

  getDatabase(databaseId: string, signal?: AbortSignal) {
    const load = (requestSignal?: AbortSignal) => this.query<DatabaseBundle>(
        `/api/v2/databases/${encodeURIComponent(databaseId)}`,
        `database:${this.workspaceId}:${databaseId}`,
        requestSignal,
      );
    const shared = this.shared(`database:${databaseId}`, load, signal);
    if (shared) return shared;
    return this.cached(`database:${databaseId}`, load, signal);
  }

  getStats(databaseId: string, signal?: AbortSignal) {
    const load = (requestSignal?: AbortSignal) => this.query<DatabaseStats>(
      `${this.databasePath(databaseId)}/stats`,
      `database-stats:${this.workspaceId}:${databaseId}`,
      requestSignal,
    );
    const shared = this.shared(`database-stats:${databaseId}`, load, signal);
    if (shared) return shared;
    return this.cached(`database-stats:${databaseId}`, load, signal);
  }

  bootstrap(options: { databaseId?: string; limit?: number; signal?: AbortSignal } = {}) {
    const params = new URLSearchParams();
    if (options.databaseId) params.set("database_id", options.databaseId);
    params.set("limit", String(options.limit ?? 50));
    const key = `bootstrap:${options.databaseId ?? "first"}:${options.limit ?? 50}`;
    const generation = this.cacheGeneration;
    const load = (requestSignal?: AbortSignal) => this.query<DatabaseBootstrap>(
      `/api/v2/databases/bootstrap?${params}`,
      `database-bootstrap:${this.workspaceId}:${key}`,
      requestSignal,
    );
    const shared = this.shared(key, load, options.signal);
    if (shared) return shared.then((value) => {
      this.primeBootstrap(value);
      return value;
    });
    return this.cached(key, load, options.signal, generation, (value, requestToken) => {
      this.commitCache("databases", value.items, requestToken, generation);
      if (value.bundle) {
        this.commitCache(`database:${value.bundle.database.id}`, value.bundle, requestToken, generation);
      }
      this.primeBootstrap(value);
    });
  }

  createDatabase(input: CreateDatabaseInput) {
    return this.command<{ database: Database }>("/api/v2/databases", "POST", input).then(({ database }) => database);
  }

  updateDatabase(databaseId: string, input: UpdateDatabaseInput) {
    return this.command<{ database: Database }>(this.databasePath(databaseId), "PATCH", input).then(({ database }) => database);
  }

  deleteDatabase(databaseId: string, input: DeleteDatabaseInput) {
    return this.command<{ id: string }>(this.databasePath(databaseId), "DELETE", input);
  }

  createProperty(databaseId: string, input: CreateDatabasePropertyInput) {
    return this.command<{ property: DatabaseProperty }>(`${this.databasePath(databaseId)}/properties`, "POST", input).then(({ property }) => property);
  }

  updateProperty(databaseId: string, propertyId: string, input: UpdateDatabasePropertyInput) {
    return this.command<{ property: DatabaseProperty }>(`${this.databasePath(databaseId)}/properties/${encodeURIComponent(propertyId)}`, "PATCH", input).then(({ property }) => property);
  }

  deleteProperty(databaseId: string, propertyId: string, input: DeleteDatabaseInput) {
    return this.command<{ id: string }>(`${this.databasePath(databaseId)}/properties/${encodeURIComponent(propertyId)}`, "DELETE", input);
  }

  listRecords(databaseId: string, options: { cursor?: string; viewId?: string; limit?: number; signal?: AbortSignal } = {}) {
    const params = new URLSearchParams();
    if (options.cursor) params.set("cursor", options.cursor);
    if (options.viewId) params.set("view_id", options.viewId);
    const limit = options.limit ?? 50;
    params.set("limit", String(limit));
    return this.query<{ items: DatabaseRecord[]; next_cursor: string | null }>(
      `${this.databasePath(databaseId)}/records?${params}`,
      `database-records:${this.workspaceId}:${databaseId}:${options.viewId ?? "all"}:${options.cursor ?? "first"}:${limit}`,
      options.signal,
    );
  }

  searchRecords(databaseId: string, query: string, options: { cursor?: string; limit?: number; signal?: AbortSignal } = {}) {
    const params = new URLSearchParams({ q: query, limit: String(options.limit ?? 50) });
    if (options.cursor) params.set("cursor", options.cursor);
    return this.query<{ items: DatabaseRecord[]; next_cursor: string | null }>(
      `${this.databasePath(databaseId)}/records/search?${params}`,
      `database-search:${this.workspaceId}:${databaseId}:${query}:${options.cursor ?? "first"}:${options.limit ?? 50}`,
      options.signal,
    );
  }

  getRecord(databaseId: string, recordId: string, signal?: AbortSignal) {
    return this.query<{ record: DatabaseRecord }>(
      `${this.databasePath(databaseId)}/records/${encodeURIComponent(recordId)}`,
      `database-record:${this.workspaceId}:${databaseId}:${recordId}`,
      signal,
    ).then(({ record }) => record);
  }

  createRecord(databaseId: string, input: CreateDatabaseRecordInput) {
    return this.command<{ record: DatabaseRecord }>(`${this.databasePath(databaseId)}/records`, "POST", input).then(({ record }) => record);
  }

  updateRecord(databaseId: string, recordId: string, input: UpdateDatabaseRecordInput) {
    return this.command<{ record: DatabaseRecord }>(`${this.databasePath(databaseId)}/records/${encodeURIComponent(recordId)}`, "PATCH", input).then(({ record }) => record);
  }

  deleteRecord(databaseId: string, recordId: string, input: DeleteDatabaseRecordInput) {
    return this.command<{ id: string }>(`${this.databasePath(databaseId)}/records/${encodeURIComponent(recordId)}`, "DELETE", input);
  }

  bulkEdit(databaseId: string, input: BulkEditRecordsInput) {
    return this.command<{ items: DatabaseRecord[] }>(`${this.databasePath(databaseId)}/records/bulk`, "POST", input);
  }

  boardMove(databaseId: string, input: BoardMoveInput) {
    return this.command<{ record: DatabaseRecord }>(`${this.databasePath(databaseId)}/board-move`, "POST", input).then(({ record }) => record);
  }

  calendarAssign(databaseId: string, input: CalendarAssignmentInput) {
    return this.command<{ record: DatabaseRecord }>(`${this.databasePath(databaseId)}/calendar-assign`, "POST", input).then(({ record }) => record);
  }

  createView(databaseId: string, input: CreateDatabaseViewInput) {
    return this.command<{ view: DatabaseView }>(`${this.databasePath(databaseId)}/views`, "POST", input).then(({ view }) => view);
  }

  updateView(databaseId: string, viewId: string, input: UpdateDatabaseViewInput) {
    return this.command<{ view: DatabaseView }>(`${this.databasePath(databaseId)}/views/${encodeURIComponent(viewId)}`, "PATCH", input).then(({ view }) => view);
  }

  deleteView(databaseId: string, viewId: string, input: DeleteDatabaseInput) {
    return this.command<{ id: string }>(`${this.databasePath(databaseId)}/views/${encodeURIComponent(viewId)}`, "DELETE", input);
  }

  createTemplate(databaseId: string, input: CreateDatabaseTemplateInput) {
    return this.command<{ template: DatabaseTemplate }>(`${this.databasePath(databaseId)}/templates`, "POST", input).then(({ template }) => template);
  }

  updateTemplate(databaseId: string, templateId: string, input: UpdateDatabaseTemplateInput) {
    return this.command<{ template: DatabaseTemplate }>(`${this.databasePath(databaseId)}/templates/${encodeURIComponent(templateId)}`, "PATCH", input).then(({ template }) => template);
  }

  deleteTemplate(databaseId: string, templateId: string, input: DeleteDatabaseInput) {
    return this.command<{ id: string }>(`${this.databasePath(databaseId)}/templates/${encodeURIComponent(templateId)}`, "DELETE", input);
  }

  applyTemplate(databaseId: string, input: ApplyDatabaseTemplateInput) {
    return this.command<{ items: DatabaseRecord[] }>(`${this.databasePath(databaseId)}/templates/apply`, "POST", input);
  }

  listComments(databaseId: string, recordId: string, signal?: AbortSignal) {
    return this.query<{ items: DatabaseComment[] }>(
      `${this.databasePath(databaseId)}/records/${encodeURIComponent(recordId)}/comments`,
      `database-comments:${this.workspaceId}:${databaseId}:${recordId}`,
      signal,
    ).then(({ items }) => items);
  }

  createComment(databaseId: string, recordId: string, input: CreateDatabaseCommentInput) {
    return this.command<{ comment: DatabaseComment }>(`${this.databasePath(databaseId)}/records/${encodeURIComponent(recordId)}/comments`, "POST", { ...input, record_id: recordId }).then(({ comment }) => comment);
  }

  updateComment(databaseId: string, commentId: string, input: UpdateDatabaseCommentInput) {
    return this.command<{ comment: DatabaseComment }>(`${this.databasePath(databaseId)}/comments/${encodeURIComponent(commentId)}`, "PATCH", input).then(({ comment }) => comment);
  }

  deleteComment(databaseId: string, commentId: string, input: DeleteDatabaseInput) {
    return this.command<{ id: string }>(`${this.databasePath(databaseId)}/comments/${encodeURIComponent(commentId)}`, "DELETE", input);
  }

  setDatabasePermission(databaseId: string, input: SetDatabasePermissionInput) {
    return this.command<{ permission: DatabasePermission }>(`${this.databasePath(databaseId)}/permissions`, "PUT", input).then(({ permission }) => permission);
  }

  listDatabasePermissions(databaseId: string, signal?: AbortSignal) {
    return this.query<DatabasePermissionList>(
      `${this.databasePath(databaseId)}/permissions`,
      `database-permissions:${this.workspaceId}:${databaseId}`,
      signal,
    ).then(({ items }) => items);
  }

  deleteDatabasePermission(databaseId: string, permissionId: string, input: DeleteDatabasePermissionInput) {
    return this.command<{ id: string }>(`${this.databasePath(databaseId)}/permissions/${encodeURIComponent(permissionId)}`, "DELETE", input);
  }

  setFieldPermission(databaseId: string, propertyId: string, input: SetFieldPermissionInput) {
    return this.command<{ permission: FieldPermission }>(`${this.databasePath(databaseId)}/properties/${encodeURIComponent(propertyId)}/permissions`, "PUT", input).then(({ permission }) => permission);
  }

  listFieldPermissions(databaseId: string, propertyId: string, signal?: AbortSignal) {
    return this.query<FieldPermissionList>(
      `${this.databasePath(databaseId)}/properties/${encodeURIComponent(propertyId)}/permissions`,
      `field-permissions:${this.workspaceId}:${databaseId}:${propertyId}`,
      signal,
    ).then(({ items }) => items);
  }

  deleteFieldPermission(databaseId: string, propertyId: string, permissionId: string, input: DeleteFieldPermissionInput) {
    return this.command<{ id: string }>(
      `${this.databasePath(databaseId)}/properties/${encodeURIComponent(propertyId)}/permissions/${encodeURIComponent(permissionId)}`,
      "DELETE",
      input,
    );
  }

  importCsv(databaseId: string, input: CsvImportInput) {
    return this.command<{ items: DatabaseRecord[]; imported_count: number }>(`${this.databasePath(databaseId)}/import/csv`, "POST", input);
  }

  previewCsv(databaseId: string, input: CsvImportInput, signal?: AbortSignal) {
    return this.client.request<CsvPreview>({
      path: `${this.databasePath(databaseId)}/import/csv/preview`,
      method: "POST",
      body: input,
      headers: this.headers(),
      requestClass: "query",
      policy: { timeoutMs: 15_000, retry: 0, signal },
    });
  }

  exportCsv(databaseId: string, input: CsvExportInput) {
    return this.command<{ csv: string; next_cursor: string | null }>(`${this.databasePath(databaseId)}/export/csv`, "POST", input);
  }

  private appendCsvChunk(chunks: string[], chunk: string) {
    if (!chunk) return;
    const previous = chunks[chunks.length - 1];
    if (previous && !/[\r\n]$/u.test(previous) && !/^[\r\n]/u.test(chunk)) chunks.push("\r\n");
    chunks.push(chunk);
  }

  async exportAllCsv(databaseId: string, input: Omit<CsvExportInput, "cursor" | "include_header">) {
    let cursor: string | null = null;
    const chunks: string[] = [];
    do {
      const page = await this.exportCsv(databaseId, { ...input, cursor, include_header: cursor === null });
      this.appendCsvChunk(chunks, page.csv);
      cursor = page.next_cursor;
    } while (cursor);
    return chunks.join("");
  }

  /** Keeps each response page bounded and lets Blob own the final byte sequence. */
  async exportCsvBlob(databaseId: string, input: Omit<CsvExportInput, "cursor" | "include_header">) {
    let cursor: string | null = null;
    const chunks: string[] = [];
    do {
      const page = await this.exportCsv(databaseId, { ...input, cursor, include_header: cursor === null });
      this.appendCsvChunk(chunks, page.csv);
      cursor = page.next_cursor;
    } while (cursor);
    return new Blob(chunks, { type: "text/csv;charset=utf-8" });
  }

  private query<T>(path: string, dedupeKey: string, signal?: AbortSignal) {
    return this.client.request<T>({
      path, headers: this.headers(), requestClass: "query",
      policy: { timeoutMs: 8_000, retry: 2, dedupeKey, signal },
    });
  }

  private command<T>(path: string, method: "POST" | "PUT" | "PATCH" | "DELETE", body: unknown) {
    return this.client.request<T>({
      path, method, body, headers: this.headers(), requestClass: "command",
      policy: { timeoutMs: 30_000, retry: 0, idempotencyKey: this.createId() },
    }).then((value) => {
      this.cacheGeneration += 1;
      this.cache.clear();
      this.latestCacheCommit.clear();
      this.queryCache?.invalidate({ userId: this.userId, workspaceId: this.workspaceId, domain: "databases" });
      return value;
    });
  }

  private cached<T>(
    key: string,
    load: (signal?: AbortSignal) => Promise<T>,
    signal?: AbortSignal,
    generation = this.cacheGeneration,
    onCommit?: (value: T, requestToken: number) => void,
  ): Promise<T> {
    const current = this.cache.get(key) as DatabaseCacheEntry<T> | undefined;
    if (current && current.expiresAt > this.now()) return Promise.resolve(current.value);
    if (current) {
      if (!current.refreshPromise) {
        const requestToken = this.beginCacheRequest(key);
        const refreshPromise = load().then((value) => {
          const active = this.cache.get(key) as DatabaseCacheEntry<T> | undefined;
          if (active === current && this.commitCache(key, value, requestToken, generation, undefined, current)) {
            onCommit?.(value, requestToken);
          }
        }).catch(() => undefined).finally(() => {
          if ((this.cache.get(key) as DatabaseCacheEntry<T> | undefined) === current) {
            current.refreshPromise = undefined;
          }
        });
        current.refreshPromise = refreshPromise;
      }
      return Promise.resolve(current.value);
    }
    const requestToken = this.beginCacheRequest(key);
    return load(signal).then((value) => {
      if (this.commitCache(key, value, requestToken, generation, signal)) {
        onCommit?.(value, requestToken);
      }
      return value;
    });
  }

  private beginCacheRequest(_key: string) {
    return ++this.cacheRequestSequence;
  }

  private canCommitCacheRequest(key: string, token: number, generation: number, signal?: AbortSignal) {
    return (this.latestCacheCommit.get(key) ?? 0) <= token
      && generation === this.cacheGeneration
      && !signal?.aborted;
  }

  private commitCache<T>(
    key: string,
    value: T,
    token: number,
    generation: number,
    signal?: AbortSignal,
    current?: DatabaseCacheEntry<T>,
  ) {
    if (!this.canCommitCacheRequest(key, token, generation, signal)) return false;
    if (current) {
      current.value = value;
      current.expiresAt = this.now() + DATABASE_CACHE_TTL_MS;
    } else {
      this.writeCache(key, value);
    }
    this.latestCacheCommit.set(key, token);
    return true;
  }

  private writeCache<T>(key: string, value: T) {
    this.cache.set(key, { value, expiresAt: this.now() + DATABASE_CACHE_TTL_MS });
  }

  private databasePath(databaseId: string) {
    return `/api/v2/databases/${encodeURIComponent(databaseId)}`;
  }

  private headers() {
    return { "x-workspace-id": this.workspaceId };
  }

  private shared<T>(query: string, load: (signal?: AbortSignal) => Promise<T>, signal?: AbortSignal) {
    if (!this.queryCache || !this.userId) return null;
    return this.queryCache.get(
      { userId: this.userId, workspaceId: this.workspaceId, domain: "databases", query },
      load,
      { ttlMs: DATABASE_CACHE_TTL_MS, signal },
    );
  }

  private primeBootstrap(value: DatabaseBootstrap) {
    if (!this.queryCache || !this.userId) return;
    this.queryCache.prime(
      { userId: this.userId, workspaceId: this.workspaceId, domain: "databases", query: "databases" },
      value.items,
      DATABASE_CACHE_TTL_MS,
    );
    if (value.bundle) {
      this.queryCache.prime(
        { userId: this.userId, workspaceId: this.workspaceId, domain: "databases", query: `database:${value.bundle.database.id}` },
        value.bundle,
        DATABASE_CACHE_TTL_MS,
      );
    }
  }
}
