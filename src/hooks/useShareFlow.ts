import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { createPublicNoteShare, getPublicNoteShareSummary, getPublicSharedNote, revokePublicNoteShare } from "@/api/shares";
import { getErrorMessage } from "@/lib/errorMessages";
import type { AuthUser } from "@/types/auth";
import type { NoteWithTags, PublicSharedNote } from "@/types/note";

interface UseShareFlowParams {
  user: AuthUser | null;
  allKnownNotes: Map<string, NoteWithTags>;
}

export function useShareFlow({ user, allKnownNotes }: UseShareFlowParams) {
  const [shareDialogNoteId, setShareDialogNoteId] = useState<string | null>(null);
  const [publicShareSummary, setPublicShareSummary] = useState<{ active: boolean; expires_at: string | null } | null>(null);
  const [pendingPublicShareToken, setPendingPublicShareToken] = useState<string | null>(null);
  const [publicSharedNote, setPublicSharedNote] = useState<PublicSharedNote | null>(null);
  const [publicSharedNoteError, setPublicSharedNoteError] = useState<string | null>(null);
  const [publicSharePassword, setPublicSharePassword] = useState("");

  const shareDialogNote = useMemo(
    () => (shareDialogNoteId ? allKnownNotes.get(shareDialogNoteId) ?? null : null),
    [allKnownNotes, shareDialogNoteId],
  );

  useEffect(() => {
    const url = new URL(window.location.href);
    const publicShareToken = url.searchParams.get("share");
    if (publicShareToken?.trim()) {
      setPendingPublicShareToken(decodeURIComponent(publicShareToken.trim()));
    }
  }, []);

  useEffect(() => {
    if (!pendingPublicShareToken) {
      setPublicSharedNote(null);
      setPublicSharedNoteError(null);
      return;
    }
    getPublicSharedNote(pendingPublicShareToken, publicSharePassword || null)
      .then((data) => {
        setPublicSharedNote(data);
        setPublicSharedNoteError(null);
      })
      .catch((error) => {
        setPublicSharedNote(null);
        setPublicSharedNoteError(getErrorMessage(error, "分享链接不存在或已失效"));
      });
  }, [pendingPublicShareToken, publicSharePassword]);

  useEffect(() => {
    if (!shareDialogNoteId || !user) {
      setPublicShareSummary(null);
      return;
    }
    getPublicNoteShareSummary(shareDialogNoteId)
      .then(setPublicShareSummary)
      .catch(() => setPublicShareSummary(null));
  }, [shareDialogNoteId, user?.current_workspace?.id]);

  function openShareDialog(noteId: string) {
    setShareDialogNoteId(noteId);
  }

  function closeShareDialog() {
    setShareDialogNoteId(null);
    setPublicShareSummary(null);
  }

  async function handleCreatePublicShare(noteId: string, expiresIn: number | null, password?: string | null) {
    const share = await createPublicNoteShare(noteId, expiresIn, password);
    setPublicShareSummary({
      active: true,
      expires_at: share.expires_at ?? null,
    });
    toast.success("独享链接已生成");
    return { share_url: share.share_url, expires_at: share.expires_at ?? null };
  }

  async function handleRevokePublicShare(noteId: string) {
    await revokePublicNoteShare(noteId);
    setPublicShareSummary({ active: false, expires_at: null });
    toast.success("独享链接已撤销");
  }

  return {
    shareDialogNoteId,
    shareDialogNote,
    publicShareSummary,
    pendingPublicShareToken,
    publicSharedNote,
    publicSharedNoteError,
    publicSharePassword,
    setPublicSharePassword,
    openShareDialog,
    closeShareDialog,
    handleCreatePublicShare,
    handleRevokePublicShare,
  };
}
