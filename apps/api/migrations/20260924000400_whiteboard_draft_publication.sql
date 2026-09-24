-- Random revisions avoid ABA when a published/deleted draft is recreated.
ALTER TABLE whiteboard_private_drafts ADD COLUMN IF NOT EXISTS revision uuid NOT NULL DEFAULT gen_random_uuid();
CREATE TABLE IF NOT EXISTS whiteboard_draft_publications (
  org_id text NOT NULL, board_id uuid NOT NULL, user_id text NOT NULL, request_id uuid NOT NULL,
  request_hash text NOT NULL CHECK(length(request_hash)=64), object_id text NOT NULL,
  epoch integer NOT NULL CHECK(epoch>0), seq bigint NOT NULL CHECK(seq BETWEEN 1 AND 9007199254740991),
  PRIMARY KEY(org_id,board_id,user_id,request_id),
  FOREIGN KEY(org_id,board_id) REFERENCES whiteboards(org_id,id) ON DELETE CASCADE
);
ALTER TABLE whiteboard_draft_publications ENABLE ROW LEVEL SECURITY;
ALTER TABLE whiteboard_draft_publications FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant ON whiteboard_draft_publications;
CREATE POLICY tenant ON whiteboard_draft_publications USING(org_id=current_setting('app.current_org',true)) WITH CHECK(org_id=current_setting('app.current_org',true));
REVOKE ALL ON whiteboard_draft_publications FROM app_rw;
GRANT SELECT, INSERT ON whiteboard_draft_publications TO app_rw;
SELECT kernel_apply_org_freeze_policies();
