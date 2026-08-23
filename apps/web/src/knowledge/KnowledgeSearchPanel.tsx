import { useEffect, useRef, useState, type FormEvent } from "react";
import type {
  SavedSearch,
  SavedSearchFilters,
  SearchHit,
  SearchRequest,
} from "@nexus/contracts";
import { KnowledgeClient } from "../data/knowledge-client";

type SearchClient = Pick<KnowledgeClient, "search" | "listSavedSearches" | "createSavedSearch" | "deleteSavedSearch">;
type SearchEntityType = SavedSearchFilters["source_types"][number];

const emptyFilters: SavedSearchFilters = {
  tag_ids: [],
  folder_ids: [],
  database_ids: [],
  member_ids: [],
  attachment_types: [],
  ocr_statuses: [],
  source_types: [],
};

const sourceOptions: readonly { value: SearchEntityType; label: string }[] = [
  { value: "note", label: "搜索笔记" },
  { value: "database_record", label: "搜索数据库记录" },
  { value: "comment", label: "搜索评论" },
  { value: "attachment", label: "搜索附件" },
];

const ocrOptions = ["queued", "running", "complete", "failed", "cancelled"] as const;
const hitSourceLabels: Record<SearchHit["hit_sources"][number], string> = {
  title: "标题",
  content: "正文",
  tags: "标签",
  properties: "属性",
  attachment_name: "附件名",
  ocr: "OCR",
};

const listFilterKeys = ["tag_ids", "folder_ids", "database_ids", "member_ids", "attachment_types"] as const;
type ListFilterKey = typeof listFilterKeys[number];

function parseList(value: string) {
  return [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))];
}

function formatList(value: readonly string[]) {
  return value.join(", ");
}

function filtersForRequest(filters: SavedSearchFilters): SavedSearchFilters {
  return {
    ...filters,
    tag_ids: [...filters.tag_ids],
    folder_ids: [...filters.folder_ids],
    database_ids: [...filters.database_ids],
    member_ids: [...filters.member_ids],
    attachment_types: [...filters.attachment_types],
    ocr_statuses: [...filters.ocr_statuses],
    source_types: [...filters.source_types],
  };
}

