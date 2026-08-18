CREATE TABLE IF NOT EXISTS note_public_shares (
  id TEXT PRIMARY KEY,
  note_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  creator_user_id TEXT NOT NULL,
  access_mode TEXT NOT NULL DEFAULT 'read',
  access_token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (creator_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_note_public_shares_note
  ON note_public_shares(note_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_note_public_shares_token
  ON note_public_shares(access_token_hash);

CREATE TRIGGER IF NOT EXISTS trg_note_public_shares_updated_at
AFTER UPDATE ON note_public_shares
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE note_public_shares SET updated_at = datetime('now') WHERE id = NEW.id;
END;
