CREATE UNIQUE INDEX IF NOT EXISTS credit_consumption_request_tenant_identity ON credit_consumption_requests(request_id,org_id);
CREATE TABLE IF NOT EXISTS credit_consumption_receipts (
  request_id text NOT NULL,
  org_id text NOT NULL,
  receipt_id text NOT NULL CHECK(length(receipt_id) BETWEEN 1 AND 200),
  terminal boolean NOT NULL,
  usage_facts jsonb NOT NULL,
  debited_hundredths bigint NOT NULL CHECK(debited_hundredths>=0),
  transaction_source_id text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(request_id,receipt_id),
  FOREIGN KEY(request_id,org_id) REFERENCES credit_consumption_requests(request_id,org_id) ON DELETE CASCADE
);
ALTER TABLE credit_consumption_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_consumption_receipts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS credit_consumption_receipts_tenant ON credit_consumption_receipts;
CREATE POLICY credit_consumption_receipts_tenant ON credit_consumption_receipts
  USING(org_id=current_setting('app.current_org',true)) WITH CHECK(org_id=current_setting('app.current_org',true));
REVOKE ALL ON credit_consumption_receipts FROM app_rw;
GRANT SELECT,INSERT ON credit_consumption_receipts TO app_rw;
