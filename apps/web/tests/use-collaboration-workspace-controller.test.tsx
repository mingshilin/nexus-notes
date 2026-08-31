import { act, renderHook, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import type { Database, DatabaseRecord, Note } from "@nexus/contracts";
import { describe, expect, it, vi } from "vitest";

import { filterWorkspaceDatabaseRecords, filterWorkspaceDatabases, getActiveDatabaseId, getVerifiedCollaborationTarget, scopeDatabaseBundle, useCollaborationWorkspaceController } from "../src/app/use-collaboration-workspace-controller";

const note = { id: "note-1", workspace_id: "ws-1", title: "当前笔记", content: "内容", status: "active", revision: 1 } as Note;
const database = { id: "db-1", workspace_id: "ws-1", name: "项目", description: "", created_by: "user-1", revision: 1 } as Database;
const record = { id: "record-1", workspace_id: "ws-1", database_id: "db-1", note_id: null, values: { name: "任务" }, created_by: "user-1", updated_by: "user-1", revision: 1 } as DatabaseRecord;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => { resolve = nextResolve; });
  return { promise, resolve };
}

function props(overrides: Record<string, unknown> = {}) {
  return {
    client: { getUnreadCount: vi.fn(async () => 0) },
    databaseClient: {
      listDatabases: vi.fn(async () => [database]),
      getRecord: vi.fn(async () => record),
    },
    workspaceId: "ws-1",
    userId: "user-1",
    collaborationEnabled: true,
    role: "owner",
    notes: [note],
    selectedNoteId: note.id,
    databases: [database],
    databaseRecords: [record],
    setSelectedNoteId: vi.fn(),
    setSelectedDatabaseId: vi.fn(),
    setSelectedDatabaseRecordId: vi.fn(),
    setResolvedNotificationRecord: vi.fn(),
    setSelectedCommentId: vi.fn(),
    setCollaborationInitialSection: vi.fn(),
    setDatabases: vi.fn(),
    setDatabaseError: vi.fn(),
    transitionToDomain: vi.fn(),
    ...overrides,
  };
}

