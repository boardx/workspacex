-- #411 review hardening: distinguish successful consumption from resend supersession.

ALTER TABLE email_verification_challenges
  ADD COLUMN IF NOT EXISTS superseded_at timestamptz;
DROP INDEX IF EXISTS email_verification_one_live_per_user;
CREATE UNIQUE INDEX IF NOT EXISTS email_verification_one_live_per_user
  ON email_verification_challenges (user_id)
  WHERE consumed_at IS NULL AND superseded_at IS NULL;

ALTER TABLE mail_outbox DROP CONSTRAINT IF EXISTS mail_outbox_status_check;
ALTER TABLE mail_outbox ADD CONSTRAINT mail_outbox_status_check
  CHECK (status IN ('pending', 'delivering', 'delivered', 'retryable', 'failed', 'cancelled'));
