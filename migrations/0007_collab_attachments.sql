CREATE TABLE IF NOT EXISTS workspace_invites (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'editor',
  invite_token_hash TEXT NOT NULL UNIQUE,
  invited_by_user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  accepted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (invited_by_user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE (workspace_id, email)
);

CREATE TABLE IF NOT EXISTS note_attachments (
  id TEXT PRIMARY KEY,
  note_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  uploader_id TEXT NOT NULL,
  storage_key TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (uploader_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_workspace_invites_workspace ON workspace_invites(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workspace_invites_email ON workspace_invites(email, expires_at DESC);
CREATE INDEX IF NOT EXISTS idx_workspace_invites_token ON workspace_invites(invite_token_hash);

CREATE INDEX IF NOT EXISTS idx_note_attachments_note ON note_attachments(workspace_id, note_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_note_attachments_uploader ON note_attachments(uploader_id, created_at DESC);

CREATE TRIGGER IF NOT EXISTS trg_workspace_invites_updated_at
AFTER UPDATE ON workspace_invites
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE workspace_invites SET updated_at = datetime('now') WHERE id = NEW.id;
END;
