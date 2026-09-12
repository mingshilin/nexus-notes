import { act, render, renderHook, waitFor } from "@testing-library/react";
import type { CollaborationComment, PublicShare, WorkspaceInvitation, WorkspaceMember, ActivityEntry, AuditEntry } from "@nexus/contracts";
import { describe, expect, it, vi } from "vitest";

import { invalidateCollaborationCache, useCollaborationCenterData } from "../src/collaboration/use-collaboration-center-data";

const now = "2026-08-30T00:00:00.000Z";
const member = { user_id: "user-2", email: "user2@example.test", display_name: "成员", role: "editor", revision: 1, joined_at: now, updated_at: now } as WorkspaceMember;
const invitation = { id: "invite-1", workspace_id: "workspace-1", email: "invite@example.test", role: "viewer", status: "pending", revision: 1, expires_at: "2026-09-01T00:00:00.000Z", created_by: "user-1", created_at: now, updated_at: now } as WorkspaceInvitation;
const comment = (id: string, targetId: string): CollaborationComment => ({ id, workspace_id: "workspace-1", target_type: "note", target_id: targetId, author_user_id: "user-1", author_display_name: "用户", parent_id: null, body: id, mention_user_ids: [], revision: 1, created_at: now, updated_at: now });
const share = { id: "share-1", entity_type: "note", entity_id: "note-1", status: "active", password_required: false, expires_at: null, revision: 1, created_at: now, updated_at: now } as PublicShare;
const activity = { id: "activity-1", workspace_id: "workspace-1", actor_user_id: "user-1", request_id: "request-1", action: "note.updated", target_type: "note", target_id: "note-1", metadata: {}, created_at: now } as ActivityEntry;
const audit = { id: "audit-1", workspace_id: "workspace-1", actor_user_id: "user-1", request_id: "request-2", action: "note.updated", target_type: "note", target_id: "note-1", metadata: {}, outcome: "success", created_at: now } as AuditEntry;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => { resolve = nextResolve; reject = nextReject; });
  return { promise, resolve, reject };
}

function client(overrides: Record<string, unknown> = {}) {
  return {
    listMembers: vi.fn(async () => [member]),
    listInvitations: vi.fn(async () => [invitation]),
    listComments: vi.fn(async () => [comment("comment-1", "note-1")]),
    listShares: vi.fn(async () => [share]),
    listActivity: vi.fn(async () => ({ items: [activity], next_cursor: null })),
    listAudit: vi.fn(async () => ({ items: [audit], next_cursor: null })),
    ...overrides,
  };
}

function Harness({ api, scope, targetId, section = "comments", commentTarget, onRender }: { api: object; scope: string; targetId: string; section?: "comments" | "shares" | "activity"; commentTarget?: { type: "note" | "database_record"; id: string }; onRender(state: ReturnType<typeof useCollaborationCenterData>): void }) {
  const state = useCollaborationCenterData({
    client: api as never,
    cacheScope: scope,
    canManage: true,
    canEdit: true,
    section,
    commentTarget: commentTarget ?? (section === "comments" ? { type: "note", id: targetId } : undefined),
  });
  onRender(state);
  return null;
}

