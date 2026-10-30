-- Owner-global billing follows the existing wallet boundary; public handlers authorize the trusted owner.
CREATE TABLE IF NOT EXISTS credit_subscription_periods (
  period_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id uuid NOT NULL REFERENCES credit_wallets(wallet_id),
  subscription_ref text NOT NULL CHECK(length(subscription_ref)>0),
  invoice_ref text NOT NULL UNIQUE CHECK(length(invoice_ref)>0),
  plan_ref text NOT NULL CHECK(length(plan_ref)>0),
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL CHECK(period_end>period_start),
  granted_hundredths bigint NOT NULL CHECK(granted_hundredths>0),
  remaining_hundredths bigint NOT NULL CHECK(remaining_hundredths>=0 AND remaining_hundredths<=granted_hundredths),
  expired_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(wallet_id,subscription_ref,period_start,period_end)
);
CREATE INDEX IF NOT EXISTS credit_subscription_periods_due ON credit_subscription_periods(wallet_id,period_end) WHERE expired_at IS NULL;
CREATE TABLE IF NOT EXISTS credit_subscription_allocations (
  allocation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id text NOT NULL REFERENCES credit_consumption_requests(request_id) ON DELETE CASCADE,
  period_id uuid NOT NULL REFERENCES credit_subscription_periods(period_id) ON DELETE CASCADE,
  hundredths bigint NOT NULL CHECK(hundredths>0),
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE credit_subscription_periods IS 'kernel-no-tenant-data: owner-global subscription credit batches joined to credit_wallets. Like existing wallets, compromised app_rw can read across owners; trusted application ownership checks are the public boundary. Immutable paid-period identity, only remaining credits and expiry can change.';
COMMENT ON TABLE credit_subscription_allocations IS 'kernel-no-tenant-data: append-only owner-global allocation audit joined to trusted request and wallet identities; HTTP queries must scope the actor or wallet. Compromised app_rw can read owner-global allocation amounts.';
REVOKE ALL ON credit_subscription_periods,credit_subscription_allocations FROM app_rw;
GRANT SELECT,INSERT ON credit_subscription_periods,credit_subscription_allocations TO app_rw;
GRANT UPDATE(remaining_hundredths,expired_at) ON credit_subscription_periods TO app_rw;

ALTER TABLE credit_transactions DROP CONSTRAINT IF EXISTS credit_transactions_type_check;
ALTER TABLE credit_transactions ADD CONSTRAINT credit_transactions_type_check CHECK(type IN ('purchase','bonus','grant','consume','subscription_grant','subscription_expire'));
ALTER TABLE credit_transactions DROP CONSTRAINT IF EXISTS credit_transactions_source_type_check;
ALTER TABLE credit_transactions ADD CONSTRAINT credit_transactions_source_type_check CHECK(source_type IN ('payment_order','admin_grant','model_request','subscription_period'));
ALTER TABLE credit_transactions DROP CONSTRAINT IF EXISTS credit_transactions_subscription_check;
ALTER TABLE credit_transactions ADD CONSTRAINT credit_transactions_subscription_check CHECK(
  (type NOT IN ('subscription_grant','subscription_expire') AND source_type<>'subscription_period') OR
  (type='subscription_grant' AND source_type='subscription_period' AND direction=1) OR
  (type='subscription_expire' AND source_type='subscription_period' AND direction=-1)
);
