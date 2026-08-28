PRAGMA foreign_keys = ON;

ALTER TABLE ai_email_outbox ADD COLUMN dispatch_lease_until TEXT;
ALTER TABLE ai_email_outbox ADD COLUMN dispatch_claim_token TEXT;

-- Rows left in the old sending state remain recoverable after this migration.
UPDATE ai_email_outbox
SET dispatch_lease_until = updated_at,
    dispatch_claim_token = 'legacy:' || id
WHERE status = 'sending' AND dispatch_claim_token IS NULL;

CREATE INDEX ai_email_outbox_dispatch_lease_idx
  ON ai_email_outbox(status, dispatch_lease_until, available_at);