describe("useCollaborationCenterData", () => {
  it("ignores a late comment response after the selected target changes", async () => {
    const oldComments = deferred<CollaborationComment[]>();
    const newComments = deferred<CollaborationComment[]>();
    const api = client({
      listComments: vi.fn((_: string, targetId: string) => targetId === "note-1" ? oldComments.promise : newComments.promise),
    });
    const snapshots: Array<ReturnType<typeof useCollaborationCenterData>> = [];
    const view = render(<Harness api={api} scope="user-1:workspace-1" targetId="note-1" onRender={(state) => snapshots.push(state)} />);
    await waitFor(() => expect(api.listComments).toHaveBeenCalledWith("note", "note-1", expect.any(AbortSignal)));
    view.rerender(<Harness api={api} scope="user-1:workspace-1" targetId="note-2" onRender={(state) => snapshots.push(state)} />);
    expect(snapshots.at(-1)?.comments).toEqual([]);
    oldComments.resolve([comment("late-old", "note-1")]);
    newComments.resolve([comment("new", "note-2")]);
    await waitFor(() => expect(snapshots.at(-1)?.comments.map((item) => item.id)).toEqual(["new"]));
    expect(snapshots.at(-1)?.comments.some((item) => item.id === "late-old")).toBe(false);
  });

  it("hydrates fresh base and section data on remount without repeating requests", async () => {
    const api = client();
    const first = renderHook(() => useCollaborationCenterData({ client: api as never, cacheScope: "user-1:workspace-1", canManage: true, canEdit: true, section: "shares", commentTarget: undefined }));
    await waitFor(() => expect(first.result.current.members).toHaveLength(1));
    await waitFor(() => expect(first.result.current.shares).toHaveLength(1));
    first.unmount();

    const second = renderHook(() => useCollaborationCenterData({ client: api as never, cacheScope: "user-1:workspace-1", canManage: true, canEdit: true, section: "shares", commentTarget: undefined }));
    expect(second.result.current.members).toEqual([member]);
    expect(second.result.current.shares).toEqual([share]);
    expect(second.result.current.baseLoading).toBe(false);
    expect(second.result.current.sectionLoading).toBe(false);
    expect(api.listMembers).toHaveBeenCalledOnce();
    expect(api.listInvitations).toHaveBeenCalledOnce();
    expect(api.listShares).toHaveBeenCalledOnce();
  });

  it("treats an existing empty section cache as missing on remount", async () => {
    const pendingShares = deferred<PublicShare[]>();
    const api = client({ listShares: vi.fn(() => pendingShares.promise) });
    const first = renderHook(() => useCollaborationCenterData({ client: api as never, cacheScope: "user-1:workspace-empty-section", canManage: true, canEdit: true, section: "shares" }));
    await waitFor(() => expect(api.listShares).toHaveBeenCalledOnce());
    first.unmount();

    const snapshots: Array<ReturnType<typeof useCollaborationCenterData>> = [];
    render(<Harness api={api} scope="user-1:workspace-empty-section" targetId="note-1" section="shares" onRender={(state) => snapshots.push(state)} />);
    expect(snapshots[0]?.sectionLoading).toBe(true);
    expect(api.listShares).toHaveBeenCalledOnce();
    pendingShares.resolve([share]);
    await waitFor(() => expect(snapshots.at(-1)?.shares).toEqual([share]));
  });

  it("keeps mounted consumers synchronized through the shared section cache", async () => {
    const api = client();
    const first = renderHook(() => useCollaborationCenterData({ client: api as never, cacheScope: "user-1:workspace-section-consumers", canManage: true, canEdit: true, section: "shares" }));
    const second = renderHook(() => useCollaborationCenterData({ client: api as never, cacheScope: "user-1:workspace-section-consumers", canManage: true, canEdit: true, section: "shares" }));
    await waitFor(() => expect(first.result.current.shares).toEqual([share]));

    act(() => { second.result.current.setShares([{ ...share, id: "share-updated" }]); });
    await waitFor(() => expect(first.result.current.shares.map((item) => item.id)).toEqual(["share-updated"]));
  });

  it("refreshes every mounted consumer after an external section invalidation", async () => {
    const refreshed = { ...share, id: "share-after-invalidation" };
    const api = client({
      listShares: vi.fn().mockResolvedValueOnce([share]).mockResolvedValueOnce([refreshed]),
    });
    const first = renderHook(() => useCollaborationCenterData({ client: api as never, cacheScope: "user-1:workspace-external-invalidation", canManage: true, canEdit: true, section: "shares" }));
    const second = renderHook(() => useCollaborationCenterData({ client: api as never, cacheScope: "user-1:workspace-external-invalidation", canManage: true, canEdit: true, section: "shares" }));
    await waitFor(() => expect(first.result.current.shares).toEqual([share]));

    act(() => invalidateCollaborationCache({
      client: api as never,
      cacheScope: "user-1:workspace-external-invalidation",
      canManage: true,
      canEdit: true,
      resource: "shares",
    }));
    await waitFor(() => expect(api.listShares).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(first.result.current.shares).toEqual([refreshed]));
    await waitFor(() => expect(second.result.current.shares).toEqual([refreshed]));
  });

  it("keeps refreshing true until both base and section requests settle", async () => {
    const members = deferred<WorkspaceMember[]>();
    const invitations = deferred<WorkspaceInvitation[]>();
    const shares = deferred<PublicShare[]>();
    const api = client({
      listMembers: vi.fn(() => members.promise),
      listInvitations: vi.fn(() => invitations.promise),
      listShares: vi.fn(() => shares.promise),
    });
    const { result } = renderHook(() => useCollaborationCenterData({ client: api as never, cacheScope: "user-1:workspace-refreshing", canManage: true, canEdit: true, section: "shares" }));
    await waitFor(() => {
      expect(api.listMembers).toHaveBeenCalled();
      expect(api.listInvitations).toHaveBeenCalled();
      expect(api.listShares).toHaveBeenCalled();
    });

    shares.resolve([share]);
    await waitFor(() => expect(result.current.shares).toEqual([share]));
    expect(result.current.refreshing).toBe(true);
    members.resolve([member]);
    invitations.resolve([invitation]);
    await waitFor(() => expect(result.current.refreshing).toBe(false));
  });

  it("ignores a late error from a section that is no longer active", async () => {
    const oldShares = deferred<PublicShare[]>();
    const api = client({
      listShares: vi.fn(() => oldShares.promise),
      listActivity: vi.fn(async () => ({ items: [activity], next_cursor: null })),
      listAudit: vi.fn(async () => ({ items: [audit], next_cursor: null })),
    });
    const { result, rerender } = renderHook((section: "shares" | "activity") => useCollaborationCenterData({ client: api as never, cacheScope: "user-1:workspace-late-error", canManage: true, canEdit: true, section }), { initialProps: "shares" });
    await waitFor(() => expect(api.listShares).toHaveBeenCalled());
    rerender("activity");
    await waitFor(() => expect(result.current.activity).toEqual([activity]));

    await act(async () => {
      oldShares.reject(new Error("old section failed"));
      await Promise.resolve();
    });
    expect(result.current.sectionError).toBeNull();
    expect(result.current.activity).toEqual([activity]);
  });

  it("writes a completed mutation to its original section cache after navigation", async () => {
    const api = client({ listActivity: vi.fn(async () => ({ items: [activity], next_cursor: null })) });
    const { result, rerender } = renderHook((section: "shares" | "activity") => useCollaborationCenterData({ client: api as never, cacheScope: "user-1:workspace-mutation-scope", canManage: true, canEdit: true, section }), { initialProps: "shares" });
    await waitFor(() => expect(result.current.shares).toEqual([share]));
    const setSharesFromOriginalSection = result.current.setShares;

    rerender("activity");
    await waitFor(() => expect(result.current.activity).toEqual([activity]));
    expect(setSharesFromOriginalSection([{ ...share, id: "share-after-navigation" }])).toBe(true);

    rerender("shares");
    await waitFor(() => expect(result.current.shares.map((item) => item.id)).toEqual(["share-after-navigation"]));
    expect(api.listShares).toHaveBeenCalledOnce();
  });

  it("keeps stale section data visible while an expired refresh is pending", async () => {
    let clock = 1_000;
    const refresh = deferred<PublicShare[]>();
    const api = client({ listShares: vi.fn().mockResolvedValueOnce([share]).mockReturnValueOnce(refresh.promise) });
    const first = renderHook(() => useCollaborationCenterData({ client: api as never, cacheScope: "user-1:workspace-stale", canManage: true, canEdit: true, section: "shares", now: () => clock }));
    await waitFor(() => expect(first.result.current.shares).toEqual([share]));
    first.unmount();
    clock = 121_001;
    const { result } = renderHook(() => useCollaborationCenterData({ client: api as never, cacheScope: "user-1:workspace-stale", canManage: true, canEdit: true, section: "shares", now: () => clock }));
    expect(result.current.shares).toEqual([share]);
    expect(result.current.refreshing).toBe(true);
    refresh.resolve([{ ...share, id: "share-refreshed" }]);
    await waitFor(() => expect(result.current.shares[0]?.id).toBe("share-refreshed"));
  });

  it("deduplicates section retries while a refresh is already in flight", async () => {
    const pendingShares = deferred<PublicShare[]>();
    let firstSignal: AbortSignal | undefined;
    const api = client({
      listShares: vi.fn((options: { signal?: AbortSignal }) => {
        firstSignal = options.signal;
        return pendingShares.promise;
      }),
    });
    const { result } = renderHook(() => useCollaborationCenterData({ client: api as never, cacheScope: "user-1:workspace-retry-dedupe", canManage: true, canEdit: true, section: "shares" }));
    await waitFor(() => expect(api.listShares).toHaveBeenCalledOnce());

    act(() => {
      result.current.retrySection();
      result.current.retrySection();
    });
    expect(api.listShares).toHaveBeenCalledOnce();
    expect(firstSignal?.aborted).toBe(false);
    pendingShares.resolve([share]);
    await waitFor(() => expect(result.current.shares).toEqual([share]));
  });

  it("rejects a setter retained by a previous scope", async () => {
    const api = client();
    const nextApi = client({ listMembers: vi.fn(async () => [{ ...member, user_id: "user-3" }]) });
    const { result, rerender } = renderHook((props: { api: object; scope: string }) => useCollaborationCenterData({ client: props.api as never, cacheScope: props.scope, canManage: true, canEdit: true, section: "people" }), { initialProps: { api, scope: "user-1:workspace-1" } });
    await waitFor(() => expect(result.current.members).toHaveLength(1));
    const staleSetMembers = result.current.setMembers;
    rerender({ api: nextApi, scope: "user-2:workspace-2" });
    await waitFor(() => expect(result.current.members[0]?.user_id).toBe("user-3"));
    act(() => { staleSetMembers([{ ...member, user_id: "stale" }]); });
    expect(result.current.members[0]?.user_id).toBe("user-3");
  });

  it("applies sequential functional member updates to the latest value", async () => {
    const api = client();
    const { result } = renderHook(() => useCollaborationCenterData({ client: api as never, cacheScope: "user-1:workspace-functional", canManage: true, canEdit: true, section: "people" }));
    await waitFor(() => expect(result.current.members).toHaveLength(1));
    act(() => {
      result.current.setMembers((current) => [...current, { ...member, user_id: "user-3", display_name: "成员 3" }]);
      result.current.setMembers((current) => [...current, { ...member, user_id: "user-4", display_name: "成员 4" }]);
    });
    expect(result.current.members.map((item) => item.user_id)).toEqual(["user-2", "user-3", "user-4"]);
  });

  it("keeps stale comments after a failed refresh and exposes a retryable error", async () => {
    const retry = deferred<CollaborationComment[]>();
    const api = client({
      listComments: vi.fn().mockResolvedValueOnce([comment("stale", "note-1")]).mockRejectedValueOnce(new Error("offline")).mockReturnValueOnce(retry.promise),
    });
    const { result } = renderHook(() => useCollaborationCenterData({ client: api as never, cacheScope: "user-1:workspace-retry", canManage: true, canEdit: true, section: "comments", commentTarget: { type: "note", id: "note-1" }, ttlMs: 0 }));
    await waitFor(() => expect(result.current.comments[0]?.id).toBe("stale"));
    act(() => result.current.retrySection());
    await waitFor(() => expect(result.current.error).toContain("协作服务"));
    expect(result.current.comments[0]?.id).toBe("stale");
    act(() => result.current.retrySection());
    retry.resolve([comment("recovered", "note-1")]);
    await waitFor(() => expect(result.current.comments[0]?.id).toBe("recovered"));
  });
});