describe("useCollaborationWorkspaceController", () => {
  it("ignores an unread-count response from the previous workspace", async () => {
    const oldCount = deferred<number>();
    const newCount = deferred<number>();
    const input = props({
      client: { getUnreadCount: vi.fn((signal: AbortSignal) => signal.aborted ? Promise.reject(new DOMException("aborted", "AbortError")) : oldCount.promise) },
    });
    const { result, rerender } = renderHook((value) => useCollaborationWorkspaceController(value as never), { initialProps: input });
    rerender({ ...input, workspaceId: "ws-2", client: { getUnreadCount: vi.fn(() => newCount.promise) } });

    oldCount.resolve(9);
    newCount.resolve(2);
    await waitFor(() => expect(result.current.unreadCount).toBe(2));
    expect(result.current.unreadCount).not.toBe(9);
  });

  it("starts only one unread request for a newly selected workspace", async () => {
    const previousIdle = (window as Window & { requestIdleCallback?: unknown }).requestIdleCallback;
    Object.defineProperty(window, "requestIdleCallback", { configurable: true, value: (callback: () => void) => { callback(); return 1; } });
    const oldClient = { getUnreadCount: vi.fn(async () => 1) };
    const newClient = { getUnreadCount: vi.fn(async () => 2) };
    try {
      const input = props({ client: oldClient });
      const { result, rerender } = renderHook((value) => useCollaborationWorkspaceController(value as never), { initialProps: input });
      await waitFor(() => expect(oldClient.getUnreadCount).toHaveBeenCalledOnce());

      rerender({ ...input, client: newClient, workspaceId: "ws-2" });
      await waitFor(() => expect(result.current.unreadCount).toBe(2));
      expect(newClient.getUnreadCount).toHaveBeenCalledOnce();
    } finally {
      if (previousIdle === undefined) delete (window as Window & { requestIdleCallback?: unknown }).requestIdleCallback;
      else Object.defineProperty(window, "requestIdleCallback", { configurable: true, value: previousIdle });
    }
  });

  it("navigates to a note notification without waiting for another read", () => {
    const input = props({ notes: [{ ...note, id: "note-9" }] });
    const { result } = renderHook(() => useCollaborationWorkspaceController(input as never));

    act(() => result.current.navigateNotificationTarget({ targetType: "note", targetId: "note-9", commentId: "comment-9" }));

    expect(input.setSelectedNoteId).toHaveBeenCalledWith("note-9");
    expect(input.setSelectedDatabaseId).not.toHaveBeenCalled();
    expect(input.setSelectedDatabaseRecordId).toHaveBeenCalledWith(null);
    expect(input.setResolvedNotificationRecord).toHaveBeenCalledWith(null);
    expect(input.setSelectedCommentId).toHaveBeenCalledWith("comment-9");
    expect(input.setCollaborationInitialSection).toHaveBeenCalledWith("comments");
    expect(input.transitionToDomain).toHaveBeenCalledWith("collaboration");
  });

  it("rejects a note notification that is not present in the active workspace", async () => {
    const input = props({ notes: [] });
    const { result } = renderHook(() => useCollaborationWorkspaceController(input as never));

    act(() => result.current.navigateNotificationTarget({ targetType: "note", targetId: "note-missing", commentId: "comment-1" }));

    await waitFor(() => expect(result.current.targetError).toBe("无法定位通知中的笔记。"));
    expect(input.setSelectedNoteId).toHaveBeenCalledWith(null);
    expect(input.transitionToDomain).toHaveBeenCalledWith("collaboration");
  });

  it("ignores notification callbacks retained from the previous workspace", async () => {
    const input = props();
    const { result, rerender } = renderHook((value) => useCollaborationWorkspaceController(value as never), { initialProps: input });
    const opener = document.createElement("button");
    act(() => result.current.toggleNotifications(opener));
    const staleRead = result.current.onNotificationRead;
    const staleNavigate = result.current.navigateNotificationTarget;

    rerender({ ...input, workspaceId: "ws-2" });
    act(() => {
      staleRead(5);
      staleNavigate({ targetType: "note", targetId: "old-note", commentId: "old-comment" });
    });
    expect(result.current.unreadCount).toBe(0);
    expect(input.setSelectedNoteId).not.toHaveBeenCalledWith("old-note");
    expect(input.transitionToDomain).not.toHaveBeenCalledWith("collaboration");
  });

  it("rejects a retained note target after the same workspace refresh removes it", async () => {
    const input = props();
    const { result, rerender } = renderHook((value) => useCollaborationWorkspaceController(value as never), { initialProps: input });
    const staleNavigate = result.current.navigateNotificationTarget;

    rerender({ ...input, notes: [{ ...note, id: "note-new" }] });
    act(() => staleNavigate({ targetType: "note", targetId: note.id, commentId: "stale-comment" }));

    await waitFor(() => expect(result.current.targetError).toBeNull());
    expect(input.setSelectedNoteId).not.toHaveBeenCalledWith(note.id);
    expect(input.setSelectedCommentId).not.toHaveBeenCalledWith(null);
    expect(input.transitionToDomain).not.toHaveBeenCalledWith("collaboration");
  });

  it("selects a loaded database notification target without issuing lookup requests", () => {
    const input = props();
    const { result } = renderHook(() => useCollaborationWorkspaceController(input as never));

    act(() => result.current.navigateNotificationTarget({ targetType: "database_record", targetId: record.id, commentId: "comment-1", databaseId: database.id }));

    expect(input.databaseClient.listDatabases).not.toHaveBeenCalled();
    expect(input.databaseClient.getRecord).not.toHaveBeenCalled();
    expect(input.setSelectedNoteId).toHaveBeenCalledWith(null);
    expect(input.setSelectedDatabaseId).toHaveBeenCalledWith(database.id);
    expect(input.setSelectedDatabaseRecordId).toHaveBeenCalledWith(record.id);
    expect(input.setResolvedNotificationRecord).toHaveBeenCalledWith(record);
    expect(input.transitionToDomain).toHaveBeenCalledWith("collaboration");
  });

  it("does not apply a database lookup after the workspace scope changes", async () => {
    const databases = deferred<Database[]>();
    const records = deferred<DatabaseRecord>();
    const input = props({
      databases: [],
      databaseRecords: [],
      databaseClient: { listDatabases: vi.fn(() => databases.promise), getRecord: vi.fn(() => records.promise) },
    });
    const { result, rerender } = renderHook((value) => useCollaborationWorkspaceController(value as never), { initialProps: input });
    act(() => result.current.navigateNotificationTarget({ targetType: "database_record", targetId: "record-late", commentId: "comment-late" }));
    rerender({ ...input, workspaceId: "ws-2" });

    databases.resolve([database]);
    records.resolve({ ...record, id: "record-late" });
    await waitFor(() => expect(input.transitionToDomain).not.toHaveBeenCalled());
    expect(input.setResolvedNotificationRecord.mock.calls.some(([value]) => value && typeof value === "object")).toBe(false);
  });

  it("rejects an unloaded record when same-workspace data changes during lookup", async () => {
    const databases = deferred<Database[]>();
    const records = deferred<DatabaseRecord>();
    const input = props({
      databases: [],
      databaseRecords: [],
      databaseClient: { listDatabases: vi.fn(() => databases.promise), getRecord: vi.fn(() => records.promise) },
    });
    const { result, rerender } = renderHook((value) => useCollaborationWorkspaceController(value as never), { initialProps: input });

    act(() => result.current.navigateNotificationTarget({ targetType: "database_record", targetId: record.id, commentId: "stale-comment" }));
    rerender({ ...input, databases: [database] });
    databases.resolve([database]);
    records.resolve(record);

    await waitFor(() => expect(result.current.targetError).toBeNull());
    expect(input.setSelectedDatabaseRecordId).not.toHaveBeenCalledWith(record.id);
    expect(input.transitionToDomain).not.toHaveBeenCalledWith("collaboration");
  });

  it("invalidates database lookups and retained callbacks when the database client changes", async () => {
    const oldDatabases = deferred<Database[]>();
    const newDatabases = deferred<Database[]>();
    const oldDatabaseClient = { listDatabases: vi.fn(() => oldDatabases.promise), getRecord: vi.fn(async () => record) };
    const newDatabaseClient = { listDatabases: vi.fn(() => newDatabases.promise), getRecord: vi.fn(async () => record) };
    const input = props({ databases: [], databaseRecords: [], databaseClient: oldDatabaseClient });
    const { result, rerender } = renderHook((value) => useCollaborationWorkspaceController(value as never), { initialProps: input });
    const staleNavigate = result.current.navigateNotificationTarget;
    act(() => staleNavigate({ targetType: "database_record", targetId: record.id, commentId: "old-comment" }));
    expect(oldDatabaseClient.listDatabases).toHaveBeenCalledOnce();

    rerender({ ...input, databaseClient: newDatabaseClient });
    act(() => staleNavigate({ targetType: "database_record", targetId: record.id, commentId: "stale-comment" }));
    expect(oldDatabaseClient.listDatabases).toHaveBeenCalledOnce();
    oldDatabases.resolve([database]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(input.transitionToDomain).not.toHaveBeenCalled();

    act(() => result.current.navigateNotificationTarget({ targetType: "database_record", targetId: record.id, commentId: "new-comment" }));
    expect(newDatabaseClient.listDatabases).toHaveBeenCalledOnce();
    newDatabases.resolve([database]);
    await waitFor(() => expect(input.transitionToDomain).toHaveBeenCalledWith("collaboration"));
    expect(input.setSelectedCommentId).toHaveBeenLastCalledWith("new-comment");
  });

  it("does not start a database lookup from a callback retained after collaboration is disabled", async () => {
    const input = props({ databases: [], databaseRecords: [] });
    const { result, rerender } = renderHook((value) => useCollaborationWorkspaceController(value as never), { initialProps: input });
    const staleNavigate = result.current.navigateNotificationTarget;
    rerender({ ...input, collaborationEnabled: false });

    act(() => staleNavigate({ targetType: "database_record", targetId: "record-stale", commentId: null }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(input.databaseClient.listDatabases).not.toHaveBeenCalled();
    expect(input.transitionToDomain).not.toHaveBeenCalledWith("collaboration");
  });

  it("rejects a database target returned for a different workspace", async () => {
    const input = props({
      databases: [],
      databaseRecords: [],
      databaseClient: {
        listDatabases: vi.fn(async () => [{ ...database, workspace_id: "ws-other" }]),
        getRecord: vi.fn(async () => ({ ...record, workspace_id: "ws-other" })),
      },
    });
    const { result } = renderHook(() => useCollaborationWorkspaceController(input as never));

    act(() => result.current.navigateNotificationTarget({ targetType: "database_record", targetId: record.id, commentId: "comment-1" }));

    await waitFor(() => expect(input.setDatabaseError).toHaveBeenCalledWith("无法定位通知中的数据库记录。"));
    expect(input.transitionToDomain).toHaveBeenCalledWith("collaboration");
    expect(input.setResolvedNotificationRecord).toHaveBeenCalledWith(null);
    expect(input.setSelectedDatabaseRecordId).not.toHaveBeenCalledWith(record.id);
  });

  it("filters mixed-workspace databases before committing a resolved target", async () => {
    const otherDatabase = { ...database, id: "db-other", workspace_id: "ws-other", name: "不属于当前工作区" };
    const input = props({
      databases: [],
      databaseRecords: [],
      databaseClient: {
        listDatabases: vi.fn(async () => [database, otherDatabase]),
        getRecord: vi.fn(async () => record),
      },
    });
    const { result } = renderHook(() => useCollaborationWorkspaceController(input as never));

    act(() => result.current.navigateNotificationTarget({ targetType: "database_record", targetId: record.id, commentId: "comment-1" }));

    await waitFor(() => expect(input.setResolvedNotificationRecord).toHaveBeenCalledWith(record));
    expect(input.setDatabases).toHaveBeenCalledWith([database]);
    expect(input.setDatabases.mock.calls.flatMap(([value]) => typeof value === "function" ? [] : value)).not.toContain(otherDatabase);
  });

  it("rejects a database response whose record ID does not match the notification target", async () => {
    const input = props({
      databases: [],
      databaseRecords: [],
      databaseClient: {
        listDatabases: vi.fn(async () => [database]),
        getRecord: vi.fn(async () => ({ ...record, id: "record-wrong" })),
      },
    });
    const { result } = renderHook(() => useCollaborationWorkspaceController(input as never));

    act(() => result.current.navigateNotificationTarget({ targetType: "database_record", targetId: record.id, commentId: "comment-1" }));

    await waitFor(() => expect(input.setDatabaseError).toHaveBeenCalledWith("无法定位通知中的数据库记录。"));
    expect(input.setSelectedNoteId).toHaveBeenCalledWith(null);
    expect(input.setResolvedNotificationRecord).toHaveBeenCalledWith(null);
    expect(input.transitionToDomain).toHaveBeenCalledWith("collaboration");
    expect(input.setSelectedDatabaseRecordId).not.toHaveBeenCalledWith(record.id);
  });

  it("exposes database deep-link failures as a collaboration error instead of an unrelated target", async () => {
    const input = props({ databases: [database], databaseRecords: [record], databaseClient: {
      listDatabases: vi.fn(async () => []),
      getRecord: vi.fn(async () => record),
    } });
    const { result } = renderHook(() => useCollaborationWorkspaceController(input as never));

    act(() => result.current.navigateNotificationTarget({ targetType: "database_record", targetId: "missing-record", commentId: "comment-1" }));

    await waitFor(() => expect(result.current.targetError).toBe("无法定位通知中的数据库记录。"));
    expect(input.setSelectedDatabaseRecordId).toHaveBeenCalledWith(null);
    expect(input.setSelectedCommentId).toHaveBeenCalledWith(null);
    expect(input.transitionToDomain).toHaveBeenCalledWith("collaboration");
  });

  it("filters database records used by collaboration targets to the active workspace", () => {
    const otherDatabase = { ...database, id: "db-other", workspace_id: "ws-other" };
    const otherRecord = { ...record, id: "record-other", database_id: otherDatabase.id, workspace_id: "ws-other" };
    expect(filterWorkspaceDatabases([database, otherDatabase], "ws-1")).toEqual([database]);
    expect(filterWorkspaceDatabaseRecords([record, otherRecord], "ws-1")).toEqual([record]);
    expect(filterWorkspaceDatabaseRecords([record, { ...record, id: "record-2", database_id: "db-2" }], "ws-1", new Set([database.id]))).toEqual([record]);
  });

  it("chooses the verified bundle database before a stale same-workspace selection", () => {
    expect(getActiveDatabaseId("db-2", { database, role: "owner", properties: [], views: [], templates: [] }, "ws-1")).toBeNull();
    expect(getActiveDatabaseId(null, { database, role: "owner", properties: [], views: [], templates: [] }, "ws-1")).toBeNull();
    expect(getActiveDatabaseId("db-2", null, "ws-1")).toBeNull();
    expect(getActiveDatabaseId("missing", null, "ws-1")).toBeNull();
  });

  it("does not treat a record from a database outside the active workspace as a collaboration target", () => {
    const otherDatabase = { ...database, id: "db-other", workspace_id: "ws-other" };
    const foreignRecord = { ...record, database_id: otherDatabase.id, workspace_id: "ws-1" };
    const scopedDatabases = filterWorkspaceDatabases([database, otherDatabase], "ws-1");
    const scopedRecords = filterWorkspaceDatabaseRecords([record, foreignRecord], "ws-1", new Set(scopedDatabases.map((item) => item.id)));
    expect(scopedRecords).toEqual([record]);
  });

  it("scopes every database bundle entity to its workspace and database", () => {
    const invalidProperty = { id: "foreign-property", workspace_id: "ws-1", database_id: "db-other" };
    const invalidView = { id: "foreign-view", workspace_id: "ws-other", database_id: "db-1" };
    const invalidTemplate = { id: "foreign-template", workspace_id: "ws-1", database_id: "db-other" };
    const bundle = {
      database,
      role: "owner",
      properties: [{ id: "property-1", workspace_id: "ws-1", database_id: "db-1" }, invalidProperty],
      views: [{ id: "view-1", workspace_id: "ws-1", database_id: "db-1" }, invalidView],
      templates: [{ id: "template-1", workspace_id: "ws-1", database_id: "db-1" }, invalidTemplate],
    } as never;
    const scoped = scopeDatabaseBundle(bundle, "ws-1");
    expect(scoped?.properties.map((item) => item.id)).toEqual(["property-1"]);
    expect(scoped?.views.map((item) => item.id)).toEqual(["view-1"]);
    expect(scoped?.templates.map((item) => item.id)).toEqual(["template-1"]);
  });

  it("exposes an active collaboration target only when it is in the verified target set", () => {
    const targets = [{ type: "note" as const, id: note.id, label: note.title }];

    expect(getVerifiedCollaborationTarget("foreign-record", note.id, targets)).toEqual({ type: "note", id: note.id });
    expect(getVerifiedCollaborationTarget("foreign-record", null, targets)).toBeUndefined();
  });

  it("toggles notifications with an opener and resets the transient state on scope change", () => {
    const input = props();
    const { result, rerender } = renderHook((value) => useCollaborationWorkspaceController(value as never), { initialProps: input });
    const opener = document.createElement("button");

    act(() => result.current.toggleNotifications(opener));
    expect(result.current.notificationOpen).toBe(true);
    expect(result.current.notificationOpenerRef.current).toBe(opener);
    rerender({ ...input, workspaceId: "ws-2" });
    expect(result.current.notificationOpen).toBe(false);
    expect(result.current.unreadCount).toBe(0);
  });

  it("resets notification state when collaboration capability changes", () => {
    const input = props();
    const { result, rerender } = renderHook((value) => useCollaborationWorkspaceController(value as never), { initialProps: input });
    const opener = document.createElement("button");

    act(() => result.current.toggleNotifications(opener));
    expect(result.current.notificationOpen).toBe(true);
    rerender({ ...input, collaborationEnabled: false });
    expect(result.current.notificationOpen).toBe(false);
    expect(result.current.unreadCount).toBe(0);
    rerender({ ...input, collaborationEnabled: true });
    expect(result.current.notificationOpen).toBe(false);
  });

  it("resets notification state when the workspace role changes", () => {
    const input = props();
    const { result, rerender } = renderHook((value) => useCollaborationWorkspaceController(value as never), { initialProps: input });
    const opener = document.createElement("button");

    act(() => result.current.toggleNotifications(opener));
    expect(result.current.notificationOpen).toBe(true);
    rerender({ ...input, role: "viewer" });
    expect(result.current.notificationOpen).toBe(false);
    expect(result.current.unreadCount).toBe(0);
    act(() => result.current.toggleNotifications(opener));
    expect(result.current.notificationOpen).toBe(true);
    expect(result.current.notificationOpenerRef.current).toBe(opener);
  });

  it("keeps the newly committed callback usable when a scope changes from default state", () => {
    const input = props();
    const { result, rerender } = renderHook((value) => useCollaborationWorkspaceController(value as never), { initialProps: input });
    const opener = document.createElement("button");

    rerender({ ...input, role: "viewer" });
    act(() => result.current.toggleNotifications(opener));
    expect(result.current.notificationOpen).toBe(true);
    expect(result.current.notificationOpenerRef.current).toBe(opener);
  });

  it("keeps the initial notification callback usable through StrictMode effect replay", () => {
    const input = props();
    const { result } = renderHook((value) => useCollaborationWorkspaceController(value as never), {
      initialProps: input,
      wrapper: StrictMode,
    });
    const opener = document.createElement("button");

    act(() => result.current.toggleNotifications(opener));
    expect(result.current.notificationOpen).toBe(true);
    expect(result.current.notificationOpenerRef.current).toBe(opener);
  });
});
