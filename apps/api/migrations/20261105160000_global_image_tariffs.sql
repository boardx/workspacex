CREATE FUNCTION valid_global_image_schedule(items jsonb,basis text) RETURNS boolean
LANGUAGE sql IMMUTABLE STRICT AS $$
 SELECT CASE WHEN jsonb_typeof(items)<>'array' THEN false ELSE
 jsonb_array_length(items)=3 AND
 (SELECT count(DISTINCT r->>'modelId')=3 AND bool_and(COALESCE(
 r->>'modelProvider'='bailian-image' AND r->>'unit'='image' AND r->>'currency'='CNY' AND r->>'quantum'='1'
 AND r->>'catalogVersion'=basis AND length(r->>'version') BETWEEN 1 AND 128
 AND (r->>'hundredthsPerQuantum') ~ '^[1-9][0-9]{0,17}$'
 AND CASE r->>'modelId' WHEN 'z-image-turbo' THEN r->>'customerAmountMinor'='25'
 WHEN 'qwen-image-3.0' THEN r->>'customerAmountMinor'='50'
 WHEN 'qwen-image-3.0-pro' THEN r->>'customerAmountMinor'='100' ELSE false END
 AND jsonb_typeof(r)='object'
 AND (SELECT count(*)=9 AND bool_and(jsonb_typeof(value)='string') FROM jsonb_each(r))
 AND r ?& ARRAY['modelProvider','modelId','unit','currency','quantum','catalogVersion','version','hundredthsPerQuantum','customerAmountMinor']
 ,false)) FROM jsonb_array_elements(items) r) END
$$;
-- Platform schedule is global; tenant reservations may read it, never mutate it.
CREATE TABLE credit_global_image_schedule (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 revision text NOT NULL CHECK(length(revision) BETWEEN 1 AND 128),
 catalog_version text NOT NULL CHECK(length(catalog_version) BETWEEN 1 AND 128),
 schedule jsonb NOT NULL CHECK(valid_global_image_schedule(schedule,catalog_version) IS TRUE)
);
CREATE TABLE credit_global_image_tariff_changes (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 actor_id text NOT NULL, old_schedule jsonb, new_schedule jsonb NOT NULL, supersession jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON credit_global_image_schedule,credit_global_image_tariff_changes FROM PUBLIC;
GRANT SELECT ON credit_global_image_schedule TO app_rw;
-- Writes must be wired through the existing separately privileged platform boundary.
-- No app_rw write grant or SECURITY DEFINER escape is introduced.
CREATE TRIGGER immutable_credit_global_image_tariff_changes BEFORE UPDATE OR DELETE ON credit_global_image_tariff_changes FOR EACH ROW EXECUTE FUNCTION f159_token_usage_append_only();

DO $$ BEGIN
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='app_billing_tariff_writer') THEN
  CREATE ROLE app_billing_tariff_writer NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
 END IF;
END $$;
GRANT SELECT,INSERT,UPDATE ON credit_global_image_schedule TO app_billing_tariff_writer;
GRANT SELECT,INSERT ON credit_global_image_tariff_changes TO app_billing_tariff_writer;
GRANT USAGE,SELECT ON SEQUENCE credit_global_image_tariff_changes_id_seq TO app_billing_tariff_writer;
GRANT SELECT ON credit_packages TO app_billing_tariff_writer;
