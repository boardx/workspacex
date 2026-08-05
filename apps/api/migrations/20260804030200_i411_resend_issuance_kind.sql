-- #411 review hardening: registration is not one of the five daily resend attempts.

ALTER TABLE email_verification_challenges
  ADD COLUMN IF NOT EXISTS issuance_kind text NOT NULL DEFAULT 'initial'
    CHECK (issuance_kind IN ('initial', 'resend'));
