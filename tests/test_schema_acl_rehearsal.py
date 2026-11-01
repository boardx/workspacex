import importlib.util
from pathlib import Path
import unittest
P=Path(__file__).resolve().parents[1]/'scripts/schema-acl-rehearsal.py'
def mod():
 s=importlib.util.spec_from_file_location('acl_rehearsal',P);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
class RoleBoundary(unittest.TestCase):
 def test_privileged_roles_and_unknown_fields_rejected(self):
  m=mod();good={'roles':[{'name':'app_rw','login':True,'inherit':True,'superuser':False,'bypassrls':False,'createrole':False,'createdb':False,'replication':False}],'memberships':[]}
  self.assertIn('CREATE ROLE',m.role_sql(good))
  for key in ('superuser','bypassrls','createrole','createdb','replication'):
   with self.assertRaises(ValueError):m.role_sql({**good,'roles':[{**good['roles'][0],key:True}]})
  with self.assertRaises(ValueError):m.role_sql({**good,'roles':[{**good['roles'][0],'password':'secret'}]})
 def test_memberships_cannot_grant_system_or_undefined_authority(self):
  m=mod()
  with self.assertRaises(ValueError):m.role_sql({'roles':[],'memberships':[{'role':'pg_read_all_data','member':'app_rw','admin':False}]})
if __name__=='__main__':unittest.main()

# Real Docker test deliberately explicit opt-in; the separate runner must enable
# it and have a cached official PostgreSQL image. Never uses production.
import os
if os.environ.get('WSX_ACL_REAL')=='1':
 import sys,json
 sys.path.insert(0,str(Path(__file__).resolve().parent))
 import test_schema_restore_rehearsal_real as fixture
 class RealOwnerAcl(unittest.TestCase):
  run_docker=fixture.RealRestore.run_docker
  psql=fixture.RealRestore.psql
  remove_source=fixture.RealRestore.remove_source
  assert_source_unchanged=fixture.RealRestore.assert_source_unchanged
  assert_rehearsal_cleaned=fixture.RealRestore.assert_rehearsal_cleaned
  def setUp(self):
   fixture.RealRestore.setUp(self);self.acl=mod()
   self.psql("""CREATE ROLE migration_admin LOGIN;
ALTER ROLE app_rw LOGIN;
GRANT USAGE,CREATE ON SCHEMA public TO migration_admin;
ALTER TABLE _kernel_migrations OWNER TO migration_admin;
ALTER TABLE billing_orders OWNER TO migration_admin;
ALTER TABLE billing_monthly_orders OWNER TO migration_admin;
ALTER TABLE billing_monthly_orders ADD COLUMN order_id uuid UNIQUE,ADD COLUMN user_id text;
CREATE TABLE credit_packages(package_id text PRIMARY KEY);
INSERT INTO credit_packages VALUES('synthetic-package');
ALTER TABLE credit_packages OWNER TO migration_admin;
ALTER TABLE billing_orders ADD COLUMN order_no text,ADD COLUMN owner_type text,ADD COLUMN owner_id text,ADD COLUMN created_by text,ADD COLUMN package_id text,ADD COLUMN amount_fen int,ADD COLUMN base_credits int,ADD COLUMN bonus_credits int,ADD COLUMN currency text,ADD COLUMN status text,ADD COLUMN expired_at timestamptz;
GRANT SELECT ON credit_packages,billing_orders,billing_monthly_orders TO app_rw;
GRANT INSERT ON billing_orders TO app_rw;
GRANT INSERT ON billing_monthly_orders TO app_rw;
ALTER DEFAULT PRIVILEGES FOR ROLE migration_admin IN SCHEMA public GRANT SELECT ON TABLES TO app_rw;""")
   def role(name):return {'name':name,'login':True,'inherit':True,'superuser':False,'bypassrls':False,'createrole':False,'createdb':False,'replication':False}
   self.snapshot={'roles':[role('app_rw'),role('migration_admin')],'memberships':json.loads(self.psql(self.acl.BUILTIN_MEMBERSHIPS_SQL)),'migrationRole':'migration_admin','catalog':json.loads(self.psql(self.acl.CATALOG_SQL))}
   self.archive.unlink();self.key.unlink()
   self.archive,self.key=self.acl.encrypt_dump([self.docker,'exec','--user','postgres',self.cid,'pg_dump','--format=custom','--username=postgres','--dbname=workspacex'],self.root)
  def test_acl_owner_and_real_role_sql(self):
   out=self.root/'acl-success';result=self.acl.rehearse(self.docker,self.image,self.archive,self.key,self.ledger,self.snapshot,self.files,out)
   self.assertEqual(result['scope'],'owner-acl-and-sql-only');self.assertEqual(result['apiBootstrap'],'NOT_PERFORMED');self.assert_source_unchanged();self.assert_rehearsal_cleaned(out)
  def test_create_source_roles_failure_persists_sanitized_stage(self):
   from unittest.mock import patch
   out=self.root/'roles-failed'
   with patch.object(self.acl,'role_sql',return_value='SELECT 1/0;'):
    with self.assertRaises(ValueError):self.acl.rehearse(self.docker,self.image,self.archive,self.key,self.ledger,self.snapshot,self.files,out)
   failure=json.loads((out/'failure.json').read_bytes());self.assertEqual(failure['stage'],'CREATE_SOURCE_ROLES');self.assertEqual(failure['code'],'CREATE_SOURCE_ROLES_FAILED');self.assertTrue(failure['cleanupComplete']);self.assert_source_unchanged();self.assert_rehearsal_cleaned(out)
  def test_changed_source_acl_is_refused(self):
   out=self.root/'acl-drift';self.snapshot['catalog']['schema:public']['owner']='wrong'
   with self.assertRaisesRegex(ValueError,'SOURCE_OWNER_ACL_DRIFT'):self.acl.rehearse(self.docker,self.image,self.archive,self.key,self.ledger,self.snapshot,self.files,out)
   self.assert_source_unchanged();self.assert_rehearsal_cleaned(out)

 class RealUSPostgres(RealOwnerAcl):
  def setUp(self):
   super().setUp()
   # Actual source postgres attributes, not synthetic superuser escalation.
   self.psql('ALTER TABLE _kernel_migrations OWNER TO postgres; ALTER TABLE billing_orders OWNER TO postgres; ALTER TABLE billing_monthly_orders OWNER TO postgres; ALTER TABLE credit_packages OWNER TO postgres; ALTER DEFAULT PRIVILEGES FOR ROLE migration_admin IN SCHEMA public REVOKE SELECT ON TABLES FROM app_rw; REVOKE ALL ON SCHEMA public FROM migration_admin; DROP ROLE migration_admin;')
   postgres=json.loads(self.psql(self.acl.POSTGRES_ROLE_SQL));self.snapshot['roles']=[r for r in self.snapshot['roles'] if r['name']=='app_rw']+[postgres];self.snapshot['migrationRole']='postgres';self.snapshot['catalog']=json.loads(self.psql(self.acl.CATALOG_SQL))
   self.archive.unlink();self.key.unlink();self.archive,self.key=self.acl.encrypt_dump([self.docker,'exec','--user','postgres',self.cid,'pg_dump','--format=custom','--username=postgres','--dbname=workspacex'],self.root)
  def test_us_builtin_role_matches_actual_source(self):
   out=self.root/'us-postgres';result=self.acl.rehearse(self.docker,self.image,self.archive,self.key,self.ledger,self.snapshot,self.files,out)
   self.assertEqual(result['status'],'OWNER_ACL_SQL_REHEARSED');self.assert_source_unchanged();self.assert_rehearsal_cleaned(out)
  def test_us_source_attributes_drift_is_refused(self):
   self.snapshot['roles'][-1]['bypassrls']=False;out=self.root/'us-postgres-drift'
   with self.assertRaisesRegex(ValueError,'POSTGRES_ROLE_ATTRIBUTES_DIFFER'):self.acl.rehearse(self.docker,self.image,self.archive,self.key,self.ledger,self.snapshot,self.files,out)
   self.assert_source_unchanged();self.assert_rehearsal_cleaned(out)

