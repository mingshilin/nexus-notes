import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type {
  ActivityEntry,
  AuditEntry,
  CollaborationComment,
  PublicShare,
  WorkspaceInvitation,
  WorkspaceMember,
} from "@nexus/contracts";

import type { CollaborationClient } from "../data/collaboration-client";
import { collaborationErrorMessage, type CollaborationCommentTarget } from "./collaboration-types";

export type CollaborationSection = "people" | "comments" | "shares" | "activity";
export type CollaborationCacheResource = "members" | "invitations" | "comments" | "shares" | "activity" | "audit";

export type CollaborationCenterDataClient = Pick<
  CollaborationClient,
  | "listMembers"
  | "listInvitations"
  | "listComments"
  | "listShares"
  | "listActivity"
  | "listAudit"
>;

export interface UseCollaborationCenterDataParams {
  client: CollaborationCenterDataClient;
  cacheScope?: string;
  canManage: boolean;
  canEdit: boolean;
  section: CollaborationSection;
  commentTarget?: Pick<CollaborationCommentTarget, "type" | "id">;
  ttlMs?: number;
  now?: () => number;
}

export interface CollaborationCacheInvalidation {
  client: CollaborationCenterDataClient;
  cacheScope?: string;
  canManage: boolean;
  canEdit: boolean;
  resource: CollaborationCacheResource;
  commentTarget?: Pick<CollaborationCommentTarget, "type" | "id">;
}

type Updater<T> = T | ((current: T) => T);
type GuardedSetter<T> = (next: Updater<T>) => boolean;

export interface CollaborationCenterDataState {
  scopeVersion: number;
  members: WorkspaceMember[];
  invitations: WorkspaceInvitation[];
  comments: CollaborationComment[];
  shares: PublicShare[];
  activity: ActivityEntry[];
  audit: AuditEntry[];
  baseLoading: boolean;
  sectionLoading: boolean;
  refreshing: boolean;
  baseError: string | null;
  sectionError: string | null;
  error: string | null;
  setMembers: GuardedSetter<WorkspaceMember[]>;
  setInvitations: GuardedSetter<WorkspaceInvitation[]>;
  setComments: GuardedSetter<CollaborationComment[]>;
  setShares: GuardedSetter<PublicShare[]>;
  setActivity: GuardedSetter<ActivityEntry[]>;
  setAudit: GuardedSetter<AuditEntry[]>;
  retryBase(): void;
  retrySection(): void;
}

interface SharedRequest<T> {
  controller: AbortController;
  promise: Promise<T>;
  generation: number;
  consumers: number;
  releaseScheduled: boolean;
  settled: boolean;
}

interface CacheValue<T> {
  hasValue: boolean;
  value?: T;
  expiresAt: number;
  generation: number;
  request: SharedRequest<T> | null;
  listeners: Set<(origin: object | null) => void>;
}

interface SectionCache {
  comments: CacheValue<CollaborationComment[]>;
  shares: CacheValue<PublicShare[]>;
  activity: CacheValue<ActivityEntry[]>;
  audit: CacheValue<AuditEntry[]>;
}

interface CollaborationCacheScope {
  members: CacheValue<WorkspaceMember[]>;
  invitations: CacheValue<WorkspaceInvitation[]>;
  sections: Map<string, SectionCache>;
}

interface RequestLease<T> {
  request: SharedRequest<T>;
  release(): void;
}

const cacheRegistry = new WeakMap<object, Map<string, CollaborationCacheScope>>();

function cacheValue<T>(): CacheValue<T> {
  return { hasValue: false, expiresAt: 0, generation: 0, request: null, listeners: new Set() };
}

function existingScopeFor(client: CollaborationCenterDataClient, scope: string) {
  return cacheRegistry.get(client as object)?.get(scope) ?? null;
}

function scopeFor(client: CollaborationCenterDataClient, scope: string) {
  const key = client as object;
  const scopes = cacheRegistry.get(key);
  const existing = scopes?.get(scope);
  if (existing) return existing;
  const created: CollaborationCacheScope = {
    members: cacheValue<WorkspaceMember[]>(),
    invitations: cacheValue<WorkspaceInvitation[]>(),
    sections: new Map(),
  };
  if (scopes) scopes.set(scope, created);
  else cacheRegistry.set(key, new Map([[scope, created]]));
  return created;
}

