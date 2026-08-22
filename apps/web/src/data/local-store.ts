import { SyncOperationSchema, type SyncOperation } from "@nexus/contracts";

const DATABASE_VERSION = 1;

type StoreName = "query_snapshots" | "drafts" | "operations" | "uploads" | "sync_cursors";

export interface LocalDraft {
  workspace_id: string;
  entity_id: string;
  title: string;
  content: string;
  updated_at: string;
}

export interface QuerySnapshot {
  key: string;
  workspace_id: string;
  data: unknown;
  revision: number;
  cached_at: string;
}

export interface UploadMetadata {
  upload_id: string;
  workspace_id: string;
  entity_id: string;
  filename: string;
  status: "pending" | "uploading" | "failed";
  updated_at: string;
}

function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function transactionDone(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed"));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
  });
}

export class BetaLocalStore {
  private readonly databaseName: string;
  private readonly database: Promise<IDBDatabase>;

  constructor(options: { databaseName?: string } = {}) {
    this.databaseName = options.databaseName ?? "nexus-notes-beta";
    this.database = this.open();
  }

  async saveDraft(draft: LocalDraft) {
    await this.put("drafts", { ...draft, key: this.entityKey(draft.workspace_id, draft.entity_id) });
  }

  async getDraft(workspaceId: string, entityId: string): Promise<LocalDraft | null> {
    return this.get<LocalDraft>("drafts", this.entityKey(workspaceId, entityId));
  }

  async listDrafts(workspaceId: string): Promise<LocalDraft[]> {
    const database = await this.database;
    const transaction = database.transaction("drafts", "readonly");
    const done = transactionDone(transaction);
    const drafts = await requestResult(transaction.objectStore("drafts").getAll()) as LocalDraft[];
    await done;
    return drafts
      .filter((draft) => draft.workspace_id === workspaceId)
      .sort((left, right) => right.updated_at.localeCompare(left.updated_at));
  }

  async removeDraft(workspaceId: string, entityId: string) {
    const database = await this.database;
    const transaction = database.transaction("drafts", "readwrite");
    const done = transactionDone(transaction);
    transaction.objectStore("drafts").delete(this.entityKey(workspaceId, entityId));
    await done;
  }

  async saveQuerySnapshot(snapshot: QuerySnapshot) {
    await this.put("query_snapshots", snapshot);
  }

  async getQuerySnapshot<T = unknown>(key: string): Promise<(QuerySnapshot & { data: T }) | null> {
    return this.get<QuerySnapshot & { data: T }>("query_snapshots", key);
  }

  async saveUpload(metadata: UploadMetadata) {
    await this.put("uploads", metadata);
  }

  async enqueueOperation(operation: SyncOperation) {
    await this.put("operations", SyncOperationSchema.parse(operation));
  }

  async listOperations(workspaceId: string): Promise<SyncOperation[]> {
    const database = await this.database;
    const transaction = database.transaction("operations", "readonly");
    const done = transactionDone(transaction);
    const all = await requestResult(transaction.objectStore("operations").getAll()) as SyncOperation[];
    await done;
    return all
      .filter((operation) => operation.workspace_id === workspaceId)
      .sort((left, right) => left.created_at.localeCompare(right.created_at) || left.operation_id.localeCompare(right.operation_id));
  }

  async removeOperation(operationId: string) {
    const database = await this.database;
    const transaction = database.transaction("operations", "readwrite");
    const done = transactionDone(transaction);
    transaction.objectStore("operations").delete(operationId);
    await done;
  }

  async setSyncCursor(workspaceId: string, cursor: string) {
    await this.put("sync_cursors", { workspace_id: workspaceId, cursor });
  }

  async getSyncCursor(workspaceId: string): Promise<string | null> {
    const record = await this.get<{ workspace_id: string; cursor: string }>("sync_cursors", workspaceId);
    return record?.cursor ?? null;
  }

  async destroy() {
    const database = await this.database;
    database.close();
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(this.databaseName);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error ?? new Error("Failed to delete IndexedDB database"));
      request.onblocked = () => reject(new Error("IndexedDB database deletion was blocked"));
    });
  }

  private async open() {
    return new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(this.databaseName, DATABASE_VERSION);
      request.onerror = () => reject(request.error ?? new Error("Failed to open IndexedDB"));
      request.onsuccess = () => resolve(request.result);
      request.onupgradeneeded = () => {
        const database = request.result;
        database.createObjectStore("query_snapshots", { keyPath: "key" });
        database.createObjectStore("drafts", { keyPath: "key" });
        database.createObjectStore("operations", { keyPath: "operation_id" });
        database.createObjectStore("uploads", { keyPath: "upload_id" });
        database.createObjectStore("sync_cursors", { keyPath: "workspace_id" });
      };
    });
  }

  private async put(storeName: StoreName, value: unknown) {
    const database = await this.database;
    const transaction = database.transaction(storeName, "readwrite");
    const done = transactionDone(transaction);
    transaction.objectStore(storeName).put(value);
    await done;
  }

  private async get<T>(storeName: StoreName, key: IDBValidKey): Promise<T | null> {
    const database = await this.database;
    const transaction = database.transaction(storeName, "readonly");
    const done = transactionDone(transaction);
    const value = await requestResult(transaction.objectStore(storeName).get(key));
    await done;
    return (value as T | undefined) ?? null;
  }

  private entityKey(workspaceId: string, entityId: string) {
    return `${workspaceId}:${entityId}`;
  }
}
