ALTER TABLE users ADD COLUMN display_name TEXT;
ALTER TABLE users ADD COLUMN bio TEXT;
ALTER TABLE users ADD COLUMN avatar_url TEXT;

CREATE TABLE IF NOT EXISTS reminders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  note_id TEXT,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  due_at TEXT NOT NULL,
  completed_at TEXT,
  notified_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_reminders_workspace_due
  ON reminders(workspace_id, due_at, completed_at, notified_at);
CREATE INDEX IF NOT EXISTS idx_reminders_user_due
  ON reminders(user_id, due_at, completed_at, notified_at);
CREATE INDEX IF NOT EXISTS idx_reminders_note_id
  ON reminders(note_id);

CREATE TRIGGER IF NOT EXISTS trg_reminders_updated_at
AFTER UPDATE ON reminders
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE reminders SET updated_at = datetime('now') WHERE id = NEW.id;
END;
