-- Personal survey aggregate. Every access is tenant-scoped; owner enforced before disclosure.
CREATE TABLE IF NOT EXISTS survey_workspaces (
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  id text NOT NULL,
  owner_id text NOT NULL,
  document jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(org_id,id),
  CHECK(document->>'ownerId'=owner_id),
  CHECK(document->'model'->>'id'=id)
);
CREATE INDEX IF NOT EXISTS survey_workspaces_owner ON survey_workspaces(org_id,owner_id,updated_at DESC);
ALTER TABLE survey_workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE survey_workspaces FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS survey_workspaces_tenant ON survey_workspaces;
CREATE POLICY survey_workspaces_tenant ON survey_workspaces
  USING(org_id=current_setting('app.current_org',true))
  WITH CHECK(org_id=current_setting('app.current_org',true));

GRANT SELECT, INSERT, UPDATE, DELETE ON survey_workspaces TO app_rw;

-- Install canonical org-disabled write restrictions on the first apply too.
-- The earlier catalog migration cannot see this table until forced replay.
SELECT kernel_apply_org_freeze_policies();
