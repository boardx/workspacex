-- New verified paid terms; monthly credit batches remain in the existing wallet/ledger.
CREATE TABLE IF NOT EXISTS billing_personal_terms (
  term_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL CHECK(length(user_id)>0),
  provider text NOT NULL CHECK(provider IN ('wechat','stripe')),
  payment_ref text NOT NULL CHECK(length(payment_ref)>0),
  subscription_ref text NOT NULL CHECK(length(subscription_ref)>0),
  catalog_version text NOT NULL CHECK(length(catalog_version)>0),
  sku text NOT NULL CHECK(length(sku)>0),
  billing_cycle text NOT NULL CHECK(billing_cycle IN ('month','year')),
  currency text NOT NULL CHECK(currency IN ('CNY','USD')),
  amount_minor bigint NOT NULL CHECK(amount_minor>0),
  purchase_anchor timestamptz NOT NULL,
  month_offset integer NOT NULL CHECK(month_offset>=0),
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL CHECK(period_end>period_start),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider,payment_ref),
  UNIQUE(provider,subscription_ref,period_start)
);
CREATE INDEX IF NOT EXISTS billing_personal_terms_owner ON billing_personal_terms(user_id,period_start);
COMMENT ON TABLE billing_personal_terms IS 'kernel-no-tenant-data: immutable owner-global verified paid-term metadata. Provider receipt ownership is validated by the trusted settlement boundary; public access must scope the authenticated user. No wallet balance or user content.';
REVOKE ALL ON billing_personal_terms FROM app_rw;
GRANT SELECT,INSERT ON billing_personal_terms TO app_rw;
