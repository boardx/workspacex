-- #411 / Wave 2: digest-only email verification challenges and transactional mail outbox.
-- Replayable: every object is guarded because migrate:check reapplies migrations.

CREATE TABLE IF NOT EXISTS email_verification_challenges (
  id             text PRIMARY KEY,
  token_digest   text NOT NULL UNIQUE CHECK (token_digest ~ '^[0-9a-f]{64}$'),
  user_id        text NOT NULL REFERENCES credentials (user_id) ON DELETE CASCADE,
  expires_at     timestamptz NOT NULL,
  consumed_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS email_verification_one_live_per_user
  ON email_verification_challenges (user_id) WHERE consumed_at IS NULL;
CREATE INDEX IF NOT EXISTS email_verification_digest_lookup
  ON email_verification_challenges (token_digest);

CREATE TABLE IF NOT EXISTS mail_outbox (
  id                   text PRIMARY KEY,
  challenge_id         text NOT NULL REFERENCES email_verification_challenges (id) ON DELETE CASCADE,
  template             text NOT NULL CHECK (template = 'email-verification'),
  recipient            text NOT NULL,
  status               text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'delivering', 'delivered', 'retryable', 'failed')),
  attempt_count        integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at      timestamptz NOT NULL DEFAULT now(),
  claimed_at           timestamptz,
  delivered_at         timestamptz,
  provider_message_id  text,
  failure_category     text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mail_outbox_one_message UNIQUE (challenge_id, template)
);

CREATE INDEX IF NOT EXISTS mail_outbox_due_idx
  ON mail_outbox (next_attempt_at, created_at)
  WHERE status IN ('pending', 'retryable');

COMMENT ON TABLE email_verification_challenges IS
  'kernel-no-tenant-data: credential verification state. Stores only SHA-256 bearer digests; '
  'the reproducible challenge id is not itself accepted by the public endpoint.';
COMMENT ON TABLE mail_outbox IS
  'kernel-no-tenant-data: transactional verification-mail delivery metadata. Contains recipient '
  'addresses and delivery state but no bearer token and no tenant content.';

GRANT SELECT, INSERT, UPDATE ON email_verification_challenges TO app_rw;
GRANT SELECT, INSERT, UPDATE ON mail_outbox TO app_rw;

-- Wave 2 invalidates pre-release plaintext links instead of carrying bearer secrets forward.
DROP TABLE IF EXISTS email_verification_tokens;
