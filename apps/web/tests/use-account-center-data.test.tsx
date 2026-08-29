import { act, render, renderHook, waitFor } from "@testing-library/react";
import type { AccountSession, Profile } from "@nexus/contracts";
import { StrictMode } from "react";
import { describe, expect, it, vi } from "vitest";

import { useAccountCenterData } from "../src/account/use-account-center-data";

const profile = {
  id: "user-1",
  email: "user@example.test",
  display_name: "用户",
  biography: "",
  locale: "zh-CN",
  timezone: "Asia/Shanghai",
  avatar_url: null,
  updated_at: "2026-08-29T00:00:00.000Z",
} as Profile;

const sessions = [{
  id: "session-1",
  current: true,
  user_agent: "Chrome",
  created_at: "2026-08-29T00:00:00.000Z",
  last_seen_at: "2026-08-29T00:00:00.000Z",
  expires_at: "2026-09-29T00:00:00.000Z",
}] as AccountSession[];

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => { resolve = nextResolve; });
  return { promise, resolve };
}

function Harness({ client, cacheScope, onRender, now }: {
  client: object;
  cacheScope: string;
  onRender(snapshot: ReturnType<typeof useAccountCenterData>): void;
  now?: () => number;
}) {
  const state = useAccountCenterData({ client: client as never, cacheScope, now });
  onRender(state);
  return null;
}

