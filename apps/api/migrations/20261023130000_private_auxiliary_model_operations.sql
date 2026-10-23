ALTER TABLE model_request_starts ADD CONSTRAINT model_request_starts_id_org_auxiliary_unique UNIQUE(id,org_id);
-- Private trial/model operations have no Chat/run rows. Store metadata authority only.
CREATE TABLE auxiliary_model_operations(
 id uuid PRIMARY KEY,
 org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 user_id text NOT NULL,
 model_provider text NOT NULL,
 model_id text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 active_until timestamptz NOT NULL DEFAULT now()+interval '15 minutes',
 closed_at timestamptz,
 UNIQUE(id,org_id)
);
CREATE TABLE auxiliary_model_requests(
 request_id text PRIMARY KEY,
 org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 operation_id uuid NOT NULL,
 model_id text NOT NULL,
 model_provider text NOT NULL,
 body_hash text NOT NULL,
 output_cap integer NOT NULL,
 started_at timestamptz NOT NULL,
 FOREIGN KEY(operation_id,org_id) REFERENCES auxiliary_model_operations(id,org_id) ON DELETE CASCADE,
 FOREIGN KEY(request_id,org_id) REFERENCES model_request_starts(id,org_id) ON DELETE CASCADE
);
ALTER TABLE auxiliary_model_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE auxiliary_model_operations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON auxiliary_model_operations USING(org_id=current_setting('app.current_org',true)) WITH CHECK(org_id=current_setting('app.current_org',true));
ALTER TABLE auxiliary_model_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE auxiliary_model_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON auxiliary_model_requests USING(org_id=current_setting('app.current_org',true)) WITH CHECK(org_id=current_setting('app.current_org',true));
GRANT SELECT,INSERT,UPDATE(closed_at) ON auxiliary_model_operations TO app_rw;
GRANT SELECT,INSERT ON auxiliary_model_requests TO app_rw;


SELECT kernel_apply_org_freeze_policies();
