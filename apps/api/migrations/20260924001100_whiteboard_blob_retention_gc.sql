-- Metadata-only roots that keep immutable Board blobs reachable for backup/legal hold,
-- plus per-Board sweep cadence and metrics. No Board content bytes live in PostgreSQL.
CREATE TABLE IF NOT EXISTS whiteboard_blob_retention_roots (
  org_id text NOT NULL,
  board_id uuid NOT NULL,
  root_kind text NOT NULL CHECK (root_kind IN ('backup','legal_hold')),
  reference_id text NOT NULL,
  manifest_key text NOT NULL,
  manifest_digest text NOT NULL CHECK (manifest_digest ~ '^[a-f0-9]{64}$'),
  manifest_plain_digest text NOT NULL CHECK (manifest_plain_digest ~ '^[a-f0-9]{64}$'),
  manifest_size_bytes bigint NOT NULL CHECK (manifest_size_bytes > 0),
  tenant_key_version integer NOT NULL CHECK (tenant_key_version > 0),
  retain_until timestamptz,
  released_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id,board_id,root_kind,reference_id),
  FOREIGN KEY (org_id,board_id) REFERENCES whiteboards(org_id,id) ON DELETE CASCADE,
  CHECK (root_kind = 'legal_hold' OR retain_until IS NOT NULL),
  CHECK (released_at IS NULL OR released_at >= created_at)
);
CREATE INDEX IF NOT EXISTS whiteboard_blob_retention_roots_active
  ON whiteboard_blob_retention_roots(org_id,board_id,root_kind,retain_until)
  WHERE released_at IS NULL;
ALTER TABLE whiteboard_blob_retention_roots ENABLE ROW LEVEL SECURITY;
ALTER TABLE whiteboard_blob_retention_roots FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS whiteboard_blob_retention_roots_tenant ON whiteboard_blob_retention_roots;
CREATE POLICY whiteboard_blob_retention_roots_tenant ON whiteboard_blob_retention_roots
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));
REVOKE ALL ON whiteboard_blob_retention_roots FROM app_rw;
GRANT SELECT,INSERT,UPDATE,DELETE ON whiteboard_blob_retention_roots TO app_rw;

CREATE TABLE IF NOT EXISTS whiteboard_blob_gc_runs (
  org_id text NOT NULL,
  board_id uuid NOT NULL,
  last_started_at timestamptz NOT NULL,
  last_finished_at timestamptz NOT NULL,
  duration_ms bigint NOT NULL CHECK (duration_ms >= 0),
  examined integer NOT NULL CHECK (examined >= 0),
  deleted integer NOT NULL CHECK (deleted >= 0),
  retained integer NOT NULL CHECK (retained >= 0),
  changed integer NOT NULL CHECK (changed >= 0),
  next_cursor text,
  PRIMARY KEY (org_id,board_id),
  FOREIGN KEY (org_id,board_id) REFERENCES whiteboards(org_id,id) ON DELETE CASCADE
);
ALTER TABLE whiteboard_blob_gc_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE whiteboard_blob_gc_runs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS whiteboard_blob_gc_runs_tenant ON whiteboard_blob_gc_runs;
CREATE POLICY whiteboard_blob_gc_runs_tenant ON whiteboard_blob_gc_runs
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));
REVOKE ALL ON whiteboard_blob_gc_runs FROM app_rw;
GRANT SELECT,INSERT,UPDATE ON whiteboard_blob_gc_runs TO app_rw;
