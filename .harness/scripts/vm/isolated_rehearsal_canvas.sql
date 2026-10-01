BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='60s';
CREATE TEMP TABLE before_templates AS SELECT * FROM public.canvas_templates;
-- Migration replay injected by the hash-bound stage supervisor.
-- Migration replay injected by the hash-bound stage supervisor.
DO $$ BEGIN
 IF EXISTS ((SELECT * FROM before_templates EXCEPT SELECT * FROM public.canvas_templates) UNION ALL (SELECT * FROM public.canvas_templates EXCEPT SELECT * FROM before_templates)) THEN RAISE EXCEPTION 'template conservation failed'; END IF;
 IF has_table_privilege('app_rw','public.canvas_template_audit','INSERT') OR has_table_privilege('app_rw','public.canvas_template_audit','UPDATE') OR has_table_privilege('app_rw','public.canvas_template_audit','DELETE') THEN RAISE EXCEPTION 'runtime audit write ACL'; END IF;
 IF NOT has_table_privilege('app_rw','public.canvas_template_audit','SELECT') THEN RAISE EXCEPTION 'runtime SELECT missing'; END IF;
END $$;
DO $$ DECLARE seq text; BEGIN
 IF (SELECT count(*) FROM pg_trigger WHERE tgrelid='public.canvas_templates'::regclass AND tgname='canvas_templates_audit_trg' AND NOT tgisinternal)<>1 THEN RAISE EXCEPTION 'audit trigger cardinality'; END IF;
 IF (SELECT count(*) FROM pg_trigger WHERE tgrelid='public.canvas_template_audit'::regclass AND tgname='canvas_template_audit_append_only_trg' AND NOT tgisinternal)<>1 THEN RAISE EXCEPTION 'append-only trigger cardinality'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_index WHERE indexrelid='public.canvas_template_audit_version_idx'::regclass AND indrelid='public.canvas_template_audit'::regclass AND indisvalid AND indisready AND NOT indisunique AND pg_get_indexdef(indexrelid,1,true)='org_id' AND pg_get_indexdef(indexrelid,2,true)='key' AND pg_get_indexdef(indexrelid,3,true)='version' AND pg_get_indexdef(indexrelid,4,true)='id' AND indnatts=4) THEN RAISE EXCEPTION 'audit index unavailable'; END IF;
 IF (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='canvas_template_audit' AND policyname IN ('canvas_template_audit_tenant','canvas_template_audit_org_frozen_ins','canvas_template_audit_org_frozen_upd','canvas_template_audit_org_frozen_del'))<>4 THEN RAISE EXCEPTION 'audit policies incomplete'; END IF;
 IF (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='canvas_template_audit' AND policyname LIKE 'canvas_template_audit_org_frozen_%' AND permissive='RESTRICTIVE')<>3 THEN RAISE EXCEPTION 'freeze policies not restrictive'; END IF;
 seq:=pg_get_serial_sequence('public.canvas_template_audit','id');
 IF seq IS NULL OR NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.canvas_template_audit'::regclass AND attname='id' AND attidentity='a') THEN RAISE EXCEPTION 'identity sequence absent'; END IF;
 -- Sequence ownership need not be app_rw: successful inserts below must use definer.
 IF has_sequence_privilege('app_rw',seq,'USAGE') OR has_sequence_privilege('app_rw',seq,'UPDATE') THEN RAISE EXCEPTION 'unexpected runtime sequence write privilege'; END IF;
