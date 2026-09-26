-- Board library metadata. Content remains in the canonical whiteboard document boundary.
ALTER TABLE whiteboards ADD COLUMN IF NOT EXISTS tags_revision integer NOT NULL DEFAULT 0 CHECK (tags_revision >= 0);

CREATE TABLE IF NOT EXISTS whiteboard_tags (
  id uuid NOT NULL,
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_by text NOT NULL,
  request_id uuid NOT NULL,
  request_hash text NOT NULL CHECK (length(request_hash) = 64),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 40),
  name_key text NOT NULL CHECK (length(name_key) BETWEEN 1 AND 160),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id),
  UNIQUE (org_id, created_by, request_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS whiteboard_tags_active_name ON whiteboard_tags(org_id, name_key) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS whiteboard_tag_bindings (
  org_id text NOT NULL,
  board_id uuid NOT NULL,
  tag_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, board_id, tag_id),
  FOREIGN KEY (org_id, board_id) REFERENCES whiteboards(org_id, id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, tag_id) REFERENCES whiteboard_tags(org_id, id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS whiteboard_tag_bindings_filter ON whiteboard_tag_bindings(org_id, tag_id, board_id);

CREATE TABLE IF NOT EXISTS whiteboard_tag_mutation_receipts (
  org_id text NOT NULL,
  actor_id text NOT NULL,
  request_id uuid NOT NULL,
  request_hash text NOT NULL CHECK (length(request_hash) = 64),
  operation text NOT NULL CHECK (operation IN ('rename', 'delete')),
  tag_id uuid NOT NULL,
  result_name text,
  result_revision integer NOT NULL CHECK (result_revision > 0),
  result_updated_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, actor_id, request_id)
);

CREATE TABLE IF NOT EXISTS whiteboard_duplicate_requests (
  job_id uuid NOT NULL,
  org_id text NOT NULL,
  actor_id text NOT NULL,
  request_id uuid NOT NULL,
  request_hash text NOT NULL CHECK (length(request_hash) = 64),
  source_board_id uuid NOT NULL,
  target_board_id uuid,
  source_epoch integer CHECK (source_epoch > 0),
  source_seq bigint CHECK (source_seq BETWEEN 0 AND 9007199254740991),
  object_count integer CHECK (object_count >= 0),
  connector_count integer CHECK (connector_count >= 0),
  asset_count integer CHECK (asset_count >= 0),
  status text NOT NULL CHECK (status IN ('running','ready_to_publish','completed','failed_pending_cleanup','cancelled_pending_cleanup')),
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, job_id),
  UNIQUE (org_id, actor_id, request_id),
  UNIQUE (org_id, target_board_id)
);

CREATE TABLE IF NOT EXISTS whiteboard_delete_receipts (
  org_id text NOT NULL,
  actor_id text NOT NULL,
  request_id uuid NOT NULL,
  request_hash text NOT NULL CHECK (length(request_hash) = 64),
  board_id uuid NOT NULL,
  deleted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, actor_id, request_id)
);

ALTER TABLE whiteboard_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE whiteboard_tags FORCE ROW LEVEL SECURITY;
ALTER TABLE whiteboard_tag_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE whiteboard_tag_bindings FORCE ROW LEVEL SECURITY;
ALTER TABLE whiteboard_tag_mutation_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE whiteboard_tag_mutation_receipts FORCE ROW LEVEL SECURITY;
ALTER TABLE whiteboard_duplicate_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE whiteboard_duplicate_requests FORCE ROW LEVEL SECURITY;
ALTER TABLE whiteboard_delete_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE whiteboard_delete_receipts FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS whiteboard_tags_tenant ON whiteboard_tags;
CREATE POLICY whiteboard_tags_tenant ON whiteboard_tags USING (org_id=current_setting('app.current_org',true)) WITH CHECK (org_id=current_setting('app.current_org',true));
DROP POLICY IF EXISTS whiteboard_tag_bindings_tenant ON whiteboard_tag_bindings;
CREATE POLICY whiteboard_tag_bindings_tenant ON whiteboard_tag_bindings USING (org_id=current_setting('app.current_org',true)) WITH CHECK (org_id=current_setting('app.current_org',true));
DROP POLICY IF EXISTS whiteboard_tag_mutation_receipts_tenant ON whiteboard_tag_mutation_receipts;
CREATE POLICY whiteboard_tag_mutation_receipts_tenant ON whiteboard_tag_mutation_receipts USING (org_id=current_setting('app.current_org',true)) WITH CHECK (org_id=current_setting('app.current_org',true));
DROP POLICY IF EXISTS whiteboard_duplicate_requests_tenant ON whiteboard_duplicate_requests;
CREATE POLICY whiteboard_duplicate_requests_tenant ON whiteboard_duplicate_requests USING (org_id=current_setting('app.current_org',true)) WITH CHECK (org_id=current_setting('app.current_org',true));
DROP POLICY IF EXISTS whiteboard_delete_receipts_tenant ON whiteboard_delete_receipts;
CREATE POLICY whiteboard_delete_receipts_tenant ON whiteboard_delete_receipts USING (org_id=current_setting('app.current_org',true)) WITH CHECK (org_id=current_setting('app.current_org',true));

REVOKE ALL ON whiteboard_tags, whiteboard_tag_bindings, whiteboard_tag_mutation_receipts, whiteboard_duplicate_requests, whiteboard_delete_receipts FROM app_rw;
GRANT SELECT, INSERT, UPDATE ON whiteboard_tags, whiteboard_duplicate_requests TO app_rw;
GRANT SELECT, INSERT ON whiteboard_tag_mutation_receipts, whiteboard_delete_receipts TO app_rw;
GRANT SELECT, INSERT, DELETE ON whiteboard_tag_bindings TO app_rw;
SELECT kernel_apply_org_freeze_policies();
