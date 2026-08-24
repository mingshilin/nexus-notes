PRAGMA foreign_keys = ON;

ALTER TABLE beta_jobs ADD COLUMN result_key TEXT;

CREATE INDEX IF NOT EXISTS beta_jobs_result_key_idx
  ON beta_jobs(workspace_id, kind, status, result_key);
