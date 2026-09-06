CREATE UNIQUE INDEX IF NOT EXISTS chat_threads_org_id_id_queue_idx ON chat_threads(org_id,id);
CREATE TABLE thread_message_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  thread_id text NOT NULL,
  actor_id text NOT NULL,
  client_request_id uuid NOT NULL,
  sequence bigint GENERATED ALWAYS AS IDENTITY,
  body text NOT NULL,
  agent_id text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','dispatched','cancelled','failed')),
  run_id text,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(org_id,thread_id,actor_id,client_request_id),
  FOREIGN KEY(org_id,thread_id) REFERENCES chat_threads(org_id,id) ON DELETE CASCADE,
  FOREIGN KEY(org_id,run_id) REFERENCES agent_runs(org_id,id)
);
CREATE INDEX thread_message_queue_pending ON thread_message_queue(org_id,thread_id,sequence) WHERE status='pending';
ALTER TABLE thread_message_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE thread_message_queue FORCE ROW LEVEL SECURITY;
CREATE POLICY thread_message_queue_tenant ON thread_message_queue
 USING(org_id=current_setting('app.current_org',true)) WITH CHECK(org_id=current_setting('app.current_org',true));
GRANT SELECT,INSERT,UPDATE ON thread_message_queue TO app_rw;
GRANT USAGE,SELECT ON SEQUENCE thread_message_queue_sequence_seq TO app_rw;
-- Discovery exposes tenant ids only. Content and mutation stay inside tenant-scoped transactions.
CREATE FUNCTION kernel_message_queue_orgs() RETURNS TABLE(org_id text)
 LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT DISTINCT q.org_id FROM thread_message_queue q LEFT JOIN agent_runs r ON r.org_id=q.org_id AND r.id=q.run_id
 WHERE q.status='pending' OR (q.status='dispatched' AND r.status IN ('queued','writeback_pending')) LIMIT 1000
$$;
REVOKE ALL ON FUNCTION kernel_message_queue_orgs() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION kernel_message_queue_orgs() TO app_rw;
SELECT kernel_apply_org_freeze_policies();
