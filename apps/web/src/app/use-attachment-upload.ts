import { useCallback, useEffect, useLayoutEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { MAX_UPLOAD_BYTES, SUPPORTED_ATTACHMENT_MIME_TYPES, type Attachment, type WorkspaceRoleContract } from "@nexus/contracts";

import type { KnowledgeClient } from "../data/knowledge-client";

export interface UseAttachmentUploadParams {
  knowledgeClient: Pick<KnowledgeClient, "createAttachmentUpload" | "uploadAttachmentContent" | "completeAttachmentUpload" | "deleteAttachment">;
  workspaceId?: string;
  role: WorkspaceRoleContract;
  logoutPending: boolean;
  selectedNoteId: string | null;
  creatingNote: boolean;
  draftTitleRef: MutableRefObject<string>;
  draftContentRef: MutableRefObject<string>;
  setAttachments: Dispatch<SetStateAction<Attachment[]>>;
  setRetryFeedback: Dispatch<SetStateAction<string | null>>;
  setUploadError: Dispatch<SetStateAction<string | null>>;
  setNoteError: Dispatch<SetStateAction<string | null>>;
  setNoteMessage: Dispatch<SetStateAction<string | null>>;
  updateActiveDraftInput(title: string, content: string): void;
  refreshRecovery(): void;
}

function isSupportedMime(value: string): value is typeof SUPPORTED_ATTACHMENT_MIME_TYPES[number] {
  return (SUPPORTED_ATTACHMENT_MIME_TYPES as readonly string[]).includes(value);
}

function isAbort(error: unknown, signal: AbortSignal) {
  return signal.aborted || (error instanceof DOMException && error.name === "AbortError");
}

export function useAttachmentUpload({
  knowledgeClient,
  workspaceId,
  role,
  logoutPending,
  selectedNoteId,
  creatingNote,
  draftTitleRef,
  draftContentRef,
  setAttachments,
  setRetryFeedback,
  setUploadError,
  setNoteError,
  setNoteMessage,
  updateActiveDraftInput,
  refreshRecovery,
}: UseAttachmentUploadParams) {
  const [isUploading, setIsUploading] = useState(false);
  const mountedRef = useRef(true);
  const pendingRef = useRef(false);
  const scopeRef = useRef({ knowledgeClient, workspaceId, role, logoutPending, selectedNoteId, creatingNote });
  const generationRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  const uploadVersionRef = useRef(0);

  useLayoutEffect(() => {
    const changed = scopeRef.current.knowledgeClient !== knowledgeClient
      || scopeRef.current.workspaceId !== workspaceId
      || scopeRef.current.role !== role
      || scopeRef.current.logoutPending !== logoutPending
      || scopeRef.current.selectedNoteId !== selectedNoteId
      || scopeRef.current.creatingNote !== creatingNote;
    if (!changed) return;
    controllerRef.current?.abort();
    controllerRef.current = null;
    uploadVersionRef.current += 1;
    generationRef.current += 1;
    pendingRef.current = false;
    setIsUploading(false);
    scopeRef.current = { knowledgeClient, workspaceId, role, logoutPending, selectedNoteId, creatingNote };
  }, [creatingNote, knowledgeClient, logoutPending, role, selectedNoteId, workspaceId]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      controllerRef.current?.abort();
      controllerRef.current = null;
      uploadVersionRef.current += 1;
      pendingRef.current = false;
    };
  }, []);

  const upload = useCallback(async (file: File, insertIntoEditor = false) => {
    const requestWorkspaceId = workspaceId;
    const requestRole = role;
    const requestNoteId = selectedNoteId;
    const requestCreatingNote = creatingNote;
    if (!mountedRef.current
      || !requestWorkspaceId
      || requestRole === "viewer"
      || logoutPending
      || pendingRef.current
      || scopeRef.current.knowledgeClient !== knowledgeClient
      || scopeRef.current.workspaceId !== requestWorkspaceId
      || scopeRef.current.role !== requestRole
      || scopeRef.current.logoutPending
      || scopeRef.current.selectedNoteId !== requestNoteId
      || scopeRef.current.creatingNote !== requestCreatingNote) return;
    const mimeType = file.type;
    if (!isSupportedMime(mimeType)) {
      setUploadError("不支持这个附件类型。请上传 PDF、JPG、PNG、WEBP 或纯文本文件。");
      if (insertIntoEditor) setNoteError("附件类型不受支持，正文内容未改变。");
      return;
    }
    if (file.size <= 0 || file.size > MAX_UPLOAD_BYTES) {
      setUploadError("附件必须大于 0 且不超过 25 MB。");
      if (insertIntoEditor) setNoteError("附件大小不符合要求，正文内容未改变。");
      return;
    }

    const controller = new AbortController();
    controllerRef.current?.abort();
    controllerRef.current = controller;
    const version = ++uploadVersionRef.current;
    const generation = generationRef.current;
    const requestClient = knowledgeClient;
    let reservedId: string | null = null;
    let published = false;
    let completionStarted = false;
    pendingRef.current = true;
    setIsUploading(true);
    setUploadError(null);

    const isCurrent = () => !controller.signal.aborted
      && mountedRef.current
      && uploadVersionRef.current === version
      && generationRef.current === generation
      && scopeRef.current.knowledgeClient === requestClient
      && scopeRef.current.workspaceId === requestWorkspaceId
      && scopeRef.current.role === requestRole
      && !scopeRef.current.logoutPending
      && scopeRef.current.selectedNoteId === requestNoteId
      && scopeRef.current.creatingNote === requestCreatingNote;
    const cleanupReservation = async () => {
      if (reservedId && !published && !completionStarted) await requestClient.deleteAttachment(reservedId).catch(() => undefined);
    };

    try {
      const reserved = await requestClient.createAttachmentUpload({
        filename: file.name,
        mime_type: mimeType,
        size_bytes: file.size,
        note_id: requestNoteId,
      });
      reservedId = reserved.id;
      if (!isCurrent() || reserved.workspace_id !== requestWorkspaceId || reserved.note_id !== requestNoteId) {
        await cleanupReservation();
        return;
      }
      const uploaded = await requestClient.uploadAttachmentContent(reserved.id, await file.arrayBuffer(), controller.signal);
      if (!isCurrent() || uploaded.workspace_id !== requestWorkspaceId || uploaded.note_id !== requestNoteId || uploaded.id !== reserved.id) {
        await cleanupReservation();
        return;
      }
      completionStarted = true;
      const completed = await requestClient.completeAttachmentUpload(uploaded.id, controller.signal);
      if (!isCurrent() || completed.workspace_id !== requestWorkspaceId || completed.note_id !== requestNoteId || completed.id !== reserved.id) {
        await cleanupReservation();
        return;
      }
      published = true;
      setAttachments((current) => [completed, ...current.filter((attachment) => attachment.id !== completed.id)]);
      setRetryFeedback(`已上传 ${file.name}，OCR 已加入队列。`);
      if (insertIntoEditor && requestNoteId && !requestCreatingNote) {
        const safeLabel = file.name.replace(/[\[\]\r\n]/gu, "_");
        const link = `[${safeLabel}](/api/v2/attachments/${encodeURIComponent(completed.id)}/file)`;
        const separator = draftContentRef.current.trim() ? "\n\n" : "";
        updateActiveDraftInput(draftTitleRef.current, `${draftContentRef.current}${separator}${link}`);
        setNoteError(null);
        setNoteMessage("附件已插入正文，保存笔记后生效。");
      }
      refreshRecovery();
    } catch (error) {
      await cleanupReservation();
      if (!isCurrent() || isAbort(error, controller.signal)) return;
      setUploadError("附件上传失败，请重新选择文件。未完成的上传会自动清理。");
      if (insertIntoEditor) setNoteError("附件上传失败，正文内容仍保留。请重试。");
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
      if (uploadVersionRef.current === version) {
        pendingRef.current = false;
        if (mountedRef.current) setIsUploading(false);
      }
    }
  }, [creatingNote, draftContentRef, draftTitleRef, knowledgeClient, logoutPending, refreshRecovery, role, selectedNoteId, setAttachments, setNoteError, setNoteMessage, setRetryFeedback, setUploadError, updateActiveDraftInput, workspaceId]);

  const abortUpload = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    uploadVersionRef.current += 1;
    pendingRef.current = false;
    if (mountedRef.current) setIsUploading(false);
  }, []);

  return {
    upload,
    abortUpload,
    isUploading,
  };
}
