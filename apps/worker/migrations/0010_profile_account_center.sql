ALTER TABLE users ADD COLUMN biography TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN locale TEXT NOT NULL DEFAULT 'zh-CN';
ALTER TABLE users ADD COLUMN timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai';
ALTER TABLE users ADD COLUMN avatar_key TEXT;
ALTER TABLE users ADD COLUMN deletion_requested_at TEXT;
ALTER TABLE sessions ADD COLUMN user_agent TEXT NOT NULL DEFAULT '';

CREATE TABLE email_change_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  new_email TEXT NOT NULL COLLATE NOCASE,
  code_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX email_change_user_active_idx ON email_change_requests(user_id, consumed_at, expires_at);

CREATE TABLE account_audit_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event TEXT NOT NULL,
  request_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX account_audit_user_created_idx ON account_audit_logs(user_id, created_at DESC, id DESC);
