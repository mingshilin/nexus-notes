import { act, renderHook, waitFor } from "@testing-library/react";
import type { Attachment, Note } from "@nexus/contracts";
import { describe, expect, it, vi } from "vitest";

import { useAttachmentUpload } from "../src/app/use-attachment-upload";

const note: Note = {
  id: "note-1",
  workspace_id: "ws-1",
  folder_id: null,
  database_id: null,
  created_by: "user-1",
  updated_by: "user-1",
  title: "笔记",
  content: "正文",
  status: "active",
  is_favorite: false,
  is_pinned: false,
  daily_date: null,
  revision: 1,
  created_at: "2026-08-31T00:00:00.000Z",
  updated_at: "2026-08-31T00:00:00.000Z",
};

const attachment = (id: string): Attachment => ({
  id,
  workspace_id: "ws-1",
  note_id: note.id,
  filename: "scan.pdf",
  mime_type: "application/pdf",
  size_bytes: 8,
  status: "ready",
  ocr_status: "pending",
  ocr_attempt_count: 0,
  ocr_updated_at: null,
  revision: 1,
  created_at: "2026-08-31T00:00:00.000Z",
  updated_at: "2026-08-31T00:00:00.000Z",
});

function client(overrides: Record<string, unknown> = {}) {
  return {
    createAttachmentUpload: vi.fn(async () => attachment("reserved-1")),
    uploadAttachmentContent: vi.fn(async () => attachment("reserved-1")),
    completeAttachmentUpload: vi.fn(async () => attachment("reserved-1")),
    deleteAttachment: vi.fn(async () => ({ deleted: true })),
    ...overrides,
  };
}

function props(overrides: Record<string, unknown> = {}) {
  const knowledgeClient = overrides.knowledgeClient ?? client();
  return {
    workspaceId: "ws-1",
    role: "editor",
    logoutPending: false,
    selectedNoteId: note.id,
    creatingNote: false,
    draftTitleRef: { current: note.title },
    draftContentRef: { current: note.content },
    setAttachments: vi.fn(),
    setRetryFeedback: vi.fn(),
    setUploadError: vi.fn(),
    setNoteError: vi.fn(),
    setNoteMessage: vi.fn(),
    updateActiveDraftInput: vi.fn(),
    refreshRecovery: vi.fn(),
    ...overrides,
    knowledgeClient,
  };
}

function file(name: string, type: string, content = "x") {
  const value = new File([content], name, { type });
  Object.defineProperty(value, "arrayBuffer", { value: vi.fn(async () => new TextEncoder().encode(content).buffer) });
  return value;
}

