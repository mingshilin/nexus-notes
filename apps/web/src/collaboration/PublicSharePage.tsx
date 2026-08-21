import type { PublicSharedContent } from "@nexus/contracts";
import { FileText, LockKeyhole } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";

import type { CollaborationClient } from "../data/collaboration-client";
import { collaborationErrorMessage } from "./CollaborationCenter";

export function PublicSharePage({ client, token }: { client: CollaborationClient; token: string }) {
  const [content, setContent] = useState<PublicSharedContent | null>(null);
  const [passwordRequired, setPasswordRequired] = useState(false);
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const accessController = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void client.getPublicShare(token, controller.signal).then((result) => {
      if (!controller.signal.aborted) setContent(result);
    }).catch((reason: unknown) => {
      if (controller.signal.aborted) return;
      const details = reason && typeof reason === "object" ? reason as { status?: number; code?: string } : {};
      if (details.status === 404 || details.code === "PUBLIC_SHARE_UNAVAILABLE") setPasswordRequired(true);
      else setError(collaborationErrorMessage(reason));
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => {
      controller.abort();
      accessController.current?.abort();
    };
  }, [client, token]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    accessController.current?.abort();
    const controller = new AbortController();
    accessController.current = controller;
    setSubmitting(true);
    setError(null);
    void client.accessPublicShare(token, { password }, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      setContent(result);
      setPassword("");
      setPasswordRequired(false);
    }).catch((reason: unknown) => {
      if (controller.signal.aborted) return;
      const details = reason && typeof reason === "object" ? reason as { status?: number; code?: string } : {};
      setError(details.status === 404 || details.code === "PUBLIC_SHARE_UNAVAILABLE" ? "密码不正确或分享不可用。" : collaborationErrorMessage(reason));
      setPassword("");
    }).finally(() => {
      if (!controller.signal.aborted) setSubmitting(false);
    });
  };

  return <main className="public-share-page">
    <section className="public-share-shell">
      <header className="public-share-brand"><span>N</span><strong>Nexus Notes</strong></header>
      {loading ? <p role="status" className="public-share-status">正在验证分享…</p> : null}
      {!loading && content ? <article className="public-share-content"><div className="public-share-icon"><FileText aria-hidden="true" /></div><p className="eyebrow">SHARED {content.entity_type.toUpperCase()}</p><h1>{content.title}</h1><p className="public-share-revision">只读 · 修订 {content.revision} · {new Date(content.updated_at).toLocaleString()}</p><div className="public-share-body">{content.content ?? "此分享不包含可显示的正文。"}</div></article> : null}
      {!loading && !content && passwordRequired ? <section className="public-share-password"><div className="public-share-icon"><LockKeyhole aria-hidden="true" /></div><p className="eyebrow">PROTECTED SHARE</p><h1>访问受保护的分享</h1><p>输入创建者提供的密码。密码仅用于本次请求，不会保存在此设备。</p><form onSubmit={submit}><label>访问密码<input aria-label="访问密码" type="password" required autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>{error ? <p role="alert" className="collaboration-error">{error}</p> : null}<button type="submit" disabled={submitting || !password}>访问分享</button></form></section> : null}
      {!loading && !content && !passwordRequired && error ? <section className="public-share-password"><div className="public-share-icon"><LockKeyhole aria-hidden="true" /></div><h1>分享暂不可用</h1><p role="alert">{error}</p></section> : null}
    </section>
  </main>;
}
