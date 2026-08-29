import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { AccountSession, Profile } from "@nexus/contracts";

import type { ProfileClient } from "../data/profile-client";

export type AccountCenterDataClient = Pick<ProfileClient, "getProfile" | "listSessions">;

export interface UseAccountCenterDataParams {
  client: AccountCenterDataClient;
  cacheScope?: string;
  ttlMs?: number;
  now?: () => number;
}

export interface AccountCenterDataState {
  scopeVersion: number;
  profile: Profile | null;
  sessions: AccountSession[];
  profileLoading: boolean;
  profileError: string | null;
  sessionsLoading: boolean;
  sessionsError: string | null;
  refreshing: boolean;
  retryProfile(): void;
  refreshSessions(): void;
  invalidateSessions(): void;
  setProfile(profile: Profile): boolean;
  setSessions(sessions: AccountSession[] | ((current: AccountSession[]) => AccountSession[])): boolean;
}

interface CacheValue<T> {
  hasValue: boolean;
  value?: T;
  expiresAt: number;
  generation: number;
  listeners: Set<(origin: object | null) => void>;
  request: SharedRequest<T> | null;
}

interface AccountCacheScope {
  profile: CacheValue<Profile>;
  sessions: CacheValue<AccountSession[]>;
}

interface SharedRequest<T> {
  controller: AbortController;
  promise: Promise<T>;
  generation: number;
  consumers: number;
  releaseScheduled: boolean;
}

interface RequestLease<T> {
  request: SharedRequest<T>;
  release(): void;
}

const cacheRegistry = new WeakMap<object, Map<string, AccountCacheScope>>();

function resource<T>(): CacheValue<T> {
  return { hasValue: false, expiresAt: 0, generation: 0, listeners: new Set(), request: null };
}

function scopeFor(client: AccountCenterDataClient, scope: string): AccountCacheScope {
  const key = client as object;
  const scopes = cacheRegistry.get(key);
  const existing = scopes?.get(scope);
  if (existing) return existing;
  const created: AccountCacheScope = { profile: resource<Profile>(), sessions: resource<AccountSession[]>() };
  if (scopes) scopes.set(scope, created);
  else cacheRegistry.set(key, new Map([[scope, created]]));
  return created;
}

function existingScopeFor(client: AccountCenterDataClient, scope: string) {
  return cacheRegistry.get(client as object)?.get(scope) ?? null;
}

function notify(value: CacheValue<unknown>, origin: object | null) {
  value.listeners.forEach((listener) => listener(origin));
}

function acquire<T>(value: CacheValue<T>, load: (signal: AbortSignal) => Promise<T>): RequestLease<T> {
  let request = value.request;
  if (request && request.generation !== value.generation) {
    request.controller.abort();
    value.request = null;
    request = null;
  }
  if (!request) {
    const controller = new AbortController();
    let created!: SharedRequest<T>;
    let loaded: Promise<T>;
    try {
      loaded = Promise.resolve(load(controller.signal));
    } catch (error) {
      loaded = Promise.reject(error);
    }
    const promise = loaded.finally(() => {
      if (value.request === created) value.request = null;
    });
    created = { controller, promise, generation: value.generation, consumers: 0, releaseScheduled: false };
    value.request = created;
    request = created;
    void promise.catch(() => undefined);
  }
  request.consumers += 1;
  request.releaseScheduled = false;
  let released = false;
  return {
    request,
    release() {
      if (released) return;
      released = true;
      if (value.request !== request) return;
      request.consumers = Math.max(0, request.consumers - 1);
      if (request.consumers > 0 || request.releaseScheduled) return;
      request.releaseScheduled = true;
      queueMicrotask(() => {
        if (value.request !== request || request.consumers > 0) {
          request.releaseScheduled = false;
          return;
        }
        value.request = null;
        request.controller.abort();
      });
    },
  };
}

function isAbort(error: unknown, signal: AbortSignal) {
  return signal.aborted || (error instanceof DOMException && error.name === "AbortError");
}

function write<T>(value: CacheValue<T>, next: T, expiresAt: number) {
  value.hasValue = true;
  value.value = next;
  value.expiresAt = expiresAt;
}

function invalidateResource<T>(value: CacheValue<T>) {
  value.generation += 1;
  value.request?.controller.abort();
  value.request = null;
  value.expiresAt = Number.NEGATIVE_INFINITY;
}

