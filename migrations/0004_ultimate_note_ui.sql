PRAGMA foreign_keys = OFF;

ALTER TABLE notes ADD COLUMN is_daily INTEGER NOT NULL DEFAULT 0;
ALTER TABLE notes ADD COLUMN daily_date TEXT;

CREATE TABLE IF NOT EXISTS note_links (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  source_note_id TEXT NOT NULL,
  target_note_id TEXT,
  target_title TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (source_note_id) REFERENCES notes(id) ON DELETE CASCADE,
  FOREIGN KEY (target_note_id) REFERENCES notes(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_notes_user_daily ON notes(user_id, is_daily, daily_date);
CREATE UNIQUE INDEX IF NOT EXISTS idx_notes_user_daily_unique
  ON notes(user_id, daily_date)
  WHERE is_daily = 1 AND daily_date IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_note_links_user_source ON note_links(user_id, source_note_id);
CREATE INDEX IF NOT EXISTS idx_note_links_user_target ON note_links(user_id, target_note_id);
CREATE INDEX IF NOT EXISTS idx_note_links_user_title ON note_links(user_id, target_title);

PRAGMA foreign_keys = ON;
