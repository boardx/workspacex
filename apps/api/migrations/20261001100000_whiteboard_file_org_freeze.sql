-- The shared freeze installer discovers only single-column org_id foreign keys.
-- The composite asset-root FK protects lifecycle identity but is not discoverable.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='whiteboard_file_assets'::regclass AND conname='whiteboard_file_assets_org_fk') THEN
    ALTER TABLE whiteboard_file_assets
      ADD CONSTRAINT whiteboard_file_assets_org_fk
      FOREIGN KEY(org_id) REFERENCES organizations(id) ON DELETE CASCADE;
  END IF;
END $$;
SELECT kernel_apply_org_freeze_policies();