export function useAccountCenterData({ client, cacheScope, ttlMs = 5 * 60_000, now = Date.now }: UseAccountCenterDataParams): AccountCenterDataState {
  const resolvedScope = cacheScope ?? "default";
  const nowRef = useRef(now);
  const ttlRef = useRef(ttlMs);
  const scopeRef = useRef({ client, scope: resolvedScope });
  const scopeVersionRef = useRef(0);
  const mountedRef = useRef(true);
  const profileLeaseRef = useRef<RequestLease<Profile> | null>(null);
  const sessionsLeaseRef = useRef<RequestLease<AccountSession[]> | null>(null);
  const forceSessionsLoadingRef = useRef(false);
  const profileOriginRef = useRef<object>({});
  const sessionsOriginRef = useRef<object>({});
  const initialCacheRef = useRef<AccountCacheScope | null | undefined>(undefined);
  if (initialCacheRef.current === undefined) initialCacheRef.current = existingScopeFor(client, resolvedScope);
  const initialCache = initialCacheRef.current ?? null;
  const [profile, setProfileState] = useState<Profile | null>(() => initialCache?.profile.hasValue ? initialCache.profile.value ?? null : null);
  const [sessions, setSessionsState] = useState<AccountSession[]>(() => initialCache?.sessions.hasValue ? initialCache.sessions.value ?? [] : []);
  const [profileLoading, setProfileLoading] = useState(() => !initialCache?.profile.hasValue);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [sessionsLoading, setSessionsLoading] = useState(() => !initialCache?.sessions.hasValue);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [profileRefreshVersion, setProfileRefreshVersion] = useState(0);
  const [sessionsRefreshVersion, setSessionsRefreshVersion] = useState(0);
  const [scopeEpoch, setScopeEpoch] = useState(0);
  const [profileRefreshing, setProfileRefreshing] = useState(() => Boolean(initialCache?.profile.hasValue && initialCache.profile.expiresAt <= now()));
  const [sessionsRefreshing, setSessionsRefreshing] = useState(() => Boolean(initialCache?.sessions.hasValue && initialCache.sessions.expiresAt <= now()));
  const sessionsRef = useRef<AccountSession[]>(sessions);
  const currentScope = scopeRef.current;
  const scopeMatches = currentScope.client === client && currentScope.scope === resolvedScope;
  const callbackScopeVersion = scopeVersionRef.current;
  const isCurrentScope = useCallback(() => mountedRef.current
    && scopeVersionRef.current === callbackScopeVersion
    && scopeRef.current.client === client
    && scopeRef.current.scope === resolvedScope, [callbackScopeVersion, client, resolvedScope]);

  useLayoutEffect(() => {
    nowRef.current = now;
    ttlRef.current = ttlMs;
  }, [now, ttlMs]);

  useLayoutEffect(() => {
    const changed = scopeRef.current.client !== client || scopeRef.current.scope !== resolvedScope;
    if (!changed) return;
    profileLeaseRef.current?.release();
    sessionsLeaseRef.current?.release();
    profileLeaseRef.current = null;
    sessionsLeaseRef.current = null;
    scopeRef.current = { client, scope: resolvedScope };
    scopeVersionRef.current += 1;
    setScopeEpoch(scopeVersionRef.current);
    forceSessionsLoadingRef.current = false;
    const next = scopeFor(client, resolvedScope);
    setProfileState(next.profile.hasValue ? next.profile.value ?? null : null);
    setSessionsState(next.sessions.hasValue ? next.sessions.value ?? [] : []);
    sessionsRef.current = next.sessions.hasValue ? next.sessions.value ?? [] : [];
    setProfileLoading(!next.profile.hasValue);
    setSessionsLoading(!next.sessions.hasValue);
    setProfileError(null);
    setSessionsError(null);
    setProfileRefreshing(next.profile.hasValue && next.profile.expiresAt <= nowRef.current());
    setSessionsRefreshing(next.sessions.hasValue && next.sessions.expiresAt <= nowRef.current());
  }, [client, resolvedScope]);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    const scope = scopeFor(client, resolvedScope);
    const onProfileUpdate = (origin: object | null) => {
      if (origin === profileOriginRef.current || !mountedRef.current || scopeRef.current.client !== client || scopeRef.current.scope !== resolvedScope) return;
      setProfileState(scope.profile.hasValue ? scope.profile.value ?? null : null);
      setProfileLoading(!scope.profile.hasValue);
      setProfileError(null);
      setProfileRefreshing(scope.profile.hasValue && scope.profile.expiresAt <= nowRef.current());
      setProfileRefreshVersion((version) => version + 1);
    };
    const onSessionsUpdate = (origin: object | null) => {
      if (origin === sessionsOriginRef.current || !mountedRef.current || scopeRef.current.client !== client || scopeRef.current.scope !== resolvedScope) return;
      setSessionsState(scope.sessions.hasValue ? scope.sessions.value ?? [] : []);
      sessionsRef.current = scope.sessions.hasValue ? scope.sessions.value ?? [] : [];
      setSessionsLoading(!scope.sessions.hasValue);
      setSessionsError(null);
      setSessionsRefreshing(scope.sessions.hasValue && scope.sessions.expiresAt <= nowRef.current());
      setSessionsRefreshVersion((version) => version + 1);
    };
    scope.profile.listeners.add(onProfileUpdate);
    scope.sessions.listeners.add(onSessionsUpdate);
    return () => {
      scope.profile.listeners.delete(onProfileUpdate);
      scope.sessions.listeners.delete(onSessionsUpdate);
    };
  }, [client, resolvedScope]);

  useEffect(() => {
    const scopeVersion = scopeVersionRef.current;
    const scope = scopeFor(client, resolvedScope);
    const cached = scope.profile;
    if (cached.hasValue) {
      setProfileState(cached.value ?? null);
      setProfileLoading(false);
      const fresh = cached.expiresAt > nowRef.current();
      setProfileRefreshing(!fresh);
      if (fresh) return undefined;
    } else {
      setProfileState(null);
      setProfileLoading(true);
      setProfileRefreshing(false);
    }
    setProfileError(null);
    const lease = acquire(cached, (signal) => client.getProfile(signal));
    profileLeaseRef.current = lease;
    const request = lease.request;
    const requestGeneration = request.generation;
    const isCurrent = () => mountedRef.current
      && scopeVersion === scopeVersionRef.current
      && scopeRef.current.client === client
      && scopeRef.current.scope === resolvedScope
      && profileLeaseRef.current === lease
      && cached.generation === requestGeneration
      && !request.controller.signal.aborted;
    void request.promise.then((next) => {
      if (!isCurrent()) return;
      write(cached, next, nowRef.current() + ttlRef.current);
      setProfileState(next);
      setProfileLoading(false);
      setProfileRefreshing(false);
      notify(cached, profileOriginRef.current);
    }).catch((error: unknown) => {
      if (isCurrent() && !isAbort(error, request.controller.signal)) setProfileError("个人资料加载失败，请重试。");
    }).finally(() => {
      const current = isCurrent();
      if (profileLeaseRef.current === lease) profileLeaseRef.current = null;
      if (current) {
        setProfileLoading(false);
        setProfileRefreshing(false);
      }
    });
    return () => {
      lease.release();
      if (profileLeaseRef.current === lease) profileLeaseRef.current = null;
    };
  }, [client, profileRefreshVersion, resolvedScope]);

  useEffect(() => {
    const scopeVersion = scopeVersionRef.current;
    const scope = scopeFor(client, resolvedScope);
    const cached = scope.sessions;
    if (cached.hasValue) {
      setSessionsState(cached.value ?? []);
      sessionsRef.current = cached.value ?? [];
      setSessionsLoading(forceSessionsLoadingRef.current);
      const fresh = cached.expiresAt > nowRef.current();
      setSessionsRefreshing(!fresh);
      if (fresh) return undefined;
    } else {
      setSessionsState([]);
      setSessionsLoading(true);
      setSessionsRefreshing(false);
    }
    forceSessionsLoadingRef.current = false;
    setSessionsError(null);
    const lease = acquire(cached, (signal) => client.listSessions(signal));
    sessionsLeaseRef.current = lease;
    const request = lease.request;
    const requestGeneration = request.generation;
    const isCurrent = () => mountedRef.current
      && scopeVersion === scopeVersionRef.current
      && scopeRef.current.client === client
      && scopeRef.current.scope === resolvedScope
      && sessionsLeaseRef.current === lease
      && cached.generation === requestGeneration
      && !request.controller.signal.aborted;
    void request.promise.then((next) => {
      if (!isCurrent()) return;
      write(cached, next, nowRef.current() + ttlRef.current);
      setSessionsState(next);
      sessionsRef.current = next;
      setSessionsLoading(false);
      setSessionsRefreshing(false);
      notify(cached, sessionsOriginRef.current);
    }).catch((error: unknown) => {
      if (isCurrent() && !isAbort(error, request.controller.signal)) setSessionsError("会话加载失败，请重试。");
    }).finally(() => {
      const current = isCurrent();
      if (sessionsLeaseRef.current === lease) sessionsLeaseRef.current = null;
      if (current) {
        setSessionsLoading(false);
        setSessionsRefreshing(false);
      }
    });
    return () => {
      lease.release();
      if (sessionsLeaseRef.current === lease) sessionsLeaseRef.current = null;
    };
  }, [client, resolvedScope, sessionsRefreshVersion]);

  const invalidateProfile = useCallback(() => {
    if (!isCurrentScope()) return;
    const scope = scopeFor(client, resolvedScope);
    invalidateResource(scope.profile);
    notify(scope.profile, profileOriginRef.current);
    setProfileRefreshVersion((version) => version + 1);
  }, [client, isCurrentScope, resolvedScope]);

  const retryProfile = useCallback(() => {
    if (!isCurrentScope()) return;
    setProfileError(null);
    invalidateProfile();
  }, [invalidateProfile, isCurrentScope]);

  const refreshSessions = useCallback(() => {
    if (!isCurrentScope()) return;
    const scope = scopeFor(client, resolvedScope);
    invalidateResource(scope.sessions);
    forceSessionsLoadingRef.current = true;
    setSessionsLoading(true);
    setSessionsError(null);
    notify(scope.sessions, sessionsOriginRef.current);
    setSessionsRefreshVersion((version) => version + 1);
  }, [client, isCurrentScope, resolvedScope]);

  const invalidateSessions = useCallback(() => {
    if (!isCurrentScope()) return;
    const scope = scopeFor(client, resolvedScope);
    sessionsLeaseRef.current?.release();
    sessionsLeaseRef.current = null;
    invalidateResource(scope.sessions);
    setSessionsError(null);
    setSessionsLoading(false);
  }, [client, isCurrentScope, resolvedScope]);

  const setProfile = useCallback((next: Profile) => {
    if (!isCurrentScope()) return false;
    const scope = scopeFor(client, resolvedScope);
    profileLeaseRef.current?.release();
    profileLeaseRef.current = null;
    invalidateResource(scope.profile);
    write(scope.profile, next, nowRef.current() + ttlRef.current);
    setProfileState(next);
    setProfileLoading(false);
    setProfileError(null);
    setProfileRefreshing(false);
    notify(scope.profile, profileOriginRef.current);
    return true;
  }, [client, isCurrentScope, resolvedScope]);

  const setSessions = useCallback((next: AccountSession[] | ((current: AccountSession[]) => AccountSession[])) => {
    if (!isCurrentScope()) return false;
    const scope = scopeFor(client, resolvedScope);
    sessionsLeaseRef.current?.release();
    sessionsLeaseRef.current = null;
    invalidateResource(scope.sessions);
    const value = typeof next === "function" ? next(sessionsRef.current) : next;
    write(scope.sessions, value, nowRef.current() + ttlRef.current);
    sessionsRef.current = value;
    setSessionsState(value);
    setSessionsLoading(false);
    setSessionsError(null);
    setSessionsRefreshing(false);
    notify(scope.sessions, sessionsOriginRef.current);
    return true;
  }, [client, isCurrentScope, resolvedScope]);

  useEffect(() => () => {
    profileLeaseRef.current?.release();
    sessionsLeaseRef.current?.release();
    profileLeaseRef.current = null;
    sessionsLeaseRef.current = null;
    scopeVersionRef.current += 1;
  }, []);

  return {
    scopeVersion: scopeEpoch,
    profile: scopeMatches ? profile : null,
    sessions: scopeMatches ? sessions : [],
    profileLoading: scopeMatches ? profileLoading : true,
    profileError: scopeMatches ? profileError : null,
    sessionsLoading: scopeMatches ? sessionsLoading : true,
    sessionsError: scopeMatches ? sessionsError : null,
    refreshing: scopeMatches && (profileRefreshing || sessionsRefreshing),
    retryProfile,
    refreshSessions,
    invalidateSessions,
    setProfile,
    setSessions,
  };
}
