-- Trusted collaboration sidecar: comments/audit and immutable checkpoint metadata stay out of Yjs.
CREATE TABLE IF NOT EXISTS whiteboard_comment_threads (
  org_id text NOT NULL, board_id uuid NOT NULL, id uuid NOT NULL, object_id text NOT NULL,
  status text NOT NULL CHECK(status IN ('open','resolved','object-deleted')),
  revision integer NOT NULL CHECK(revision>0), payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(org_id,board_id,id), FOREIGN KEY(org_id,board_id) REFERENCES whiteboards(org_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS whiteboard_comment_threads_object ON whiteboard_comment_threads(org_id,board_id,object_id);
CREATE TABLE IF NOT EXISTS whiteboard_comment_requests (
  org_id text NOT NULL, board_id uuid NOT NULL, actor_id text NOT NULL, request_id uuid NOT NULL,
  request_hash text NOT NULL CHECK(length(request_hash)=64), response jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(org_id,board_id,actor_id,request_id), FOREIGN KEY(org_id,board_id) REFERENCES whiteboards(org_id,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS whiteboard_collaboration_events (
  org_id text NOT NULL, board_id uuid NOT NULL, event_id uuid NOT NULL, actor_id text NOT NULL,
  event_type text NOT NULL, payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(org_id,board_id,event_id), FOREIGN KEY(org_id,board_id) REFERENCES whiteboards(org_id,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS whiteboard_checkpoints (
  org_id text NOT NULL, board_id uuid NOT NULL, checkpoint_id uuid NOT NULL, actor_id text NOT NULL, request_id uuid NOT NULL,
  manifest jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(org_id,board_id,checkpoint_id), UNIQUE(org_id,board_id,actor_id,request_id),
  FOREIGN KEY(org_id,board_id) REFERENCES whiteboards(org_id,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS whiteboard_restore_requests (
  org_id text NOT NULL, board_id uuid NOT NULL, actor_id text NOT NULL, request_id uuid NOT NULL,
  response jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(org_id,board_id,actor_id,request_id), FOREIGN KEY(org_id,board_id) REFERENCES whiteboards(org_id,id) ON DELETE CASCADE
);
ALTER TABLE whiteboard_comment_threads ENABLE ROW LEVEL SECURITY; ALTER TABLE whiteboard_comment_threads FORCE ROW LEVEL SECURITY;
ALTER TABLE whiteboard_comment_requests ENABLE ROW LEVEL SECURITY; ALTER TABLE whiteboard_comment_requests FORCE ROW LEVEL SECURITY;
ALTER TABLE whiteboard_collaboration_events ENABLE ROW LEVEL SECURITY; ALTER TABLE whiteboard_collaboration_events FORCE ROW LEVEL SECURITY;
ALTER TABLE whiteboard_checkpoints ENABLE ROW LEVEL SECURITY; ALTER TABLE whiteboard_checkpoints FORCE ROW LEVEL SECURITY;
ALTER TABLE whiteboard_restore_requests ENABLE ROW LEVEL SECURITY; ALTER TABLE whiteboard_restore_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS whiteboard_comment_threads_tenant ON whiteboard_comment_threads; CREATE POLICY whiteboard_comment_threads_tenant ON whiteboard_comment_threads USING(org_id=current_setting('app.current_org',true)) WITH CHECK(org_id=current_setting('app.current_org',true));
DROP POLICY IF EXISTS whiteboard_comment_requests_tenant ON whiteboard_comment_requests; CREATE POLICY whiteboard_comment_requests_tenant ON whiteboard_comment_requests USING(org_id=current_setting('app.current_org',true)) WITH CHECK(org_id=current_setting('app.current_org',true));
DROP POLICY IF EXISTS whiteboard_collaboration_events_tenant ON whiteboard_collaboration_events; CREATE POLICY whiteboard_collaboration_events_tenant ON whiteboard_collaboration_events USING(org_id=current_setting('app.current_org',true)) WITH CHECK(org_id=current_setting('app.current_org',true));
DROP POLICY IF EXISTS whiteboard_checkpoints_tenant ON whiteboard_checkpoints; CREATE POLICY whiteboard_checkpoints_tenant ON whiteboard_checkpoints USING(org_id=current_setting('app.current_org',true)) WITH CHECK(org_id=current_setting('app.current_org',true));
DROP POLICY IF EXISTS whiteboard_restore_requests_tenant ON whiteboard_restore_requests; CREATE POLICY whiteboard_restore_requests_tenant ON whiteboard_restore_requests USING(org_id=current_setting('app.current_org',true)) WITH CHECK(org_id=current_setting('app.current_org',true));
REVOKE ALL ON whiteboard_comment_threads,whiteboard_comment_requests,whiteboard_collaboration_events,whiteboard_checkpoints,whiteboard_restore_requests FROM app_rw;
GRANT SELECT,INSERT,UPDATE ON whiteboard_comment_threads TO app_rw;
GRANT SELECT,INSERT ON whiteboard_comment_requests,whiteboard_collaboration_events,whiteboard_checkpoints,whiteboard_restore_requests TO app_rw;
SELECT kernel_apply_org_freeze_policies();
