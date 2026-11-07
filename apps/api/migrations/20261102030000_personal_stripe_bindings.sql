CREATE TABLE IF NOT EXISTS billing_personal_stripe_bindings (
  subscription_ref text PRIMARY KEY CHECK(length(subscription_ref)>0),
  purchase_ref text NOT NULL UNIQUE REFERENCES billing_personal_purchases(purchase_ref),
  session_ref text NOT NULL UNIQUE CHECK(length(session_ref)>0),
  customer_ref text NOT NULL CHECK(length(customer_ref)>0),
  price_ref text NOT NULL CHECK(length(price_ref)>0),
  purchase_anchor timestamptz NOT NULL,
  status text NOT NULL CHECK(length(status)>0),
  cancel_at_period_end boolean NOT NULL,
  snapshot_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  next_check_at timestamptz
);
CREATE INDEX IF NOT EXISTS billing_personal_stripe_customer ON billing_personal_stripe_bindings(customer_ref);
CREATE INDEX IF NOT EXISTS billing_personal_stripe_due ON billing_personal_stripe_bindings(next_check_at,subscription_ref) WHERE next_check_at IS NOT NULL;
COMMENT ON TABLE billing_personal_stripe_bindings IS 'kernel-no-tenant-data: immutable new-generation personal Stripe customer/subscription/price/purchase-anchor ownership, with authoritative mutable renewal snapshot. No card data or tenant content.';
REVOKE ALL ON billing_personal_stripe_bindings FROM app_rw;
GRANT SELECT,INSERT ON billing_personal_stripe_bindings TO app_rw;
GRANT UPDATE(status,cancel_at_period_end,snapshot_at,next_check_at) ON billing_personal_stripe_bindings TO app_rw;