function sectionCacheFor(scope: CollaborationCacheScope, key: string): SectionCache {
  const existing = scope.sections.get(key);
  if (existing) return existing;
  const created: SectionCache = {
    comments: cacheValue<CollaborationComment[]>(),
    shares: cacheValue<PublicShare[]>(),
    activity: cacheValue<ActivityEntry[]>(),
    audit: cacheValue<AuditEntry[]>(),
  };
  scope.sections.set(key, created);
  return created;
}

function existingSectionCacheFor(scope: CollaborationCacheScope | null, key: string) {
  return scope?.sections.get(key) ?? null;
}

function notify<T>(value: CacheValue<T>, origin: object | null) {
  value.listeners.forEach((listener) => listener(origin));
}

function acquire<T>(value: CacheValue<T>, load: (signal: AbortSignal) => Promise<T>): RequestLease<T> {
  let request = value.request;
  if (request && request.generation !== value.generation) {
    request.controller.abort();
    if (value.request === request) value.request = null;
    request = null;
  }
  if (!request || request.generation !== value.generation) {
    const controller = new AbortController();
    let created!: SharedRequest<T>;
    let loaded: Promise<T>;
    try {
      loaded = Promise.resolve(load(controller.signal));
    } catch (error) {
      loaded = Promise.reject(error);
    }
    const promise = loaded.finally(() => {
      created.settled = true;
      if (value.request === created) value.request = null;
    });
    created = { controller, promise, generation: value.generation, consumers: 0, releaseScheduled: false, settled: false };
    value.request = created;
    request = created;
    void promise.catch(() => undefined);
  }
  request.consumers += 1;
  request.releaseScheduled = false;
  const acquiredRequest = request;
  let released = false;
  return {
    request: acquiredRequest,
    release() {
      if (released) return;
      released = true;
      if (value.request !== acquiredRequest) return;
      acquiredRequest.consumers = Math.max(0, acquiredRequest.consumers - 1);
      if (acquiredRequest.consumers > 0 || acquiredRequest.settled || acquiredRequest.releaseScheduled) return;
      acquiredRequest.releaseScheduled = true;
      queueMicrotask(() => {
        if (value.request !== acquiredRequest || acquiredRequest.consumers > 0 || acquiredRequest.settled) {
          acquiredRequest.releaseScheduled = false;
          return;
        }
        value.request = null;
        acquiredRequest.controller.abort();
      });
    },
  };
}

function retire<T>(value: CacheValue<T>) {
  value.generation += 1;
  const request = value.request;
  value.request = null;
  value.expiresAt = Number.NEGATIVE_INFINITY;
  if (request && !request.settled) request.controller.abort();
}

export function invalidateCollaborationCache({ client, cacheScope, canManage, canEdit, resource, commentTarget }: CollaborationCacheInvalidation) {
  const scope = scopeFor(client, `${cacheScope ?? "default"}:${canManage ? "manage" : "member"}:${canEdit ? "edit" : "view"}`);
  const invalidate = <T,>(value: CacheValue<T>) => { retire(value); notify(value, null); };
  if (resource === "members") return invalidate(scope.members);
  if (resource === "invitations") return invalidate(scope.invitations);
  if (resource === "comments") return invalidate(sectionCacheFor(scope, sectionQueryKey("comments", commentTarget, canManage, canEdit)).comments);
  if (resource === "shares") return invalidate(sectionCacheFor(scope, sectionQueryKey("shares", undefined, canManage, canEdit)).shares);
  const activityCache = sectionCacheFor(scope, sectionQueryKey("activity", undefined, canManage, canEdit));
  return resource === "activity" ? invalidate(activityCache.activity) : invalidate(activityCache.audit);
}

function write<T>(value: CacheValue<T>, next: T, expiresAt: number) {
  value.hasValue = true;
  value.value = next;
  value.expiresAt = expiresAt;
}

function updateValue<T>(value: CacheValue<T>, next: Updater<T>, current: T, now: () => number, ttlMs: number) {
  retire(value);
  const resolved = typeof next === "function" ? (next as (current: T) => T)(current) : next;
  write(value, resolved, now() + ttlMs);
  return resolved;
}

function sectionQueryKey(section: CollaborationSection, target: Pick<CollaborationCommentTarget, "type" | "id"> | undefined, canManage: boolean, canEdit: boolean) {
  if (section === "comments") return target ? `comments:${target.type}:${target.id}` : "comments:none";
  if (section === "shares") return `shares:${canEdit ? "edit" : "view"}`;
  if (section === "activity") return `activity:${canManage ? "manage" : "member"}`;
  return "people";
}