describe("useAccountCenterData", () => {
  it("hydrates a fresh profile and sessions cache on remount without duplicate requests", async () => {
    const client = {
      getProfile: vi.fn(async () => profile),
      listSessions: vi.fn(async () => sessions),
    };
    const first = renderHook(() => useAccountCenterData({ client: client as never, cacheScope: "user-1:workspace-1", now: () => 1_000 }));
    await waitFor(() => expect(first.result.current.profile).toEqual(profile));
    await waitFor(() => expect(first.result.current.sessions).toEqual(sessions));
    first.unmount();

    const snapshots: Array<ReturnType<typeof useAccountCenterData>> = [];
    render(<Harness client={client} cacheScope="user-1:workspace-1" now={() => 1_000} onRender={(state) => snapshots.push(state)} />);
    expect(snapshots[0]?.profile).toEqual(profile);
    expect(snapshots[0]?.sessions).toEqual(sessions);
    expect(snapshots[0]?.profileLoading).toBe(false);
    expect(snapshots[0]?.sessionsLoading).toBe(false);
    expect(client.getProfile).toHaveBeenCalledOnce();
    expect(client.listSessions).toHaveBeenCalledOnce();
  });

  it("shares both initial requests between StrictMode and simultaneous consumers", async () => {
    const profileRequest = deferred<Profile>();
    const sessionsRequest = deferred<AccountSession[]>();
    const client = {
      getProfile: vi.fn(() => profileRequest.promise),
      listSessions: vi.fn(() => sessionsRequest.promise),
    };
    const first = renderHook(() => useAccountCenterData({ client: client as never, cacheScope: "user-1:workspace-concurrent" }));
    const second = renderHook(() => useAccountCenterData({ client: client as never, cacheScope: "user-1:workspace-concurrent" }));
    render(<StrictMode><Harness client={client} cacheScope="user-1:workspace-concurrent" onRender={() => undefined} /></StrictMode>);
    expect(client.getProfile).toHaveBeenCalledOnce();
    expect(client.listSessions).toHaveBeenCalledOnce();

    profileRequest.resolve(profile);
    sessionsRequest.resolve(sessions);
    await waitFor(() => expect(first.result.current.profile).toEqual(profile));
    await waitFor(() => expect(second.result.current.sessions).toEqual(sessions));
    first.unmount();
    second.unmount();
  });

  it("aborts an abandoned shared request and starts a new one after remount", async () => {
    const firstProfile = deferred<Profile>();
    const firstSessions = deferred<AccountSession[]>();
    const secondProfile = deferred<Profile>();
    const secondSessions = deferred<AccountSession[]>();
    const profileSignals: AbortSignal[] = [];
    const sessionSignals: AbortSignal[] = [];
    const client = {
      getProfile: vi.fn((signal?: AbortSignal) => {
        if (signal) profileSignals.push(signal);
        return profileSignals.length === 1 ? firstProfile.promise : secondProfile.promise;
      }),
      listSessions: vi.fn((signal?: AbortSignal) => {
        if (signal) sessionSignals.push(signal);
        return sessionSignals.length === 1 ? firstSessions.promise : secondSessions.promise;
      }),
    };
    const first = renderHook(() => useAccountCenterData({ client: client as never, cacheScope: "user-abandoned:workspace-1" }));
    await waitFor(() => expect(client.getProfile).toHaveBeenCalledOnce());
    await waitFor(() => expect(client.listSessions).toHaveBeenCalledOnce());
    first.unmount();
    await act(async () => { await Promise.resolve(); });
    expect(profileSignals[0]?.aborted).toBe(true);
    expect(sessionSignals[0]?.aborted).toBe(true);
    const second = renderHook(() => useAccountCenterData({ client: client as never, cacheScope: "user-abandoned:workspace-1" }));
    expect(client.getProfile).toHaveBeenCalledTimes(2);
    expect(client.listSessions).toHaveBeenCalledTimes(2);
    secondProfile.resolve(profile);
    secondSessions.resolve(sessions);
    await waitFor(() => expect(second.result.current.profile).toEqual(profile));
    second.unmount();
    firstProfile.resolve(profile);
    firstSessions.resolve(sessions);
  });

  it("keeps a shared request alive for the remaining consumer and aborts only after the last one leaves", async () => {
    const sharedProfile = deferred<Profile>();
    const sharedSessions = deferred<AccountSession[]>();
    const profileSignals: AbortSignal[] = [];
    const sessionSignals: AbortSignal[] = [];
    const client = {
      getProfile: vi.fn((signal?: AbortSignal) => { if (signal) profileSignals.push(signal); return sharedProfile.promise; }),
      listSessions: vi.fn((signal?: AbortSignal) => { if (signal) sessionSignals.push(signal); return sharedSessions.promise; }),
    };
    const first = renderHook(() => useAccountCenterData({ client: client as never, cacheScope: "user-lease:workspace-1" }));
    const second = renderHook(() => useAccountCenterData({ client: client as never, cacheScope: "user-lease:workspace-1" }));
    await waitFor(() => expect(client.getProfile).toHaveBeenCalledOnce());
    first.unmount();
    await act(async () => { await Promise.resolve(); });
    expect(profileSignals[0]?.aborted).toBe(false);
    expect(sessionSignals[0]?.aborted).toBe(false);
    sharedProfile.resolve(profile);
    sharedSessions.resolve(sessions);
    await waitFor(() => expect(second.result.current.profile).toEqual(profile));
    second.unmount();

    const abandonedProfile = deferred<Profile>();
    const abandonedSessions = deferred<AccountSession[]>();
    const nextClient = {
      getProfile: vi.fn((signal?: AbortSignal) => { if (signal) profileSignals.push(signal); return abandonedProfile.promise; }),
      listSessions: vi.fn((signal?: AbortSignal) => { if (signal) sessionSignals.push(signal); return abandonedSessions.promise; }),
    };
    const last = renderHook(() => useAccountCenterData({ client: nextClient as never, cacheScope: "user-lease:workspace-2" }));
    await waitFor(() => expect(nextClient.getProfile).toHaveBeenCalledOnce());
    last.unmount();
    await act(async () => { await Promise.resolve(); });
    expect(profileSignals.at(-1)?.aborted).toBe(true);
    expect(sessionSignals.at(-1)?.aborted).toBe(true);
    abandonedProfile.resolve(profile);
    abandonedSessions.resolve(sessions);
  });

  it("isolates explicit scopes on the same client and ignores late old responses", async () => {
    const oldProfile = deferred<Profile>();
    const oldSessions = deferred<AccountSession[]>();
    const newProfile = deferred<Profile>();
    const newSessions = deferred<AccountSession[]>();
    const nextProfile = { ...profile, id: "user-2", display_name: "新用户" };
    const nextSessions = [{ ...sessions[0], id: "session-2" }];
    const client = {
      getProfile: vi.fn()
        .mockReturnValueOnce(oldProfile.promise)
        .mockReturnValueOnce(newProfile.promise),
      listSessions: vi.fn()
        .mockReturnValueOnce(oldSessions.promise)
        .mockReturnValueOnce(newSessions.promise),
    };
    const { result, rerender } = renderHook(
      (props: { cacheScope: string }) => useAccountCenterData({ client: client as never, cacheScope: props.cacheScope }),
      { initialProps: { cacheScope: "user-1:workspace-1" } },
    );
    rerender({ cacheScope: "user-2:workspace-1" });
    expect(result.current.profile).toBeNull();
    expect(result.current.sessions).toEqual([]);
    expect(result.current.profileLoading).toBe(true);
    oldProfile.resolve(profile);
    oldSessions.resolve(sessions);
    newProfile.resolve(nextProfile);
    newSessions.resolve(nextSessions);
    await waitFor(() => expect(result.current.profile).toEqual(nextProfile));
    await waitFor(() => expect(result.current.sessions).toEqual(nextSessions));
    expect(result.current.profile?.display_name).not.toBe("用户");
  });

  it("keeps stale account data visible while an expired cache refreshes", async () => {
    let now = 1_000;
    const refreshedProfile = deferred<Profile>();
    const refreshedSessions = deferred<AccountSession[]>();
    const client = {
      getProfile: vi.fn()
        .mockResolvedValueOnce(profile)
        .mockReturnValueOnce(refreshedProfile.promise),
      listSessions: vi.fn()
        .mockResolvedValueOnce(sessions)
        .mockReturnValueOnce(refreshedSessions.promise),
    };
    const first = renderHook(() => useAccountCenterData({ client: client as never, cacheScope: "user-1:workspace-expired", now: () => now }));
    await waitFor(() => expect(first.result.current.profile).toEqual(profile));
    first.unmount();
    now = 301_001;
    const snapshots: Array<ReturnType<typeof useAccountCenterData>> = [];
    render(<Harness client={client} cacheScope="user-1:workspace-expired" now={() => now} onRender={(state) => snapshots.push(state)} />);
    expect(snapshots[0]?.profile).toEqual(profile);
    expect(snapshots[0]?.sessions).toEqual(sessions);
    expect(snapshots[0]?.profileLoading).toBe(false);
    expect(snapshots[0]?.sessionsLoading).toBe(false);
    expect(snapshots[0]?.refreshing).toBe(true);
    expect(client.getProfile).toHaveBeenCalledTimes(2);
    expect(client.listSessions).toHaveBeenCalledTimes(2);
    await act(async () => {
      refreshedProfile.resolve({ ...profile, display_name: "刷新后" });
      refreshedSessions.resolve([{ ...sessions[0], id: "session-refreshed" }]);
    });
    await waitFor(() => expect(snapshots.at(-1)?.profile?.display_name).toBe("刷新后"));
  });

  it("keeps stale account data when an expired profile and session refresh fails", async () => {
    let now = 1_000;
    const client = {
      getProfile: vi.fn().mockResolvedValueOnce(profile).mockRejectedValueOnce(new Error("profile offline")),
      listSessions: vi.fn().mockResolvedValueOnce(sessions).mockRejectedValueOnce(new Error("sessions offline")),
    };
    const first = renderHook(() => useAccountCenterData({ client: client as never, cacheScope: "user-stale-failure:workspace-1", now: () => now }));
    await waitFor(() => expect(first.result.current.profile).toEqual(profile));
    await waitFor(() => expect(first.result.current.sessions).toEqual(sessions));
    first.unmount();
    now = 301_000;
    const { result } = renderHook(() => useAccountCenterData({ client: client as never, cacheScope: "user-stale-failure:workspace-1", now: () => now }));
    expect(result.current.profile).toEqual(profile);
    expect(result.current.sessions).toEqual(sessions);
    await waitFor(() => expect(result.current.profileError).toBe("个人资料加载失败，请重试。"));
    await waitFor(() => expect(result.current.sessionsError).toBe("会话加载失败，请重试。"));
    expect(result.current.profile).toEqual(profile);
    expect(result.current.sessions).toEqual(sessions);
    expect(result.current.refreshing).toBe(false);
  });

  it("does not let an older shared response overwrite a committed profile or session update", async () => {
    const profileRequest = deferred<Profile>();
    const sessionsRequest = deferred<AccountSession[]>();
    const client = {
      getProfile: vi.fn(() => profileRequest.promise),
      listSessions: vi.fn(() => sessionsRequest.promise),
    };
    const { result } = renderHook(() => useAccountCenterData({ client: client as never, cacheScope: "user-1:workspace-mutation-race" }));
    const committedProfile = { ...profile, display_name: "本地提交" };
    const committedSessions = [{ ...sessions[0], id: "session-committed" }];
    act(() => {
      result.current.setProfile(committedProfile);
      result.current.setSessions(committedSessions);
    });
    profileRequest.resolve(profile);
    sessionsRequest.resolve(sessions);
    await act(async () => {
      await Promise.all([profileRequest.promise, sessionsRequest.promise]);
    });
    expect(result.current.profile).toEqual(committedProfile);
    expect(result.current.sessions).toEqual(committedSessions);
  });

  it("ignores setters retained by a previous client and scope after switching", async () => {
    const oldClient = {
      getProfile: vi.fn(async () => profile),
      listSessions: vi.fn(async () => sessions),
    };
    const nextProfile = { ...profile, id: "user-2", display_name: "新用户" };
    const nextSessions = [{ ...sessions[0], id: "session-2" }];
    const newClient = {
      getProfile: vi.fn(async () => nextProfile),
      listSessions: vi.fn(async () => nextSessions),
    };
    const { result, rerender } = renderHook(
      (props: { client: object; cacheScope: string }) => useAccountCenterData({ client: props.client as never, cacheScope: props.cacheScope }),
      { initialProps: { client: oldClient, cacheScope: "user-1:workspace-1" } },
    );
    await waitFor(() => expect(result.current.profile).toEqual(profile));
    const staleSetProfile = result.current.setProfile;
    const staleSetSessions = result.current.setSessions;
    const staleRetryProfile = result.current.retryProfile;
    const staleRefreshSessions = result.current.refreshSessions;
    const staleInvalidateSessions = result.current.invalidateSessions;
    rerender({ client: newClient, cacheScope: "user-2:workspace-2" });
    await waitFor(() => expect(result.current.profile).toEqual(nextProfile));
    await waitFor(() => expect(result.current.sessions).toEqual(nextSessions));

    act(() => {
      staleSetProfile({ ...profile, display_name: "旧回调" });
      staleSetSessions([{ ...sessions[0], id: "旧会话" }]);
      staleRetryProfile();
      staleRefreshSessions();
      staleInvalidateSessions();
    });
    expect(result.current.profile).toEqual(nextProfile);
    expect(result.current.sessions).toEqual(nextSessions);
    expect(result.current.profileLoading).toBe(false);
    expect(result.current.sessionsLoading).toBe(false);
    expect(oldClient.getProfile).toHaveBeenCalledOnce();
    expect(oldClient.listSessions).toHaveBeenCalledOnce();
  });

  it("applies sequential session updates to the latest value instead of a stale snapshot", async () => {
    const client = {
      getProfile: vi.fn(async () => profile),
      listSessions: vi.fn(async () => sessions),
    };
    const { result } = renderHook(() => useAccountCenterData({ client: client as never, cacheScope: "user-1:workspace-session-updates" }));
    await waitFor(() => expect(result.current.sessions).toEqual(sessions));
    act(() => {
      result.current.setSessions((current) => [...current, { ...sessions[0], id: "session-added" }]);
      result.current.setSessions((current) => current.filter((item) => item.id !== "session-1"));
    });
    expect(result.current.sessions.map((item) => item.id)).toEqual(["session-added"]);
  });
});