class ExistingPostgres(unittest.TestCase):
 def test_builtin_postgres_is_compared_never_created_or_elevated(self):
  m=mod();role={'name':'postgres','login':True,'inherit':True,'superuser':True,'bypassrls':True,'createrole':True,'createdb':True,'replication':True}
  self.assertEqual(m.role_sql({'roles':[role],'memberships':[]}),'')
  m.compare_builtin_postgres({'roles':[role]},role)
  for key in role.keys()-{'name'}:
   with self.assertRaises(ValueError):m.compare_builtin_postgres({'roles':[role]},{**role,key:not role[key]})

class BuiltinGrants(unittest.TestCase):
 def test_builtin_graph_is_verified_without_grant_or_escalation(self):
  m=mod();edge={'role':'pg_read_all_stats','member':'pg_monitor','admin':False,'inherit':True,'set':True}
  self.assertEqual(m.role_sql({'roles':[],'memberships':[edge]}),'')
  m.compare_builtin_memberships({'memberships':[edge]},[edge])
  for actual in ([],[{**edge,'admin':True}]):
   with self.assertRaisesRegex(ValueError,'BUILTIN_MEMBERSHIPS_DIFFER'):m.compare_builtin_memberships({'memberships':[edge]},actual)

if os.environ.get('WSX_ACL_REAL')=='1':
 class RealCatalogSemantics(unittest.TestCase):
  run_docker=fixture.RealRestore.run_docker;psql=fixture.RealRestore.psql;remove_source=fixture.RealRestore.remove_source
  def setUp(self):fixture.RealRestore.setUp(self);self.acl=mod()
  def catalog(self):return json.loads(self.psql(self.acl.CATALOG_SQL))
  def test_owner_default_explicit_acl_and_null_are_semantically_equal(self):
   before=self.catalog();self.psql('GRANT ALL ON billing_orders TO postgres');self.assertEqual(before,self.catalog())
  def test_extra_grant_revoke_and_grant_option_remain_detectable(self):
   baseline=self.catalog();self.psql('GRANT SELECT ON billing_orders TO app_rw');granted=self.catalog();self.assertNotEqual(baseline,granted)
   self.psql('GRANT SELECT ON billing_orders TO app_rw WITH GRANT OPTION');option=self.catalog();self.assertNotEqual(granted,option)
   self.psql('REVOKE GRANT OPTION FOR SELECT ON billing_orders FROM app_rw');self.assertEqual(granted,self.catalog())
   self.psql('REVOKE SELECT ON billing_orders FROM app_rw');self.assertEqual(baseline,self.catalog())
  def test_revoked_owner_and_real_column_grants_are_not_defaults(self):
   baseline=self.catalog();self.psql('REVOKE SELECT ON billing_orders FROM postgres');self.assertNotEqual(baseline,self.catalog())
   self.psql('GRANT SELECT ON billing_orders TO postgres');self.assertEqual(baseline,self.catalog())
   self.psql('GRANT UPDATE(qr_code_url) ON billing_orders TO app_rw');column=self.catalog();self.assertNotEqual(baseline,column)
   self.psql('GRANT UPDATE(qr_code_url) ON billing_orders TO app_rw WITH GRANT OPTION');self.assertNotEqual(column,self.catalog())
  def test_sequence_function_and_default_privilege_kinds_are_normalized(self):
   self.psql("CREATE SEQUENCE acl_seq; CREATE FUNCTION public.acl_fn() RETURNS int LANGUAGE sql AS 'SELECT 1'; ALTER DEFAULT PRIVILEGES FOR ROLE postgres GRANT SELECT ON TABLES TO app_rw");baseline=self.catalog()
   self.psql('GRANT ALL ON SEQUENCE acl_seq TO postgres; GRANT ALL ON FUNCTION public.acl_fn() TO postgres');self.assertEqual(baseline,self.catalog())
   self.psql('GRANT USAGE ON SEQUENCE acl_seq TO app_rw');self.assertNotEqual(baseline,self.catalog())
  def test_grantor_difference_is_not_erased(self):
   self.psql('CREATE ROLE grantor_a; CREATE ROLE grantor_b; GRANT USAGE ON SCHEMA public TO grantor_a,grantor_b; GRANT SELECT ON billing_orders TO grantor_a,grantor_b WITH GRANT OPTION; SET ROLE grantor_a; GRANT SELECT ON billing_orders TO app_rw; RESET ROLE;');before=self.catalog()
   self.psql('SET ROLE grantor_a; REVOKE SELECT ON billing_orders FROM app_rw; RESET ROLE; SET ROLE grantor_b; GRANT SELECT ON billing_orders TO app_rw; RESET ROLE;');self.assertNotEqual(before,self.catalog())
  def test_unsupported_index_acl_content_is_preserved_strictly(self):
   self.psql("CREATE INDEX acl_unknown_index ON billing_orders(provider); UPDATE pg_class SET relacl=ARRAY['app_rw=r/postgres']::aclitem[] WHERE relname='acl_unknown_index'");before=self.catalog()
   self.psql("UPDATE pg_class SET relacl=ARRAY['app_rw=w/postgres']::aclitem[] WHERE relname='acl_unknown_index'");after=self.catalog()
   key='relation:public.acl_unknown_index';self.assertTrue(before[key]['unsupportedAclPresent']);self.assertTrue(after[key]['unsupportedAclPresent']);self.assertNotEqual(before[key]['unsupportedAclRaw'],after[key]['unsupportedAclRaw']);self.assertNotEqual(before,after)
  def test_index_rebuilt_attribute_names_do_not_create_permission_drift(self):
   self.psql('CREATE INDEX acl_fixture_index ON billing_orders(provider); ALTER TABLE billing_orders RENAME COLUMN provider TO provider_renamed');before=self.catalog()
   self.psql('DROP INDEX acl_fixture_index; CREATE INDEX acl_fixture_index ON billing_orders(provider_renamed)');self.assertEqual(before,self.catalog())

class FailureStages(unittest.TestCase):
 def test_failure_stage_is_stable_and_secret_error_is_redacted(self):
  m=mod();value=m.failure_receipt('CREATE_SOURCE_ROLES','password=secret-role-name',True)
  self.assertEqual(value['stage'],'CREATE_SOURCE_ROLES');self.assertEqual(value['code'],'CREATE_SOURCE_ROLES_FAILED');self.assertEqual(value['causeCode'],'REHEARSAL_FAILED');self.assertNotIn('secret',str(value))
  with self.assertRaises(ValueError):m.failure_receipt('arbitrary stage','QUERY_FAILED',True)
