-- User approved the AIDT context bridge on 2026-11-16. Ordinary/legacy runs remain NULL.
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS aidt_selector_hash text;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='agent_runs_aidt_selector_hash_check') THEN
    ALTER TABLE agent_runs ADD CONSTRAINT agent_runs_aidt_selector_hash_check CHECK(aidt_selector_hash IS NULL OR aidt_selector_hash ~ '^[a-f0-9]{64}$');
  END IF;
END $$;
CREATE OR REPLACE FUNCTION aidt_run_selector_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF OLD.aidt_selector_hash IS DISTINCT FROM NEW.aidt_selector_hash THEN
    RAISE EXCEPTION 'AIDT run selector marker is immutable' USING ERRCODE='23514';
  END IF; RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS agent_runs_aidt_selector_immutable ON agent_runs;
CREATE TRIGGER agent_runs_aidt_selector_immutable BEFORE UPDATE OF aidt_selector_hash ON agent_runs FOR EACH ROW EXECUTE FUNCTION aidt_run_selector_immutable();

CREATE TABLE IF NOT EXISTS aidt_run_context_snapshots (
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  run_id text NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  thread_id text NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
  input_message_id text NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  requested_by text NOT NULL,
  selector_version integer NOT NULL DEFAULT 1 CHECK(selector_version=1),
  selector_json jsonb NOT NULL CHECK(jsonb_typeof(selector_json)='object' AND selector_json ?& ARRAY['schemaVersion','projectId'] AND selector_json->>'schemaVersion'='1'),
  selector_hash text NOT NULL CHECK(selector_hash ~ '^[a-f0-9]{64}$'),
  snapshot_version integer NOT NULL DEFAULT 1 CHECK(snapshot_version=1),
  snapshot_json jsonb NOT NULL CHECK(jsonb_typeof(snapshot_json)='object' AND snapshot_json ?& ARRAY['schemaVersion','selector'] AND snapshot_json->>'schemaVersion'='1'),
  snapshot_hash text NOT NULL CHECK(snapshot_hash ~ '^[a-f0-9]{64}$'),
  prepared_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(org_id,run_id),
  UNIQUE(org_id,run_id,snapshot_hash),
  FOREIGN KEY(org_id,run_id) REFERENCES agent_runs(org_id,id) ON DELETE CASCADE,
  FOREIGN KEY(project_id,org_id) REFERENCES projects(id,org_id) ON DELETE CASCADE,
  FOREIGN KEY(org_id,thread_id) REFERENCES chat_threads(org_id,id) ON DELETE CASCADE,
  CHECK(snapshot_json->'selector'=selector_json),
  CHECK(selector_json->>'projectId'=project_id)
);
CREATE TABLE IF NOT EXISTS aidt_run_context_applications (
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  run_id text NOT NULL,
  seq bigint NOT NULL CHECK(seq>0),
  attempt_id text NOT NULL,
  kind text NOT NULL CHECK(kind IN ('assembled','message-dispatch-observed','checkpoint-resume-observed','failed')),
  snapshot_hash text NOT NULL CHECK(snapshot_hash ~ '^[a-f0-9]{64}$'),
  event jsonb NOT NULL CHECK(jsonb_typeof(event)='object' AND event ?& ARRAY['kind','attemptId','snapshotHash'] AND event->>'kind'=kind AND event->>'attemptId'=attempt_id AND event->>'snapshotHash'=snapshot_hash),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(org_id,run_id,seq),
  FOREIGN KEY(org_id,run_id,snapshot_hash) REFERENCES aidt_run_context_snapshots(org_id,run_id,snapshot_hash) ON DELETE CASCADE
);
CREATE OR REPLACE FUNCTION aidt_snapshot_matches_run() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM agent_runs r JOIN chat_threads t ON t.org_id=r.org_id AND t.id=r.thread_id
    JOIN chat_messages m ON m.org_id=r.org_id AND m.id=r.input_message_id AND m.thread_id=t.id
    WHERE r.org_id=NEW.org_id AND r.id=NEW.run_id AND r.thread_id=NEW.thread_id
      AND r.input_message_id=NEW.input_message_id AND t.project_id=NEW.project_id
      AND m.author_kind='human' AND m.author_id=NEW.requested_by AND r.aidt_selector_hash=NEW.selector_hash) THEN
    RAISE EXCEPTION 'AIDT snapshot does not match accepted run' USING ERRCODE='23514';
  END IF; RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS aidt_snapshot_run_scope ON aidt_run_context_snapshots;
CREATE TRIGGER aidt_snapshot_run_scope BEFORE INSERT ON aidt_run_context_snapshots FOR EACH ROW EXECUTE FUNCTION aidt_snapshot_matches_run();
CREATE OR REPLACE FUNCTION aidt_context_append_only() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'AIDT context records are append only' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS aidt_snapshot_no_update ON aidt_run_context_snapshots;
CREATE TRIGGER aidt_snapshot_no_update BEFORE UPDATE ON aidt_run_context_snapshots FOR EACH ROW EXECUTE FUNCTION aidt_context_append_only();
DROP TRIGGER IF EXISTS aidt_application_no_update ON aidt_run_context_applications;
CREATE TRIGGER aidt_application_no_update BEFORE UPDATE ON aidt_run_context_applications FOR EACH ROW EXECUTE FUNCTION aidt_context_append_only();
ALTER TABLE aidt_run_context_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE aidt_run_context_snapshots FORCE ROW LEVEL SECURITY;
ALTER TABLE aidt_run_context_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE aidt_run_context_applications FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS aidt_run_context_snapshots_tenant ON aidt_run_context_snapshots;
CREATE POLICY aidt_run_context_snapshots_tenant ON aidt_run_context_snapshots USING(org_id=current_setting('app.current_org',true)) WITH CHECK(org_id=current_setting('app.current_org',true));
DROP POLICY IF EXISTS aidt_run_context_applications_tenant ON aidt_run_context_applications;
CREATE POLICY aidt_run_context_applications_tenant ON aidt_run_context_applications USING(org_id=current_setting('app.current_org',true)) WITH CHECK(org_id=current_setting('app.current_org',true));
REVOKE ALL ON aidt_run_context_snapshots,aidt_run_context_applications FROM app_rw;
GRANT SELECT,INSERT ON aidt_run_context_snapshots,aidt_run_context_applications TO app_rw;
SELECT kernel_apply_org_freeze_policies();
SELECT kernel_apply_project_archive_policies();
COMMENT ON TABLE aidt_run_context_snapshots IS 'Exact authorized shared AIDT source selection, not verified research or model receipt.';
COMMENT ON TABLE aidt_run_context_applications IS 'Actual AIDT assembly/native dispatch/checkpoint facts; no prompt bodies or synthetic tool events.';
