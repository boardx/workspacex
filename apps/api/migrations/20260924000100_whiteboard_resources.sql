-- Private-by-default whiteboards. RLS scopes tenants; every repository operation scopes actors.
CREATE TABLE IF NOT EXISTS whiteboards (
  id uuid PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  owner_id text NOT NULL,
  request_id uuid NOT NULL,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, owner_id, request_id),
  UNIQUE (org_id, id)
);
CREATE TABLE IF NOT EXISTS whiteboard_members (
  org_id text NOT NULL,
  board_id uuid NOT NULL,
  user_id text NOT NULL,
  role text NOT NULL CHECK (role IN ('editor', 'viewer')),
  PRIMARY KEY (org_id, board_id, user_id),
  FOREIGN KEY (org_id, board_id) REFERENCES whiteboards(org_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS whiteboard_members_actor ON whiteboard_members(org_id, user_id);
ALTER TABLE whiteboards ENABLE ROW LEVEL SECURITY;
ALTER TABLE whiteboards FORCE ROW LEVEL SECURITY;
ALTER TABLE whiteboard_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE whiteboard_members FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS whiteboards_tenant ON whiteboards;
CREATE POLICY whiteboards_tenant ON whiteboards USING (org_id = current_setting('app.current_org', true)) WITH CHECK (org_id = current_setting('app.current_org', true));
DROP POLICY IF EXISTS whiteboard_members_tenant ON whiteboard_members;
CREATE POLICY whiteboard_members_tenant ON whiteboard_members USING (org_id = current_setting('app.current_org', true)) WITH CHECK (org_id = current_setting('app.current_org', true));
REVOKE ALL ON whiteboards, whiteboard_members FROM app_rw;
GRANT SELECT, INSERT, UPDATE, DELETE ON whiteboards, whiteboard_members TO app_rw;
SELECT kernel_apply_org_freeze_policies();
