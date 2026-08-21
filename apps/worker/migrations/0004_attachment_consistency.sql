CREATE TABLE IF NOT EXISTS queue_outbox (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  job_kind TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  payload_json TEXT NOT NULL,
  available_at TEXT NOT NULL,
  published_at TEXT,
  attempt INTEGER NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS queue_outbox_ready_idx ON queue_outbox(published_at, available_at);

CREATE TABLE beta_ocr_jobs_0004_stage (
  id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  attachment_id TEXT NOT NULL,
  source_revision INTEGER NOT NULL,
  status TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  attempt_count INTEGER NOT NULL,
  deadline TEXT NOT NULL,
  last_error_code TEXT,
  revision INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  migration_rank INTEGER NOT NULL
);

INSERT INTO beta_ocr_jobs_0004_stage (
  id, workspace_id, user_id, attachment_id, source_revision, status, idempotency_key,
  attempt_count, deadline, last_error_code, revision, created_at, updated_at, migration_rank
)
SELECT
  j.id, j.workspace_id, j.user_id, j.attachment_id,
  CASE
    WHEN substr(j.idempotency_key, 1, length(j.attachment_id) + 5) = 'ocr:' || j.attachment_id || ':'
      AND substr(j.idempotency_key, length(j.attachment_id) + 6) != ''
      AND substr(j.idempotency_key, length(j.attachment_id) + 6) NOT GLOB '*[^0-9]*'
      AND CAST(substr(j.idempotency_key, length(j.attachment_id) + 6) AS INTEGER) > 0
    THEN CAST(substr(j.idempotency_key, length(j.attachment_id) + 6) AS INTEGER)
    ELSE a.revision
  END,
  j.status, j.idempotency_key, j.attempt_count, j.deadline, j.last_error_code,
  j.revision, j.created_at, j.updated_at,
  ROW_NUMBER() OVER (
    PARTITION BY j.workspace_id, j.attachment_id,
      CASE
        WHEN substr(j.idempotency_key, 1, length(j.attachment_id) + 5) = 'ocr:' || j.attachment_id || ':'
          AND substr(j.idempotency_key, length(j.attachment_id) + 6) != ''
          AND substr(j.idempotency_key, length(j.attachment_id) + 6) NOT GLOB '*[^0-9]*'
          AND CAST(substr(j.idempotency_key, length(j.attachment_id) + 6) AS INTEGER) > 0
        THEN CAST(substr(j.idempotency_key, length(j.attachment_id) + 6) AS INTEGER)
        ELSE a.revision
      END
    ORDER BY
      CASE j.status
        WHEN 'completed' THEN 1
        WHEN 'processing' THEN 2
        WHEN 'pending' THEN 3
        WHEN 'failed' THEN 4
        ELSE 5
      END,
      j.revision DESC, j.updated_at DESC, j.id DESC
  )
FROM beta_ocr_jobs j
JOIN beta_attachments a ON a.workspace_id = j.workspace_id AND a.id = j.attachment_id;

CREATE TABLE beta_ocr_jobs_0003_duplicates (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  attachment_id TEXT NOT NULL,
  source_revision INTEGER NOT NULL,
  status TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  attempt_count INTEGER NOT NULL,
  deadline TEXT NOT NULL,
  last_error_code TEXT,
  revision INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_reason TEXT NOT NULL
);

INSERT INTO beta_ocr_jobs_0003_duplicates (
  id, workspace_id, user_id, attachment_id, source_revision, status, idempotency_key,
  attempt_count, deadline, last_error_code, revision, created_at, updated_at, archived_reason
)
SELECT
  id, workspace_id, user_id, attachment_id, source_revision, status, idempotency_key,
  attempt_count, deadline, last_error_code, revision, created_at, updated_at,
  'duplicate_workspace_attachment_source_revision'
FROM beta_ocr_jobs_0004_stage
WHERE migration_rank > 1;

CREATE TABLE beta_ocr_jobs_0004 (
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

INSERT INTO beta_ocr_jobs_0004 (
  id, workspace_id, user_id, attachment_id, source_revision, status, idempotency_key,
  attempt_count, deadline, last_error_code, revision, created_at, updated_at
)
SELECT
  id, workspace_id, user_id, attachment_id, source_revision, status, idempotency_key,
  attempt_count, deadline, last_error_code, revision, created_at, updated_at
FROM beta_ocr_jobs_0004_stage
WHERE migration_rank = 1;

DROP TABLE beta_ocr_jobs;
ALTER TABLE beta_ocr_jobs_0004 RENAME TO beta_ocr_jobs;
DROP TABLE beta_ocr_jobs_0004_stage;

CREATE INDEX beta_ocr_jobs_workspace_status_idx ON beta_ocr_jobs(workspace_id, attachment_id, status, updated_at DESC);
