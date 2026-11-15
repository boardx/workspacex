SET client_min_messages=warning;
SELECT jsonb_build_object(
 'schemaDigest',md5(jsonb_build_object(
  'columns',(SELECT jsonb_agg(jsonb_build_array(column_name,data_type,is_nullable,column_default) ORDER BY ordinal_position) FROM information_schema.columns WHERE table_schema='public' AND table_name='aidt_stage_revisions'),
  'constraints',(SELECT jsonb_agg(pg_get_constraintdef(oid) ORDER BY conname) FROM pg_constraint WHERE conrelid='aidt_stage_revisions'::regclass),
  'policies',(SELECT jsonb_agg(jsonb_build_array(polname,polpermissive,polcmd,pg_get_expr(polqual,polrelid),pg_get_expr(polwithcheck,polrelid)) ORDER BY polname) FROM pg_policy WHERE polrelid='aidt_stage_revisions'::regclass),
  'grants',(SELECT jsonb_agg(jsonb_build_array(grantee,privilege_type) ORDER BY grantee,privilege_type) FROM information_schema.role_table_grants WHERE table_schema='public' AND table_name='aidt_stage_revisions'),
  'rls',(SELECT jsonb_build_array(relrowsecurity,relforcerowsecurity) FROM pg_class WHERE oid='aidt_stage_revisions'::regclass)
 )::text),
 'dataDigest',(SELECT md5(COALESCE(string_agg(to_jsonb(r)::text,E'\n' ORDER BY to_jsonb(r)::text),'')) FROM aidt_stage_revisions r),
 'rowCount',(SELECT count(*) FROM aidt_stage_revisions)) AS original_snapshot\gset
BEGIN;
LOCK TABLE aidt_stage_revisions IN SHARE MODE;
CREATE FUNCTION pg_temp.aidt_probe_snapshot() RETURNS jsonb LANGUAGE sql AS $$SELECT jsonb_build_object(
 'schemaDigest',md5(jsonb_build_object(
  'columns',(SELECT jsonb_agg(jsonb_build_array(column_name,data_type,is_nullable,column_default) ORDER BY ordinal_position) FROM information_schema.columns WHERE table_schema='public' AND table_name='aidt_stage_revisions'),
  'constraints',(SELECT jsonb_agg(pg_get_constraintdef(oid) ORDER BY conname) FROM pg_constraint WHERE conrelid='aidt_stage_revisions'::regclass),
  'policies',(SELECT jsonb_agg(jsonb_build_array(polname,polpermissive,polcmd,pg_get_expr(polqual,polrelid),pg_get_expr(polwithcheck,polrelid)) ORDER BY polname) FROM pg_policy WHERE polrelid='aidt_stage_revisions'::regclass),
  'grants',(SELECT jsonb_agg(jsonb_build_array(grantee,privilege_type) ORDER BY grantee,privilege_type) FROM information_schema.role_table_grants WHERE table_schema='public' AND table_name='aidt_stage_revisions'),
  'rls',(SELECT jsonb_build_array(relrowsecurity,relforcerowsecurity) FROM pg_class WHERE oid='aidt_stage_revisions'::regclass)
 )::text),
 'dataDigest',(SELECT md5(COALESCE(string_agg(to_jsonb(r)::text,E'\n' ORDER BY to_jsonb(r)::text),'')) FROM aidt_stage_revisions r),
 'rowCount',(SELECT count(*) FROM aidt_stage_revisions)) AS snapshot$$;
INSERT INTO aidt_stage_revisions(org_id,project_id,stage_id,revision,content,source_stage_revisions,updated_by,operation_id,request_key)
 SELECT p.org_id,p.id,1,COALESCE((SELECT max(revision) FROM aidt_stage_revisions s WHERE s.org_id=p.org_id AND s.project_id=p.id AND s.stage_id=1),0)+1,
 '{"schemaVersion":1,"draft":{"fields":{},"ideas":[],"selectedIdeaId":""}}'::jsonb,'[]'::jsonb,'migration-replay-synthetic-probe',gen_random_uuid(),'synthetic-rollback-only'
 FROM projects p ORDER BY (p.kind='general') DESC,p.id LIMIT 1;
 CREATE TEMP TABLE aidt_replay_probe(phase text,payload jsonb) ON COMMIT DROP;
 INSERT INTO aidt_replay_probe VALUES('before',pg_temp.aidt_probe_snapshot());
