-- #6290: one retail price per model/unit for every personal and enterprise payer.
-- Previous org-scoped tariffs contain disposable test data. Operators configure
-- approved global retail prices after this migration; there is no legacy read path.
CREATE TABLE IF NOT EXISTS credit_global_native_tariffs (
 model_provider text NOT NULL,model_id text NOT NULL,unit text NOT NULL,
 quantum bigint NOT NULL CHECK(quantum>0),hundredths_per_quantum bigint NOT NULL CHECK(hundredths_per_quantum>0),
 version text NOT NULL CHECK(length(version)>0),pricing_basis jsonb NOT NULL DEFAULT '{"source":"operator"}'::jsonb,
 PRIMARY KEY(model_provider,model_id,unit)
);
CREATE TABLE IF NOT EXISTS credit_global_native_tariff_changes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),actor_id text NOT NULL CHECK(length(btrim(actor_id))>0),
 old_tariff jsonb,new_tariff jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS immutable_global_native_tariff_changes ON credit_global_native_tariff_changes;
CREATE TRIGGER immutable_global_native_tariff_changes BEFORE UPDATE OR DELETE ON credit_global_native_tariff_changes
 FOR EACH ROW EXECUTE FUNCTION f159_token_usage_append_only();

-- Historical forced replay recreates these tables. Remove them every time while
-- leaving existing canonical prices and their immutable audit rows untouched.
DROP TABLE IF EXISTS credit_native_tariffs;
DROP TABLE IF EXISTS credit_native_tariff_changes;
-- Follow the existing deployment-global consumption-settings writer pattern:
-- application authorization MUST establish authoritative platform operator status.
REVOKE ALL ON credit_global_native_tariffs,credit_global_native_tariff_changes FROM PUBLIC,app_rw;
GRANT SELECT,INSERT,UPDATE ON credit_global_native_tariffs TO app_rw;
GRANT SELECT,INSERT ON credit_global_native_tariff_changes TO app_rw;
REVOKE UPDATE,DELETE ON credit_global_native_tariff_changes FROM app_rw;
COMMENT ON TABLE credit_global_native_tariffs IS 'kernel-no-tenant-data: canonical deployment-global retail prices, no org overrides. Runtime SELECT only; operator service guards configuration mutations. Supplier geography is metadata, not automatic repricing.';
COMMENT ON TABLE credit_global_native_tariff_changes IS 'kernel-no-tenant-data: append-only global retail tariff audit. Writes require authoritative platform operator checks; no tenant content or credentials.';
