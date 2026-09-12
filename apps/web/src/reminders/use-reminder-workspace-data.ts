import { useCallback, useEffect, useLayoutEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { Reminder, ReminderDelivery, ReminderListQuery, UpdateReminderInput } from "@nexus/contracts";

type ReminderPage = { items: Reminder[]; next_cursor: string | null };

export interface ReminderWorkspaceClient {
  createReminder?: unknown;
  updateReminder?: unknown;
  snoozeReminder?: unknown;
  deleteReminder?: unknown;
  listReminderPage?(input: ReminderListQuery, signal?: AbortSignal): Promise<ReminderPage>;
  listReminders?(includeCompleted?: boolean, signal?: AbortSignal): Promise<Reminder[]>;
  listReminderDeliveries?(reminderId: string, signal?: AbortSignal): Promise<ReminderDelivery[]>;
  retryReminderDelivery?(reminderId: string, deliveryId: string, signal?: AbortSignal): Promise<ReminderDelivery>;
}

export interface UseReminderWorkspaceDataParams {
  client: ReminderWorkspaceClient;
  now?: () => number;
  ttlMs?: number;
  cacheScope?: string;
}

export interface ReminderWorkspaceDataState {
  reminders: Reminder[];
  setReminders: Dispatch<SetStateAction<Reminder[]>>;
  nextCursor: string | null;
  setNextCursor: Dispatch<SetStateAction<string | null>>;
  search: string;
  setSearch: Dispatch<SetStateAction<string>>;
  debouncedSearch: string;
  statusFilter: ReminderListQuery["status"];
  setStatusFilter: Dispatch<SetStateAction<ReminderListQuery["status"]>>;
  selectedIds: Set<string>;
  setSelectedIds: Dispatch<SetStateAction<Set<string>>>;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  setError: Dispatch<SetStateAction<string | null>>;
  feedback: string | null;
  setFeedback: Dispatch<SetStateAction<string | null>>;
  failedBulkIds: string[];
  setFailedBulkIds: Dispatch<SetStateAction<string[]>>;
  retryRequest: { reminder: Reminder; input: UpdateReminderInput; success: string } | null;
  setRetryRequest: Dispatch<SetStateAction<{ reminder: Reminder; input: UpdateReminderInput; success: string } | null>>;
  loadMore(): void;
  deliveryOpenId: string | null;
  deliveryItems: Record<string, ReminderDelivery[]>;
  deliveryLoadingId: string | null;
  deliveryErrors: Record<string, string>;
  deliveryRetryId: string | null;
  toggleDeliveryStatus(reminderId: string): void;
  retryDelivery(reminderId: string, deliveryId: string): void;
}

interface ReminderCacheEntry {
  items: Reminder[];
  nextCursor: string | null;
  expiresAt: number;
}

interface ReminderCacheScope {
  entries: Map<string, ReminderCacheEntry>;
  listeners: Set<(origin: object | null) => void>;
}

const cacheRegistry = new WeakMap<object, Map<string, ReminderCacheScope>>();

function cacheScopeFor(client: ReminderWorkspaceClient, scope: string): ReminderCacheScope {
  const key = client as object;
  const scopes = cacheRegistry.get(key);
  if (scopes) {
    const existing = scopes.get(scope);
    if (existing) return existing;
    const created: ReminderCacheScope = { entries: new Map(), listeners: new Set() };
    scopes.set(scope, created);
    return created;
  }
  const created: ReminderCacheScope = { entries: new Map(), listeners: new Set() };
  cacheRegistry.set(key, new Map([[scope, created]]));
  return created;
}

function cacheFor(client: ReminderWorkspaceClient, scope: string) {
  return cacheScopeFor(client, scope).entries;
}

function invalidateCacheScope(client: ReminderWorkspaceClient, scope: string) {
  const cacheScope = cacheScopeFor(client, scope);
  cacheScope.entries.clear();
  cacheScope.listeners.forEach((listener) => listener(null));
}

function notifyCacheScope(client: ReminderWorkspaceClient, scope: string, origin: object) {
  cacheScopeFor(client, scope).listeners.forEach((listener) => listener(origin));
}

function queryKey(status: ReminderListQuery["status"], search: string) {
  return `${status}\u0000${search}`;
}

function isAborted(error: unknown, signal: AbortSignal) {
  return signal.aborted || (error instanceof DOMException && error.name === "AbortError");
}

function mergeUnique(current: Reminder[], next: Reminder[]) {
  const byId = new Map(current.map((item) => [item.id, item]));
  next.forEach((item) => byId.set(item.id, item));
  return [...byId.values()];
}

export function useReminderWorkspaceData({ client, now = Date.now, ttlMs = 60_000, cacheScope }: UseReminderWorkspaceDataParams): ReminderWorkspaceDataState {
  const resolvedCacheScope = cacheScope ?? "default";
  // Hydrate the default query during render so a remounted panel never flashes an empty list.
  const initialCacheRef = useRef<ReminderCacheEntry | null | undefined>(undefined);
  if (initialCacheRef.current === undefined) {
    initialCacheRef.current = cacheFor(client, resolvedCacheScope).get(queryKey("all", "")) ?? null;
  }
  const initialCache = initialCacheRef.current;
  const initialCacheIsFresh = initialCache ? initialCache.expiresAt > now() : false;
  const [reminders, setRemindersState] = useState<Reminder[]>(() => initialCache?.items ?? []);
  const [nextCursor, setNextCursorState] = useState<string | null>(() => initialCache?.nextCursor ?? null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<ReminderListQuery["status"]>("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(() => !initialCache);
  const [refreshing, setRefreshing] = useState(() => Boolean(initialCache && !initialCacheIsFresh));
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [failedBulkIds, setFailedBulkIds] = useState<string[]>([]);
  const [retryRequest, setRetryRequest] = useState<{ reminder: Reminder; input: UpdateReminderInput; success: string } | null>(null);
  const [deliveryOpenId, setDeliveryOpenId] = useState<string | null>(null);
  const [deliveryItems, setDeliveryItems] = useState<Record<string, ReminderDelivery[]>>({});
  const [deliveryLoadingId, setDeliveryLoadingId] = useState<string | null>(null);
  const [deliveryErrors, setDeliveryErrors] = useState<Record<string, string>>({});
  const [deliveryRetryId, setDeliveryRetryId] = useState<string | null>(null);
  const [cacheRefreshVersion, setCacheRefreshVersion] = useState(0);
  const listControllerRef = useRef<AbortController | null>(null);
  const pageControllerRef = useRef<AbortController | null>(null);
  const deliveryControllerRef = useRef<AbortController | null>(null);
  const deliveryRetryControllerRef = useRef<AbortController | null>(null);
  const deliveryOpenIdRef = useRef<string | null>(null);
  const generationRef = useRef(0);
  const deliverySequenceRef = useRef(0);
  const deliveryRetryIdRef = useRef<string | null>(null);
  const deliveryRetryReminderIdRef = useRef<string | null>(null);
  const scopeRef = useRef({ client, cacheScope: resolvedCacheScope });
  const scopeVersionRef = useRef(0);
  const queryKeyRef = useRef<string | null>(null);
  const remindersRef = useRef<Reminder[]>([]);
  const nextCursorRef = useRef<string | null>(null);
  const nowRef = useRef(now);
  const ttlMsRef = useRef(ttlMs);
  const mountedRef = useRef(true);
  const cacheListenerTokenRef = useRef<object>({});
  const scopeMatches = scopeRef.current.client === client && scopeRef.current.cacheScope === resolvedCacheScope;

  useLayoutEffect(() => {
    const scopeChanged = scopeRef.current.client !== client || scopeRef.current.cacheScope !== resolvedCacheScope;
    if (scopeChanged) {
      scopeRef.current = { client, cacheScope: resolvedCacheScope };
      scopeVersionRef.current += 1;
      generationRef.current += 1;
      deliverySequenceRef.current += 1;
      listControllerRef.current?.abort();
      pageControllerRef.current?.abort();
      deliveryControllerRef.current?.abort();
      deliveryRetryControllerRef.current?.abort();
      listControllerRef.current = null;
      pageControllerRef.current = null;
      deliveryControllerRef.current = null;
      deliveryRetryControllerRef.current = null;
      deliveryOpenIdRef.current = null;
      deliveryRetryIdRef.current = null;
      deliveryRetryReminderIdRef.current = null;
      const cached = cacheFor(client, resolvedCacheScope).get(queryKey(statusFilter, debouncedSearch));
      setRemindersState(cached?.items ?? []);
      setNextCursorState(cached?.nextCursor ?? null);
      setLoading(!cached);
      setRefreshing(Boolean(cached && cached.expiresAt <= now()));
      setSelectedIds(new Set());
      setFailedBulkIds([]);
      setRetryRequest(null);
      setError(null);
      setFeedback(null);
      setDeliveryOpenId(null);
      setDeliveryLoadingId(null);
      setDeliveryItems({});
      setDeliveryErrors({});
      setDeliveryRetryId(null);
    }
  }, [client, debouncedSearch, resolvedCacheScope, statusFilter]);

  useLayoutEffect(() => {
    mountedRef.current = true;
    const cacheScope = cacheScopeFor(client, resolvedCacheScope);
    const onInvalidate = (origin: object | null) => {
      if (origin === cacheListenerTokenRef.current) return;
      if (!mountedRef.current
        || scopeRef.current.client !== client
        || scopeRef.current.cacheScope !== resolvedCacheScope) return;
      const currentKey = queryKeyRef.current;
      if (currentKey !== null && remindersRef.current.length > 0) {
        cacheScope.entries.set(currentKey, {
          items: remindersRef.current,
          nextCursor: nextCursorRef.current,
          expiresAt: Number.NEGATIVE_INFINITY,
        });
      }
      setCacheRefreshVersion((version) => version + 1);
    };
    cacheScope.listeners.add(onInvalidate);
    return () => {
      mountedRef.current = false;
      cacheScope.listeners.delete(onInvalidate);
    };
  }, [client, resolvedCacheScope]);

  useLayoutEffect(() => {
    nowRef.current = now;
    ttlMsRef.current = ttlMs;
    remindersRef.current = reminders;
    nextCursorRef.current = nextCursor;
  }, [now, ttlMs, reminders, nextCursor]);

  const setterScopeVersion = scopeVersionRef.current;
  const setterGeneration = generationRef.current;
  const setterQueryKey = queryKeyRef.current;
  const setReminders = useCallback<Dispatch<SetStateAction<Reminder[]>>>((next) => {
    const cache = cacheFor(client, resolvedCacheScope);
    const scopeIsCurrent = scopeVersionRef.current === setterScopeVersion
      && mountedRef.current
      && scopeRef.current.client === client
      && scopeRef.current.cacheScope === resolvedCacheScope;
    const queryIsCurrent = scopeIsCurrent
      && generationRef.current === setterGeneration
      && queryKeyRef.current === setterQueryKey
      && setterQueryKey !== null;
    if (!queryIsCurrent) {
      invalidateCacheScope(client, resolvedCacheScope);
      return;
    }
    const retryingReminderId = deliveryRetryReminderIdRef.current;
    deliveryRetryControllerRef.current?.abort();
    deliveryRetryControllerRef.current = null;
    deliveryRetryIdRef.current = null;
    deliveryRetryReminderIdRef.current = null;
    deliverySequenceRef.current += 1;
    setDeliveryRetryId(null);
    if (retryingReminderId) {
      setDeliveryItems((current) => {
        const next = { ...current };
        delete next[retryingReminderId];
        return next;
      });
    }
    generationRef.current += 1;
    listControllerRef.current?.abort();
    pageControllerRef.current?.abort();
    listControllerRef.current = null;
    pageControllerRef.current = null;
    setRefreshing(false);
    const value = typeof next === "function" ? next(remindersRef.current) : next;
    cache.clear();
    cache.set(setterQueryKey, { items: value, nextCursor: nextCursorRef.current, expiresAt: nowRef.current() + ttlMsRef.current });
    remindersRef.current = value;
    setRemindersState(value);
    notifyCacheScope(client, resolvedCacheScope, cacheListenerTokenRef.current);
  }, [client, resolvedCacheScope, setterGeneration, setterQueryKey, setterScopeVersion]);

  const setNextCursor = useCallback<Dispatch<SetStateAction<string | null>>>((next) => {
    if (scopeVersionRef.current !== setterScopeVersion
      || scopeRef.current.client !== client
      || scopeRef.current.cacheScope !== resolvedCacheScope
      || generationRef.current !== setterGeneration
      || queryKeyRef.current !== setterQueryKey
      || setterQueryKey === null) return;
    setNextCursorState((current) => {
      const value = typeof next === "function" ? next(current) : next;
      nextCursorRef.current = value;
      cacheFor(client, resolvedCacheScope).set(setterQueryKey, { items: remindersRef.current, nextCursor: value, expiresAt: nowRef.current() + ttlMsRef.current });
      return value;
    });
  }, [client, resolvedCacheScope, setterGeneration, setterQueryKey, setterScopeVersion]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim().slice(0, 160)), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    const currentKey = queryKey(statusFilter, debouncedSearch);
    const generation = ++generationRef.current;
    queryKeyRef.current = currentKey;
    listControllerRef.current?.abort();
    pageControllerRef.current?.abort();
    deliveryControllerRef.current?.abort();
    deliveryRetryControllerRef.current?.abort();
    deliverySequenceRef.current += 1;
    deliveryOpenIdRef.current = null;
    setDeliveryOpenId(null);
    setDeliveryLoadingId(null);
    setDeliveryItems({});
    setDeliveryErrors({});
    deliveryRetryIdRef.current = null;
    setDeliveryRetryId(null);
    setSelectedIds(new Set());
    setFailedBulkIds([]);
    setRetryRequest(null);
    setError(null);

    const cached = cacheFor(client, resolvedCacheScope).get(currentKey);
    if (cached) {
      setRemindersState(cached.items);
      setNextCursorState(cached.nextCursor);
      setLoading(false);
      const fresh = cached.expiresAt > nowRef.current();
      setRefreshing(!fresh);
      if (fresh) return undefined;
    } else {
      setRemindersState([]);
      setNextCursorState(null);
      setLoading(true);
      setRefreshing(false);
    }

    const controller = new AbortController();
    listControllerRef.current = controller;
    const scopeVersion = scopeVersionRef.current;
    const isCurrent = () => !controller.signal.aborted
      && generation === generationRef.current
      && scopeVersion === scopeVersionRef.current
      && scopeRef.current.client === client
      && scopeRef.current.cacheScope === resolvedCacheScope
      && queryKeyRef.current === currentKey;
    const load = client.listReminderPage
      ? client.listReminderPage({ status: statusFilter, query: debouncedSearch || undefined, limit: 50 }, controller.signal)
      : client.listReminders
        ? client.listReminders(true, controller.signal).then((items) => ({ items, next_cursor: null }))
        : Promise.reject(new Error("Reminder list API is unavailable"));

    void load.then((page) => {
      if (!isCurrent()) return;
      const normalized = { items: page.items, nextCursor: page.next_cursor, expiresAt: nowRef.current() + ttlMsRef.current };
      cacheFor(client, resolvedCacheScope).set(currentKey, normalized);
      setRemindersState(page.items);
      setNextCursorState(page.next_cursor);
      setSelectedIds(new Set());
      setFailedBulkIds([]);
    }).catch((reason: unknown) => {
      if (isCurrent() && !isAborted(reason, controller.signal)) setError("提醒暂时无法加载，保留最近可用数据。请稍后重试。");
    }).finally(() => {
      if (!isCurrent()) return;
      listControllerRef.current = null;
      setLoading(false);
      setRefreshing(false);
    });

    return () => {
      controller.abort();
      if (listControllerRef.current === controller) listControllerRef.current = null;
    };
  }, [cacheRefreshVersion, client, debouncedSearch, resolvedCacheScope, statusFilter]);

  const loadMore = useCallback(() => {
    if (!client.listReminderPage || !nextCursor || loading || refreshing || pageControllerRef.current) return;
    const currentKey = queryKey(statusFilter, debouncedSearch);
    const generation = generationRef.current;
    const cursor = nextCursor;
    const controller = new AbortController();
    pageControllerRef.current = controller;
    setRefreshing(true);
    const scopeVersion = scopeVersionRef.current;
    const isCurrent = () => !controller.signal.aborted
      && generation === generationRef.current
      && scopeVersion === scopeVersionRef.current
      && scopeRef.current.client === client
      && scopeRef.current.cacheScope === resolvedCacheScope
      && queryKeyRef.current === currentKey;
    void client.listReminderPage({ status: statusFilter, query: debouncedSearch || undefined, cursor, limit: 50 }, controller.signal).then((page) => {
      if (!isCurrent()) return;
      setRemindersState((current) => {
        const merged = mergeUnique(current, page.items);
        cacheFor(client, resolvedCacheScope).set(currentKey, { items: merged, nextCursor: page.next_cursor, expiresAt: nowRef.current() + ttlMsRef.current });
        return merged;
      });
      nextCursorRef.current = page.next_cursor;
      setNextCursorState(page.next_cursor);
    }).catch((reason: unknown) => {
      if (isCurrent() && !isAborted(reason, controller.signal)) setError("更多提醒暂时无法加载。");
    }).finally(() => {
      if (pageControllerRef.current === controller) pageControllerRef.current = null;
      if (isCurrent()) setRefreshing(false);
    });
  }, [client, debouncedSearch, loading, nextCursor, refreshing, resolvedCacheScope, statusFilter]);

  const callbackScopeVersion = scopeVersionRef.current;
  const toggleDeliveryStatus = useCallback((reminderId: string) => {
    if (!client.listReminderDeliveries
      || scopeVersionRef.current !== callbackScopeVersion
      || scopeRef.current.client !== client
      || scopeRef.current.cacheScope !== resolvedCacheScope) return;
    const openId = deliveryOpenIdRef.current;
    const retryingReminderId = deliveryRetryReminderIdRef.current;
    const sequence = ++deliverySequenceRef.current;
    deliveryControllerRef.current?.abort();
    deliveryRetryControllerRef.current?.abort();
    deliveryControllerRef.current = null;
    deliveryRetryControllerRef.current = null;
    deliveryRetryIdRef.current = null;
    deliveryRetryReminderIdRef.current = null;
    setDeliveryRetryId(null);
    setDeliveryLoadingId(null);
    if (retryingReminderId) {
      setDeliveryItems((current) => {
        const next = { ...current };
        delete next[retryingReminderId];
        return next;
      });
    }
    if (openId === reminderId) {
      deliveryOpenIdRef.current = null;
      setDeliveryOpenId(null);
      return;
    }
    const generation = generationRef.current;
    deliveryOpenIdRef.current = reminderId;
    setDeliveryOpenId(reminderId);
    setDeliveryErrors((current) => {
      const next = { ...current };
      delete next[reminderId];
      return next;
    });
    if (deliveryItems[reminderId]) return;
    const controller = new AbortController();
    deliveryControllerRef.current = controller;
    setDeliveryLoadingId(reminderId);
    const isCurrent = () => !controller.signal.aborted
      && sequence === deliverySequenceRef.current
      && generation === generationRef.current
      && callbackScopeVersion === scopeVersionRef.current
      && scopeRef.current.client === client
      && scopeRef.current.cacheScope === resolvedCacheScope
      && deliveryOpenIdRef.current === reminderId;
    void client.listReminderDeliveries(reminderId, controller.signal).then((items) => {
      if (!isCurrent()) return;
      setDeliveryItems((current) => ({ ...current, [reminderId]: items }));
    }).catch((reason: unknown) => {
      if (!isAborted(reason, controller.signal) && isCurrent()) setDeliveryErrors((current) => ({ ...current, [reminderId]: "投递状态暂时无法加载，请重试。" }));
    }).finally(() => {
      if (deliveryControllerRef.current === controller) deliveryControllerRef.current = null;
      if (!controller.signal.aborted && sequence === deliverySequenceRef.current) setDeliveryLoadingId((current) => current === reminderId ? null : current);
    });
  }, [callbackScopeVersion, client, deliveryItems, resolvedCacheScope]);

  const retryDelivery = useCallback((reminderId: string, deliveryId: string) => {
    if (!client.retryReminderDelivery
      || deliveryRetryIdRef.current !== null
      || deliveryOpenIdRef.current !== reminderId
      || callbackScopeVersion !== scopeVersionRef.current
      || scopeRef.current.client !== client
      || scopeRef.current.cacheScope !== resolvedCacheScope) return;
    const generation = generationRef.current;
    const requestClient = client;
    const sequence = deliverySequenceRef.current;
    const retryId = `${reminderId}:${deliveryId}`;
    const controller = new AbortController();
    const isCurrent = () => generation === generationRef.current
      && sequence === deliverySequenceRef.current
      && callbackScopeVersion === scopeVersionRef.current
      && deliveryOpenIdRef.current === reminderId
      && scopeRef.current.client === requestClient
      && scopeRef.current.cacheScope === resolvedCacheScope;
    deliveryRetryControllerRef.current = controller;
    deliveryRetryIdRef.current = retryId;
    deliveryRetryReminderIdRef.current = reminderId;
    setDeliveryRetryId(retryId);
    const retryRequest = client.retryReminderDelivery(reminderId, deliveryId, controller.signal);
    void retryRequest.then((updated) => {
      if (!isCurrent()) return;
      setDeliveryItems((current) => ({
        ...current,
        [reminderId]: (current[reminderId] ?? []).map((item) => item.id === updated.id ? updated : item),
      }));
      setFeedback("投递已重新排队。请稍后查看发送结果。");
    }).catch(() => {
      if (isCurrent()) setDeliveryErrors((current) => ({ ...current, [reminderId]: "投递重试失败，请稍后重试。" }));
    }).finally(() => {
      if (deliveryRetryControllerRef.current === controller) deliveryRetryControllerRef.current = null;
      if (isCurrent()) {
        deliveryRetryIdRef.current = null;
        deliveryRetryReminderIdRef.current = null;
        setDeliveryRetryId(null);
      }
    });
  }, [callbackScopeVersion, client, resolvedCacheScope]);

  useEffect(() => () => {
    generationRef.current += 1;
    deliverySequenceRef.current += 1;
    listControllerRef.current?.abort();
    pageControllerRef.current?.abort();
    deliveryControllerRef.current?.abort();
    deliveryRetryControllerRef.current?.abort();
    deliveryOpenIdRef.current = null;
    deliveryRetryIdRef.current = null;
    deliveryRetryReminderIdRef.current = null;
  }, []);

  return {
    reminders: scopeMatches ? reminders : [],
    setReminders,
    nextCursor: scopeMatches ? nextCursor : null,
    setNextCursor,
    search,
    setSearch,
    debouncedSearch,
    statusFilter,
    setStatusFilter,
    selectedIds: scopeMatches ? selectedIds : new Set(),
    setSelectedIds,
    loading: scopeMatches ? loading : true,
    refreshing: scopeMatches ? refreshing : false,
    error: scopeMatches ? error : null,
    setError,
    feedback: scopeMatches ? feedback : null,
    setFeedback,
    failedBulkIds: scopeMatches ? failedBulkIds : [],
    setFailedBulkIds,
    retryRequest: scopeMatches ? retryRequest : null,
    setRetryRequest,
    loadMore,
    deliveryOpenId: scopeMatches ? deliveryOpenId : null,
    deliveryItems: scopeMatches ? deliveryItems : {},
    deliveryLoadingId: scopeMatches ? deliveryLoadingId : null,
    deliveryErrors: scopeMatches ? deliveryErrors : {},
    deliveryRetryId: scopeMatches ? deliveryRetryId : null,
    toggleDeliveryStatus,
    retryDelivery,
  };
}