END $$;
SELECT pg_get_serial_sequence('public.canvas_template_audit','id') AS audit_sequence;
SELECT p.proname,r.rolname,r.rolsuper,r.rolbypassrls,p.prosecdef,p.proconfig,p.proacl FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner WHERE p.oid='public.record_canvas_template_audit()'::regprocedure;
SELECT relrowsecurity,relforcerowsecurity,relacl FROM pg_class WHERE oid='public.canvas_template_audit'::regclass;
SELECT policyname,permissive,cmd FROM pg_policies WHERE schemaname='public' AND tablename='canvas_template_audit' ORDER BY policyname;
INSERT INTO organizations(id,name,kind) VALUES ('isolated-audit-probe-a','Isolated audit probe','organization'),('isolated-audit-probe-b','Isolated audit peer','organization');
-- Actual migration/bootstrap identity, deliberately no tenant or actor setting.
SELECT set_config('app.current_org','',true),set_config('app.canvas_template_actor','',true),set_config('app.canvas_template_action','',true);
INSERT INTO canvas_templates(org_id,key,version,display_name,status,builtin,visibility,underlying_type,sections) VALUES ('isolated-audit-probe-a','isolated-audit-probe',1,'Probe','draft',false,'org-wide','canvas','[]');
SELECT set_config('app.current_org','isolated-audit-probe-a',true);
SET LOCAL ROLE app_rw;
INSERT INTO canvas_templates(org_id,key,version,display_name,status,builtin,visibility,underlying_type,sections) VALUES ('isolated-audit-probe-a','isolated-runtime-insert',1,'Runtime insert','draft',false,'org-wide','canvas','[]');
DO $$ BEGIN IF (SELECT count(*) FROM canvas_template_audit WHERE org_id='isolated-audit-probe-a' AND key='isolated-runtime-insert' AND actor_source='host' AND actor_id IS NULL)<>1 THEN RAISE EXCEPTION 'app_rw definer insert failed'; END IF; END $$;
UPDATE canvas_templates SET display_name='Old runtime edit' WHERE org_id='isolated-audit-probe-a' AND key='isolated-audit-probe';
UPDATE canvas_templates SET updated_at=clock_timestamp() WHERE org_id='isolated-audit-probe-a' AND key='isolated-audit-probe';
DO $$ BEGIN
 IF (SELECT count(*) FROM canvas_template_audit WHERE org_id='isolated-audit-probe-a' AND key='isolated-audit-probe')<>2 THEN RAISE EXCEPTION 'old-runtime/create/no-op audit count'; END IF;
 IF EXISTS(SELECT 1 FROM canvas_template_audit WHERE org_id='isolated-audit-probe-a' AND actor_source<>'host') THEN RAISE EXCEPTION 'host actor fabricated'; END IF;
 BEGIN DELETE FROM canvas_template_audit WHERE org_id='isolated-audit-probe-a'; RAISE EXCEPTION 'unexpected direct DELETE'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SAVEPOINT pooled_context;
SELECT set_config('app.canvas_template_actor','isolated-actor-probe',true),set_config('app.canvas_template_action','publish',true);
UPDATE canvas_templates SET display_name='Principal edit' WHERE org_id='isolated-audit-probe-a' AND key='isolated-runtime-insert';
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM canvas_template_audit WHERE key='isolated-runtime-insert' AND actor_id='isolated-actor-probe' AND actor_source='principal') THEN RAISE EXCEPTION 'principal context not applied'; END IF; END $$;
ROLLBACK TO SAVEPOINT pooled_context;
DO $$ BEGIN IF NULLIF(current_setting('app.canvas_template_actor',true),'') IS NOT NULL OR NULLIF(current_setting('app.canvas_template_action',true),'') IS NOT NULL THEN RAISE EXCEPTION 'savepoint context leak'; END IF; END $$;
SELECT set_config('app.current_org','isolated-audit-probe-b',true);
DO $$ BEGIN IF EXISTS(SELECT 1 FROM canvas_template_audit WHERE org_id='isolated-audit-probe-a') THEN RAISE EXCEPTION 'cross tenant leak'; END IF; END $$;
RESET ROLE;
SELECT set_config('app.current_org','isolated-audit-probe-a',true);
DO $$ BEGIN
 BEGIN UPDATE canvas_template_audit SET action='tampered' WHERE org_id='isolated-audit-probe-a'; RAISE EXCEPTION 'unexpected audit mutation'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'canvas template audit is append-only' THEN RAISE; END IF; END;
END $$;
UPDATE organizations SET status='disabled',disabled_at=now(),retention_until=now()+interval '1 day' WHERE id='isolated-audit-probe-a';
SET LOCAL ROLE app_rw;
DO $$ BEGIN
 BEGIN UPDATE canvas_templates SET display_name='Frozen mutation' WHERE org_id='isolated-audit-probe-a' AND key='isolated-audit-probe'; RAISE EXCEPTION 'frozen write accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
UPDATE organizations SET status='active',disabled_at=NULL,retention_until=NULL WHERE id='isolated-audit-probe-a';
DELETE FROM organizations WHERE id='isolated-audit-probe-a';
DO $$ BEGIN IF EXISTS(SELECT 1 FROM canvas_template_audit WHERE org_id='isolated-audit-probe-a') THEN RAISE EXCEPTION 'cascade orphan'; END IF; END $$;
ROLLBACK;
BEGIN;
SELECT set_config('app.canvas_template_actor','isolated-pooled-actor',true),set_config('app.canvas_template_action','publish',true);
COMMIT;
BEGIN;
DO $$ BEGIN IF NULLIF(current_setting('app.canvas_template_actor',true),'') IS NOT NULL OR NULLIF(current_setting('app.canvas_template_action',true),'') IS NOT NULL THEN RAISE EXCEPTION 'transaction context leaked on same pooled connection'; END IF; END $$;
ROLLBACK;
