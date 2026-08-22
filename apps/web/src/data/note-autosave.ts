import type { Note, UpdateNoteInput } from "@nexus/contracts";

import { ApiClientError } from "./api-client";

interface AutosaveClient {
  update(noteId: string, input: UpdateNoteInput): Promise<Note>;
}

export interface NoteAutosaveConflict {
  serverNote: Note;
  submitted: UpdateNoteInput;
}

export interface NoteAutosaveCallbacks {
  onSaved?(note: Note): void;
  onConflict?(conflict: NoteAutosaveConflict): void;
  onError?(error: unknown): void;
}

interface PendingAutosave {
  noteId: string;
  input: UpdateNoteInput;
}

export class NoteAutosaveController {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pending: PendingAutosave | undefined;

  constructor(
    private readonly client: AutosaveClient,
    private readonly callbacks: NoteAutosaveCallbacks = {},
    private readonly delayMs = 800,
  ) {}

  schedule(noteId: string, input: UpdateNoteInput) {
    if (this.timer) clearTimeout(this.timer);
    this.pending = { noteId, input: { ...input } };
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flush();
    }, this.delayMs);
  }

  cancel() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.pending = undefined;
  }

  async flush() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    const pending = this.pending;
    this.pending = undefined;
    if (!pending) return;

    let saved: Note;
    try {
      saved = await this.client.update(pending.noteId, pending.input);
    } catch (error) {
      if (error instanceof ApiClientError && error.code === "NOTE_CONFLICT") {
        const serverNote = error.details?.server_note as Note | undefined;
        const submitted = (error.details?.submitted as UpdateNoteInput | undefined) ?? pending.input;
        if (serverNote) {
          this.callbacks.onConflict?.({ serverNote, submitted });
          return;
        }
      }
      this.callbacks.onError?.(error);
      return;
    }
    this.callbacks.onSaved?.(saved);
  }
}