describe("useAttachmentUpload", () => {
  it("uploads a supported file and inserts a safe link into the selected note", async () => {
    const input = props();
    const { result } = renderHook(() => useAttachmentUpload(input as never));
    const uploadFile = file("scan[1].pdf", "application/pdf", "%PDF-1.7");

    await act(async () => { await result.current.upload(uploadFile, true); });

    expect(input.knowledgeClient.createAttachmentUpload).toHaveBeenCalledWith(expect.objectContaining({ note_id: note.id, size_bytes: uploadFile.size }));
    expect(input.knowledgeClient.uploadAttachmentContent).toHaveBeenCalledWith("reserved-1", expect.anything(), expect.any(AbortSignal));
    expect(input.knowledgeClient.completeAttachmentUpload).toHaveBeenCalledWith("reserved-1", expect.any(AbortSignal));
    expect(input.setAttachments).toHaveBeenCalledWith(expect.any(Function));
    expect(input.updateActiveDraftInput).toHaveBeenCalledWith(note.title, expect.stringContaining("scan_1_.pdf"));
    expect(input.setRetryFeedback).toHaveBeenCalledWith("已上传 scan[1].pdf，OCR 已加入队列。");
    expect(input.refreshRecovery).toHaveBeenCalledOnce();
  });

  it("rejects invalid files without issuing an upload request", async () => {
    const input = props();
    const { result } = renderHook(() => useAttachmentUpload(input as never));
    const uploadFile = file("script.exe", "application/octet-stream");

    await act(async () => { await result.current.upload(uploadFile, true); });

    expect(input.knowledgeClient.createAttachmentUpload).not.toHaveBeenCalled();
    expect(input.setUploadError).toHaveBeenCalledWith(expect.stringContaining("不支持"));
    expect(input.setNoteError).toHaveBeenCalledWith(expect.stringContaining("不受支持"));
  });

  it("cleans up a reservation and exposes a retryable error after upload failure", async () => {
    const input = props({ knowledgeClient: client({
      uploadAttachmentContent: vi.fn(async () => { throw new Error("network"); }),
    }) });
    const { result } = renderHook(() => useAttachmentUpload(input as never));
    const uploadFile = file("scan.pdf", "application/pdf");

    await act(async () => { await result.current.upload(uploadFile, true); });

    expect(input.knowledgeClient.deleteAttachment).toHaveBeenCalledWith("reserved-1");
    expect(input.setUploadError).toHaveBeenCalledWith(expect.stringContaining("上传失败"));
    expect(input.setNoteError).toHaveBeenCalledWith(expect.stringContaining("正文内容仍保留"));
  });

  it("does not publish a completed upload after the selected workspace changes", async () => {
    let resolveComplete!: (value: Attachment) => void;
    const complete = new Promise<Attachment>((resolve) => { resolveComplete = resolve; });
    const input = props({ knowledgeClient: client({ completeAttachmentUpload: vi.fn(() => complete) }) });
    const { result, rerender } = renderHook((value) => useAttachmentUpload(value as never), { initialProps: input });
    const uploadFile = file("scan.pdf", "application/pdf");

    let uploadPromise!: Promise<void>;
    act(() => { uploadPromise = result.current.upload(uploadFile, true); });
    await waitFor(() => expect(input.knowledgeClient.completeAttachmentUpload).toHaveBeenCalledOnce());
    rerender({ ...input, workspaceId: "ws-2", selectedNoteId: "note-2" });
    resolveComplete(attachment("reserved-1"));
    await act(async () => { await uploadPromise; });

    expect(input.setAttachments).not.toHaveBeenCalled();
    expect(input.setRetryFeedback).not.toHaveBeenCalled();
    expect(input.updateActiveDraftInput).not.toHaveBeenCalled();
  });

  it("never deletes a reservation after the complete request has started", async () => {
    const completeError = new Error("complete timed out");
    const input = props({ knowledgeClient: client({
      completeAttachmentUpload: vi.fn(async () => { throw completeError; }),
    }) });
    const { result } = renderHook(() => useAttachmentUpload(input as never));
    const uploadFile = file("scan.pdf", "application/pdf");

    await act(async () => { await result.current.upload(uploadFile, true); });

    expect(input.knowledgeClient.completeAttachmentUpload).toHaveBeenCalledOnce();
    expect(input.knowledgeClient.deleteAttachment).not.toHaveBeenCalled();
    expect(input.setUploadError).toHaveBeenCalledWith(expect.stringContaining("上传失败"));
  });

  it("does not publish an upload that finishes after logout begins", async () => {
    let resolveComplete!: (value: Attachment) => void;
    const complete = new Promise<Attachment>((resolve) => { resolveComplete = resolve; });
    const input = props({ knowledgeClient: client({ completeAttachmentUpload: vi.fn(() => complete) }) });
    const { result, rerender } = renderHook((value) => useAttachmentUpload(value as never), { initialProps: input });
    const uploadFile = file("scan.pdf", "application/pdf");
    let uploadPromise!: Promise<void>;

    act(() => { uploadPromise = result.current.upload(uploadFile, true); });
    await waitFor(() => expect(input.knowledgeClient.completeAttachmentUpload).toHaveBeenCalledOnce());
    rerender({ ...input, logoutPending: true });
    resolveComplete(attachment("reserved-1"));
    await act(async () => { await uploadPromise; });

    expect(input.setAttachments).not.toHaveBeenCalled();
    expect(input.setRetryFeedback).not.toHaveBeenCalled();
    expect(input.updateActiveDraftInput).not.toHaveBeenCalled();
    expect(input.setUploadError).not.toHaveBeenCalledWith(expect.stringContaining("上传失败"));
  });

  it("does not update React state when an active upload is explicitly aborted", async () => {
    const input = props({ knowledgeClient: client({
      uploadAttachmentContent: vi.fn(() => new Promise<Attachment>(() => undefined)),
    }) });
    const { result } = renderHook(() => useAttachmentUpload(input as never));
    const uploadFile = file("scan.pdf", "application/pdf");

    act(() => { void result.current.upload(uploadFile); });
    await waitFor(() => expect(input.knowledgeClient.uploadAttachmentContent).toHaveBeenCalledOnce());
    act(() => result.current.abortUpload());

    expect(result.current.isUploading).toBe(false);
  });
});
