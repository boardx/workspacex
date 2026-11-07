CREATE TABLE IF NOT EXISTS billing_personal_payment_receipts (
  provider text NOT NULL CHECK(length(provider)>0),
  payment_ref text NOT NULL CHECK(length(payment_ref) BETWEEN 1 AND 255),
  purchase_ref text NOT NULL REFERENCES billing_personal_purchases(purchase_ref),
  amount_minor bigint NOT NULL CHECK(amount_minor>0),
  currency text NOT NULL CHECK(length(currency)>0),
  paid_at timestamptz,
  verified_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  manual_review boolean NOT NULL DEFAULT false,
  manual_reason text,
  PRIMARY KEY(provider,payment_ref),
  CHECK((manual_review AND manual_reason IS NOT NULL AND length(manual_reason) BETWEEN 1 AND 128)
     OR (NOT manual_review AND manual_reason IS NULL))
);
CREATE INDEX IF NOT EXISTS billing_personal_receipt_purchase ON billing_personal_payment_receipts(purchase_ref,verified_at);
COMMENT ON TABLE billing_personal_payment_receipts IS 'kernel-no-tenant-data: immutable provider payment ownership and money snapshots for the new accounting generation. Trusted settlement only; no raw callback bodies or tenant business content.';
REVOKE ALL ON billing_personal_payment_receipts FROM app_rw;
GRANT SELECT,INSERT ON billing_personal_payment_receipts TO app_rw;
GRANT UPDATE(manual_review,manual_reason) ON billing_personal_payment_receipts TO app_rw;
ALTER TABLE billing_personal_purchases ADD COLUMN IF NOT EXISTS payment_review_required boolean NOT NULL DEFAULT false;
GRANT UPDATE(payment_review_required) ON billing_personal_purchases TO app_rw;
