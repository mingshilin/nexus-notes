PRAGMA foreign_keys = OFF;

ALTER TABLE note_attachments ADD COLUMN ocr_text TEXT;
ALTER TABLE note_attachments ADD COLUMN ocr_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE note_attachments ADD COLUMN ocr_updated_at TEXT;

CREATE TABLE IF NOT EXISTS import_jobs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  created_by_user_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'completed',
  imported_count INTEGER NOT NULL DEFAULT 0,
  warning_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS offline_drafts (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  note_id TEXT,
  title TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  synced_at TEXT,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_note_attachments_workspace_ocr ON note_attachments(workspace_id, ocr_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_import_jobs_workspace ON import_jobs(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_offline_drafts_user ON offline_drafts(workspace_id, user_id, updated_at DESC);

CREATE TRIGGER IF NOT EXISTS trg_import_jobs_updated_at
AFTER UPDATE ON import_jobs
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE import_jobs SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_offline_drafts_updated_at
AFTER UPDATE ON offline_drafts
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE offline_drafts SET updated_at = datetime('now') WHERE id = NEW.id;
END;

PRAGMA foreign_keys = ON;
