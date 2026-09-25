-- Organization-level, restart-safe orchestration over the board-scoped migration.
-- This must remain a follow-up migration: 20260924001000 was already deployed.
CREATE TABLE IF NOT EXISTS whiteboard_content_rollouts (
  org_id text NOT NULL,
  rollout_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','paused','cancelled','completed')),
  cursor_board_id uuid,
  snapshot_upper_board_id uuid,
  discovery_cycle bigint NOT NULL DEFAULT 1 CHECK (discovery_cycle > 0),
  cycle_new_items bigint NOT NULL DEFAULT 0 CHECK (cycle_new_items >= 0),
  exhausted boolean NOT NULL DEFAULT false,
  config jsonb NOT NULL CHECK (jsonb_typeof(config)='object'),
  control_revision bigint NOT NULL DEFAULT 0 CHECK (control_revision>=0),
  discovered bigint NOT NULL DEFAULT 0 CHECK (discovered>=0),
  scanned bigint NOT NULL DEFAULT 0 CHECK (scanned>=0),
  migrated bigint NOT NULL DEFAULT 0 CHECK (migrated>=0),
  failed bigint NOT NULL DEFAULT 0 CHECK (failed>=0),
  retried bigint NOT NULL DEFAULT 0 CHECK (retried>=0),
  bytes_read bigint NOT NULL DEFAULT 0 CHECK (bytes_read>=0),
  bytes_written bigint NOT NULL DEFAULT 0 CHECK (bytes_written>=0),
  cas_resets bigint NOT NULL DEFAULT 0 CHECK (cas_resets>=0),
  orphan_candidates bigint NOT NULL DEFAULT 0 CHECK (orphan_candidates>=0),
  phase_calls bigint NOT NULL DEFAULT 0 CHECK (phase_calls>=0),
  latency_ms bigint NOT NULL DEFAULT 0 CHECK (latency_ms>=0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  PRIMARY KEY(org_id,rollout_id),
  CHECK ((status='completed' AND completed_at IS NOT NULL) OR (status<>'completed' AND completed_at IS NULL))
);

CREATE TABLE IF NOT EXISTS whiteboard_content_rollout_items (
  org_id text NOT NULL,
  rollout_id uuid NOT NULL,
  board_id uuid NOT NULL,
  migration_job_id uuid NOT NULL,
  state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','running','retry','succeeded','failed','cancelled')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts>=0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_owner text,
  lease_token uuid,
  lease_epoch bigint NOT NULL DEFAULT 0 CHECK (lease_epoch>=0),
  lease_until timestamptz,
  last_error_code text CHECK (last_error_code IS NULL OR last_error_code ~ '^[A-Z0-9_]{1,64}$'),
  bytes_read bigint NOT NULL DEFAULT 0 CHECK (bytes_read>=0),
  bytes_written bigint NOT NULL DEFAULT 0 CHECK (bytes_written>=0),
  cas_resets bigint NOT NULL DEFAULT 0 CHECK (cas_resets>=0),
  orphan_candidates bigint NOT NULL DEFAULT 0 CHECK (orphan_candidates>=0),
  phase_calls bigint NOT NULL DEFAULT 0 CHECK (phase_calls>=0),
  latency_ms bigint NOT NULL DEFAULT 0 CHECK (latency_ms>=0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(org_id,rollout_id,board_id),
  UNIQUE(org_id,migration_job_id),
  FOREIGN KEY(org_id,rollout_id) REFERENCES whiteboard_content_rollouts(org_id,rollout_id) ON DELETE CASCADE,
  FOREIGN KEY(org_id,board_id) REFERENCES whiteboards(org_id,id) ON DELETE CASCADE,
  CHECK ((state='running' AND lease_owner IS NOT NULL AND lease_token IS NOT NULL AND lease_until IS NOT NULL)
    OR (state<>'running' AND lease_owner IS NULL AND lease_token IS NULL AND lease_until IS NULL))
);
CREATE INDEX IF NOT EXISTS whiteboard_content_rollout_claim
  ON whiteboard_content_rollout_items(org_id,rollout_id,state,next_attempt_at,board_id);

-- These rows contain only limiter metadata. They deliberately have no tenant payload:
-- one locked row serializes admission across every CLI process and tenant.
CREATE TABLE IF NOT EXISTS whiteboard_content_rollout_limiters (
  rollout_id uuid PRIMARY KEY,
  global_concurrency integer NOT NULL CHECK (global_concurrency BETWEEN 1 AND 64),
  rate_per_second integer NOT NULL CHECK (rate_per_second BETWEEN 1 AND 10000),
  next_launch_at timestamptz NOT NULL DEFAULT '-infinity',
  last_org_id text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS whiteboard_content_rollout_global_leases (
  lease_token uuid PRIMARY KEY,
  rollout_id uuid NOT NULL REFERENCES whiteboard_content_rollout_limiters(rollout_id) ON DELETE CASCADE,
  lease_until timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS whiteboard_content_rollout_global_leases_expiry
  ON whiteboard_content_rollout_global_leases(rollout_id,lease_until);
CREATE TABLE IF NOT EXISTS whiteboard_content_rollout_contenders (
  rollout_id uuid NOT NULL REFERENCES whiteboard_content_rollout_limiters(rollout_id) ON DELETE CASCADE,
  org_id text NOT NULL,
  waiting_until timestamptz NOT NULL,
  PRIMARY KEY(rollout_id,org_id)
);

CREATE TABLE IF NOT EXISTS whiteboard_content_rollout_events (
  sequence bigint GENERATED ALWAYS AS IDENTITY,
  org_id text NOT NULL,
  rollout_id uuid NOT NULL,
  board_id uuid,
  kind text NOT NULL CHECK (kind IN ('control','outcome')),
  code text NOT NULL CHECK (code ~ '^[A-Z0-9_]{1,64}$'),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(detail)='object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(org_id,rollout_id,sequence),
  FOREIGN KEY(org_id,rollout_id) REFERENCES whiteboard_content_rollouts(org_id,rollout_id) ON DELETE CASCADE
);

DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='board_rollout_admission_owner') THEN
    CREATE ROLE board_rollout_admission_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='board_rollout_admission_owner'
    AND (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolinherit OR rolbypassrls)) THEN
    RAISE EXCEPTION 'board_rollout_admission_owner role is not isolated';
  END IF;
  IF pg_has_role('app_rw','board_rollout_admission_owner','MEMBER') THEN
    RAISE EXCEPTION 'app_rw must not assume board_rollout_admission_owner';
  END IF;
END $$;

ALTER TABLE whiteboard_content_rollouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE whiteboard_content_rollouts FORCE ROW LEVEL SECURITY;
ALTER TABLE whiteboard_content_rollout_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE whiteboard_content_rollout_items FORCE ROW LEVEL SECURITY;
ALTER TABLE whiteboard_content_rollout_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE whiteboard_content_rollout_events FORCE ROW LEVEL SECURITY;
ALTER TABLE whiteboard_content_rollout_limiters ENABLE ROW LEVEL SECURITY;
ALTER TABLE whiteboard_content_rollout_limiters FORCE ROW LEVEL SECURITY;
ALTER TABLE whiteboard_content_rollout_global_leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE whiteboard_content_rollout_global_leases FORCE ROW LEVEL SECURITY;
ALTER TABLE whiteboard_content_rollout_contenders ENABLE ROW LEVEL SECURITY;
ALTER TABLE whiteboard_content_rollout_contenders FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS whiteboard_content_rollouts_tenant ON whiteboard_content_rollouts;
CREATE POLICY whiteboard_content_rollouts_tenant ON whiteboard_content_rollouts
  USING (org_id=current_setting('app.current_org',true)) WITH CHECK (org_id=current_setting('app.current_org',true));
DROP POLICY IF EXISTS whiteboard_content_rollout_items_tenant ON whiteboard_content_rollout_items;
CREATE POLICY whiteboard_content_rollout_items_tenant ON whiteboard_content_rollout_items
  USING (org_id=current_setting('app.current_org',true)) WITH CHECK (org_id=current_setting('app.current_org',true));
DROP POLICY IF EXISTS whiteboard_content_rollout_events_tenant ON whiteboard_content_rollout_events;
CREATE POLICY whiteboard_content_rollout_events_tenant ON whiteboard_content_rollout_events
  USING (org_id=current_setting('app.current_org',true)) WITH CHECK (org_id=current_setting('app.current_org',true));
DROP POLICY IF EXISTS whiteboard_content_rollout_limiters_global ON whiteboard_content_rollout_limiters;
CREATE POLICY whiteboard_content_rollout_limiters_global ON whiteboard_content_rollout_limiters
  USING (current_user <> 'app_rw') WITH CHECK (current_user <> 'app_rw');
DROP POLICY IF EXISTS whiteboard_content_rollout_global_leases_global ON whiteboard_content_rollout_global_leases;
CREATE POLICY whiteboard_content_rollout_global_leases_global ON whiteboard_content_rollout_global_leases
  USING (current_user <> 'app_rw') WITH CHECK (current_user <> 'app_rw');
DROP POLICY IF EXISTS whiteboard_content_rollout_contenders_global ON whiteboard_content_rollout_contenders;
CREATE POLICY whiteboard_content_rollout_contenders_global ON whiteboard_content_rollout_contenders
  USING (org_id=current_setting('app.current_org',true) OR current_user='board_rollout_admission_owner')
  WITH CHECK (org_id=current_setting('app.current_org',true) OR current_user='board_rollout_admission_owner');

REVOKE ALL ON whiteboard_content_rollouts,whiteboard_content_rollout_items,whiteboard_content_rollout_events,
  whiteboard_content_rollout_limiters,whiteboard_content_rollout_global_leases,whiteboard_content_rollout_contenders FROM app_rw;
GRANT SELECT,INSERT,UPDATE ON whiteboard_content_rollouts,whiteboard_content_rollout_items TO app_rw;
GRANT SELECT,INSERT ON whiteboard_content_rollout_events TO app_rw;
GRANT USAGE,SELECT ON SEQUENCE whiteboard_content_rollout_events_sequence_seq TO app_rw;
GRANT USAGE ON SCHEMA public TO board_rollout_admission_owner;
GRANT SELECT,UPDATE ON whiteboard_content_rollouts,whiteboard_content_rollout_items TO board_rollout_admission_owner;
GRANT INSERT ON whiteboard_content_rollout_events TO board_rollout_admission_owner;
GRANT USAGE,SELECT ON SEQUENCE whiteboard_content_rollout_events_sequence_seq TO board_rollout_admission_owner;
GRANT SELECT,INSERT,UPDATE ON whiteboard_content_rollout_limiters TO board_rollout_admission_owner;
GRANT SELECT,INSERT,DELETE ON whiteboard_content_rollout_global_leases TO board_rollout_admission_owner;
GRANT SELECT,INSERT,UPDATE,DELETE ON whiteboard_content_rollout_contenders TO board_rollout_admission_owner;

CREATE OR REPLACE FUNCTION claim_whiteboard_content_rollout_admission(
  p_org_id text,p_rollout_id uuid,p_worker_id text,p_lease_token uuid,p_lease_until timestamptz
) RETURNS TABLE(board_id uuid,migration_job_id uuid,attempt integer,lease_token uuid,lease_epoch bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  v_status text; v_config jsonb; v_global integer; v_tenant integer; v_rate integer;
  v_last_org text; v_rate_ready boolean; v_next_org text; v_active bigint; v_exp record;
BEGIN
  IF current_setting('app.current_org',true) IS DISTINCT FROM p_org_id OR p_rollout_id IS NULL OR p_lease_token IS NULL
    OR p_org_id='' OR length(p_org_id)>200 OR p_worker_id !~ '^[A-Za-z0-9._:-]{1,200}$' OR p_lease_until IS NULL
    OR p_lease_until<=clock_timestamp() OR p_lease_until>clock_timestamp()+interval '1 hour' THEN
    RAISE EXCEPTION 'ROLLOUT_ADMISSION_INVALID';
  END IF;
  SELECT r.status,r.config INTO v_status,v_config FROM public.whiteboard_content_rollouts r
    WHERE r.org_id=p_org_id AND r.rollout_id=p_rollout_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ROLLOUT_NOT_FOUND'; END IF;
  IF v_status<>'running' THEN RETURN; END IF;
  v_global := (v_config->>'globalConcurrency')::integer;
  v_tenant := (v_config->>'tenantConcurrency')::integer;
  v_rate := (v_config->>'ratePerSecond')::integer;
  IF v_global NOT BETWEEN 1 AND 64 OR v_tenant NOT BETWEEN 1 AND 32 OR v_tenant>v_global OR v_rate NOT BETWEEN 1 AND 10000 THEN
    RAISE EXCEPTION 'ROLLOUT_CONFIG_INVALID';
  END IF;
  INSERT INTO public.whiteboard_content_rollout_limiters(rollout_id,global_concurrency,rate_per_second)
    VALUES(p_rollout_id,v_global,v_rate) ON CONFLICT(rollout_id) DO NOTHING;
  SELECT l.last_org_id,l.next_launch_at<=clock_timestamp() INTO v_last_org,v_rate_ready
    FROM public.whiteboard_content_rollout_limiters l WHERE l.rollout_id=p_rollout_id
    AND l.global_concurrency=v_global AND l.rate_per_second=v_rate FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ROLLOUT_GLOBAL_CONFIG_CONFLICT'; END IF;
  DELETE FROM public.whiteboard_content_rollout_global_leases g WHERE g.rollout_id=p_rollout_id AND g.lease_until<=clock_timestamp();
  DELETE FROM public.whiteboard_content_rollout_contenders c WHERE c.rollout_id=p_rollout_id AND c.waiting_until<=clock_timestamp();
  INSERT INTO public.whiteboard_content_rollout_contenders(rollout_id,org_id,waiting_until)
    VALUES(p_rollout_id,p_org_id,p_lease_until) ON CONFLICT(rollout_id,org_id) DO UPDATE SET waiting_until=excluded.waiting_until;
  SELECT c.org_id INTO v_next_org FROM public.whiteboard_content_rollout_contenders c WHERE c.rollout_id=p_rollout_id
    ORDER BY CASE WHEN v_last_org IS NULL OR c.org_id>v_last_org THEN 0 ELSE 1 END,c.org_id LIMIT 1;
  IF v_next_org IS DISTINCT FROM p_org_id OR NOT v_rate_ready THEN RETURN; END IF;
  SELECT count(*) INTO v_active FROM public.whiteboard_content_rollout_global_leases g WHERE g.rollout_id=p_rollout_id;
  IF v_active>=v_global THEN RETURN; END IF;

  FOR v_exp IN
    WITH expired AS (SELECT i.board_id,i.attempts,i.lease_token FROM public.whiteboard_content_rollout_items i
      WHERE i.org_id=p_org_id AND i.rollout_id=p_rollout_id AND i.state='running' AND i.lease_until<=clock_timestamp() FOR UPDATE),
    changed AS (UPDATE public.whiteboard_content_rollout_items i SET state='retry',lease_owner=NULL,lease_token=NULL,
      lease_until=NULL,next_attempt_at=clock_timestamp(),last_error_code='LEASE_EXPIRED',updated_at=clock_timestamp()
      FROM expired e WHERE i.org_id=p_org_id AND i.rollout_id=p_rollout_id AND i.board_id=e.board_id
      AND i.lease_token=e.lease_token RETURNING e.board_id,e.attempts,e.lease_token)
    SELECT * FROM changed
  LOOP
    DELETE FROM public.whiteboard_content_rollout_global_leases g WHERE g.lease_token=v_exp.lease_token;
    UPDATE public.whiteboard_content_rollouts r SET retried=retried+1,
      scanned=scanned+CASE WHEN v_exp.attempts=1 THEN 1 ELSE 0 END,updated_at=clock_timestamp()
      WHERE r.org_id=p_org_id AND r.rollout_id=p_rollout_id;
    INSERT INTO public.whiteboard_content_rollout_events(org_id,rollout_id,board_id,kind,code,detail)
      VALUES(p_org_id,p_rollout_id,v_exp.board_id,'outcome','LEASE_EXPIRED',jsonb_build_object('attempt',v_exp.attempts));
  END LOOP;

  SELECT count(*) INTO v_active FROM public.whiteboard_content_rollout_items i
    WHERE i.org_id=p_org_id AND i.rollout_id=p_rollout_id AND i.state='running';
  IF v_active>=v_tenant THEN RETURN; END IF;
  WITH candidate AS (SELECT i.board_id FROM public.whiteboard_content_rollout_items i
    WHERE i.org_id=p_org_id AND i.rollout_id=p_rollout_id AND i.state IN ('queued','retry')
    AND i.next_attempt_at<=clock_timestamp() ORDER BY i.board_id LIMIT 1 FOR UPDATE SKIP LOCKED)
  UPDATE public.whiteboard_content_rollout_items i SET state='running',attempts=i.attempts+1,lease_owner=p_worker_id,
    lease_token=p_lease_token,lease_epoch=i.lease_epoch+1,lease_until=p_lease_until,updated_at=clock_timestamp()
    FROM candidate c WHERE i.org_id=p_org_id AND i.rollout_id=p_rollout_id AND i.board_id=c.board_id
    RETURNING i.board_id,i.migration_job_id,i.attempts,i.lease_token,i.lease_epoch
    INTO board_id,migration_job_id,attempt,lease_token,lease_epoch;
  IF NOT FOUND THEN
    DELETE FROM public.whiteboard_content_rollout_contenders c WHERE c.rollout_id=p_rollout_id AND c.org_id=p_org_id;
    RETURN;
  END IF;
  INSERT INTO public.whiteboard_content_rollout_global_leases(lease_token,rollout_id,lease_until)
    VALUES(p_lease_token,p_rollout_id,p_lease_until);
  UPDATE public.whiteboard_content_rollout_limiters l SET last_org_id=p_org_id,
    next_launch_at=clock_timestamp()+((1.0/v_rate)*interval '1 second'),updated_at=clock_timestamp()
    WHERE l.rollout_id=p_rollout_id;
  RETURN NEXT;
END $$;

CREATE OR REPLACE FUNCTION release_whiteboard_content_rollout_admission(
  p_org_id text,p_rollout_id uuid,p_board_id uuid,p_migration_job_id uuid,p_owner text,
  p_token uuid,p_epoch bigint,p_attempt integer
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_deleted boolean;
BEGIN
  IF current_setting('app.current_org',true) IS DISTINCT FROM p_org_id OR p_rollout_id IS NULL OR p_board_id IS NULL
    OR p_migration_job_id IS NULL OR p_token IS NULL OR p_owner !~ '^[A-Za-z0-9._:-]{1,200}$'
    OR p_epoch<1 OR p_attempt<1 THEN RAISE EXCEPTION 'ROLLOUT_RELEASE_INVALID'; END IF;
  DELETE FROM public.whiteboard_content_rollout_global_leases g WHERE g.rollout_id=p_rollout_id AND g.lease_token=p_token
    AND EXISTS (SELECT 1 FROM public.whiteboard_content_rollout_items i WHERE i.org_id=p_org_id AND i.rollout_id=p_rollout_id
      AND i.board_id=p_board_id AND i.migration_job_id=p_migration_job_id AND i.state='running'
      AND i.lease_owner=p_owner AND i.lease_token=p_token AND i.lease_epoch=p_epoch AND i.attempts=p_attempt
      AND i.lease_until>clock_timestamp()) RETURNING true INTO v_deleted;
  RETURN coalesce(v_deleted,false);
END $$;

CREATE OR REPLACE FUNCTION invalidate_whiteboard_content_rollout_leases(
  p_org_id text,p_rollout_id uuid,p_status text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_lease record;
BEGIN
  IF current_setting('app.current_org',true) IS DISTINCT FROM p_org_id OR p_rollout_id IS NULL
    OR p_status NOT IN ('paused','cancelled') THEN
    RAISE EXCEPTION 'ROLLOUT_CONTROL_INVALID';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.whiteboard_content_rollouts r WHERE r.org_id=p_org_id AND r.rollout_id=p_rollout_id AND r.status=p_status) THEN
    RAISE EXCEPTION 'ROLLOUT_CONTROL_STALE';
  END IF;
  FOR v_lease IN SELECT i.board_id,i.lease_token,i.lease_epoch FROM public.whiteboard_content_rollout_items i
    WHERE i.org_id=p_org_id AND i.rollout_id=p_rollout_id AND i.state='running' FOR UPDATE
  LOOP
    DELETE FROM public.whiteboard_content_rollout_global_leases g WHERE g.lease_token=v_lease.lease_token;
    UPDATE public.whiteboard_content_rollout_items i SET state=CASE WHEN p_status='paused' THEN 'queued' ELSE 'cancelled' END,
      attempts=CASE WHEN p_status='paused' THEN greatest(0,attempts-1) ELSE attempts END,
      lease_owner=NULL,lease_token=NULL,lease_until=NULL,next_attempt_at=clock_timestamp(),updated_at=clock_timestamp()
      WHERE i.org_id=p_org_id AND i.rollout_id=p_rollout_id AND i.board_id=v_lease.board_id
      AND i.lease_token=v_lease.lease_token AND i.lease_epoch=v_lease.lease_epoch;
  END LOOP;
  IF p_status='cancelled' THEN
    UPDATE public.whiteboard_content_rollout_items i SET state='cancelled',updated_at=clock_timestamp()
      WHERE i.org_id=p_org_id AND i.rollout_id=p_rollout_id AND i.state IN ('queued','retry');
  END IF;
END $$;

ALTER FUNCTION claim_whiteboard_content_rollout_admission(text,uuid,text,uuid,timestamptz) OWNER TO board_rollout_admission_owner;
ALTER FUNCTION release_whiteboard_content_rollout_admission(text,uuid,uuid,uuid,text,uuid,bigint,integer) OWNER TO board_rollout_admission_owner;
ALTER FUNCTION invalidate_whiteboard_content_rollout_leases(text,uuid,text) OWNER TO board_rollout_admission_owner;
REVOKE ALL ON FUNCTION claim_whiteboard_content_rollout_admission(text,uuid,text,uuid,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION release_whiteboard_content_rollout_admission(text,uuid,uuid,uuid,text,uuid,bigint,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION invalidate_whiteboard_content_rollout_leases(text,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_whiteboard_content_rollout_admission(text,uuid,text,uuid,timestamptz) TO app_rw;
GRANT EXECUTE ON FUNCTION release_whiteboard_content_rollout_admission(text,uuid,uuid,uuid,text,uuid,bigint,integer) TO app_rw;
GRANT EXECUTE ON FUNCTION invalidate_whiteboard_content_rollout_leases(text,uuid,text) TO app_rw;
