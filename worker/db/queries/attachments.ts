export {
  createPublicNoteShare,
  deleteNoteAttachmentById,
  getActivePublicShareByNoteId,
  getNoteAttachmentById,
  getPublicSharedNoteByTokenHash,
  getPublicShareSummaryByNoteId,
  insertNoteAttachment,
  listNoteAttachments,
  revokePublicSharesByNoteId,
} from "./legacy";

export type {
  NoteAttachmentRow,
  NotePublicShareRow,
} from "./legacy";
