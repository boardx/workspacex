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
  artifact_state text NOT NULL DEFAULT 'pending' CHECK (artifact_state IN ('pending','referenced','cleanup_pending','purged')),
  cleanup_after timestamptz,
  cleanup_owner text,
  lease_owner text,
  lease_expires_at timestamptz,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 8),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id,id),
  FOREIGN KEY (org_id,board_id) REFERENCES whiteboards(org_id,id) ON DELETE CASCADE,
  CHECK (status<>'done' OR (artifact_state='referenced' AND object_key IS NOT NULL AND sha256 IS NOT NULL AND size_bytes IS NOT NULL)),
  CHECK (artifact_state NOT IN ('cleanup_pending','purged') OR status IN ('failed','cancelled')),
  CHECK ((status='failed' AND error_code IS NOT NULL) OR (status<>'failed' AND error_code IS NULL))
);
ALTER TABLE whiteboard_file_export_jobs ADD COLUMN IF NOT EXISTS artifact_state text NOT NULL DEFAULT 'pending';
ALTER TABLE whiteboard_file_export_jobs ADD COLUMN IF NOT EXISTS cleanup_after timestamptz;
ALTER TABLE whiteboard_file_export_jobs ADD COLUMN IF NOT EXISTS cleanup_owner text;
ALTER TABLE whiteboard_file_export_jobs ADD COLUMN IF NOT EXISTS lease_owner text;
ALTER TABLE whiteboard_file_export_jobs ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz;
ALTER TABLE whiteboard_file_export_jobs ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;
ALTER TABLE whiteboard_file_export_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE whiteboard_file_export_jobs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS whiteboard_file_export_jobs_tenant ON whiteboard_file_export_jobs;
CREATE POLICY whiteboard_file_export_jobs_tenant ON whiteboard_file_export_jobs USING (org_id=current_setting('app.current_org',true)) WITH CHECK (org_id=current_setting('app.current_org',true));
REVOKE ALL ON whiteboard_file_export_jobs FROM app_rw;
GRANT SELECT,INSERT,UPDATE ON whiteboard_file_export_jobs TO app_rw;
SELECT kernel_apply_org_freeze_policies();

CREATE OR REPLACE FUNCTION public.kernel_claim_whiteboard_file_export(p_worker text,p_lease_ms integer,p_concurrency integer)
RETURNS TABLE(id uuid,org_id text,board_id uuid,actor_id text,format text,background text,status text,progress integer,filename text,mime_type text,object_count integer,page_order jsonb,losses jsonb,size_bytes bigint,error_code text,object_key text,sha256 text,lease_owner text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF p_worker='' OR p_lease_ms<1000 OR p_lease_ms>30000 OR p_concurrency<1 OR p_concurrency>8 THEN RETURN; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('whiteboard-file-export-admission',0));
  IF (SELECT count(*) FROM public.whiteboard_file_export_jobs active WHERE active.status='running' AND active.lease_expires_at>clock_timestamp())>=p_concurrency THEN RETURN; END IF;
  RETURN QUERY
  WITH candidate AS (
    SELECT j.org_id,j.id FROM public.whiteboard_file_export_jobs j
    WHERE (j.status='queued' OR (j.status='running' AND j.lease_expires_at<=clock_timestamp())) AND j.attempts<8
    ORDER BY j.created_at,j.id LIMIT 1 FOR UPDATE SKIP LOCKED
  )
  UPDATE public.whiteboard_file_export_jobs j SET status='running',progress=GREATEST(j.progress,10),lease_owner=p_worker,
    lease_expires_at=clock_timestamp()+p_lease_ms*interval '1 millisecond',attempts=j.attempts+1,updated_at=clock_timestamp()
  FROM candidate c WHERE j.org_id=c.org_id AND j.id=c.id
  RETURNING j.id,j.org_id,j.board_id,j.actor_id,j.format,j.background,j.status,j.progress,j.filename,j.mime_type,j.object_count,j.page_order,j.losses,j.size_bytes,j.error_code,j.object_key,j.sha256,j.lease_owner;
END $$;
REVOKE ALL ON FUNCTION public.kernel_claim_whiteboard_file_export(text,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kernel_claim_whiteboard_file_export(text,integer,integer) TO app_rw;

CREATE OR REPLACE FUNCTION public.kernel_claim_whiteboard_file_export_cleanup(p_worker text)
RETURNS TABLE(id uuid,object_key text,cleanup_owner text)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  WITH candidate AS (
    SELECT j.org_id,j.id FROM public.whiteboard_file_export_jobs j
    WHERE j.artifact_state='cleanup_pending' AND j.cleanup_after<=clock_timestamp()
      AND (j.cleanup_owner IS NULL OR j.updated_at<clock_timestamp()-interval '1 minute')
    ORDER BY j.cleanup_after,j.id LIMIT 1 FOR UPDATE SKIP LOCKED
  )
  UPDATE public.whiteboard_file_export_jobs j SET cleanup_owner=p_worker,updated_at=clock_timestamp()
  FROM candidate c WHERE j.org_id=c.org_id AND j.id=c.id RETURNING j.id,j.object_key,j.cleanup_owner
$$;
REVOKE ALL ON FUNCTION public.kernel_claim_whiteboard_file_export_cleanup(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kernel_claim_whiteboard_file_export_cleanup(text) TO app_rw;

CREATE OR REPLACE FUNCTION public.kernel_finish_whiteboard_file_export_cleanup(p_job uuid,p_worker text,p_deleted boolean)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  WITH changed AS (
    UPDATE public.whiteboard_file_export_jobs SET artifact_state=CASE WHEN p_deleted THEN 'purged' ELSE 'cleanup_pending' END,
      cleanup_owner=NULL,cleanup_after=CASE WHEN p_deleted THEN NULL ELSE clock_timestamp()+interval '1 minute' END,updated_at=clock_timestamp()
    WHERE id=p_job AND artifact_state='cleanup_pending' AND cleanup_owner=p_worker RETURNING id
  ) SELECT EXISTS(SELECT 1 FROM changed)
$$;
REVOKE ALL ON FUNCTION public.kernel_finish_whiteboard_file_export_cleanup(uuid,text,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kernel_finish_whiteboard_file_export_cleanup(uuid,text,boolean) TO app_rw;