export function KnowledgeSearchPanel({ client }: { client: SearchClient }) {
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<SavedSearchFilters>(emptyFilters);
  const [results, setResults] = useState<SearchHit[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>([]);
  const [saveName, setSaveName] = useState("");
  const [loading, setLoading] = useState(false);
  const [savedLoading, setSavedLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const requestRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setSavedLoading(true);
    void client.listSavedSearches(controller.signal).then((items) => {
      if (!controller.signal.aborted) setSavedSearches(items);
    }).catch(() => {
      if (!controller.signal.aborted) setError("保存的搜索暂时无法加载，请稍后重试。");
    }).finally(() => {
      if (!controller.signal.aborted) setSavedLoading(false);
    });
    return () => controller.abort();
  }, [client]);

  useEffect(() => () => requestRef.current?.abort(), []);

  const runSearch = (nextQuery: string, nextFilters: SavedSearchFilters, cursor?: string) => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    setError(null);
    setFeedback(null);
    const request: SearchRequest = {
      query: nextQuery,
      filters: filtersForRequest(nextFilters),
      limit: 50,
      ...(cursor ? { cursor } : {}),
    };
    void client.search({ ...request, signal: controller.signal }).then((page) => {
      if (controller.signal.aborted) return;
      setResults((current) => cursor ? [...current, ...page.items] : page.items);
      setNextCursor(page.next_cursor);
    }).catch(() => {
      if (!controller.signal.aborted) setError("搜索暂时无法完成，请重试。当前筛选条件已保留。");
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
  };

  const updateListFilter = (key: ListFilterKey, value: string) => {
    setFilters((current) => ({ ...current, [key]: parseList(value) }));
  };

  const toggleSource = (value: SearchEntityType) => {
    setFilters((current) => ({
      ...current,
      source_types: current.source_types.includes(value)
        ? current.source_types.filter((item) => item !== value)
        : [...current.source_types, value],
    }));
  };

  const toggleOcrStatus = (value: typeof ocrOptions[number]) => {
    setFilters((current) => ({
      ...current,
      ocr_statuses: current.ocr_statuses.includes(value)
        ? current.ocr_statuses.filter((item) => item !== value)
        : [...current.ocr_statuses, value],
    }));
  };

  const resetFilters = () => setFilters(emptyFilters);

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    runSearch(query, filters);
  };

  const saveCurrentSearch = (event: FormEvent) => {
    event.preventDefault();
    const name = saveName.trim();
    if (!name) {
      setError("请输入保存搜索名称。");
      return;
    }
    setSaving(true);
    setError(null);
    void client.createSavedSearch({ name, query, filters: filtersForRequest(filters) }).then((saved) => {
      setSavedSearches((current) => [saved, ...current.filter((item) => item.id !== saved.id)]);
      setSaveName("");
      setFeedback(`已保存搜索：${saved.name}`);
    }).catch(() => setError("保存搜索失败，请重试。当前查询和筛选条件已保留。")).finally(() => setSaving(false));
  };

  const applySavedSearch = (saved: SavedSearch) => {
    const nextFilters = filtersForRequest(saved.filters);
    setQuery(saved.query);
    setFilters(nextFilters);
    runSearch(saved.query, nextFilters);
  };

  const deleteSavedSearch = (saved: SavedSearch) => {
    setError(null);
    void client.deleteSavedSearch(saved.id).then(() => {
      setSavedSearches((current) => current.filter((item) => item.id !== saved.id));
      setFeedback(`已删除搜索：${saved.name}`);
    }).catch(() => setError("删除保存搜索失败，请重试。"));
  };

  return (
    <section className="knowledge-search" aria-labelledby="knowledge-search-heading">
      <div className="knowledge-search-heading">
        <div><small>KNOWLEDGE SEARCH</small><h2 id="knowledge-search-heading">搜索与保存搜索</h2></div>
        <p>搜索标题、正文、标签、属性、附件名与 OCR 内容。</p>
      </div>
      <form className="knowledge-search-form" onSubmit={submitSearch}>
        <label className="knowledge-search-query">知识搜索<input aria-label="知识搜索" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索笔记、附件或 OCR 内容" /></label>
        <button type="submit" disabled={loading}>{loading ? "搜索中…" : "搜索"}</button>
      </form>
      <fieldset className="knowledge-search-filters">
        <legend>完整过滤</legend>
        {listFilterKeys.map((key) => {
          const labels: Record<ListFilterKey, string> = {
            tag_ids: "标签过滤",
            folder_ids: "文件夹过滤",
            database_ids: "数据库过滤",
            member_ids: "成员过滤",
            attachment_types: "附件类型过滤",
          };
          return <label className="knowledge-search-filter" key={key}>{labels[key]}<input aria-label={labels[key]} value={formatList(filters[key])} onChange={(event) => updateListFilter(key, event.target.value)} placeholder="多个值用逗号分隔" /></label>;
        })}
        <label className="knowledge-search-filter">开始日期<input aria-label="搜索开始日期" type="date" value={filters.date_from ?? ""} onChange={(event) => setFilters((current) => ({ ...current, date_from: event.target.value || undefined }))} /></label>
        <label className="knowledge-search-filter">结束日期<input aria-label="搜索结束日期" type="date" value={filters.date_to ?? ""} onChange={(event) => setFilters((current) => ({ ...current, date_to: event.target.value || undefined }))} /></label>
        <label className="knowledge-search-filter">收藏<select aria-label="收藏过滤" value={filters.favorite === undefined ? "" : String(filters.favorite)} onChange={(event) => setFilters((current) => ({ ...current, favorite: event.target.value === "" ? undefined : event.target.value === "true" }))}><option value="">全部</option><option value="true">仅收藏</option><option value="false">未收藏</option></select></label>
        <label className="knowledge-search-filter">置顶<select aria-label="置顶过滤" value={filters.pinned === undefined ? "" : String(filters.pinned)} onChange={(event) => setFilters((current) => ({ ...current, pinned: event.target.value === "" ? undefined : event.target.value === "true" }))}><option value="">全部</option><option value="true">仅置顶</option><option value="false">未置顶</option></select></label>
        <div className="knowledge-search-checks"><span>来源类型</span>{sourceOptions.map((option) => <label key={option.value}><input type="checkbox" checked={filters.source_types.includes(option.value)} onChange={() => toggleSource(option.value)} />{option.label}</label>)}</div>
        <div className="knowledge-search-checks"><span>OCR 状态</span>{ocrOptions.map((status) => <label key={status}><input type="checkbox" checked={filters.ocr_statuses.includes(status)} onChange={() => toggleOcrStatus(status)} />{status}</label>)}</div>
        <button type="button" className="knowledge-search-reset" onClick={resetFilters}>清除过滤</button>
      </fieldset>
      <form className="knowledge-search-save" onSubmit={saveCurrentSearch}>
        <label>保存当前搜索<input aria-label="保存搜索名称" value={saveName} onChange={(event) => setSaveName(event.target.value)} placeholder="例如：本周研究资料" /></label>
        <button type="submit" disabled={saving}>{saving ? "保存中…" : "保存搜索"}</button>
      </form>
      {savedLoading ? <p className="knowledge-search-state" role="status">正在加载保存的搜索…</p> : null}
      {savedSearches.length > 0 ? <ul className="knowledge-search-saved" aria-label="已保存搜索">{savedSearches.map((saved) => <li key={saved.id} aria-label={saved.name}><strong>{saved.name}</strong><button type="button" aria-label={`应用${saved.name}`} onClick={() => applySavedSearch(saved)}>应用</button><button type="button" aria-label={`删除${saved.name}`} onClick={() => deleteSavedSearch(saved)}>删除</button></li>)}</ul> : null}
      {error ? <p className="knowledge-search-error" role="alert">{error}</p> : null}
      {feedback ? <p className="knowledge-search-feedback" aria-live="polite">{feedback}</p> : null}
      {!loading && results.length === 0 ? <p className="knowledge-search-state">输入关键词或筛选条件后开始搜索。</p> : null}
      <div className="knowledge-search-results" aria-live="polite">
        {results.map((hit) => <article className="knowledge-search-result" aria-label={hit.title || "未命名结果"} key={`${hit.entity_type}:${hit.entity_id}`}><div><strong>{hit.title || "未命名结果"}</strong><small>{hit.entity_type} · 命中来源：{hit.hit_sources.map((source) => hitSourceLabels[source]).join("、") || "未标注"}</small></div><p>{hit.excerpt}</p></article>)}
        {nextCursor ? <button type="button" className="knowledge-search-load-more" disabled={loading} onClick={() => runSearch(query, filters, nextCursor)}>加载更多结果</button> : null}
      </div>
    </section>
  );
}
