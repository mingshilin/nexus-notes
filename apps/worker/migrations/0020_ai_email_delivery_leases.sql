PRAGMA foreign_keys = ON;

ALTER TABLE ai_email_outbox ADD COLUMN delivery_lease_until TEXT;
ALTER TABLE ai_email_outbox ADD COLUMN delivery_claim_token TEXT;

CREATE INDEX ai_email_outbox_delivery_lease_idx
  ON ai_email_outbox(status, delivery_lease_until, dispatch_lease_until);
