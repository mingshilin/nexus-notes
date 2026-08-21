CREATE TABLE beta_attachments (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  note_id TEXT REFERENCES notes(id) ON DELETE SET NULL,
  object_key TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL CHECK (mime_type IN ('application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'text/plain')),
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 26214400),
  status TEXT NOT NULL CHECK (status IN ('uploading', 'ready', 'deleted')),
  idempotency_key TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE (workspace_id, user_id, idempotency_key)
);

CREATE TABLE beta_ocr_jobs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  attachment_id TEXT NOT NULL REFERENCES beta_attachments(id) ON DELETE CASCADE,
  source_revision INTEGER NOT NULL CHECK (source_revision > 0),
  status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'dead_letter')),
  idempotency_key TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  deadline TEXT NOT NULL,
  last_error_code TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (workspace_id, attachment_id, source_revision)
);

CREATE INDEX beta_attachments_workspace_page_idx ON beta_attachments(workspace_id, status, created_at DESC, id DESC);
CREATE INDEX beta_ocr_jobs_workspace_status_idx ON beta_ocr_jobs(workspace_id, attachment_id, status, updated_at DESC);
