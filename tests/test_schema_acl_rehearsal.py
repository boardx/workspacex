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
