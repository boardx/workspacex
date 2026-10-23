-- One deployment-wide preflight switch. Accounting does not depend on this flag.
CREATE TABLE IF NOT EXISTS credit_consumption_settings (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 credit_preflight_enabled boolean NOT NULL DEFAULT false,
 updated_by text,
 updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO credit_consumption_settings(singleton) VALUES(true) ON CONFLICT(singleton) DO NOTHING;
CREATE TABLE IF NOT EXISTS credit_consumption_setting_changes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 actor_id text NOT NULL CHECK(length(btrim(actor_id))>0),
 old_enabled boolean NOT NULL,
 new_enabled boolean NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT,UPDATE ON credit_consumption_settings TO app_rw;
GRANT SELECT,INSERT ON credit_consumption_setting_changes TO app_rw;
DROP TRIGGER IF EXISTS credit_consumption_setting_changes_immutable ON credit_consumption_setting_changes;
CREATE TRIGGER credit_consumption_setting_changes_immutable BEFORE UPDATE OR DELETE ON credit_consumption_setting_changes
 FOR EACH ROW EXECUTE FUNCTION f159_token_usage_append_only();
