-- Image bytes remain in the existing immutable ObjectStore. These rows only
-- resolve opaque board-scoped handles to roots governed by whiteboard asset GC.
CREATE TABLE whiteboard_image_assets (
  org_id text NOT NULL,
  board_id uuid NOT NULL,
  asset_id text NOT NULL CHECK(asset_id ~ '^board-image-[a-f0-9]{64}$'),
  object_key text NOT NULL,
  metadata jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(org_id,board_id,asset_id),
  FOREIGN KEY(org_id,board_id,object_key) REFERENCES whiteboard_asset_refs(org_id,board_id,object_key) ON DELETE CASCADE
);
ALTER TABLE whiteboard_image_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE whiteboard_image_assets FORCE ROW LEVEL SECURITY;
CREATE POLICY whiteboard_image_assets_org ON whiteboard_image_assets
  USING(org_id=current_setting('app.current_org',true)) WITH CHECK(org_id=current_setting('app.current_org',true));
REVOKE ALL ON whiteboard_image_assets FROM app_rw;
GRANT SELECT,INSERT ON whiteboard_image_assets TO app_rw;
SELECT kernel_apply_org_freeze_policies();
