ALTER TABLE whiteboard_transfer_audit ADD COLUMN IF NOT EXISTS format text;
ALTER TABLE whiteboard_transfer_audit ADD COLUMN IF NOT EXISTS outcome text;
ALTER TABLE whiteboard_transfer_audit ADD COLUMN IF NOT EXISTS job_id uuid;
ALTER TABLE whiteboard_transfer_audit ADD COLUMN IF NOT EXISTS loss_report jsonb;
ALTER TABLE whiteboard_transfer_audit DROP CONSTRAINT IF EXISTS whiteboard_transfer_audit_object_count_check;
ALTER TABLE whiteboard_transfer_audit ADD CONSTRAINT whiteboard_transfer_audit_object_count_check CHECK (object_count BETWEEN 0 AND 10000);
ALTER TABLE whiteboard_transfer_audit DROP CONSTRAINT IF EXISTS whiteboard_transfer_audit_format_check;
ALTER TABLE whiteboard_transfer_audit ADD CONSTRAINT whiteboard_transfer_audit_format_check CHECK (format IS NULL OR format IN ('png','svg','pdf','sticky-csv'));
ALTER TABLE whiteboard_transfer_audit DROP CONSTRAINT IF EXISTS whiteboard_transfer_audit_outcome_check;
ALTER TABLE whiteboard_transfer_audit ADD CONSTRAINT whiteboard_transfer_audit_outcome_check CHECK (outcome IS NULL OR outcome IN ('done','failed','cancelled'));
ALTER TABLE whiteboard_transfer_audit DROP CONSTRAINT IF EXISTS whiteboard_transfer_audit_loss_report_check;
ALTER TABLE whiteboard_transfer_audit ADD CONSTRAINT whiteboard_transfer_audit_loss_report_check CHECK (loss_report IS NULL OR jsonb_typeof(loss_report)='array');

CREATE TABLE IF NOT EXISTS whiteboard_file_export_jobs (
  id uuid NOT NULL,
  org_id text NOT NULL,
  board_id uuid NOT NULL,
  actor_id text NOT NULL,
  format text NOT NULL CHECK (format IN ('png','svg','pdf','sticky-csv')),
  background text NOT NULL,
  status text NOT NULL CHECK (status IN ('queued','running','done','failed','cancelled')),
  progress integer NOT NULL CHECK (progress BETWEEN 0 AND 100),
  filename text NOT NULL,
  mime_type text NOT NULL,
  object_count integer NOT NULL DEFAULT 0 CHECK (object_count BETWEEN 0 AND 10000),
  page_order jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(page_order)='array'),
  losses jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(losses)='array'),
  size_bytes bigint CHECK (size_bytes IS NULL OR size_bytes BETWEEN 0 AND 67108864),
  error_code text CHECK (error_code IS NULL OR error_code IN ('BOUNDS_EXCEEDED','GENERATION_FAILED')),
  object_key text,
  sha256 text CHECK (sha256 IS NULL OR sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id,id),
  FOREIGN KEY (org_id,board_id) REFERENCES whiteboards(org_id,id) ON DELETE CASCADE,
  CHECK ((status='done')=(object_key IS NOT NULL AND sha256 IS NOT NULL AND size_bytes IS NOT NULL)),
  CHECK ((status='failed' AND error_code IS NOT NULL) OR (status<>'failed' AND error_code IS NULL))
);
ALTER TABLE whiteboard_file_export_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE whiteboard_file_export_jobs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS whiteboard_file_export_jobs_tenant ON whiteboard_file_export_jobs;
CREATE POLICY whiteboard_file_export_jobs_tenant ON whiteboard_file_export_jobs USING (org_id=current_setting('app.current_org',true)) WITH CHECK (org_id=current_setting('app.current_org',true));
REVOKE ALL ON whiteboard_file_export_jobs FROM app_rw;
GRANT SELECT,INSERT,UPDATE ON whiteboard_file_export_jobs TO app_rw;
SELECT kernel_apply_org_freeze_policies();
