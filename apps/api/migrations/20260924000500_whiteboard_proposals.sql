CREATE TABLE whiteboard_proposals (
  org_id text NOT NULL, board_id uuid NOT NULL, id uuid NOT NULL,
  submitted_by text NOT NULL, request_id uuid NOT NULL, request_hash text NOT NULL CHECK(length(request_hash)=64),
  title text NOT NULL, generator_label text,
  base_epoch integer NOT NULL CHECK(base_epoch>0), base_seq bigint NOT NULL CHECK(base_seq BETWEEN 0 AND 9007199254740991),
  commands jsonb NOT NULL CHECK(jsonb_typeof(commands)='array'),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','applied','rejected','conflicted')),
  decided_by text, decision_request_id uuid, decision_action text CHECK(decision_action IN('accept','reject')),
  committed_epoch integer, committed_seq bigint, created_at timestamptz NOT NULL DEFAULT now(), decided_at timestamptz,
  PRIMARY KEY(org_id,board_id,id), UNIQUE(org_id,board_id,submitted_by,request_id),
  FOREIGN KEY(org_id,board_id) REFERENCES whiteboards(org_id,id) ON DELETE CASCADE,
  CHECK((status='pending' AND decided_by IS NULL AND decided_at IS NULL AND decision_request_id IS NULL AND decision_action IS NULL)
    OR (status<>'pending' AND decided_by IS NOT NULL AND decided_at IS NOT NULL AND decision_request_id IS NOT NULL AND decision_action IS NOT NULL)),
  CHECK((status='applied' AND committed_epoch IS NOT NULL AND committed_seq IS NOT NULL AND committed_epoch>0 AND committed_seq>0) OR (status<>'applied' AND committed_epoch IS NULL AND committed_seq IS NULL))
);
ALTER TABLE whiteboard_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE whiteboard_proposals FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant ON whiteboard_proposals USING(org_id=current_setting('app.current_org',true)) WITH CHECK(org_id=current_setting('app.current_org',true));
REVOKE ALL ON whiteboard_proposals FROM app_rw;
GRANT SELECT,INSERT,UPDATE ON whiteboard_proposals TO app_rw;
SELECT kernel_apply_org_freeze_policies();
