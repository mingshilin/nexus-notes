import { useCallback, useEffect, useLayoutEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { Notification, NotificationReadInput } from "@nexus/contracts";

import type { CollaborationClient } from "../data/collaboration-client";
import { collaborationErrorMessage } from "./collaboration-types";

type NotificationPage = { items: Notification[]; next_cursor: string | null };
type NotificationReadResult = { notification_ids: string[]; read_at: string };
type NotificationReadAllResult = { count: number; read_at: string };

export type NotificationCenterDataClient = Pick<
  CollaborationClient,
  "listNotifications" | "readNotification" | "readNotifications" | "readAllNotifications"
>;

export interface UseNotificationCenterDataParams {
  client: NotificationCenterDataClient;
  open: boolean;
  cacheScope?: string;
  ttlMs?: number;
  now?: () => number;
}

export interface NotificationCenterDataState {
  notifications: Notification[];
  nextCursor: string | null;
  selectedIds: Set<string>;
  loading: boolean;
  refreshing: boolean;
  pending: boolean;
  error: string | null;
  setSelectedIds: Dispatch<SetStateAction<Set<string>>>;
  markNotificationRead(notificationId: string, revision: number): Promise<NotificationReadResult | null>;
  readSelected(): Promise<number>;
  readAll(): Promise<number>;
  loadMore(): Promise<void>;
  retry(): void;
}

interface NotificationCacheEntry {
  items: Notification[];
  nextCursor: string | null;
  expiresAt: number;
}

interface NotificationListRequest {
  controller: AbortController;
  promise: Promise<NotificationPage>;
  consumers: number;
  releaseScheduled: boolean;
}

interface NotificationListLease {
  request: NotificationListRequest;
  release(): void;
}

interface NotificationCacheScope {
  entry: NotificationCacheEntry | null;
  listeners: Set<(origin: object | null) => void>;
  listRequest: NotificationListRequest | null;
}

const cacheRegistry = new WeakMap<object, Map<string, NotificationCacheScope>>();

function cacheScopeFor(client: NotificationCenterDataClient, scope: string): NotificationCacheScope {
  const key = client as object;
  const scopes = cacheRegistry.get(key);
  if (scopes) {
    const existing = scopes.get(scope);
    if (existing) return existing;
    const created: NotificationCacheScope = { entry: null, listeners: new Set(), listRequest: null };
    scopes.set(scope, created);
    return created;
  }
  const created: NotificationCacheScope = { entry: null, listeners: new Set(), listRequest: null };
  cacheRegistry.set(key, new Map([[scope, created]]));
  return created;
}

function writeCache(client: NotificationCenterDataClient, scope: string, entry: NotificationCacheEntry) {
  const cache = cacheScopeFor(client, scope);
  cache.entry = entry;
}

function notifyCacheInvalidation(client: NotificationCenterDataClient, scope: string, origin: object | null) {
  cacheScopeFor(client, scope).listeners.forEach((listener) => listener(origin));
}

function acquireListRequest(cache: NotificationCacheScope, load: (signal: AbortSignal) => Promise<NotificationPage>) {
  let request = cache.listRequest;
  if (!request) {
    const controller = new AbortController();
    let created!: NotificationListRequest;
    const promise = load(controller.signal).finally(() => {
      if (cache.listRequest === created) cache.listRequest = null;
    });
    created = { controller, promise, consumers: 0, releaseScheduled: false };
    cache.listRequest = created;
    request = created;
  }
  request.consumers += 1;
  request.releaseScheduled = false;
  let released = false;
  return {
    request,
    release() {
      if (released) return;
      released = true;
      releaseListRequest(cache, request);
    },
  } satisfies NotificationListLease;
}

function releaseListRequest(cache: NotificationCacheScope, request: NotificationListRequest) {
  if (cache.listRequest !== request) return;
  request.consumers = Math.max(0, request.consumers - 1);
  if (request.consumers > 0 || request.releaseScheduled) return;
  request.releaseScheduled = true;
  queueMicrotask(() => {
    if (cache.listRequest !== request || request.consumers > 0) {
      request.releaseScheduled = false;
      return;
    }
    cache.listRequest = null;
    request.controller.abort();
  });
}

function isAbort(error: unknown, signal: AbortSignal) {
  return signal.aborted || (error instanceof DOMException && error.name === "AbortError");
}

function mergeNotifications(current: Notification[], next: Notification[]) {
  const byId = new Map(current.map((item) => [item.id, item]));
  next.forEach((item) => {
    const previous = byId.get(item.id);
    byId.set(item.id, previous?.read_at && !item.read_at ? { ...item, read_at: previous.read_at } : item);
  });
  return [...byId.values()];
}

function preserveReadState(items: Notification[], previous: Notification[] = []) {
  const previousById = new Map(previous.map((item) => [item.id, item]));
  return items.map((item) => {
    const previousItem = previousById.get(item.id);
    return previousItem?.read_at && !item.read_at ? { ...item, read_at: previousItem.read_at } : item;
  });
}

export function useNotificationCenterData({
  client,
  open,
  cacheScope,
  ttlMs = 60_000,
  now = Date.now,
}: UseNotificationCenterDataParams): NotificationCenterDataState {
  const resolvedCacheScope = cacheScope ?? "default";
  const initialCacheRef = useRef<NotificationCacheEntry | null | undefined>(undefined);
  if (initialCacheRef.current === undefined) {
    initialCacheRef.current = cacheScopeFor(client, resolvedCacheScope).entry;
  }
  const initialCache = initialCacheRef.current;
  const [notifications, setNotifications] = useState<Notification[]>(() => initialCache?.items ?? []);
  const [nextCursor, setNextCursor] = useState<string | null>(() => initialCache?.nextCursor ?? null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(() => open && !initialCache);
  const [refreshing, setRefreshing] = useState(() => Boolean(open && initialCache && initialCache.expiresAt <= now()));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cacheRefreshVersion, setCacheRefreshVersion] = useState(0);
  const handledRefreshVersionRef = useRef(0);
  const scopeRef = useRef({ client, cacheScope: resolvedCacheScope });
  const scopeVersionRef = useRef(0);
  const generationRef = useRef(0);
  const notificationsRef = useRef<Notification[]>(notifications);
  const nextCursorRef = useRef<string | null>(nextCursor);
  const pendingRef = useRef(false);
  const mountedRef = useRef(true);
  const listLeaseRef = useRef<NotificationListLease | null>(null);
  const pageControllerRef = useRef<AbortController | null>(null);
  const commandControllerRef = useRef<AbortController | null>(null);
  const listenerTokenRef = useRef<object>({});
  const scopeMatches = scopeRef.current.client === client && scopeRef.current.cacheScope === resolvedCacheScope;

  useLayoutEffect(() => {
    const scopeChanged = scopeRef.current.client !== client || scopeRef.current.cacheScope !== resolvedCacheScope;
    if (scopeChanged) {
      const previousListLease = listLeaseRef.current;
      if (previousListLease) {
        previousListLease.release();
        listLeaseRef.current = null;
      }
      scopeRef.current = { client, cacheScope: resolvedCacheScope };
      scopeVersionRef.current += 1;
      generationRef.current += 1;
      pageControllerRef.current?.abort();
      commandControllerRef.current?.abort();
      pageControllerRef.current = null;
      commandControllerRef.current = null;
      pendingRef.current = false;
      const cached = cacheScopeFor(client, resolvedCacheScope).entry;
      setNotifications(cached?.items ?? []);
      setNextCursor(cached?.nextCursor ?? null);
      setSelectedIds(new Set());
      setLoading(Boolean(open && !cached));
      setRefreshing(Boolean(open && cached && cached.expiresAt <= now()));
      setPending(false);
      setError(null);
    }
  }, [client, now, open, resolvedCacheScope]);

  useLayoutEffect(() => {
    mountedRef.current = true;
    const cache = cacheScopeFor(client, resolvedCacheScope);
    const onCacheUpdate = (origin: object | null) => {
      if (origin === listenerTokenRef.current || !mountedRef.current || !open
        || scopeRef.current.client !== client || scopeRef.current.cacheScope !== resolvedCacheScope) return;
      const entry = cache.entry;
      if (!entry) return;
      generationRef.current += 1;
      const activeListLease = listLeaseRef.current;
      if (activeListLease) {
        activeListLease.release();
        listLeaseRef.current = null;
      }
      pageControllerRef.current?.abort();
      commandControllerRef.current?.abort();
      pageControllerRef.current = null;
      commandControllerRef.current = null;
      pendingRef.current = false;
      setNotifications(entry.items);
      setNextCursor(entry.nextCursor);
      setSelectedIds(new Set());
      setPending(false);
      setError(null);
      setRefreshing(true);
      setCacheRefreshVersion((version) => version + 1);
    };
    cache.listeners.add(onCacheUpdate);
    return () => {
      mountedRef.current = false;
      cache.listeners.delete(onCacheUpdate);
    };
  }, [client, open, resolvedCacheScope]);

  useLayoutEffect(() => {
    notificationsRef.current = notifications;
    nextCursorRef.current = nextCursor;
  }, [notifications, nextCursor]);

  useLayoutEffect(() => {
    if (open) return;
    generationRef.current += 1;
    commandControllerRef.current?.abort();
    commandControllerRef.current = null;
    pendingRef.current = false;
    setPending(false);
    setSelectedIds(new Set());
  }, [open]);

  useEffect(() => {
    if (!open) {
      const activeListLease = listLeaseRef.current;
      if (activeListLease) {
        activeListLease.release();
        listLeaseRef.current = null;
      }
      pageControllerRef.current?.abort();
      pageControllerRef.current = null;
      return undefined;
    }
    const scopeVersion = scopeVersionRef.current;
    const generation = ++generationRef.current;
    const cached = cacheScopeFor(client, resolvedCacheScope).entry;
    if (cached) {
      setNotifications(cached.items);
      setNextCursor(cached.nextCursor);
      setLoading(false);
      const fresh = cached.expiresAt > now();
      setRefreshing(!fresh);
      if (fresh && handledRefreshVersionRef.current >= cacheRefreshVersion) return undefined;
      handledRefreshVersionRef.current = cacheRefreshVersion;
    } else {
      setNotifications([]);
      setNextCursor(null);
      setLoading(true);
      setRefreshing(false);
    }
    setError(null);

    const cache = cacheScopeFor(client, resolvedCacheScope);
    const lease = acquireListRequest(cache, (signal) => client.listNotifications({ limit: 25, signal }));
    const request = lease.request;
    listLeaseRef.current = lease;
    const controller = request.controller;
    const isCurrent = () => !controller.signal.aborted
      && mountedRef.current
      && scopeVersion === scopeVersionRef.current
      && generation === generationRef.current
      && scopeRef.current.client === client
      && scopeRef.current.cacheScope === resolvedCacheScope;
    void request.promise.then((page) => {
      if (!isCurrent()) return;
      const items = preserveReadState(page.items, cache.entry?.items);
      const entry = { items, nextCursor: page.next_cursor, expiresAt: now() + ttlMs };
      writeCache(client, resolvedCacheScope, entry);
      setNotifications(items);
      setNextCursor(page.next_cursor);
      setSelectedIds(new Set());
      setError(null);
    }).catch((reason: unknown) => {
      if (isCurrent() && !isAbort(reason, controller.signal)) setError(collaborationErrorMessage(reason));
    }).finally(() => {
      if (listLeaseRef.current === lease) listLeaseRef.current = null;
      if (isCurrent()) {
        setLoading(false);
        setRefreshing(false);
      }
    });
    return () => {
      lease.release();
      if (listLeaseRef.current === lease) listLeaseRef.current = null;
    };
  }, [cacheRefreshVersion, client, now, open, resolvedCacheScope, ttlMs]);

  const runCommand = useCallback(async <T,>(task: (signal: AbortSignal) => Promise<T>): Promise<T | null> => {
    if (commandControllerRef.current || !mountedRef.current || !open) return null;
    const scopeVersion = scopeVersionRef.current;
    const generation = generationRef.current;
    const requestClient = client;
    const requestScope = resolvedCacheScope;
    const controller = new AbortController();
    commandControllerRef.current = controller;
    pendingRef.current = true;
    setPending(true);
    setError(null);
    const isCurrent = () => !controller.signal.aborted
      && mountedRef.current
      && scopeVersion === scopeVersionRef.current
      && generation === generationRef.current
      && scopeRef.current.client === requestClient
      && scopeRef.current.cacheScope === requestScope;
    try {
      const result = await task(controller.signal);
      return isCurrent() ? result : null;
    } catch (reason) {
      if (isCurrent() && !isAbort(reason, controller.signal)) setError(collaborationErrorMessage(reason));
      return null;
    } finally {
      if (commandControllerRef.current === controller) commandControllerRef.current = null;
      if (isCurrent()) {
        const pagePending = pageControllerRef.current !== null;
        pendingRef.current = pagePending;
        setPending(pagePending);
      }
    }
  }, [client, open, resolvedCacheScope]);

  const cancelListRequestsForMutation = useCallback(() => {
    generationRef.current += 1;
    const activeListLease = listLeaseRef.current;
    if (activeListLease) {
      activeListLease.release();
      listLeaseRef.current = null;
    }
    pageControllerRef.current?.abort();
    pageControllerRef.current = null;
    pendingRef.current = false;
    setPending(false);
    setLoading(false);
    setRefreshing(false);
  }, [client, resolvedCacheScope]);

  const updateReadState = useCallback((ids: readonly string[], readAt: string) => {
    if (ids.length === 0) return;
    cancelListRequestsForMutation();
    const idSet = new Set(ids);
    const updated = notificationsRef.current.map((item) => idSet.has(item.id) ? { ...item, read_at: readAt } : item);
    notificationsRef.current = updated;
    setNotifications(updated);
    setSelectedIds((current) => new Set([...current].filter((id) => !idSet.has(id))));
    const cached = cacheScopeFor(client, resolvedCacheScope).entry;
    if (cached) {
      const updatedCache = {
        ...cached,
        items: cached.items.map((item) => idSet.has(item.id) ? { ...item, read_at: readAt } : item),
        expiresAt: now() + ttlMs,
      };
      writeCache(client, resolvedCacheScope, updatedCache);
      notifyCacheInvalidation(client, resolvedCacheScope, listenerTokenRef.current);
    }
  }, [cancelListRequestsForMutation, client, now, resolvedCacheScope, ttlMs]);

  const markNotificationRead = useCallback(async (notificationId: string, revision: number) => {
    const result = await runCommand((signal) => client.readNotification(notificationId, revision, signal));
    if (!result) return null;
    updateReadState(result.notification_ids, result.read_at);
    return result;
  }, [client, runCommand, updateReadState]);

  const readSelected = useCallback(async () => {
    const selected = notificationsRef.current.filter((item) => selectedIds.has(item.id) && !item.read_at);
    if (selected.length === 0) return 0;
    const input: NotificationReadInput = {
      notification_ids: selected.map((item) => item.id),
      base_revisions: Object.fromEntries(selected.map((item) => [item.id, item.revision])),
    };
    const result = await runCommand((signal) => client.readNotifications(input, signal));
    if (!result) return 0;
    updateReadState(result.notification_ids, result.read_at);
    return result.notification_ids.length;
  }, [client, runCommand, selectedIds, updateReadState]);

  const readAll = useCallback(async () => {
    const result = await runCommand((signal) => client.readAllNotifications(signal));
    if (!result) return 0;
    cancelListRequestsForMutation();
    const readAt = result.read_at;
    const updated = notificationsRef.current.map((item) => ({ ...item, read_at: item.read_at ?? readAt }));
    notificationsRef.current = updated;
    setNotifications(updated);
    setSelectedIds(new Set());
    const cached = cacheScopeFor(client, resolvedCacheScope).entry;
    if (cached) {
      const updatedCache = {
        ...cached,
        items: cached.items.map((item) => ({ ...item, read_at: item.read_at ?? readAt })),
        expiresAt: now() + ttlMs,
      };
      writeCache(client, resolvedCacheScope, updatedCache);
      notifyCacheInvalidation(client, resolvedCacheScope, listenerTokenRef.current);
    }
    return result.count;
  }, [cancelListRequestsForMutation, client, now, resolvedCacheScope, runCommand, ttlMs]);

  const loadMore = useCallback(async () => {
    const cursor = nextCursorRef.current;
    if (!cursor || pendingRef.current || pageControllerRef.current || !open) return;
    const scopeVersion = scopeVersionRef.current;
    const generation = generationRef.current;
    const requestClient = client;
    const requestScope = resolvedCacheScope;
    const controller = new AbortController();
    pageControllerRef.current = controller;
    setPending(true);
    pendingRef.current = true;
    setError(null);
    const isCurrent = () => !controller.signal.aborted && mountedRef.current
      && scopeVersion === scopeVersionRef.current && generation === generationRef.current
      && scopeRef.current.client === requestClient && scopeRef.current.cacheScope === requestScope;
    try {
      const page = await client.listNotifications({ cursor, limit: 25, signal: controller.signal });
      if (!isCurrent()) return;
      const merged = mergeNotifications(notificationsRef.current, page.items);
      const entry = { items: merged, nextCursor: page.next_cursor, expiresAt: now() + ttlMs };
      writeCache(client, resolvedCacheScope, entry);
      notificationsRef.current = merged;
      nextCursorRef.current = page.next_cursor;
      setNotifications(merged);
      setNextCursor(page.next_cursor);
    } catch (reason) {
      if (isCurrent() && !isAbort(reason, controller.signal)) setError(collaborationErrorMessage(reason));
    } finally {
      if (pageControllerRef.current === controller) pageControllerRef.current = null;
      if (isCurrent() && !commandControllerRef.current) {
        pendingRef.current = false;
        setPending(false);
      }
    }
  }, [client, now, open, resolvedCacheScope, ttlMs]);

  const retry = useCallback(() => {
    const cached = cacheScopeFor(client, resolvedCacheScope).entry;
    if (cached) {
      writeCache(client, resolvedCacheScope, { ...cached, expiresAt: Number.NEGATIVE_INFINITY });
    }
    setError(null);
    notifyCacheInvalidation(client, resolvedCacheScope, listenerTokenRef.current);
    setCacheRefreshVersion((version) => version + 1);
  }, [client, resolvedCacheScope]);

  useEffect(() => () => {
    mountedRef.current = false;
    generationRef.current += 1;
    const activeListLease = listLeaseRef.current;
    if (activeListLease) {
      activeListLease.release();
      listLeaseRef.current = null;
    }
    pageControllerRef.current?.abort();
    commandControllerRef.current?.abort();
  }, []);

  return {
    notifications: scopeMatches ? notifications : [],
    nextCursor: scopeMatches ? nextCursor : null,
    selectedIds: scopeMatches ? selectedIds : new Set(),
    loading: scopeMatches ? loading : open,
    refreshing: scopeMatches ? refreshing : false,
    pending: scopeMatches ? pending : false,
    error: scopeMatches ? error : null,
    setSelectedIds,
    markNotificationRead,
    readSelected,
    readAll,
    loadMore,
    retry,
  };
}
