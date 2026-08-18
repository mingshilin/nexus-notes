import { useEffect, useState } from "react";
import { Copy, Link2, Share2, Users } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

interface ShareDialogProps {
  open: boolean;
  noteTitle?: string;
  canInvite: boolean;
  canCreatePublicShare: boolean;
  publicShareSummary?: { active: boolean; expires_at: string | null } | null;
  onOpenChange: (open: boolean) => void;
  onCopyDeepLink: () => Promise<void>;
  onCreatePublicShare?: (expiresIn: number | null, password?: string | null) => Promise<{ share_url: string; expires_at?: string | null }>;
  onRevokePublicShare?: () => Promise<void>;
  onCreateInvite?: (payload: { email: string; role: "editor" | "viewer" }) => Promise<{ invite_url: string }>;
}

export function ShareDialog({
  open,
  noteTitle,
  canInvite,
  canCreatePublicShare,
  publicShareSummary = null,
  onOpenChange,
  onCopyDeepLink,
  onCreatePublicShare,
  onRevokePublicShare,
  onCreateInvite,
}: ShareDialogProps) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"editor" | "viewer">("editor");
  const [publicExpiry, setPublicExpiry] = useState<"never" | "24h" | "7d">("7d");
  const [publicPassword, setPublicPassword] = useState("");
  const [inviteResult, setInviteResult] = useState("");
  const [publicShareResult, setPublicShareResult] = useState("");
  const [publicShareExpiryLabel, setPublicShareExpiryLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [revokeConfirmOpen, setRevokeConfirmOpen] = useState(false);

  useEffect(() => {
    if (!open) {
      setEmail("");
      setRole("editor");
      setPublicExpiry("7d");
      setPublicPassword("");
      setInviteResult("");
      setPublicShareResult("");
      setPublicShareExpiryLabel("");
      setBusy(false);
      setRevokeConfirmOpen(false);
    }
  }, [open]);

  async function submitInvite() {
    if (!onCreateInvite || !email.trim()) return;
    setBusy(true);
    try {
      const result = await onCreateInvite({ email: email.trim(), role });
      setInviteResult(result.invite_url);
      setEmail("");
    } finally {
      setBusy(false);
    }
  }

  async function submitPublicShare() {
    if (!onCreatePublicShare) return;
    setBusy(true);
    try {
      const expiresIn = publicExpiry === "never" ? null : publicExpiry === "24h" ? 24 * 60 * 60 : 7 * 24 * 60 * 60;
      const result = await onCreatePublicShare(expiresIn, publicPassword.trim() || null);
      setPublicShareResult(result.share_url);
      setPublicShareExpiryLabel(result.expires_at ? new Date(result.expires_at).toLocaleString("zh-CN") : "永久有效");
    } finally {
      setBusy(false);
    }
  }

  async function submitRevokePublicShare() {
    if (!onRevokePublicShare) return;
    setBusy(true);
    try {
      await onRevokePublicShare();
      setPublicShareResult("");
      setPublicShareExpiryLabel("");
      setRevokeConfirmOpen(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="mac-glass max-w-xl gap-0 rounded-[24px] p-0">
        <DialogHeader className="border-b px-5 py-4" style={{ borderColor: "var(--border-subtle)" }}>
          <DialogTitle className="flex items-center gap-2">
            <Share2 className="h-5 w-5 text-primary" />
            分享{noteTitle ? `《${noteTitle || "无标题笔记"}》` : "笔记"}
          </DialogTitle>
          <DialogDescription>
            {canInvite ? "可生成工作区协作邀请链接，也可以复制当前笔记深链给已有成员。" : "你当前没有创建协作邀请的权限，但可以复制当前笔记深链给已有成员。"}
          </DialogDescription>
        </DialogHeader>

        <div className="scrollbar-subtle max-h-[min(72dvh,40rem)] space-y-5 overflow-y-auto px-5 py-4">
          <section className="rounded-[18px] border border-border/70 bg-white/65 p-4 dark:bg-white/[0.04]">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <Link2 className="h-4 w-4" />
              工作区成员深链
            </div>
            <p className="mb-3 text-sm text-muted-foreground">仅当前工作区内已拥有权限的成员可通过这个链接打开目标笔记。</p>
            <Button variant="outline" className="rounded-[12px]" onClick={() => void onCopyDeepLink()}>
              <Copy className="h-4 w-4" />
              复制成员深链
            </Button>
          </section>

          {canCreatePublicShare && onCreatePublicShare ? (
            <section className="rounded-[18px] border border-border/70 bg-white/65 p-4 dark:bg-white/[0.04]">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <Share2 className="h-4 w-4" />
                单篇独享链接
              </div>
              <p className="mb-3 text-sm text-muted-foreground">生成一个不依赖工作区成员身份的只读单篇链接，外部用户可直接打开这一篇笔记。</p>
              {publicShareSummary ? (
                <div className="mb-3 rounded-[12px] border border-border/70 bg-background/60 px-3 py-2 text-xs text-muted-foreground">
                  {publicShareSummary.active
                    ? `当前已有活动独享链接 · ${publicShareSummary.expires_at ? `到期时间 ${new Date(publicShareSummary.expires_at).toLocaleString("zh-CN")}` : "永久有效"}`
                    : "当前没有活动独享链接"}
                </div>
              ) : null}
              <div className="mb-3">
                <div className="grid gap-2 sm:grid-cols-[150px_1fr]">
                  <select
                    value={publicExpiry}
                    onChange={(event) => setPublicExpiry(event.target.value as "never" | "24h" | "7d")}
                    className="rounded-[12px] border border-input bg-background/80 px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                  >
                    <option value="24h">24 小时有效</option>
                    <option value="7d">7 天有效</option>
                    <option value="never">永久有效</option>
                  </select>
                  <Input value={publicPassword} onChange={(event) => setPublicPassword(event.target.value)} placeholder="访问密码（可选）" className="rounded-[12px]" />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button className="rounded-[12px]" disabled={busy} onClick={() => void submitPublicShare()}>
                  {publicShareSummary?.active ? "重新生成独享链接" : "生成独享链接"}
                </Button>
                {onRevokePublicShare ? (
                  <Button variant="outline" className="rounded-[12px]" disabled={busy} onClick={() => setRevokeConfirmOpen(true)}>
                    撤销当前独享链接
                  </Button>
                ) : null}
                {publicShareResult ? (
                  <Button variant="outline" className="rounded-[12px]" onClick={() => void navigator.clipboard.writeText(publicShareResult)}>
                    <Copy className="h-4 w-4" />
                    复制独享链接
                  </Button>
                ) : null}
              </div>
              {publicShareResult ? (
                <div className="mt-3 space-y-1 text-xs text-muted-foreground">
                  <p className="break-all">{publicShareResult}</p>
                  <p>有效期：{publicShareExpiryLabel}</p>
                </div>
              ) : null}
            </section>
          ) : null}

          {canInvite && onCreateInvite ? (
            <section className="rounded-[18px] border border-border/70 bg-white/65 p-4 dark:bg-white/[0.04]">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <Users className="h-4 w-4" />
                生成可编辑邀请链接
              </div>
              <div className="grid gap-3">
                <div className="grid gap-3 sm:grid-cols-[1fr_132px]">
                  <Input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="成员邮箱" className="rounded-[12px]" />
                  <select
                    value={role}
                    onChange={(event) => setRole(event.target.value as "editor" | "viewer")}
                    className="rounded-[12px] border border-input bg-background/80 px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                  >
                    <option value="editor">编辑者</option>
                    <option value="viewer">只读者</option>
                  </select>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button className="rounded-[12px]" disabled={busy || !email.trim()} onClick={() => void submitInvite()}>
                    生成邀请链接
                  </Button>
                  {inviteResult ? (
                    <Button variant="outline" className="rounded-[12px]" onClick={() => void navigator.clipboard.writeText(inviteResult)}>
                      <Copy className="h-4 w-4" />
                      复制邀请链接
                    </Button>
                  ) : null}
                </div>
                {inviteResult ? <p className="break-all text-xs text-muted-foreground">{inviteResult}</p> : null}
              </div>
            </section>
          ) : null}
        </div>
      </DialogContent>
      <ConfirmDialog
        open={revokeConfirmOpen}
        title="撤销独享链接"
        description="当前独享链接会立即失效，已获得链接的人将无法继续访问。"
        confirmLabel="撤销链接"
        destructive
        loading={busy}
        onOpenChange={setRevokeConfirmOpen}
        onConfirm={() => void submitRevokePublicShare()}
      />
    </Dialog>
  );
}
