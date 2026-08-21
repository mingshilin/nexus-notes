import type { AuthSession, InvitationPreview } from "@nexus/contracts";
import { useEffect, useState } from "react";

import { AuthGate, type AuthClient } from "../auth";
import type { CollaborationClient } from "../data/collaboration-client";

function inviteErrorMessage(error: unknown) {
  const code = error && typeof error === "object" ? (error as { code?: string }).code : undefined;
  if (code === "INVITATION_EMAIL_MISMATCH") return "邀请邮箱与当前账户不匹配。";
  if (code === "INVITATION_UNAVAILABLE") return "邀请无效、已过期或已被使用。";
  if (code === "MEMBER_QUOTA_EXCEEDED") return "工作区成员名额已满。";
  return "邀请暂时无法处理，请稍后重试。";
}

function roleLabel(role: InvitationPreview["role"]) {
  return role === "editor" ? "编辑者" : "查看者";
}

function AcceptInvitation({
  authClient,
  client,
  preview,
  session,
  token,
  onAccepted,
}: {
  authClient: AuthClient;
  client: CollaborationClient;
  preview: InvitationPreview;
  session: AuthSession;
  token: string;
  onAccepted(workspaceId: string): void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const emailMatches = session.user.email.toLowerCase() === preview.email.toLowerCase();
  const acceptable = preview.status === "pending" && emailMatches;

  const accept = async () => {
    if (!acceptable || pending) return;
    setPending(true);
    setError(null);
    try {
      const existing = new Set(session.workspaces.map((workspace) => workspace.id));
      await client.acceptInvitation(token);
      const refreshed = await authClient.session();
      const acceptedWorkspace = refreshed.workspaces.find((workspace) => !existing.has(workspace.id))
        ?? refreshed.workspaces.find((workspace) => workspace.name === preview.workspace_name && workspace.role === preview.role);
      if (!acceptedWorkspace) throw Object.assign(new Error("Accepted workspace missing from refreshed session"), { code: "INVITATION_SESSION_STALE" });
      onAccepted(acceptedWorkspace.id);
    } catch (reason) {
      setError(inviteErrorMessage(reason));
    } finally {
      setPending(false);
    }
  };

  return <div className="invite-actions">
    {!emailMatches && preview.status === "pending" ? <p className="collaboration-error" role="alert">邀请邮箱与当前账户不匹配。</p> : null}
    {error ? <p className="collaboration-error" role="alert">{error}</p> : null}
    <button type="button" disabled={!acceptable || pending} onClick={() => void accept()}>
      {preview.status !== "pending" ? "邀请不可接受" : pending ? "正在加入…" : `接受邀请并进入 ${preview.workspace_name}`}
    </button>
  </div>;
}

export function InviteRedemptionPage({
  authClient,
  client,
  token,
  turnstileSiteKey,
  onAccepted,
}: {
  authClient: AuthClient;
  client: CollaborationClient;
  token: string;
  turnstileSiteKey: string;
  onAccepted(workspaceId: string): void;
}) {
  const [preview, setPreview] = useState<InvitationPreview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    void client.previewInvitation(token, controller.signal).then((result) => {
      if (!controller.signal.aborted) setPreview(result);
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(inviteErrorMessage(reason));
    });
    return () => controller.abort();
  }, [client, token]);

  return <div className="invite-route">
    <section className="invite-preview" aria-label="工作区邀请">
      <p className="eyebrow">WORKSPACE INVITATION</p>
      {!preview && !error ? <p role="status">正在读取邀请…</p> : null}
      {error ? <p className="collaboration-error" role="alert">{error}</p> : null}
      {preview ? <>
        <h1>加入 {preview.workspace_name}</h1>
        <p>{preview.inviter_display_name} 邀请你加入工作区。</p>
        <dl>
          <div><dt>邀请邮箱</dt><dd>{preview.email}</dd></div>
          <div><dt>角色</dt><dd>{roleLabel(preview.role)}</dd></div>
          <div><dt>有效期至</dt><dd>{new Date(preview.expires_at).toLocaleString()}</dd></div>
        </dl>
        {preview.status === "expired" ? <p className="collaboration-error">此邀请已过期。</p> : null}
        {preview.status === "revoked" ? <p className="collaboration-error">此邀请已撤销。</p> : null}
        {preview.status === "accepted" ? <p className="collaboration-error">此邀请已被使用。</p> : null}
      </> : null}
    </section>
    <AuthGate client={authClient} turnstileSiteKey={turnstileSiteKey}>
      {(session) => preview ? <AcceptInvitation authClient={authClient} client={client} preview={preview} session={session} token={token} onAccepted={onAccepted} /> : null}
    </AuthGate>
  </div>;
}
