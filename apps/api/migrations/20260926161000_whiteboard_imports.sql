CREATE TABLE IF NOT EXISTS whiteboard_imports (
  org_id text NOT NULL,
  board_id uuid NOT NULL,
  id uuid NOT NULL,
  actor_id text NOT NULL,
  source text NOT NULL CHECK (source IN ('miro','mural')),
  file_name text NOT NULL CHECK (length(file_name) BETWEEN 1 AND 255),
  mime_type text NOT NULL CHECK (mime_type IN ('application/json','text/csv','application/zip')),
  size_bytes bigint NOT NULL CHECK (size_bytes BETWEEN 1 AND 33554432),
  sha256 text NOT NULL CHECK (length(sha256)=64),
  source_object_key text NOT NULL,
  stage text NOT NULL CHECK (stage IN ('uploaded','preflighted','completed','failed')),
  counts jsonb,
  report jsonb,
  preflight_request_id uuid,
  execute_request_id uuid,
  execute_request_hash text CHECK (execute_request_hash IS NULL OR length(execute_request_hash)=64),
  completed_epoch integer,
  completed_seq bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, board_id, id),
  UNIQUE (org_id, board_id, actor_id, id),
  FOREIGN KEY (org_id, board_id) REFERENCES whiteboards(org_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS whiteboard_imports_board ON whiteboard_imports(org_id,board_id,created_at DESC);
ALTER TABLE whiteboard_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE whiteboard_imports FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS whiteboard_imports_tenant ON whiteboard_imports;
CREATE POLICY whiteboard_imports_tenant ON whiteboard_imports USING (org_id=current_setting('app.current_org',true)) WITH CHECK (org_id=current_setting('app.current_org',true));
REVOKE ALL ON whiteboard_imports FROM app_rw;
GRANT SELECT,INSERT,UPDATE ON whiteboard_imports TO app_rw;
SELECT kernel_apply_org_freeze_policies();
