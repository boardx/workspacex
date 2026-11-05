-- #6290: one retail price per model/unit for every personal and enterprise payer.
SET LOCAL row_security=off;
LOCK TABLE credit_native_tariffs IN ACCESS EXCLUSIVE MODE;
DO $dependency$ BEGIN
 IF to_regclass('credit_global_image_schedule') IS NULL OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='app_billing_tariff_writer') THEN RAISE EXCEPTION 'global_native_requires_global_image_1600'; END IF;
END $dependency$;
-- Validate rational prices before selecting anything; differing metadata is not a price conflict.
-- Canonical structure/permission validation is shared by repeat application and
-- the one exact historical force-replay adapter. It never reads tenant price data.
CREATE OR REPLACE FUNCTION kernel_native_tariff_cutover_complete(target_schema text DEFAULT current_schema()) RETURNS boolean
LANGUAGE plpgsql AS $validate$
DECLARE ns oid; old_oid oid; legacy_oid oid; global_oid oid; audit_oid oid;
BEGIN
 ns:=to_regnamespace(target_schema);
 SELECT oid INTO old_oid FROM pg_class WHERE relnamespace=ns AND relname='credit_native_tariffs';
 SELECT oid INTO legacy_oid FROM pg_class WHERE relnamespace=ns AND relname='credit_native_tariffs_legacy';
 SELECT oid INTO global_oid FROM pg_class WHERE relnamespace=ns AND relname='credit_global_native_tariffs';
 SELECT oid INTO audit_oid FROM pg_class WHERE relnamespace=ns AND relname='credit_global_native_tariff_changes';
 IF legacy_oid IS NULL AND global_oid IS NULL AND audit_oid IS NULL AND (SELECT relkind FROM pg_class WHERE oid=old_oid)='r' THEN RETURN false; END IF;
 IF old_oid IS NULL OR legacy_oid IS NULL OR global_oid IS NULL OR audit_oid IS NULL THEN RAISE EXCEPTION 'global_native_tariff_cutover_incomplete'; END IF;
 IF (SELECT relkind FROM pg_class WHERE oid=old_oid)<>'v' OR EXISTS(SELECT 1 FROM pg_class WHERE oid=ANY(ARRAY[legacy_oid,global_oid,audit_oid]) AND relkind<>'r') THEN RAISE EXCEPTION 'global_native_tariff_cutover_invalid_relations'; END IF;
 IF EXISTS(SELECT * FROM (VALUES('model_provider','text'),('model_id','text'),('unit','text'),('quantum','bigint'),('hundredths_per_quantum','bigint'),('version','text'),('pricing_basis','jsonb')) AS expected(name,type)
  EXCEPT SELECT attname,format_type(atttypid,atttypmod) FROM pg_attribute WHERE attrelid=global_oid AND attnum>0 AND NOT attisdropped) THEN RAISE EXCEPTION 'global_native_tariff_cutover_invalid_columns'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint c WHERE c.conrelid=global_oid AND c.contype='p' AND (SELECT array_agg(a.attname::text ORDER BY k.ordinality) FROM unnest(c.conkey) WITH ORDINALITY k(attnum,ordinality) JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum)=ARRAY['model_provider','model_id','unit']) THEN RAISE EXCEPTION 'global_native_tariff_cutover_invalid_key'; END IF;
 IF EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=global_oid AND attname=ANY(ARRAY['quantum','hundredths_per_quantum','version']) AND NOT attnotnull) THEN RAISE EXCEPTION 'global_native_tariff_cutover_invalid_nullability'; END IF;
 IF EXISTS(SELECT * FROM (VALUES('CHECK ((quantum > 0))'),('CHECK ((hundredths_per_quantum > 0))'),('CHECK ((length(version) > 0))')) expected(definition)
  EXCEPT SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid=global_oid AND contype='c' AND convalidated) THEN RAISE EXCEPTION 'global_native_tariff_cutover_invalid_rate_constraints'; END IF;
 IF NOT (SELECT coalesce(reloptions,'{}')@>ARRAY['security_invoker=true','security_barrier=true'] FROM pg_class WHERE oid=old_oid) THEN RAISE EXCEPTION 'global_native_tariff_cutover_invalid_view_options'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid=global_oid AND conname='global_native_excludes_image_provider' AND contype='c' AND convalidated AND pg_get_constraintdef(oid)='CHECK ((model_provider <> ''bailian-image''::text))') THEN RAISE EXCEPTION 'global_native_tariff_image_exclusion_missing'; END IF;
 -- Fingerprint is installed together with the canonical dual-source view. Any
 -- changed projection/filter must fail replay, even when all table names remain.
 IF obj_description(old_oid,'pg_class') IS DISTINCT FROM 'native-tariff-union-v1:'||md5(pg_get_viewdef(old_oid,true)) THEN RAISE EXCEPTION 'global_native_tariff_cutover_invalid_view'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_depend d JOIN pg_rewrite r ON r.oid=d.objid WHERE r.ev_class=old_oid AND d.refobjid=to_regclass('credit_global_image_schedule')) THEN RAISE EXCEPTION 'global_native_tariff_cutover_missing_image_source'; END IF;
 IF has_table_privilege('app_rw',legacy_oid,'SELECT,INSERT,UPDATE,DELETE') OR has_table_privilege('app_rw',old_oid,'INSERT,UPDATE,DELETE') OR NOT has_table_privilege('app_rw',old_oid,'SELECT')
  OR NOT has_table_privilege('app_rw',global_oid,'SELECT') OR has_table_privilege('app_rw',global_oid,'INSERT,UPDATE,DELETE')
  OR NOT has_table_privilege('app_rw',audit_oid,'SELECT') OR has_table_privilege('app_rw',audit_oid,'INSERT,UPDATE,DELETE')
  OR NOT has_table_privilege('app_billing_tariff_writer',global_oid,'SELECT') OR NOT has_table_privilege('app_billing_tariff_writer',global_oid,'INSERT') OR NOT has_table_privilege('app_billing_tariff_writer',global_oid,'UPDATE') OR has_table_privilege('app_billing_tariff_writer',global_oid,'DELETE')
  OR NOT has_table_privilege('app_billing_tariff_writer',audit_oid,'INSERT') OR has_table_privilege('app_billing_tariff_writer',audit_oid,'UPDATE,DELETE') THEN RAISE EXCEPTION 'global_native_tariff_cutover_invalid_permissions'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=audit_oid AND tgname='immutable_global_native_tariff_changes' AND tgenabled IN ('O','A') AND tgfoid='f159_token_usage_append_only()'::regprocedure) THEN RAISE EXCEPTION 'global_native_tariff_cutover_invalid_audit_trigger'; END IF;
 RETURN true;
