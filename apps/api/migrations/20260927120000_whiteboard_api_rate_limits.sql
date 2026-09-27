CREATE TABLE IF NOT EXISTS whiteboard_api_rate_limits(org_id text NOT NULL,board_id uuid NOT NULL,principal_id text NOT NULL,window_started timestamptz NOT NULL,count integer NOT NULL CHECK(count>0),PRIMARY KEY(org_id,board_id,principal_id));
ALTER TABLE whiteboard_api_rate_limits ENABLE ROW LEVEL SECURITY;ALTER TABLE whiteboard_api_rate_limits FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS whiteboard_api_rate_limits_org ON whiteboard_api_rate_limits;
CREATE POLICY whiteboard_api_rate_limits_org ON whiteboard_api_rate_limits USING(org_id=current_setting('app.current_org',true)) WITH CHECK(org_id=current_setting('app.current_org',true));
REVOKE ALL ON whiteboard_api_rate_limits FROM app_rw;
GRANT SELECT,INSERT,UPDATE ON whiteboard_api_rate_limits TO app_rw;
SELECT kernel_apply_org_freeze_policies();