-- User-approved A: shared working drafts, append-only; no completion or consensus state.
CREATE TABLE IF NOT EXISTS aidt_stage_revisions (
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  stage_id integer NOT NULL CHECK(stage_id BETWEEN 1 AND 6),
  revision integer NOT NULL CHECK(revision > 0),
  content jsonb NOT NULL CHECK(jsonb_typeof(content)='object' AND content->>'schemaVersion'='1'),
  source_stage_revisions jsonb NOT NULL CHECK(jsonb_typeof(source_stage_revisions)='array'),
  updated_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  operation_id uuid NOT NULL,
  request_key text NOT NULL,
  PRIMARY KEY(org_id,project_id,stage_id,revision),
  UNIQUE(org_id,project_id,updated_by,operation_id),
  FOREIGN KEY(project_id,org_id) REFERENCES projects(id,org_id) ON DELETE CASCADE
);
ALTER TABLE aidt_stage_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE aidt_stage_revisions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS aidt_stage_revisions_tenant ON aidt_stage_revisions;
CREATE POLICY aidt_stage_revisions_tenant ON aidt_stage_revisions
  USING(org_id=current_setting('app.current_org',true))
  WITH CHECK(org_id=current_setting('app.current_org',true));
REVOKE ALL ON aidt_stage_revisions FROM app_rw;
GRANT SELECT,INSERT ON aidt_stage_revisions TO app_rw;
-- Single-column project FK makes this table discoverable by existing archive policy installer.
SELECT kernel_apply_org_freeze_policies();
SELECT kernel_apply_project_archive_policies();
COMMENT ON TABLE aidt_stage_revisions IS 'AIDT student-authored shared working drafts, not verified evidence or learning completion. Immutable revisions and actor-scoped operation receipt.';

INSERT INTO aidt_replay_probe VALUES('first',pg_temp.aidt_probe_snapshot());
-- User-approved A: shared working drafts, append-only; no completion or consensus state.
CREATE TABLE IF NOT EXISTS aidt_stage_revisions (
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  stage_id integer NOT NULL CHECK(stage_id BETWEEN 1 AND 6),
  revision integer NOT NULL CHECK(revision > 0),
  content jsonb NOT NULL CHECK(jsonb_typeof(content)='object' AND content->>'schemaVersion'='1'),
  source_stage_revisions jsonb NOT NULL CHECK(jsonb_typeof(source_stage_revisions)='array'),
  updated_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  operation_id uuid NOT NULL,
  request_key text NOT NULL,
  PRIMARY KEY(org_id,project_id,stage_id,revision),
  UNIQUE(org_id,project_id,updated_by,operation_id),
  FOREIGN KEY(project_id,org_id) REFERENCES projects(id,org_id) ON DELETE CASCADE
);
ALTER TABLE aidt_stage_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE aidt_stage_revisions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS aidt_stage_revisions_tenant ON aidt_stage_revisions;
CREATE POLICY aidt_stage_revisions_tenant ON aidt_stage_revisions
  USING(org_id=current_setting('app.current_org',true))
  WITH CHECK(org_id=current_setting('app.current_org',true));
REVOKE ALL ON aidt_stage_revisions FROM app_rw;
GRANT SELECT,INSERT ON aidt_stage_revisions TO app_rw;
-- Single-column project FK makes this table discoverable by existing archive policy installer.
SELECT kernel_apply_org_freeze_policies();
SELECT kernel_apply_project_archive_policies();
COMMENT ON TABLE aidt_stage_revisions IS 'AIDT student-authored shared working drafts, not verified evidence or learning completion. Immutable revisions and actor-scoped operation receipt.';

