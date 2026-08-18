CREATE TABLE IF NOT EXISTS email_verification_codes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_email_verification_codes_email
  ON email_verification_codes(email, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_email_verification_codes_user
  ON email_verification_codes(user_id, created_at DESC);

ALTER TABLE workspace_invites ADD COLUMN note_id TEXT REFERENCES notes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_workspace_invites_note
  ON workspace_invites(note_id, created_at DESC);
