-- Empty on migration. No existing quotas/plans are changed or activated.
CREATE TABLE IF NOT EXISTS ai_budget_windows (
 org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 user_id text NOT NULL, window_start timestamptz NOT NULL, window_end timestamptz NOT NULL,
 timezone text NOT NULL, token_limit bigint NULL CHECK(token_limit>=0),
 cost_limit_micros bigint NOT NULL CHECK(cost_limit_micros>=0),
 currency text NOT NULL, price_version text NOT NULL, configured_by text NOT NULL,
 PRIMARY KEY(org_id,user_id,window_start,window_end), CHECK(window_end>window_start)
);
CREATE TABLE IF NOT EXISTS ai_request_reservations (
 id text PRIMARY KEY, org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 user_id text NOT NULL, window_start timestamptz NOT NULL, window_end timestamptz NOT NULL,
 maximum_tokens bigint NOT NULL CHECK(maximum_tokens>=0), maximum_cost_micros bigint NOT NULL CHECK(maximum_cost_micros>=0),
 model_provider text NOT NULL, model_id text NOT NULL, currency text NOT NULL, price_version text NOT NULL,
 state text NOT NULL DEFAULT 'held' CHECK(state IN ('held','settled')),
 settled_tokens bigint NULL CHECK(settled_tokens>=0), settled_cost_micros bigint NULL CHECK(settled_cost_micros>=0),
 created_at timestamptz NOT NULL DEFAULT now(), settled_at timestamptz NULL,
 FOREIGN KEY(org_id,user_id,window_start,window_end) REFERENCES ai_budget_windows(org_id,user_id,window_start,window_end) ON DELETE CASCADE,
 CHECK(state='held' OR (settled_tokens IS NOT NULL AND settled_cost_micros IS NOT NULL))
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['ai_budget_windows','ai_request_reservations'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('DROP POLICY IF EXISTS tenant_scope ON %I',t);
  EXECUTE format('CREATE POLICY tenant_scope ON %I USING(org_id=current_setting(''app.current_org'',true)) WITH CHECK(org_id=current_setting(''app.current_org'',true))',t);
 END LOOP;
END $$;
-- Budget configuration has no runtime write grant yet: approved/audited configuration API remains a gate.
GRANT SELECT ON ai_budget_windows TO app_rw;
GRANT SELECT,INSERT,UPDATE ON ai_request_reservations TO app_rw;
SELECT kernel_apply_org_freeze_policies();

ALTER TABLE token_usage_events ADD COLUMN IF NOT EXISTS cost_micros bigint NULL CHECK(cost_micros>=0);
ALTER TABLE token_usage_events ADD COLUMN IF NOT EXISTS currency text NULL;
ALTER TABLE token_usage_events ADD COLUMN IF NOT EXISTS price_version text NULL;

CREATE OR REPLACE FUNCTION ai_reservation_settle_only() RETURNS trigger AS $$ BEGIN
 IF OLD.state='settled' OR NEW.state<>'settled' OR NEW.settled_at IS NULL
  OR (to_jsonb(NEW)-ARRAY['state','settled_tokens','settled_cost_micros','settled_at'])
    IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','settled_tokens','settled_cost_micros','settled_at']) THEN
  RAISE EXCEPTION 'AI reservation permits only one immutable settlement';
 END IF;
 RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS ai_reservation_settle_only ON ai_request_reservations;
CREATE TRIGGER ai_reservation_settle_only BEFORE UPDATE ON ai_request_reservations
 FOR EACH ROW EXECUTE FUNCTION ai_reservation_settle_only();

ALTER TABLE token_usage_events DROP CONSTRAINT IF EXISTS token_usage_price_complete;
ALTER TABLE token_usage_events ADD CONSTRAINT token_usage_price_complete CHECK (
 (cost_micros IS NULL AND currency IS NULL AND price_version IS NULL)
 OR (cost_micros IS NOT NULL AND currency IS NOT NULL AND length(currency)>0
     AND price_version IS NOT NULL AND length(price_version)>0)
);
