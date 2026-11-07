-- One-time calendar-month purchases; never repurpose a recurring Stripe binding.
CREATE TABLE IF NOT EXISTS billing_monthly_orders (
 order_id uuid PRIMARY KEY,
 user_id text NOT NULL CHECK(length(user_id)>0),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','paid','expired')),
 session_ref text UNIQUE CHECK(session_ref IS NULL OR session_ref ~ '^cs_[A-Za-z0-9_]+$'),
 payment_ref text UNIQUE CHECK(payment_ref IS NULL OR payment_ref ~ '^pi_[A-Za-z0-9_]+$'),
 created_at timestamptz NOT NULL DEFAULT now(),
 period_start timestamptz, period_end timestamptz,
 CHECK((state='paid')=(payment_ref IS NOT NULL AND period_start IS NOT NULL AND period_end IS NOT NULL)),
 CHECK(period_end IS NULL OR period_end>period_start)
);
CREATE UNIQUE INDEX IF NOT EXISTS billing_monthly_orders_pending ON billing_monthly_orders(user_id) WHERE state='pending';
CREATE INDEX IF NOT EXISTS billing_monthly_orders_user ON billing_monthly_orders(user_id,created_at DESC);
COMMENT ON TABLE billing_monthly_orders IS 'kernel-no-tenant-data: owner-global one-time monthly orders. Trusted HTTP principal scopes reads and checkout reservation; verified Stripe retrieval scopes settlement. Compromised app_rw has cross-owner access as with existing wallets. No raw credentials or customer email.';
REVOKE ALL ON billing_monthly_orders FROM app_rw;
GRANT SELECT,INSERT ON billing_monthly_orders TO app_rw;
GRANT UPDATE(state,session_ref,payment_ref,period_start,period_end) ON billing_monthly_orders TO app_rw;
