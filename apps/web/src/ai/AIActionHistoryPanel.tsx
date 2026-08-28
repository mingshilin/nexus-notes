import type { AiActionHistoryItem } from "@nexus/contracts";
import { useEffect, useState } from "react";

export interface ActionHistoryClient {
  listAiActionHistory(workspaceId: string, limit?: number, signal?: AbortSignal): Promise<{ items: AiActionHistoryItem[] } | AiActionHistoryItem[]>;
}

const statusLabels: Record<string, string> = {
  proposed: "待确认",
  confirmed: "已确认",
  executing: "执行中",
  rejected: "已拒绝",
  expired: "已过期",
  executed: "已完成",
  failed: "失败",
  conflict: "冲突",
};

const riskLabels: Record<string, string> = {
  read: "读取",
  safe_write: "安全写入",
  confirmed_write: "确认写入",
  external_or_destructive: "外部或高风险",
};

function itemsFrom(value: { items: AiActionHistoryItem[] } | AiActionHistoryItem[]) {
  return Array.isArray(value) ? value : value.items;
}

export function AIActionHistoryPanel({ client, workspaceId, active = true }: { client: ActionHistoryClient; workspaceId: string; active?: boolean }) {
  const [items, setItems] = useState<AiActionHistoryItem[]>([]);
  const [status, setStatus] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!active || typeof client.listAiActionHistory !== "function") return undefined;
    const controller = new AbortController();
    let current = true;
    setItems([]);
    setLoading(true);
    setError(null);
    void client.listAiActionHistory(workspaceId, 50, controller.signal).then((value) => {
      if (current && !controller.signal.aborted) setItems(itemsFrom(value));
    }).catch(() => {
      if (current && !controller.signal.aborted) setError("AI 操作历史加载失败，请重试。");
    }).finally(() => {
      if (current && !controller.signal.aborted) setLoading(false);
    });
    return () => {
      current = false;
      controller.abort();
    };
  }, [active, client, workspaceId]);

  const visibleItems = status === "all" ? items : items.filter((item) => item.status === status);

  return (
    <section className="ai-control-panel account-subpanel" aria-labelledby="ai-action-history-title">
      <div className="account-subpanel-heading">
        <div>
          <p className="eyebrow">ACTION HISTORY</p>
          <h3 id="ai-action-history-title">AI 操作历史</h3>
        </div>
        <label className="ai-history-filter">状态
          <select aria-label="筛选状态" value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="all">全部</option>
            {Object.entries(statusLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
          </select>
        </label>
      </div>
      {loading ? <p role="status">正在加载 AI 操作历史…</p> : null}
      {error ? <p className="account-error" role="alert">{error}</p> : null}
      {!loading && !error && visibleItems.length === 0 ? <p className="account-muted">暂无符合条件的操作。</p> : null}
      {visibleItems.length > 0 ? <ul className="ai-action-history-list">
        {visibleItems.map((item) => <li key={item.action_id}>
          <div><strong>{item.action_id}</strong><span>{item.tool}</span></div>
          <div><span>{riskLabels[item.risk] ?? item.risk}</span><span>{statusLabels[item.status] ?? item.status}</span></div>
          {item.error_code ? <small>{item.error_code}</small> : null}
        </li>)}
      </ul> : null}
    </section>
  );
}
