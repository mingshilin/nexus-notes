import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
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
  retryReminderDelivery?(reminderId: string, deliveryId: string): Promise<ReminderDelivery>;
}

export interface UseReminderWorkspaceDataParams {
  client: ReminderWorkspaceClient;
  now?: () => number;
  ttlMs?: number;
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

const cacheRegistry = new WeakMap<object, Map<string, ReminderCacheEntry>>();

function cacheFor(client: ReminderWorkspaceClient) {
  const key = client as object;
  const existing = cacheRegistry.get(key);
  if (existing) return existing;
  const created = new Map<string, ReminderCacheEntry>();
  cacheRegistry.set(key, created);
  return created;
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

export function useReminderWorkspaceData({ client, now = Date.now, ttlMs = 60_000 }: UseReminderWorkspaceDataParams): ReminderWorkspaceDataState {
  const [reminders, setRemindersState] = useState<Reminder[]>([]);
  const [nextCursor, setNextCursorState] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<ReminderListQuery["status"]>("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [failedBulkIds, setFailedBulkIds] = useState<string[]>([]);
  const [retryRequest, setRetryRequest] = useState<{ reminder: Reminder; input: UpdateReminderInput; success: string } | null>(null);
  const [deliveryOpenId, setDeliveryOpenId] = useState<string | null>(null);
  const [deliveryItems, setDeliveryItems] = useState<Record<string, ReminderDelivery[]>>({});
  const [deliveryLoadingId, setDeliveryLoadingId] = useState<string | null>(null);
  const [deliveryErrors, setDeliveryErrors] = useState<Record<string, string>>({});
  const [deliveryRetryId, setDeliveryRetryId] = useState<string | null>(null);
  const listControllerRef = useRef<AbortController | null>(null);
  const pageControllerRef = useRef<AbortController | null>(null);
  const deliveryControllerRef = useRef<AbortController | null>(null);
  const deliveryOpenIdRef = useRef<string | null>(null);
  const generationRef = useRef(0);
  const deliverySequenceRef = useRef(0);
  const clientRef = useRef(client);
  const queryKeyRef = useRef<string | null>(null);
  const remindersRef = useRef<Reminder[]>([]);
  const nextCursorRef = useRef<string | null>(null);
  const nowRef = useRef(now);
  const ttlMsRef = useRef(ttlMs);
  clientRef.current = client;
  remindersRef.current = reminders;
  nextCursorRef.current = nextCursor;
  nowRef.current = now;
  ttlMsRef.current = ttlMs;

  const setReminders = useCallback<Dispatch<SetStateAction<Reminder[]>>>((next) => {
    generationRef.current += 1;
    listControllerRef.current?.abort();
    pageControllerRef.current?.abort();
    listControllerRef.current = null;
    pageControllerRef.current = null;
    setRefreshing(false);
    setRemindersState((current) => {
      const value = typeof next === "function" ? next(current) : next;
      const currentKey = queryKeyRef.current;
      const cache = cacheFor(client);
      cache.clear();
      if (currentKey !== null) cache.set(currentKey, { items: value, nextCursor: nextCursorRef.current, expiresAt: nowRef.current() + ttlMsRef.current });
      return value;
    });
  }, [client]);

  const setNextCursor = useCallback<Dispatch<SetStateAction<string | null>>>((next) => {
    setNextCursorState((current) => {
      const value = typeof next === "function" ? next(current) : next;
      nextCursorRef.current = value;
      const currentKey = queryKeyRef.current;
      if (currentKey !== null) cacheFor(client).set(currentKey, { items: remindersRef.current, nextCursor: value, expiresAt: nowRef.current() + ttlMsRef.current });
      return value;
    });
  }, [client]);

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
    deliveryOpenIdRef.current = null;
    setDeliveryOpenId(null);
    setDeliveryLoadingId(null);
    setDeliveryItems({});
    setDeliveryErrors({});
    setSelectedIds(new Set());
    setFailedBulkIds([]);
    setRetryRequest(null);
    setError(null);

    const cached = cacheFor(client).get(currentKey);
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
    const isCurrent = () => !controller.signal.aborted
      && generation === generationRef.current
      && clientRef.current === client
      && queryKeyRef.current === currentKey;
    const load = client.listReminderPage
      ? client.listReminderPage({ status: statusFilter, query: debouncedSearch || undefined, limit: 50 }, controller.signal)
      : client.listReminders
        ? client.listReminders(true, controller.signal).then((items) => ({ items, next_cursor: null }))
        : Promise.reject(new Error("Reminder list API is unavailable"));

    void load.then((page) => {
      if (!isCurrent()) return;
      const normalized = { items: page.items, nextCursor: page.next_cursor, expiresAt: nowRef.current() + ttlMsRef.current };
      cacheFor(client).set(currentKey, normalized);
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
  }, [client, debouncedSearch, statusFilter]);

  const loadMore = useCallback(() => {
    if (!client.listReminderPage || !nextCursor || loading || refreshing || pageControllerRef.current) return;
    const currentKey = queryKey(statusFilter, debouncedSearch);
    const generation = generationRef.current;
    const cursor = nextCursor;
    const controller = new AbortController();
    pageControllerRef.current = controller;
    setRefreshing(true);
    const isCurrent = () => !controller.signal.aborted
      && generation === generationRef.current
      && clientRef.current === client
      && queryKeyRef.current === currentKey;
    void client.listReminderPage({ status: statusFilter, query: debouncedSearch || undefined, cursor, limit: 50 }, controller.signal).then((page) => {
      if (!isCurrent()) return;
      setRemindersState((current) => {
        const merged = mergeUnique(current, page.items);
        cacheFor(client).set(currentKey, { items: merged, nextCursor: page.next_cursor, expiresAt: nowRef.current() + ttlMsRef.current });
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
  }, [client, debouncedSearch, loading, nextCursor, refreshing, statusFilter]);

  const toggleDeliveryStatus = useCallback((reminderId: string) => {
    if (!client.listReminderDeliveries) return;
    if (deliveryOpenId === reminderId) {
      deliveryControllerRef.current?.abort();
      deliveryControllerRef.current = null;
      deliveryOpenIdRef.current = null;
      setDeliveryOpenId(null);
      setDeliveryLoadingId(null);
      return;
    }
    deliveryControllerRef.current?.abort();
    const controller = new AbortController();
    const sequence = ++deliverySequenceRef.current;
    const generation = generationRef.current;
    deliveryControllerRef.current = controller;
    deliveryOpenIdRef.current = reminderId;
    setDeliveryOpenId(reminderId);
    if (deliveryItems[reminderId]) return;
    setDeliveryLoadingId(reminderId);
    setDeliveryErrors((current) => {
      const next = { ...current };
      delete next[reminderId];
      return next;
    });
    const isCurrent = () => !controller.signal.aborted
      && sequence === deliverySequenceRef.current
      && generation === generationRef.current
      && clientRef.current === client
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
  }, [client, deliveryItems, deliveryOpenId]);

  const retryDelivery = useCallback((reminderId: string, deliveryId: string) => {
    if (!client.retryReminderDelivery || deliveryRetryId !== null) return;
    const generation = generationRef.current;
    const requestClient = client;
    setDeliveryRetryId(`${reminderId}:${deliveryId}`);
    void client.retryReminderDelivery(reminderId, deliveryId).then((updated) => {
      if (generation !== generationRef.current || clientRef.current !== requestClient) return;
      setDeliveryItems((current) => ({
        ...current,
        [reminderId]: (current[reminderId] ?? []).map((item) => item.id === updated.id ? updated : item),
      }));
      setFeedback("投递已重新排队。请稍后查看发送结果。");
    }).catch(() => {
      if (generation === generationRef.current && clientRef.current === requestClient) setDeliveryErrors((current) => ({ ...current, [reminderId]: "投递重试失败，请稍后重试。" }));
    }).finally(() => {
      if (generation === generationRef.current && clientRef.current === requestClient) setDeliveryRetryId(null);
    });
  }, [client, deliveryRetryId]);

  useEffect(() => () => {
    listControllerRef.current?.abort();
    pageControllerRef.current?.abort();
    deliveryControllerRef.current?.abort();
    deliveryOpenIdRef.current = null;
  }, []);

  return {
    reminders,
    setReminders,
    nextCursor,
    setNextCursor,
    search,
    setSearch,
    debouncedSearch,
    statusFilter,
    setStatusFilter,
    selectedIds,
    setSelectedIds,
    loading,
    refreshing,
    error,
    setError,
    feedback,
    setFeedback,
    failedBulkIds,
    setFailedBulkIds,
    retryRequest,
    setRetryRequest,
    loadMore,
    deliveryOpenId,
    deliveryItems,
    deliveryLoadingId,
    deliveryErrors,
    deliveryRetryId,
    toggleDeliveryStatus,
    retryDelivery,
  };
}
