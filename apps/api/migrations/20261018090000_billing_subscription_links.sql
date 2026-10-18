/* F08: owner-global subscription read model and hashed principal-bound purchase intents.
 * F09 alone will introduce verified webhook writes. HTTP readers cannot mutate snapshots.
 * No org column: a subscription belongs to a user across organization switches.
 */
CREATE TABLE IF NOT EXISTS billing_subscriptions (
  user_id text PRIMARY KEY CHECK (length(user_id)>0),
  provider text NOT NULL DEFAULT 'stripe' CHECK (provider='stripe'),
  customer_ref text UNIQUE,
  subscription_ref text NOT NULL UNIQUE,
  status text NOT NULL CHECK (status IN ('active','trialing','past_due','canceled','incomplete','unpaid','paused','incomplete_expired')),
  plan_ref text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  trial_start timestamptz,
  trial_end timestamptz,
  binding_generation bigint NOT NULL DEFAULT 1 CHECK (binding_generation>0),
  synchronization_uncertain boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS billing_purchase_intents (
  intent_hash text PRIMARY KEY CHECK (intent_hash ~ '^[0-9a-f]{64}$'),
  user_id text NOT NULL CHECK (length(user_id)>0),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now()+interval '24 hours'),
  expected_generation bigint NOT NULL CHECK (expected_generation>=0),
  consumed_subscription_ref text UNIQUE,
  CHECK (expires_at>created_at)
);
CREATE INDEX IF NOT EXISTS billing_purchase_intents_user_idx ON billing_purchase_intents(user_id,created_at DESC);
COMMENT ON TABLE billing_subscriptions IS 'kernel-no-tenant-data: owner-global Stripe subscription snapshot keyed by user, app_rw SELECT only in F08; compromised app role can read customer/subscription refs and billing status across users. HTTP access filters trusted principal user_id.';
COMMENT ON TABLE billing_purchase_intents IS 'kernel-no-tenant-data: owner-global principal-bound SHA256 purchase intent digests, expiry and expected generation; no raw bearer token. Compromised app role can read/insert intents for arbitrary users; trusted HTTP principal is the ownership boundary. app_rw cannot UPDATE or DELETE correlation history. Expired/consumed hashes retain user and generation for late-payment reconciliation; retention policy is separate.';
REVOKE ALL ON billing_subscriptions,billing_purchase_intents FROM app_rw;
GRANT SELECT ON billing_subscriptions TO app_rw;
-- F09 must reject expired authorization without deleting the hash/user/generation correlation.
-- Unknown or late payments require explicit reconciliation; intent retention is not automatic authorization.
GRANT SELECT,INSERT ON billing_purchase_intents TO app_rw;
