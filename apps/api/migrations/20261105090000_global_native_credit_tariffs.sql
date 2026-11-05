-- #6290: one retail price per model/unit for every personal and enterprise payer.
SET LOCAL row_security=off;
-- The rename is the transactional cutover marker. A replay must not reconsolidate
-- the compatibility view, overwrite operator prices, or append migration audit rows.
DO $cutover$
DECLARE conflicts jsonb;
BEGIN
 IF (SELECT relkind FROM pg_class WHERE oid = to_regclass('credit_native_tariffs')) IN ('r','p') THEN
LOCK TABLE credit_native_tariffs IN ACCESS EXCLUSIVE MODE;
-- Validate rational prices before selecting anything; differing metadata is not a price conflict.
 SELECT jsonb_agg(jsonb_build_object('provider',model_provider,'model',model_id,'unit',unit)) INTO conflicts
 FROM (SELECT model_provider,model_id,unit FROM credit_native_tariffs
       GROUP BY model_provider,model_id,unit
       HAVING count(DISTINCT (quantum/gcd(quantum,hundredths_per_quantum),hundredths_per_quantum/gcd(quantum,hundredths_per_quantum)))>1) different;
 IF conflicts IS NOT NULL THEN RAISE EXCEPTION 'global_native_tariff_price_conflicts: %',conflicts; END IF;

CREATE TABLE credit_global_native_tariffs (
 model_provider text NOT NULL,model_id text NOT NULL,unit text NOT NULL,
 quantum bigint NOT NULL CHECK(quantum>0),hundredths_per_quantum bigint NOT NULL CHECK(hundredths_per_quantum>0),
 version text NOT NULL CHECK(length(version)>0),pricing_basis jsonb NOT NULL DEFAULT '{"source":"operator"}'::jsonb,
 PRIMARY KEY(model_provider,model_id,unit)
);
CREATE TABLE credit_global_native_tariff_changes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),actor_id text NOT NULL CHECK(length(btrim(actor_id))>0),
 old_tariff jsonb,new_tariff jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER immutable_global_native_tariff_changes BEFORE UPDATE OR DELETE ON credit_global_native_tariff_changes
 FOR EACH ROW EXECUTE FUNCTION f159_token_usage_append_only();

INSERT INTO credit_global_native_tariffs(model_provider,model_id,unit,quantum,hundredths_per_quantum,version,pricing_basis)
 SELECT model_provider,model_id,unit,quantum/gcd(quantum,hundredths_per_quantum),hundredths_per_quantum/gcd(quantum,hundredths_per_quantum),
 'global-legacy-'||md5(model_provider||chr(31)||model_id||chr(31)||unit||chr(31)||(quantum/gcd(quantum,hundredths_per_quantum))::text||':'||(hundredths_per_quantum/gcd(quantum,hundredths_per_quantum))::text),
 jsonb_build_object('source','legacy-consolidation','legacyRowCount',count(*),'legacyVersionCount',count(DISTINCT version))
 FROM credit_native_tariffs GROUP BY model_provider,model_id,unit,quantum/gcd(quantum,hundredths_per_quantum),hundredths_per_quantum/gcd(quantum,hundredths_per_quantum);
INSERT INTO credit_global_native_tariff_changes(actor_id,old_tariff,new_tariff)
 SELECT 'migration:20261105090000_global_native_credit_tariffs',NULL,
 jsonb_build_object('modelProvider',model_provider,'modelId',model_id,'unit',unit,'quantum',quantum::text,'hundredthsPerQuantum',hundredths_per_quantum::text,'version',version,'pricingBasis',pricing_basis)
 FROM credit_global_native_tariffs;

ALTER TABLE credit_native_tariffs RENAME TO credit_native_tariffs_legacy;
 END IF;
END $cutover$;
REVOKE ALL ON credit_native_tariffs_legacy FROM PUBLIC,app_rw;
CREATE OR REPLACE VIEW credit_native_tariffs WITH(security_invoker=true,security_barrier=true) AS
 SELECT o.id AS org_id,t.model_provider,t.model_id,t.unit,t.quantum,t.hundredths_per_quantum,t.version
 FROM organizations o CROSS JOIN credit_global_native_tariffs t
 WHERE o.id=current_setting('app.current_org',true);
REVOKE ALL ON credit_native_tariffs FROM PUBLIC,app_rw;
GRANT SELECT ON credit_native_tariffs TO app_rw;
REVOKE INSERT,UPDATE,DELETE ON credit_native_tariffs FROM PUBLIC,app_rw;
REVOKE INSERT,UPDATE,DELETE ON credit_native_tariffs_legacy FROM PUBLIC,app_rw;
-- Follow the existing deployment-global consumption-settings writer pattern:
-- application authorization MUST establish authoritative platform operator status.
REVOKE ALL ON credit_global_native_tariffs,credit_global_native_tariff_changes FROM PUBLIC,app_rw;
GRANT SELECT,INSERT,UPDATE ON credit_global_native_tariffs TO app_rw;
GRANT SELECT,INSERT ON credit_global_native_tariff_changes TO app_rw;
REVOKE UPDATE,DELETE ON credit_global_native_tariff_changes FROM app_rw;
COMMENT ON TABLE credit_global_native_tariffs IS 'kernel-no-tenant-data: canonical deployment-global retail prices, no org overrides. Runtime SELECT only; operator service guards configuration mutations. Supplier geography is metadata, not automatic repricing.';
COMMENT ON TABLE credit_global_native_tariff_changes IS 'kernel-no-tenant-data: append-only global retail tariff audit. Writes require authoritative platform operator checks; no tenant content or credentials.';
COMMENT ON VIEW credit_native_tariffs IS 'Read-only compatibility projection of canonical global prices for the current tenant. No copied prices and no org overrides; legacy mutation endpoints fail closed.';

-- Freeze policies are named after their relation. The renamed legacy tenant table
-- must receive its final names on first install, just as on full historical replay.
SELECT kernel_apply_org_freeze_policies();
