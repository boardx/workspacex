CREATE TABLE IF NOT EXISTS whiteboard_threads (
 id uuid PRIMARY KEY, org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 board_id uuid NOT NULL REFERENCES whiteboards(id) ON DELETE CASCADE, request_id uuid NOT NULL,
 anchor_kind text NOT NULL CHECK(anchor_kind IN ('object','point')), anchor_object_id text,
 anchor_label text, anchor_x double precision, anchor_y double precision,
 resolved_at timestamptz, created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(org_id,board_id,created_by,request_id),
 CHECK((anchor_kind='object' AND anchor_object_id IS NOT NULL AND anchor_label IS NOT NULL AND anchor_x IS NULL AND anchor_y IS NULL) OR
       (anchor_kind='point' AND anchor_object_id IS NULL AND anchor_label IS NULL AND anchor_x IS NOT NULL AND anchor_y IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS whiteboard_comments (
 id uuid PRIMARY KEY, org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 board_id uuid NOT NULL REFERENCES whiteboards(id) ON DELETE CASCADE, thread_id uuid NOT NULL REFERENCES whiteboard_threads(id) ON DELETE CASCADE,
 request_id uuid NOT NULL, author_id text NOT NULL, body text NOT NULL CHECK(length(body)<=4000),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), edited_at timestamptz, deleted_at timestamptz,
 UNIQUE(org_id,thread_id,author_id,request_id)
);
CREATE TABLE IF NOT EXISTS whiteboard_comment_mentions (
 org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, board_id uuid NOT NULL REFERENCES whiteboards(id) ON DELETE CASCADE,
 comment_id uuid NOT NULL REFERENCES whiteboard_comments(id) ON DELETE CASCADE, user_id text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(org_id,comment_id,user_id)
);
CREATE TABLE IF NOT EXISTS whiteboard_comment_tasks (
 id uuid PRIMARY KEY, org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 board_id uuid NOT NULL REFERENCES whiteboards(id) ON DELETE CASCADE, thread_id uuid NOT NULL UNIQUE REFERENCES whiteboard_threads(id) ON DELETE CASCADE,
 source_comment_id uuid NOT NULL REFERENCES whiteboard_comments(id) ON DELETE RESTRICT,
 request_id uuid NOT NULL, assignee_id text, due_at timestamptz, status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','done')),
 created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(org_id,board_id,created_by,request_id)
);
CREATE TABLE IF NOT EXISTS whiteboard_discussion_audit (
 id bigserial PRIMARY KEY, org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 board_id uuid NOT NULL REFERENCES whiteboards(id) ON DELETE CASCADE, actor_id text NOT NULL,
 entity_kind text NOT NULL CHECK(entity_kind IN ('comment','thread','task')), entity_id uuid NOT NULL,
 action text NOT NULL CHECK(action IN ('edit','delete','resolve','reopen','assign','due','status')),
 before_value jsonb, after_value jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS whiteboard_threads_page ON whiteboard_threads(org_id,board_id,updated_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS whiteboard_comments_thread ON whiteboard_comments(org_id,thread_id,created_at,id);
CREATE INDEX IF NOT EXISTS whiteboard_mentions_user ON whiteboard_comment_mentions(org_id,user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS whiteboard_tasks_assignee ON whiteboard_comment_tasks(org_id,assignee_id,status,due_at);
CREATE INDEX IF NOT EXISTS whiteboard_discussion_audit_entity ON whiteboard_discussion_audit(org_id,entity_kind,entity_id,created_at);
ALTER TABLE whiteboard_threads ENABLE ROW LEVEL SECURITY; ALTER TABLE whiteboard_threads FORCE ROW LEVEL SECURITY;
ALTER TABLE whiteboard_comments ENABLE ROW LEVEL SECURITY; ALTER TABLE whiteboard_comments FORCE ROW LEVEL SECURITY;
ALTER TABLE whiteboard_comment_mentions ENABLE ROW LEVEL SECURITY; ALTER TABLE whiteboard_comment_mentions FORCE ROW LEVEL SECURITY;
ALTER TABLE whiteboard_comment_tasks ENABLE ROW LEVEL SECURITY; ALTER TABLE whiteboard_comment_tasks FORCE ROW LEVEL SECURITY;
ALTER TABLE whiteboard_discussion_audit ENABLE ROW LEVEL SECURITY; ALTER TABLE whiteboard_discussion_audit FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS whiteboard_threads_tenant ON whiteboard_threads; CREATE POLICY whiteboard_threads_tenant ON whiteboard_threads USING(org_id=current_setting('app.current_org',true)) WITH CHECK(org_id=current_setting('app.current_org',true));
DROP POLICY IF EXISTS whiteboard_comments_tenant ON whiteboard_comments; CREATE POLICY whiteboard_comments_tenant ON whiteboard_comments USING(org_id=current_setting('app.current_org',true)) WITH CHECK(org_id=current_setting('app.current_org',true));
DROP POLICY IF EXISTS whiteboard_comment_mentions_tenant ON whiteboard_comment_mentions; CREATE POLICY whiteboard_comment_mentions_tenant ON whiteboard_comment_mentions USING(org_id=current_setting('app.current_org',true)) WITH CHECK(org_id=current_setting('app.current_org',true));
DROP POLICY IF EXISTS whiteboard_comment_tasks_tenant ON whiteboard_comment_tasks; CREATE POLICY whiteboard_comment_tasks_tenant ON whiteboard_comment_tasks USING(org_id=current_setting('app.current_org',true)) WITH CHECK(org_id=current_setting('app.current_org',true));
DROP POLICY IF EXISTS whiteboard_discussion_audit_tenant ON whiteboard_discussion_audit; CREATE POLICY whiteboard_discussion_audit_tenant ON whiteboard_discussion_audit USING(org_id=current_setting('app.current_org',true)) WITH CHECK(org_id=current_setting('app.current_org',true));
GRANT SELECT,INSERT,UPDATE ON whiteboard_threads,whiteboard_comments,whiteboard_comment_mentions,whiteboard_comment_tasks TO app_rw;
GRANT SELECT,INSERT ON whiteboard_discussion_audit TO app_rw;
GRANT USAGE,SELECT ON SEQUENCE whiteboard_discussion_audit_id_seq TO app_rw;
SELECT kernel_apply_org_freeze_policies();
