-- Exact financial precision; existing order/package integer snapshots stay untouched.
ALTER TABLE credit_wallets DROP CONSTRAINT IF EXISTS credit_wallets_balance_check;
ALTER TABLE credit_wallets ALTER COLUMN balance TYPE numeric(12,2);
ALTER TABLE credit_wallets DROP CONSTRAINT IF EXISTS credit_wallets_balance_bounds;
ALTER TABLE credit_wallets ADD CONSTRAINT credit_wallets_balance_bounds CHECK (balance BETWEEN -2147483647 AND 2147483647);
ALTER TABLE credit_transactions DROP CONSTRAINT IF EXISTS credit_transactions_balance_after_check;
ALTER TABLE credit_transactions ALTER COLUMN balance_after TYPE numeric(12,2);
ALTER TABLE credit_transactions ALTER COLUMN credits TYPE numeric(12,2);
ALTER TABLE credit_transactions DROP CONSTRAINT IF EXISTS credit_transactions_type_check;
ALTER TABLE credit_transactions ADD CONSTRAINT credit_transactions_type_check CHECK(type IN ('purchase','bonus','grant','consume'));
ALTER TABLE credit_transactions DROP CONSTRAINT IF EXISTS credit_transactions_source_type_check;
ALTER TABLE credit_transactions ADD CONSTRAINT credit_transactions_source_type_check CHECK(source_type IN ('payment_order','admin_grant','model_request'));
ALTER TABLE credit_transactions DROP CONSTRAINT IF EXISTS credit_transactions_consume_check;
ALTER TABLE credit_transactions ADD CONSTRAINT credit_transactions_consume_check CHECK(type <> 'consume' OR (direction=-1 AND source_type='model_request'));
ALTER TABLE credit_transactions DROP CONSTRAINT IF EXISTS credit_transactions_balance_bounds;
ALTER TABLE credit_transactions ADD CONSTRAINT credit_transactions_balance_bounds CHECK(balance_after BETWEEN -2147483647 AND 2147483647);
CREATE TABLE IF NOT EXISTS credit_consumption_requests (
 request_id text PRIMARY KEY, org_id text NOT NULL,
 user_id text NOT NULL, wallet_id uuid NOT NULL REFERENCES credit_wallets(wallet_id),
 model_provider text NOT NULL, model_id text NOT NULL, run_id text,
 start_facts jsonb NOT NULL, reserved_hundredths bigint NOT NULL CHECK(reserved_hundredths>=0),
 tariff_version text NOT NULL, native_unit text, native_quantum bigint, native_rate bigint,
 state text NOT NULL DEFAULT 'reserved' CHECK(state IN ('reserved','pending','settled')),
 usage_facts jsonb, debited_hundredths bigint CHECK(debited_hundredths>=0),
 created_at timestamptz NOT NULL DEFAULT now(), settled_at timestamptz
);
CREATE INDEX IF NOT EXISTS credit_consumption_wallet_holds ON credit_consumption_requests(wallet_id) WHERE state<>'settled';
CREATE TABLE IF NOT EXISTS credit_native_tariffs (
 org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, model_provider text NOT NULL, model_id text NOT NULL, unit text NOT NULL,
 quantum bigint NOT NULL CHECK(quantum>0), hundredths_per_quantum bigint NOT NULL CHECK(hundredths_per_quantum>0),
 version text NOT NULL CHECK(length(version)>0), PRIMARY KEY(org_id,model_provider,model_id,unit)
);
ALTER TABLE credit_consumption_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_consumption_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS credit_consumption_requests_tenant ON credit_consumption_requests;
CREATE POLICY credit_consumption_requests_tenant ON credit_consumption_requests USING(org_id=current_setting('app.current_org',true)) WITH CHECK(org_id=current_setting('app.current_org',true));
ALTER TABLE credit_native_tariffs ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_native_tariffs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS credit_native_tariffs_tenant ON credit_native_tariffs;
CREATE POLICY credit_native_tariffs_tenant ON credit_native_tariffs USING(org_id=current_setting('app.current_org',true)) WITH CHECK(org_id=current_setting('app.current_org',true));
GRANT SELECT,INSERT,UPDATE ON credit_consumption_requests,credit_native_tariffs TO app_rw;
-- Wallet aggregate serializes cross-workspace personal holds without bypassing tenant RLS.
ALTER TABLE credit_wallets ADD COLUMN IF NOT EXISTS held_hundredths bigint NOT NULL DEFAULT 0 CHECK(held_hundredths>=0);

-- Aggregate unresolved unbounded admissions across all workspaces sharing a wallet.
ALTER TABLE credit_wallets ADD COLUMN IF NOT EXISTS unbounded_requests bigint NOT NULL DEFAULT 0 CHECK(unbounded_requests>=0);
