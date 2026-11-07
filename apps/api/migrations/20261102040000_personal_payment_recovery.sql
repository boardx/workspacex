-- Recovery hints are rebuildable scheduling metadata, never payment or entitlement proof.
ALTER TABLE billing_personal_purchases
  ADD COLUMN IF NOT EXISTS recovery_next_check_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  ADD COLUMN IF NOT EXISTS recovery_attempts integer NOT NULL DEFAULT 0 CHECK(recovery_attempts BETWEEN 0 AND 1000),
  ADD COLUMN IF NOT EXISTS recovery_error text CHECK(recovery_error IN ('binding_unresolved','provider_unavailable'));
CREATE INDEX IF NOT EXISTS billing_personal_recovery_due ON billing_personal_purchases(recovery_next_check_at,purchase_ref)
  WHERE fulfilled_at IS NULL AND closed_at IS NULL AND NOT payment_review_required;
ALTER TABLE billing_personal_stripe_bindings
  ADD COLUMN IF NOT EXISTS invoice_cursor text CHECK(invoice_cursor IS NULL OR invoice_cursor ~ '^in_[A-Za-z0-9_]{1,252}$');
GRANT UPDATE(recovery_next_check_at,recovery_attempts,recovery_error) ON billing_personal_purchases TO app_rw;
GRANT UPDATE(invoice_cursor) ON billing_personal_stripe_bindings TO app_rw;
-- Newly introduced scheduling must also discover older paid bindings and missed terminal events.
UPDATE billing_personal_stripe_bindings SET next_check_at=clock_timestamp();
