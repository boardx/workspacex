CREATE TABLE IF NOT EXISTS whiteboard_proposals (
  org_id text NOT NULL, board_id uuid NOT NULL, id uuid NOT NULL,
  submitted_by text NOT NULL, request_id uuid NOT NULL, request_hash text NOT NULL CHECK(length(request_hash)=64),
  title text NOT NULL, generator_label text,
  source_kind text NOT NULL DEFAULT 'human-api' CHECK(source_kind IN('human-api','agent')),
  actor_id text NOT NULL DEFAULT '', agent_id text, agent_name text, agent_version_id text, run_id text,
  model_provider text, model_id text, model_version text,
  base_epoch integer NOT NULL CHECK(base_epoch>0), base_seq bigint NOT NULL CHECK(base_seq BETWEEN 0 AND 9007199254740991),
  commands jsonb NOT NULL CHECK(jsonb_typeof(commands)='array'),
  command_decisions jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(command_decisions)='array'),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','applied','rejected','conflicted')),
  decided_by text, decision_request_id uuid, decision_action text CHECK(decision_action IN('accept','reject')),
  committed_epoch integer, committed_seq bigint, created_at timestamptz NOT NULL DEFAULT now(), decided_at timestamptz,
  PRIMARY KEY(org_id,board_id,id), UNIQUE(org_id,board_id,submitted_by,request_id),
  FOREIGN KEY(org_id,board_id) REFERENCES whiteboards(org_id,id) ON DELETE CASCADE,
  CHECK((status='pending' AND decided_by IS NULL AND decided_at IS NULL AND decision_request_id IS NULL AND decision_action IS NULL)
    OR (status<>'pending' AND decided_by IS NOT NULL AND decided_at IS NOT NULL AND decision_request_id IS NOT NULL AND decision_action IS NOT NULL)),
  CHECK((status='applied' AND committed_epoch IS NOT NULL AND committed_seq IS NOT NULL AND committed_epoch>0 AND committed_seq>0) OR (status<>'applied' AND committed_epoch IS NULL AND committed_seq IS NULL))
);
ALTER TABLE whiteboard_proposals ADD COLUMN IF NOT EXISTS source_kind text NOT NULL DEFAULT 'human-api';
ALTER TABLE whiteboard_proposals ADD COLUMN IF NOT EXISTS actor_id text NOT NULL DEFAULT '';
ALTER TABLE whiteboard_proposals ADD COLUMN IF NOT EXISTS agent_id text;
ALTER TABLE whiteboard_proposals ADD COLUMN IF NOT EXISTS agent_name text;
ALTER TABLE whiteboard_proposals ADD COLUMN IF NOT EXISTS agent_version_id text;
ALTER TABLE whiteboard_proposals ADD COLUMN IF NOT EXISTS run_id text;
ALTER TABLE whiteboard_proposals ADD COLUMN IF NOT EXISTS model_provider text;
ALTER TABLE whiteboard_proposals ADD COLUMN IF NOT EXISTS model_id text;
ALTER TABLE whiteboard_proposals ADD COLUMN IF NOT EXISTS model_version text;
ALTER TABLE whiteboard_proposals ADD COLUMN IF NOT EXISTS command_decisions jsonb NOT NULL DEFAULT '[]'::jsonb;
UPDATE whiteboard_proposals SET actor_id=submitted_by WHERE actor_id='';
UPDATE whiteboard_proposals AS p SET command_decisions=(
  SELECT jsonb_agg(jsonb_build_object(
    'status',CASE WHEN p.status='applied' THEN 'applied' WHEN p.status='rejected' THEN 'rejected' ELSE 'pending' END,
    'decidedBy',CASE WHEN p.status IN('applied','rejected') THEN p.decided_by ELSE NULL END,
    'decidedAt',CASE WHEN p.status IN('applied','rejected') THEN p.decided_at ELSE NULL END,
    'requestId',CASE WHEN p.status IN('applied','rejected') THEN p.decision_request_id ELSE NULL END,
    'committedEpoch',CASE WHEN p.status='applied' THEN p.committed_epoch ELSE NULL END,
    'committedSeq',CASE WHEN p.status='applied' THEN p.committed_seq ELSE NULL END
  ) ORDER BY ordinal)
  FROM jsonb_array_elements(p.commands) WITH ORDINALITY AS command(value,ordinal)
) WHERE jsonb_array_length(p.command_decisions)=0;

CREATE TABLE IF NOT EXISTS whiteboard_proposal_decisions (
  org_id text NOT NULL, board_id uuid NOT NULL, actor_id text NOT NULL, request_id uuid NOT NULL,
  request_hash text NOT NULL CHECK(length(request_hash)=64), result jsonb NOT NULL CHECK(jsonb_typeof(result)='object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(org_id,board_id,actor_id,request_id),
  FOREIGN KEY(org_id,board_id) REFERENCES whiteboards(org_id,id) ON DELETE CASCADE
);
ALTER TABLE whiteboard_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE whiteboard_proposals FORCE ROW LEVEL SECURITY;
ALTER TABLE whiteboard_proposal_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE whiteboard_proposal_decisions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant ON whiteboard_proposals;
CREATE POLICY tenant ON whiteboard_proposals USING(org_id=current_setting('app.current_org',true)) WITH CHECK(org_id=current_setting('app.current_org',true));
DROP POLICY IF EXISTS tenant ON whiteboard_proposal_decisions;
CREATE POLICY tenant ON whiteboard_proposal_decisions USING(org_id=current_setting('app.current_org',true)) WITH CHECK(org_id=current_setting('app.current_org',true));
REVOKE ALL ON whiteboard_proposals,whiteboard_proposal_decisions FROM app_rw;
GRANT SELECT,INSERT,UPDATE ON whiteboard_proposals TO app_rw;
GRANT SELECT,INSERT ON whiteboard_proposal_decisions TO app_rw;
SELECT kernel_apply_org_freeze_policies();