function isAborted(error: unknown, signal: AbortSignal) {
  return signal.aborted || (error instanceof DOMException && error.name === "AbortError");
}

function readCachedResource<T>(value: CacheValue<T> | null, fallback: T, now: number) {
  const hasValue = Boolean(value?.hasValue);
  const current = hasValue ? value?.value ?? fallback : fallback;
  return { current, hasValue, stale: hasValue && (value?.expiresAt ?? 0) <= now };
}

function sectionStatus(
  scope: CollaborationCacheScope | null,
  queryKey: string,
  section: CollaborationSection,
  commentTarget: Pick<CollaborationCommentTarget, "type" | "id"> | undefined,
  canManage: boolean,
  canEdit: boolean,
  now: number,
) {
  if (section === "people" || (section === "comments" && !commentTarget) || (section === "shares" && !canEdit)) {
    return { loading: false, stale: false };
  }
  const cached = existingSectionCacheFor(scope, queryKey);
  if (!cached) return { loading: true, stale: false };
  const resources = section === "comments"
    ? [cached.comments]
    : section === "shares"
      ? [cached.shares]
      : [cached.activity, ...(canManage ? [cached.audit] : [])];
  return {
    loading: resources.some((resource) => !resource.hasValue),
    stale: resources.some((resource) => resource.hasValue && resource.expiresAt <= now),
  };
}

function resourceForSection(resource: SectionCache, section: CollaborationSection, canManage: boolean, canEdit: boolean): Array<CacheValue<unknown>> {
  if (section === "comments") return [resource.comments as CacheValue<unknown>];
  if (section === "shares") return canEdit ? [resource.shares as CacheValue<unknown>] : [];
  if (section === "activity") return [resource.activity as CacheValue<unknown>, ...(canManage ? [resource.audit as CacheValue<unknown>] : [])];
  return [];
}