END $validate$;
REVOKE ALL ON FUNCTION kernel_native_tariff_cutover_complete(text) FROM PUBLIC;
DO $cutover$
DECLARE conflicts jsonb;
BEGIN
 IF kernel_native_tariff_cutover_complete() THEN RETURN; END IF;

 SELECT jsonb_agg(jsonb_build_object('provider',model_provider,'model',model_id,'unit',unit)) INTO conflicts
 FROM (SELECT model_provider,model_id,unit FROM credit_native_tariffs WHERE model_provider<>'bailian-image'
       GROUP BY model_provider,model_id,unit
       HAVING count(DISTINCT (quantum/gcd(quantum,hundredths_per_quantum),hundredths_per_quantum/gcd(quantum,hundredths_per_quantum)))>1) different;
 IF conflicts IS NOT NULL THEN RAISE EXCEPTION 'global_native_tariff_price_conflicts: %',conflicts; END IF;


CREATE TABLE credit_global_native_tariffs (
 model_provider text NOT NULL CONSTRAINT global_native_excludes_image_provider CHECK(model_provider<>'bailian-image'),model_id text NOT NULL,unit text NOT NULL,
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
 FROM credit_native_tariffs WHERE model_provider<>'bailian-image' GROUP BY model_provider,model_id,unit,quantum/gcd(quantum,hundredths_per_quantum),hundredths_per_quantum/gcd(quantum,hundredths_per_quantum);
INSERT INTO credit_global_native_tariff_changes(actor_id,old_tariff,new_tariff)
 SELECT 'migration:20261105170000_global_native_credit_tariffs',NULL,
 jsonb_build_object('modelProvider',model_provider,'modelId',model_id,'unit',unit,'quantum',quantum::text,'hundredthsPerQuantum',hundredths_per_quantum::text,'version',version,'pricingBasis',pricing_basis)
 FROM credit_global_native_tariffs;

ALTER TABLE credit_native_tariffs RENAME TO credit_native_tariffs_legacy;
REVOKE ALL ON credit_native_tariffs_legacy FROM PUBLIC,app_rw;
CREATE VIEW credit_native_tariffs WITH(security_invoker=true,security_barrier=true) AS
 SELECT o.id AS org_id,t.model_provider,t.model_id,t.unit,t.quantum,t.hundredths_per_quantum,t.version
 FROM organizations o CROSS JOIN credit_global_native_tariffs t
 WHERE o.id=current_setting('app.current_org',true)
 UNION ALL
 SELECT o.id AS org_id,r.value->>'modelProvider',r.value->>'modelId',r.value->>'unit',
 (r.value->>'quantum')::bigint,(r.value->>'hundredthsPerQuantum')::bigint,r.value->>'version'
 FROM organizations o CROSS JOIN credit_global_image_schedule i CROSS JOIN LATERAL jsonb_array_elements(i.schedule) r(value)
 WHERE o.id=current_setting('app.current_org',true) AND i.singleton=true;
EXECUTE format('COMMENT ON VIEW credit_native_tariffs IS %L','native-tariff-union-v1:'||md5(pg_get_viewdef('credit_native_tariffs'::regclass,true)));
REVOKE ALL ON credit_native_tariffs FROM PUBLIC,app_rw;
GRANT SELECT ON credit_native_tariffs TO app_rw;
REVOKE INSERT,UPDATE,DELETE ON credit_native_tariffs FROM PUBLIC,app_rw;
REVOKE INSERT,UPDATE,DELETE ON credit_native_tariffs_legacy FROM PUBLIC,app_rw;
-- Reuse the separately credentialed #6268 writer; app_rw is always read-only.
-- Platform authorization precedes writer use; no tenant receives writer credentials.
REVOKE ALL ON credit_global_native_tariffs,credit_global_native_tariff_changes FROM PUBLIC,app_rw;
GRANT SELECT ON credit_global_native_tariffs TO app_rw;
GRANT SELECT,INSERT,UPDATE ON credit_global_native_tariffs TO app_billing_tariff_writer;
GRANT SELECT ON credit_global_native_tariff_changes TO app_rw;
GRANT SELECT,INSERT ON credit_global_native_tariff_changes TO app_billing_tariff_writer;
REVOKE UPDATE,DELETE ON credit_global_native_tariff_changes FROM app_rw;
COMMENT ON TABLE credit_global_native_tariffs IS 'kernel-no-tenant-data: canonical deployment-global retail prices, no org overrides. Runtime SELECT only; operator service guards configuration mutations. Supplier geography is metadata, not automatic repricing.';
COMMENT ON TABLE credit_global_native_tariff_changes IS 'kernel-no-tenant-data: append-only global retail tariff audit. Writes require authoritative platform operator checks; no tenant content or credentials.';
-- View fingerprint above is part of the cutover validator; do not overwrite it.

 -- The shared installer keys policy names by current table name. Install the
 -- renamed relation's guards now rather than only during a later full replay.
 DROP POLICY IF EXISTS credit_native_tariffs_org_frozen_ins ON credit_native_tariffs_legacy;
 DROP POLICY IF EXISTS credit_native_tariffs_org_frozen_upd ON credit_native_tariffs_legacy;
 DROP POLICY IF EXISTS credit_native_tariffs_org_frozen_del ON credit_native_tariffs_legacy;
 PERFORM kernel_apply_org_freeze_policies();
 PERFORM kernel_native_tariff_cutover_complete();
END $cutover$;
