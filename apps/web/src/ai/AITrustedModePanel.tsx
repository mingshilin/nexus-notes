import type { AiTrustedMode } from "@nexus/contracts";
import { useEffect, useState } from "react";

export interface TrustedModeClient {
  getAiTrustedMode(workspaceId: string, signal?: AbortSignal): Promise<AiTrustedMode>;
  updateAiTrustedMode(workspaceId: string, input: { enabled: boolean; expires_at: string | null; base_revision: number }): Promise<AiTrustedMode>;
}

function formatExpiry(value: string | null) {
  return value ? new Date(value).toLocaleString("zh-CN") : "未设置";
}

function isActive(mode: AiTrustedMode) {
  return mode.enabled && mode.expires_at !== null && Date.parse(mode.expires_at) > Date.now();
}

export function AITrustedModePanel({ client, workspaceId, active = true }: { client: TrustedModeClient; workspaceId: string; active?: boolean }) {
  const [mode, setMode] = useState<AiTrustedMode | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clock, setClock] = useState(() => Date.now());

  useEffect(() => {
    if (!active || typeof client.getAiTrustedMode !== "function") return undefined;
    const controller = new AbortController();
    let current = true;
    setMode(null);
    setLoading(true);
    setError(null);
    void client.getAiTrustedMode(workspaceId, controller.signal).then((next) => {
      if (!current || controller.signal.aborted) return;
      setMode(next);
    }).catch(() => {
      if (current && !controller.signal.aborted) setError("AI 自动执行状态加载失败，请重试。");
    }).finally(() => {
      if (current && !controller.signal.aborted) setLoading(false);
    });
    return () => {
      current = false;
      controller.abort();
    };
  }, [active, client, workspaceId]);

  useEffect(() => {
    if (!mode?.expires_at) return undefined;
    const timer = window.setInterval(() => setClock(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, [mode?.expires_at]);

  const trustedActive = mode ? isActive(mode) : false;
  const remaining = mode?.expires_at ? Math.max(0, Date.parse(mode.expires_at) - clock) : 0;
  const remainingText = remaining > 0
    ? `约剩余 ${Math.ceil(remaining / 3_600_000)} 小时`
    : mode?.enabled ? "已过期" : "未开启";

  const toggle = async () => {
    if (!mode || pending) return;
    const previous = mode;
    const nextEnabled = !trustedActive;
    const optimistic: AiTrustedMode = {
      ...mode,
      enabled: nextEnabled,
      expires_at: nextEnabled ? new Date(Date.now() + 24 * 60 * 60_000).toISOString() : null,
    };
    setMode(optimistic);
    setPending(true);
    setError(null);
    try {
      if (typeof client.updateAiTrustedMode !== "function") return;
      const next = await client.updateAiTrustedMode(workspaceId, {
        enabled: nextEnabled,
        expires_at: nextEnabled ? optimistic.expires_at : null,
        base_revision: previous.revision,
      });
      setMode(next);
    } catch {
      setMode(previous);
      setError("AI 自动执行状态保存失败，已恢复原状态。");
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="ai-control-panel account-subpanel" aria-labelledby="ai-trusted-mode-title">
      <div className="account-subpanel-heading">
        <div>
          <p className="eyebrow">TRUSTED MODE</p>
          <h3 id="ai-trusted-mode-title">AI 自动执行</h3>
        </div>
        <span className={`ai-trusted-badge${trustedActive ? " active" : ""}`}>{trustedActive ? "运行中" : "已关闭"}</span>
      </div>
      <p className="account-muted">当前工作区：{workspaceId}</p>
      {loading ? <p role="status">正在加载 AI 自动执行状态…</p> : null}
      {error ? <p className="account-error" role="alert">{error}</p> : null}
      {mode ? <>
        <strong>{trustedActive ? "AI 自动执行已开启" : mode.enabled ? "AI 自动执行已过期" : "AI 自动执行已关闭"}</strong>
        <dl className="ai-trusted-details">
          <div><dt>作用范围</dt><dd>仅当前工作区</dd></div>
          <div><dt>到期时间</dt><dd>{formatExpiry(mode.expires_at)}（{remainingText}）</dd></div>
        </dl>
        <button type="button" disabled={pending} onClick={() => { void toggle(); }}>
          {pending ? "保存中…" : trustedActive ? "关闭 AI 自动执行" : "开启 AI 自动执行"}
        </button>
      </> : null}
    </section>
  );
}