export function useCollaborationCenterData({
  client,
  cacheScope,
  canManage,
  canEdit,
  section,
  commentTarget,
  ttlMs = 120_000,
  now = Date.now,
}: UseCollaborationCenterDataParams): CollaborationCenterDataState {
  const resolvedScope = `${cacheScope ?? "default"}:${canManage ? "manage" : "member"}:${canEdit ? "edit" : "view"}`;
  const queryKey = sectionQueryKey(section, commentTarget, canManage, canEdit);
  const nowRef = useRef(now);
  const ttlRef = useRef(ttlMs);
  const scopeRef = useRef({ client, scope: resolvedScope });
  const sectionRef = useRef(queryKey);
  const scopeVersionRef = useRef(0);
  const mountedRef = useRef(true);
  const baseOriginRef = useRef<object>({});
  const sectionOriginRef = useRef<object>({});
  const baseLeasesRef = useRef<Array<RequestLease<unknown>>>([]);
  const sectionLeasesRef = useRef<Array<RequestLease<unknown>>>([]);
  const initialScopeRef = useRef<CollaborationCacheScope | null | undefined>(undefined);
  if (initialScopeRef.current === undefined) initialScopeRef.current = existingScopeFor(client, resolvedScope);
  const initialScope = initialScopeRef.current;
  const initialSection = existingSectionCacheFor(initialScope, queryKey);
  const initialMembers = readCachedResource(initialScope?.members ?? null, [], now());
  const initialInvitations = readCachedResource(initialScope?.invitations ?? null, [], now());
  const initialComments = readCachedResource(initialSection?.comments ?? null, [], now());
  const initialShares = readCachedResource(initialSection?.shares ?? null, [], now());
  const initialActivity = readCachedResource(initialSection?.activity ?? null, [], now());
  const initialAudit = readCachedResource(initialSection?.audit ?? null, [], now());
  const initialSectionStatus = sectionStatus(initialScope, queryKey, section, commentTarget, canManage, canEdit, now());
  const [members, setMembersState] = useState<WorkspaceMember[]>(() => initialMembers.current);
  const [invitations, setInvitationsState] = useState<WorkspaceInvitation[]>(() => initialInvitations.current);
  const [comments, setCommentsState] = useState<CollaborationComment[]>(() => initialComments.current);
  const [shares, setSharesState] = useState<PublicShare[]>(() => initialShares.current);
  const [activity, setActivityState] = useState<ActivityEntry[]>(() => initialActivity.current);
  const [audit, setAuditState] = useState<AuditEntry[]>(() => initialAudit.current);
  const [baseLoading, setBaseLoading] = useState(() => !initialMembers.hasValue || (canManage && !initialInvitations.hasValue));
  const [sectionLoading, setSectionLoading] = useState(() => initialSectionStatus.loading);
  const [refreshing, setRefreshing] = useState(() => initialMembers.stale || (canManage && initialInvitations.stale) || initialSectionStatus.stale);
  const [baseError, setBaseError] = useState<string | null>(null);
  const [sectionError, setSectionError] = useState<string | null>(null);
  const [baseRetryVersion, setBaseRetryVersion] = useState(0);
  const [sectionRetryVersion, setSectionRetryVersion] = useState(0);
  const [baseReloadVersion, setBaseReloadVersion] = useState(0);
  const [sectionReloadVersion, setSectionReloadVersion] = useState(0);
  const [scopeEpoch, setScopeEpoch] = useState(0);
  const membersRef = useRef(members);
  const invitationsRef = useRef(invitations);
  const commentsRef = useRef(comments);
  const sharesRef = useRef(shares);
  const activityRef = useRef(activity);
  const auditRef = useRef(audit);
  const basePendingRef = useRef(0);
  const sectionPendingRef = useRef(0);
  const scopeMatches = scopeRef.current.client === client && scopeRef.current.scope === resolvedScope;
  const sectionMatches = sectionRef.current === queryKey;
  const callbackScopeVersion = scopeVersionRef.current;
  const callbackQueryKey = queryKey;
  const isCurrentScope = useCallback(() => mountedRef.current
    && scopeVersionRef.current === callbackScopeVersion
    && scopeRef.current.client === client
    && scopeRef.current.scope === resolvedScope, [callbackScopeVersion, client, resolvedScope]);

  const updateRefreshing = useCallback(() => {
    if (mountedRef.current) setRefreshing(basePendingRef.current > 0 || sectionPendingRef.current > 0);
  }, []);

  useLayoutEffect(() => {
    nowRef.current = now;
    ttlRef.current = ttlMs;
  }, [now, ttlMs]);

  useLayoutEffect(() => {
    const changed = scopeRef.current.client !== client || scopeRef.current.scope !== resolvedScope;
    if (!changed) return;
    baseLeasesRef.current.forEach((lease) => lease.release());
    baseLeasesRef.current = [];
    sectionLeasesRef.current.forEach((lease) => lease.release());
    sectionLeasesRef.current = [];
    scopeRef.current = { client, scope: resolvedScope };
    sectionRef.current = queryKey;
    scopeVersionRef.current += 1;
    setScopeEpoch(scopeVersionRef.current);
    const next = scopeFor(client, resolvedScope);
    const nextSection = existingSectionCacheFor(next, queryKey);
    membersRef.current = next.members.value ?? [];
    invitationsRef.current = canManage ? next.invitations.value ?? [] : [];
    commentsRef.current = nextSection?.comments.value ?? [];
    sharesRef.current = nextSection?.shares.value ?? [];
    activityRef.current = nextSection?.activity.value ?? [];
    auditRef.current = nextSection?.audit.value ?? [];
    setMembersState(membersRef.current);
    setInvitationsState(invitationsRef.current);
    setCommentsState(commentsRef.current);
    setSharesState(sharesRef.current);
    setActivityState(activityRef.current);
    setAuditState(auditRef.current);
    setBaseLoading(!next.members.hasValue || (canManage && !next.invitations.hasValue));
    const nextSectionStatus = sectionStatus(next, queryKey, section, commentTarget, canManage, canEdit, nowRef.current());
    setSectionLoading(nextSectionStatus.loading);
    basePendingRef.current = 0;
    sectionPendingRef.current = 0;
    setRefreshing(
      (next.members.hasValue && next.members.expiresAt <= nowRef.current())
      || (canManage && next.invitations.hasValue && next.invitations.expiresAt <= nowRef.current())
      || nextSectionStatus.stale,
    );
    setBaseError(null);
    setSectionError(null);
  }, [canEdit, canManage, client, commentTarget?.id, commentTarget?.type, queryKey, resolvedScope, section]);

  useLayoutEffect(() => {
    const changed = sectionRef.current !== queryKey;
    if (!changed) return;
    sectionLeasesRef.current.forEach((lease) => lease.release());
    sectionLeasesRef.current = [];
    sectionRef.current = queryKey;
    const scope = scopeFor(client, resolvedScope);
    const nextSection = existingSectionCacheFor(scope, queryKey);
    commentsRef.current = nextSection?.comments.value ?? [];
    sharesRef.current = nextSection?.shares.value ?? [];
    activityRef.current = nextSection?.activity.value ?? [];
    auditRef.current = nextSection?.audit.value ?? [];
    setCommentsState(commentsRef.current);
    setSharesState(sharesRef.current);
    setActivityState(activityRef.current);
    setAuditState(auditRef.current);
    const nextSectionStatus = sectionStatus(scope, queryKey, section, commentTarget, canManage, canEdit, nowRef.current());
    setSectionLoading(nextSectionStatus.loading);
    sectionPendingRef.current = 0;
    setSectionError(null);
    setRefreshing(nextSectionStatus.stale || basePendingRef.current > 0);
  }, [canEdit, canManage, client, commentTarget?.id, commentTarget?.type, queryKey, resolvedScope, section]);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    const scope = scopeFor(client, resolvedScope);
    const sync = () => {
      if (!mountedRef.current || !scopeMatches) return;
      membersRef.current = scope.members.value ?? [];
      invitationsRef.current = canManage ? scope.invitations.value ?? [] : [];
      setMembersState(membersRef.current);
      setInvitationsState(invitationsRef.current);
      const invalidated = [scope.members, ...(canManage ? [scope.invitations] : [])]
        .some((resource) => (resource.hasValue && resource.expiresAt <= nowRef.current()) || (!resource.hasValue && !resource.request));
      if (invalidated) setBaseReloadVersion((version) => version + 1);
    };
    const onMembers = (origin: object | null) => { if (origin !== baseOriginRef.current) sync(); };
    const onInvitations = (origin: object | null) => { if (origin !== baseOriginRef.current) sync(); };
    scope.members.listeners.add(onMembers);
    scope.invitations.listeners.add(onInvitations);
    return () => {
      scope.members.listeners.delete(onMembers);
      scope.invitations.listeners.delete(onInvitations);
    };
  }, [canManage, client, resolvedScope, scopeMatches]);

  useEffect(() => {
    const scope = scopeFor(client, resolvedScope);
    if (section === "people") return undefined;
    const resource = sectionCacheFor(scope, queryKey);
    const listenerScopeVersion = scopeVersionRef.current;
    const isCurrentListener = () => mountedRef.current
      && scopeVersionRef.current === listenerScopeVersion
      && scopeRef.current.client === client
      && scopeRef.current.scope === resolvedScope
      && sectionRef.current === queryKey;
    const sync = () => {
      if (!isCurrentListener()) return;
      commentsRef.current = resource.comments.value ?? [];
      sharesRef.current = resource.shares.value ?? [];
      activityRef.current = resource.activity.value ?? [];
      auditRef.current = resource.audit.value ?? [];
      setCommentsState(commentsRef.current);
      setSharesState(sharesRef.current);
      setActivityState(activityRef.current);
      setAuditState(auditRef.current);
      const relevantResources = resourceForSection(resource, section, canManage, canEdit);
      const invalidated = relevantResources.some((value) => (value.hasValue && value.expiresAt <= nowRef.current()) || (!value.hasValue && !value.request));
      if (invalidated) setSectionReloadVersion((version) => version + 1);
    };
    const listener = (origin: object | null) => { if (origin !== sectionOriginRef.current) sync(); };
    Object.values(resource).forEach((value) => {
      if (value && typeof value === "object" && "listeners" in value) (value as CacheValue<unknown>).listeners.add(listener);
    });
    return () => {
      Object.values(resource).forEach((value) => {
        if (value && typeof value === "object" && "listeners" in value) (value as CacheValue<unknown>).listeners.delete(listener);
      });
    };
  }, [canEdit, canManage, client, queryKey, resolvedScope, section]);

  useEffect(() => {
    const scopeVersion = scopeVersionRef.current;
    const scope = scopeFor(client, resolvedScope);
    const memberResource = scope.members;
    const invitationResource = scope.invitations;
    const memberState = readCachedResource(memberResource, [] as WorkspaceMember[], nowRef.current());
    const invitationState = readCachedResource(invitationResource, [] as WorkspaceInvitation[], nowRef.current());
      membersRef.current = memberState.current;
      invitationsRef.current = canManage ? invitationState.current : [];
      setMembersState(membersRef.current);
      setInvitationsState(invitationsRef.current);
    const needsMembers = !memberState.hasValue || memberState.stale;
    const needsInvitations = canManage && (!invitationState.hasValue || invitationState.stale);
    const missing = !memberState.hasValue || (canManage && !invitationState.hasValue);
    setBaseLoading(missing);
    if (!needsMembers && !needsInvitations) {
      basePendingRef.current = 0;
      setRefreshing(sectionPendingRef.current > 0);
    } else {
      setRefreshing(true);
    }
    setBaseError(null);
    if (!needsMembers && !needsInvitations) return undefined;
    let active = true;
    let pending = Number(needsMembers) + Number(needsInvitations);
    const leases: Array<RequestLease<unknown>> = [];
    baseLeasesRef.current = leases;
    basePendingRef.current = pending;
    updateRefreshing();
    const isCurrentEffect = () => active
      && mountedRef.current
      && scopeVersion === scopeVersionRef.current
      && scopeRef.current.client === client
      && scopeRef.current.scope === resolvedScope
      && baseLeasesRef.current === leases;
    const finish = () => {
      if (!isCurrentEffect()) return;
      pending -= 1;
      basePendingRef.current = Math.max(0, pending);
      if (active && pending <= 0) {
        setBaseLoading(false);
      }
      updateRefreshing();
    };
    const attach = <T,>(resource: CacheValue<T>, lease: RequestLease<T>, apply: (value: T) => void) => {
      leases.push(lease as RequestLease<unknown>);
      const request = lease.request;
      const requestGeneration = request.generation;
      const isCurrentRequest = () => isCurrentEffect()
        && resource.generation === requestGeneration
        && !request.controller.signal.aborted;
      void request.promise.then((value) => {
        if (!isCurrentRequest()) return;
        write(resource, value, nowRef.current() + ttlRef.current);
        apply(value);
        notify(resource, baseOriginRef.current);
      }).catch((error: unknown) => {
        if (isCurrentRequest() && !isAborted(error, request.controller.signal)) setBaseError(collaborationErrorMessage(error));
      }).finally(finish);
    };
    if (needsMembers) attach(memberResource, acquire(memberResource, (signal) => client.listMembers(signal)), (value) => { membersRef.current = value; setMembersState(value); });
    if (needsInvitations) attach(invitationResource, acquire(invitationResource, (signal) => client.listInvitations(signal)), (value) => { invitationsRef.current = value; setInvitationsState(value); });
    return () => {
      active = false;
      leases.forEach((lease) => lease.release());
      if (baseLeasesRef.current === leases) {
        baseLeasesRef.current = [];
        basePendingRef.current = 0;
        updateRefreshing();
      }
    };
  }, [baseReloadVersion, baseRetryVersion, canManage, client, resolvedScope, updateRefreshing]);

  useEffect(() => {
    if (section === "people" || (section === "comments" && !commentTarget)) {
      setSectionLoading(false);
      sectionPendingRef.current = 0;
      updateRefreshing();
      if (section === "comments") { commentsRef.current = []; setCommentsState([]); }
      return undefined;
    }
    const scopeVersion = scopeVersionRef.current;
    const scope = scopeFor(client, resolvedScope);
    const cached = sectionCacheFor(scope, queryKey);
    const resources: Array<{
      resource: CacheValue<unknown[]>;
      load: (signal: AbortSignal) => Promise<unknown[]>;
      apply(value: unknown[]): void;
    }> = [];
    if (section === "comments") {
      resources.push({
        resource: cached.comments as CacheValue<unknown[]>,
        load: (signal) => client.listComments(commentTarget!.type as "note" | "database_record", commentTarget!.id, signal),
        apply: (value) => { commentsRef.current = value as CollaborationComment[]; setCommentsState(commentsRef.current); },
      });
    } else if (section === "shares" && canEdit) {
      resources.push({
        resource: cached.shares as CacheValue<unknown[]>,
        load: (signal) => client.listShares({ signal }),
        apply: (value) => { sharesRef.current = value as PublicShare[]; setSharesState(sharesRef.current); },
      });
    } else if (section === "activity") {
      resources.push({
        resource: cached.activity as CacheValue<unknown[]>,
        load: (signal) => client.listActivity({ limit: 50, signal }).then((page) => page.items),
        apply: (value) => { activityRef.current = value as ActivityEntry[]; setActivityState(activityRef.current); },
      });
      if (canManage) {
        resources.push({
          resource: cached.audit as CacheValue<unknown[]>,
          load: (signal) => client.listAudit({ limit: 50, signal }).then((page) => page.items),
          apply: (value) => { auditRef.current = value as AuditEntry[]; setAuditState(auditRef.current); },
        });
      } else {
        setAuditState([]);
      }
    }
    if (resources.length === 0) {
      setSectionLoading(false);
      sectionPendingRef.current = 0;
      updateRefreshing();
      return undefined;
    }
    resources.forEach(({ resource, apply }) => {
      const state = readCachedResource(resource, [] as unknown[], nowRef.current());
      apply(state.current);
    });
    const missing = resources.some(({ resource }) => !resource.hasValue);
    const stale = resources.some(({ resource }) => resource.hasValue && resource.expiresAt <= nowRef.current());
    setSectionLoading(missing);
    sectionPendingRef.current = 0;
    setRefreshing(stale || basePendingRef.current > 0);
    setSectionError(null);
    const toLoad = resources.filter(({ resource }) => !resource.hasValue || resource.expiresAt <= nowRef.current());
    if (toLoad.length === 0) return undefined;
    let active = true;
    let pending = toLoad.length;
    const leases: Array<RequestLease<unknown>> = [];
    sectionLeasesRef.current = leases;
    sectionPendingRef.current = pending;
    updateRefreshing();
    const isCurrentEffect = () => active
      && mountedRef.current
      && scopeVersion === scopeVersionRef.current
      && scopeRef.current.client === client
      && scopeRef.current.scope === resolvedScope
      && sectionRef.current === queryKey
      && sectionLeasesRef.current === leases;
    const finish = () => {
      if (!isCurrentEffect()) return;
      pending -= 1;
      sectionPendingRef.current = Math.max(0, pending);
      if (active && pending === 0) {
        setSectionLoading(false);
      }
      updateRefreshing();
    };
    toLoad.forEach(({ resource, load, apply }) => {
      const lease = acquire(resource, load);
      leases.push(lease as RequestLease<unknown>);
      const request = lease.request;
      const requestGeneration = request.generation;
      const isCurrentRequest = () => isCurrentEffect()
        && resource.generation === requestGeneration
        && !request.controller.signal.aborted;
      void request.promise.then((value) => {
        if (!isCurrentRequest()) return;
        write(resource, value, nowRef.current() + ttlRef.current);
        apply(value);
        notify(resource, sectionOriginRef.current);
      }).catch((error: unknown) => {
        if (isCurrentRequest() && !isAborted(error, request.controller.signal)) setSectionError(collaborationErrorMessage(error));
      }).finally(finish);
    });
    return () => {
      active = false;
      leases.forEach((lease) => lease.release());
      if (sectionLeasesRef.current === leases) {
        sectionLeasesRef.current = [];
        sectionPendingRef.current = 0;
        updateRefreshing();
      }
    };
  }, [canManage, canEdit, client, commentTarget?.id, commentTarget?.type, queryKey, resolvedScope, section, sectionReloadVersion, sectionRetryVersion, updateRefreshing]);

  const setResourceValue = useCallback(<T,>(resource: CacheValue<T>, next: Updater<T>, current: T, origin: object, setter?: (value: T) => void) => {
    const value = updateValue(resource, next, current, nowRef.current, ttlRef.current);
    setter?.(value);
    notify(resource, origin);
    return true;
  }, []);

  const setMembers = useCallback<GuardedSetter<WorkspaceMember[]>>((next) => {
    if (!isCurrentScope()) return false;
    return setResourceValue(scopeFor(client, resolvedScope).members, next, membersRef.current, baseOriginRef.current, (value) => { membersRef.current = value; setMembersState(value); });
  }, [client, isCurrentScope, resolvedScope, setResourceValue]);
  const setInvitations = useCallback<GuardedSetter<WorkspaceInvitation[]>>((next) => {
    if (!isCurrentScope()) return false;
    return setResourceValue(scopeFor(client, resolvedScope).invitations, next, invitationsRef.current, baseOriginRef.current, (value) => { invitationsRef.current = value; setInvitationsState(value); });
  }, [client, isCurrentScope, resolvedScope, setResourceValue]);
  const setComments = useCallback<GuardedSetter<CollaborationComment[]>>((next) => {
    if (!isCurrentScope()) return false;
    const cached = sectionCacheFor(scopeFor(client, resolvedScope), callbackQueryKey);
    const visible = sectionRef.current === callbackQueryKey;
    return setResourceValue(cached.comments, next, cached.comments.value ?? [], sectionOriginRef.current, visible ? (value) => { commentsRef.current = value; setCommentsState(value); } : undefined);
  }, [callbackQueryKey, client, isCurrentScope, resolvedScope, setResourceValue]);
  const setShares = useCallback<GuardedSetter<PublicShare[]>>((next) => {
    if (!isCurrentScope()) return false;
    const cached = sectionCacheFor(scopeFor(client, resolvedScope), callbackQueryKey);
    const visible = sectionRef.current === callbackQueryKey;
    return setResourceValue(cached.shares, next, cached.shares.value ?? [], sectionOriginRef.current, visible ? (value) => { sharesRef.current = value; setSharesState(value); } : undefined);
  }, [callbackQueryKey, client, isCurrentScope, resolvedScope, setResourceValue]);
  const setActivity = useCallback<GuardedSetter<ActivityEntry[]>>((next) => {
    if (!isCurrentScope()) return false;
    const cached = sectionCacheFor(scopeFor(client, resolvedScope), callbackQueryKey);
    const visible = sectionRef.current === callbackQueryKey;
    return setResourceValue(cached.activity, next, cached.activity.value ?? [], sectionOriginRef.current, visible ? (value) => { activityRef.current = value; setActivityState(value); } : undefined);
  }, [callbackQueryKey, client, isCurrentScope, resolvedScope, setResourceValue]);
  const setAudit = useCallback<GuardedSetter<AuditEntry[]>>((next) => {
    if (!isCurrentScope()) return false;
    const cached = sectionCacheFor(scopeFor(client, resolvedScope), callbackQueryKey);
    const visible = sectionRef.current === callbackQueryKey;
    return setResourceValue(cached.audit, next, cached.audit.value ?? [], sectionOriginRef.current, visible ? (value) => { auditRef.current = value; setAuditState(value); } : undefined);
  }, [callbackQueryKey, client, isCurrentScope, resolvedScope, setResourceValue]);

  const retryBase = useCallback(() => {
    if (!isCurrentScope()) return;
    const scope = scopeFor(client, resolvedScope);
    retire(scope.members);
    if (canManage) retire(scope.invitations);
    setBaseError(null);
    setBaseRetryVersion((version) => version + 1);
  }, [canManage, client, isCurrentScope, resolvedScope]);
  const retrySection = useCallback(() => {
    if (!isCurrentScope() || sectionRef.current !== callbackQueryKey || section === "people") return;
    if (sectionPendingRef.current > 0) return;
    const scope = scopeFor(client, resolvedScope);
    const cached = sectionCacheFor(scope, callbackQueryKey);
    const resource = section === "comments"
      ? cached.comments
      : section === "shares"
        ? cached.shares
        : section === "activity"
          ? cached.activity
          : cached.audit;
    retire(resource as CacheValue<unknown[]>);
    setSectionError(null);
    setSectionRetryVersion((version) => version + 1);
  }, [callbackQueryKey, canManage, client, isCurrentScope, resolvedScope, section]);

  useEffect(() => () => {
    mountedRef.current = false;
    baseLeasesRef.current.forEach((lease) => lease.release());
    sectionLeasesRef.current.forEach((lease) => lease.release());
    scopeVersionRef.current += 1;
  }, []);

  return {
    scopeVersion: scopeEpoch,
    members: scopeMatches ? members : [],
    invitations: scopeMatches ? invitations : [],
    comments: scopeMatches && sectionMatches ? comments : [],
    shares: scopeMatches && sectionMatches ? shares : [],
    activity: scopeMatches && sectionMatches ? activity : [],
    audit: scopeMatches && sectionMatches ? audit : [],
    baseLoading: scopeMatches ? baseLoading : true,
    sectionLoading: scopeMatches && sectionMatches ? sectionLoading : section !== "people" && (section !== "comments" || Boolean(commentTarget)),
    refreshing: scopeMatches ? refreshing : false,
    baseError: scopeMatches ? baseError : null,
    sectionError: scopeMatches && sectionMatches ? sectionError : null,
    error: scopeMatches ? sectionError ?? baseError : null,
    setMembers,
    setInvitations,
    setComments,
    setShares,
    setActivity,
    setAudit,
    retryBase,
    retrySection,
  };
}
