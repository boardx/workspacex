CREATE TABLE IF NOT EXISTS whiteboard_file_assets (
  org_id text NOT NULL,
  board_id uuid NOT NULL,
  asset_id text NOT NULL CHECK(asset_id ~ '^board-file-[a-f0-9]{64}$'),
  object_key text NOT NULL,
  metadata jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(org_id,board_id,asset_id),
  FOREIGN KEY(org_id,board_id,object_key) REFERENCES whiteboard_asset_refs(org_id,board_id,object_key) ON DELETE CASCADE
);
ALTER TABLE whiteboard_file_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE whiteboard_file_assets FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON whiteboard_file_assets;
CREATE POLICY tenant_isolation ON whiteboard_file_assets
  USING(org_id=current_setting('app.current_org',true))
  WITH CHECK(org_id=current_setting('app.current_org',true));
GRANT SELECT,INSERT,UPDATE,DELETE ON whiteboard_file_assets TO app_rw;
SELECT kernel_apply_org_freeze_policies();
