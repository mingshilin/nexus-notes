import type { AiProviderPreference, AiUserConfigSummary } from "@nexus/contracts";
import { useEffect, useState } from "react";
import type { ApiClient } from "../data/api-client";

const PROVIDERS = [
  { id: "custom", label: "自定义兼容网关", baseUrl: "" },
  { id: "openai", label: "OpenAI", baseUrl: "https://api.openai.com/v1" },
  { id: "deepseek", label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1" },
  { id: "openrouter", label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1" },
  { id: "siliconflow", label: "硅基流动", baseUrl: "https://api.siliconflow.cn/v1" },
] as const;

interface Props {
  client: Pick<ApiClient, "request">;
  status?: AiUserConfigSummary | null;
}

export function AIConfigPanel({ client, status = null }: Props) {
  const [summary, setSummary] = useState<AiUserConfigSummary | null>(null);
  const [provider, setProvider] = useState<AiProviderPreference | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [pending, setPending] = useState<"provider" | "test" | "save" | "delete" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      client.request<AiUserConfigSummary>({
        path: "/api/v2/ai/config",
        requestClass: "query",
        policy: { timeoutMs: 8_000, retry: 1, dedupeKey: "ai-user-config", signal: controller.signal },
      }),
      client.request<AiProviderPreference>({
        path: "/api/v2/ai/provider",
        requestClass: "query",
        policy: { timeoutMs: 8_000, retry: 1, dedupeKey: "ai-provider-preference", signal: controller.signal },
      }),
    ]).then(([next, preference]) => {
      if (controller.signal.aborted) return;
      setSummary(next);
      setProvider(preference);
      setBaseUrl(next.base_url ?? "");
      setModel(next.model ?? "");
    }).catch(() => {
      if (!controller.signal.aborted) setError("AI 配置加载失败，请稍后重试。");
    });
    return () => controller.abort();
  }, [client]);

  const selectProvider = async (source: AiProviderPreference["source"]) => {
    if (!provider || pending !== null || provider.source === source) return;
    setPending("provider");
    setError(null);
    setMessage(null);
    try {
      const next = await client.request<AiProviderPreference>({
        path: "/api/v2/ai/provider",
        method: "PATCH",
        body: { source, base_revision: provider.revision },
        requestClass: "command",
        policy: { timeoutMs: 8_000, retry: 0, idempotencyKey: crypto.randomUUID() },
      });
      setProvider(next);
      setMessage(source === "personal" ? "已选择我的 AI。" : "已选择系统 AI。");
    } catch {
      setError("AI 服务选择保存失败，请刷新后重试。");
    } finally {
      setPending(null);
    }
  };

  const testConnection = async () => {
    setPending("test");
    setError(null);
    setMessage(null);
    try {
      await client.request({
        path: "/api/v2/ai/config/test",
        method: "POST",
        body: { base_url: baseUrl.trim(), model: model.trim(), ...(apiKey.trim() ? { api_key: apiKey.trim() } : {}) },
        requestClass: "command",
        policy: { timeoutMs: 20_000, retry: 0, idempotencyKey: crypto.randomUUID() },
      });
      setMessage("连接测试成功，可以保存这套配置。");
    } catch {
      setError("连接测试失败，原有配置未被修改。");
    } finally {
      setPending(null);
    }
  };

  const save = async () => {
    setPending("save");
    setError(null);
    setMessage(null);
    try {
      const next = await client.request<AiUserConfigSummary>({
        path: "/api/v2/ai/config",
        method: "PUT",
        body: {
          base_url: baseUrl.trim(),
          model: model.trim(),
          base_revision: summary?.revision ?? null,
          ...(apiKey.trim() ? { api_key: apiKey.trim() } : {}),
        },
        requestClass: "command",
        policy: { timeoutMs: 12_000, retry: 0, idempotencyKey: crypto.randomUUID() },
      });
      setSummary(next);
      setBaseUrl(next.base_url ?? baseUrl.trim());
      setModel(next.model ?? model.trim());
      setApiKey("");
      setMessage(next.verified_at ? "个人 AI 配置已保存并验证。" : "个人 AI 配置已保存，当前尚未验证。");
    } catch {
      setError("AI 配置保存失败，原有配置仍然有效。");
    } finally {
      setPending(null);
    }
  };

  const remove = async () => {
    if (!summary?.revision) return;
    setPending("delete");
    setError(null);
    try {
      await client.request({
        path: "/api/v2/ai/config",
        method: "DELETE",
        body: { base_revision: summary.revision },
        requestClass: "command",
        policy: { timeoutMs: 8_000, retry: 0, idempotencyKey: crypto.randomUUID() },
      });
      setSummary({ configured: false, source: "unconfigured" });
      setBaseUrl("");
      setModel("");
      setApiKey("");
      setMessage("个人 AI 配置已删除。");
    } catch {
      setError("删除失败，请刷新配置后重试。");
    } finally {
      setPending(null);
    }
  };

  const selectedSource = provider?.source ?? status?.selected_source ?? "system";
  const personalConfigured = summary?.configured === true || status?.personal_configured === true;
  const systemConfigured = status?.system_configured === true || status?.source === "server_default";
  const availability = selectedSource === "personal"
    ? personalConfigured
      ? "当前使用我的 AI。"
      : systemConfigured
        ? "个人 AI 尚未配置，将自动使用系统 AI。"
        : "系统 AI 当前不可用，请配置我的 AI。"
    : systemConfigured
      ? "当前使用系统 AI。"
      : personalConfigured
        ? "系统 AI 当前不可用，你可以切换到我的 AI。"
        : "系统 AI 当前不可用，请配置我的 AI。";

  return (
    <div className="ai-provider-config-stack">
      <section className="ai-provider-selector" aria-labelledby="ai-provider-selector-title">
        <div>
          <p className="eyebrow">AI PROVIDER</p>
          <h2 id="ai-provider-selector-title">选择 AI 服务</h2>
          <p>{availability}</p>
        </div>
        <div className="ai-provider-options" role="group" aria-label="AI 服务选择">
          <button type="button" aria-label="使用系统 AI" aria-pressed={selectedSource === "system"} disabled={!provider || pending !== null} onClick={() => { void selectProvider("system"); }}>
            <strong>系统 AI</strong><span>无需 API Key</span>
          </button>
          <button type="button" aria-label="使用我的 AI" aria-pressed={selectedSource === "personal"} disabled={!provider || pending !== null} onClick={() => { void selectProvider("personal"); }}>
            <strong>我的 AI</strong><span>使用个人配置</span>
          </button>
        </div>
      </section>
      <details className="ai-config-panel" open={!summary?.configured}>
      <summary>个人 AI 配置</summary>
      <p>配置跨工作区生效。API Key 仅加密保存在服务端，页面不会重新显示明文。</p>
      <label>服务商
        <select aria-label="AI 服务商" onChange={(event) => {
          const preset = PROVIDERS.find((item) => item.id === event.target.value);
          if (preset?.baseUrl) setBaseUrl(preset.baseUrl);
        }} defaultValue="custom">
          {PROVIDERS.map((provider) => <option key={provider.id} value={provider.id}>{provider.label}</option>)}
        </select>
      </label>
      <label>API 地址<input aria-label="AI API 地址" type="url" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://api.example.com/v1" /></label>
      <label>模型<input aria-label="AI 模型" value={model} onChange={(event) => setModel(event.target.value)} placeholder="model-name" /></label>
      <label>API Key<input aria-label="AI API Key" type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} autoComplete="new-password" placeholder={summary?.key_hint ?? "输入新的 API Key"} /></label>
      {summary?.key_hint ? <p className="ai-config-key-hint">当前密钥：{summary.key_hint}</p> : null}
      <div className="account-actions">
        <button type="button" disabled={pending !== null || !baseUrl.trim() || !model.trim()} onClick={testConnection}>{pending === "test" ? "正在测试…" : "测试 AI 连接"}</button>
        <button type="button" disabled={pending !== null || !baseUrl.trim() || !model.trim() || (!apiKey.trim() && !summary?.configured)} onClick={save}>{pending === "save" ? "正在保存…" : "保存 AI 配置"}</button>
        {summary?.source === "personal" ? <button type="button" className="account-danger-button" disabled={pending !== null} onClick={remove}>{pending === "delete" ? "正在删除…" : "删除个人配置"}</button> : null}
      </div>
      {message ? <p role="status">{message}</p> : null}
      {error ? <p role="alert" className="database-operation-error">{error}</p> : null}
      </details>
    </div>
  );
}