INSERT INTO aidt_replay_probe VALUES('second',pg_temp.aidt_probe_snapshot());
DO $$ BEGIN IF (SELECT count(DISTINCT payload) FROM aidt_replay_probe)<>1 THEN RAISE EXCEPTION 'replay state changed'; END IF;
 IF (SELECT (payload->>'rowCount')::integer FROM aidt_replay_probe WHERE phase='before')<1 THEN RAISE EXCEPTION 'populated probe missing'; END IF; END $$;
 SELECT jsonb_build_object('replayPassed',true,'syntheticFixtureRolledBack',true,'snapshots',(SELECT jsonb_object_agg(phase,payload) FROM aidt_replay_probe));
 ROLLBACK;
SELECT jsonb_build_object(
 'schemaDigest',md5(jsonb_build_object(
  'columns',(SELECT jsonb_agg(jsonb_build_array(column_name,data_type,is_nullable,column_default) ORDER BY ordinal_position) FROM information_schema.columns WHERE table_schema='public' AND table_name='aidt_stage_revisions'),
  'constraints',(SELECT jsonb_agg(pg_get_constraintdef(oid) ORDER BY conname) FROM pg_constraint WHERE conrelid='aidt_stage_revisions'::regclass),
  'policies',(SELECT jsonb_agg(jsonb_build_array(polname,polpermissive,polcmd,pg_get_expr(polqual,polrelid),pg_get_expr(polwithcheck,polrelid)) ORDER BY polname) FROM pg_policy WHERE polrelid='aidt_stage_revisions'::regclass),
  'grants',(SELECT jsonb_agg(jsonb_build_array(grantee,privilege_type) ORDER BY grantee,privilege_type) FROM information_schema.role_table_grants WHERE table_schema='public' AND table_name='aidt_stage_revisions'),
  'rls',(SELECT jsonb_build_array(relrowsecurity,relforcerowsecurity) FROM pg_class WHERE oid='aidt_stage_revisions'::regclass)
 )::text),
 'dataDigest',(SELECT md5(COALESCE(string_agg(to_jsonb(r)::text,E'\n' ORDER BY to_jsonb(r)::text),'')) FROM aidt_stage_revisions r),
 'rowCount',(SELECT count(*) FROM aidt_stage_revisions)) AS snapshot;
SELECT jsonb_build_object(
 'schemaDigest',md5(jsonb_build_object(
  'columns',(SELECT jsonb_agg(jsonb_build_array(column_name,data_type,is_nullable,column_default) ORDER BY ordinal_position) FROM information_schema.columns WHERE table_schema='public' AND table_name='aidt_stage_revisions'),
  'constraints',(SELECT jsonb_agg(pg_get_constraintdef(oid) ORDER BY conname) FROM pg_constraint WHERE conrelid='aidt_stage_revisions'::regclass),
  'policies',(SELECT jsonb_agg(jsonb_build_array(polname,polpermissive,polcmd,pg_get_expr(polqual,polrelid),pg_get_expr(polwithcheck,polrelid)) ORDER BY polname) FROM pg_policy WHERE polrelid='aidt_stage_revisions'::regclass),
  'grants',(SELECT jsonb_agg(jsonb_build_array(grantee,privilege_type) ORDER BY grantee,privilege_type) FROM information_schema.role_table_grants WHERE table_schema='public' AND table_name='aidt_stage_revisions'),
  'rls',(SELECT jsonb_build_array(relrowsecurity,relforcerowsecurity) FROM pg_class WHERE oid='aidt_stage_revisions'::regclass)
 )::text),
 'dataDigest',(SELECT md5(COALESCE(string_agg(to_jsonb(r)::text,E'\n' ORDER BY to_jsonb(r)::text),'')) FROM aidt_stage_revisions r),
 'rowCount',(SELECT count(*) FROM aidt_stage_revisions)) AS rollback_snapshot\gset
SELECT jsonb_build_object('rollbackRestoredOriginal', :'original_snapshot'::jsonb=:'rollback_snapshot'::jsonb, 'originalSnapshot',:'original_snapshot'::jsonb);
