-- Durable quotes precede upstream requests; the dormant epoch remains unchanged.
CREATE TABLE IF NOT EXISTS billing_personal_purchases (
  purchase_ref text PRIMARY KEY CHECK(length(purchase_ref) BETWEEN 6 AND 32),
  user_id text NOT NULL CHECK(length(user_id)>0),
  idempotency_key text NOT NULL CHECK(length(idempotency_key) BETWEEN 16 AND 128),
  generation text NOT NULL CHECK(length(generation)>0),
  catalog_version text NOT NULL CHECK(length(catalog_version)>0),
  provider text NOT NULL CHECK(length(provider)>0),
  product jsonb NOT NULL CHECK(jsonb_typeof(product)='object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  session_ref text,
  payment_url text,
  expires_at timestamptz,
  fulfilled_at timestamptz,
  closed_at timestamptz,
  UNIQUE(user_id,idempotency_key),
  UNIQUE(provider,session_ref),
  CHECK((session_ref IS NULL AND payment_url IS NULL AND expires_at IS NULL)
     OR (session_ref IS NOT NULL AND payment_url IS NOT NULL AND expires_at IS NOT NULL
         AND length(session_ref)>0 AND length(payment_url)>0 AND expires_at>created_at))
);
CREATE UNIQUE INDEX IF NOT EXISTS billing_personal_purchase_open_pro ON billing_personal_purchases(user_id)
  WHERE product->>'kind'='subscription' AND fulfilled_at IS NULL AND closed_at IS NULL;
CREATE INDEX IF NOT EXISTS billing_personal_purchase_pending ON billing_personal_purchases(created_at,purchase_ref)
  WHERE fulfilled_at IS NULL AND closed_at IS NULL;
COMMENT ON TABLE billing_personal_purchases IS 'kernel-no-tenant-data: immutable owner-global personal purchase quotes and provider correlation. Authenticated reads always constrain user_id. No credentials or tenant business content.';
REVOKE ALL ON billing_personal_purchases FROM app_rw;
GRANT SELECT,INSERT ON billing_personal_purchases TO app_rw;
GRANT UPDATE(session_ref,payment_url,expires_at,fulfilled_at,closed_at) ON billing_personal_purchases TO app_rw;
