import importlib.util
from pathlib import Path
import unittest
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('acl_capture',ROOT/'scripts/schema-acl-source-prepare.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class Capture(unittest.TestCase):
 def good(self):return {'database':'workspacex','role':'postgres','bytes':1000,'ledger':{'old.sql':'a'*64},'roles':[],'memberships':[],'roleSettings':[],'catalog':{'schema:public':{'owner':'pg_database_owner'}}}
 def test_metadata_has_no_password_and_is_explicit_read_only(self):
  sql=m.query_sql('SELECT 1','postgres');self.assertTrue(sql.startswith('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;'));self.assertTrue(sql.endswith('ROLLBACK;'));self.assertNotIn('rolpassword',sql);self.assertNotIn('pg_authid',sql);self.assertNotIn("rolname<>'postgres'",sql);self.assertIn("left(rolname,3)<>'pg_'",sql);self.assertNotIn("LIKE 'pg_%'",sql)
 def test_password_or_wrong_source_or_over_limit_rejected(self):
  good=self.good();self.assertEqual(m.validate_capture(good,'us'),good)
  for patch in ({'password':'secret'},{'database':'wrong'},{'bytes':128*1024*1024+1},{'bytes':True}):
   with self.assertRaises(ValueError):m.validate_capture({**good,**patch},'us')
 def test_source_privilege_is_recorded_not_silently_dropped(self):
  role={'name':'provider_admin','login':False,'inherit':True,'superuser':True,'bypassrls':True,'createrole':True,'createdb':True,'replication':False}
  result=m.validate_capture({**self.good(),'roles':[role]},'us');self.assertTrue(result['roles'][0]['superuser'])
  with self.assertRaises(ValueError):m.validate_capture({**self.good(),'roles':[{**role,'password':'x'}]},'us')

import os
if os.environ.get('WSX_ACL_REAL')=='1':
 import sys,json
 sys.path.insert(0,str(Path(__file__).resolve().parent))
 import test_schema_restore_rehearsal_real as fixture
 class RealCapture(unittest.TestCase):
  run_docker=fixture.RealRestore.run_docker;psql=fixture.RealRestore.psql;remove_source=fixture.RealRestore.remove_source
  def setUp(self):fixture.RealRestore.setUp(self)
  def test_actual_pg_catalog_snapshot_readonly_and_password_free(self):
   a=importlib.util.spec_from_file_location('acl',ROOT/'scripts/schema-acl-rehearsal.py');acl=importlib.util.module_from_spec(a);a.loader.exec_module(acl)
   sql=m.query_sql(acl.CATALOG_SQL,'postgres');before=self.psql('SELECT count(*) FROM _kernel_migrations')
   raw=self.run_docker('exec','--user','postgres',self.cid,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','--username=postgres','--dbname=workspacex','-c',sql)
   value=m.validate_capture(json.loads(raw),'us')
   self.assertEqual(value['ledger'],self.ledger);self.assertIn('relation:public.billing_orders',value['catalog']);self.assertEqual(self.psql('SELECT count(*) FROM _kernel_migrations'),before)
   self.assertEqual(set(value['roles'][0]),{'name','login','inherit','superuser','bypassrls','createrole','createdb','replication'})
if __name__=='__main__':unittest.main()

class CnApiBinding(unittest.TestCase):
 def test_other_port_cannot_be_claimed_as_same_source(self):
  env={'PGHOST':'fixed','PGDATABASE':'db','PGPORT':'5433','APP_DB_USER':'app_rw'}
  with self.assertRaises(ValueError):m.cn_api_binding(env,'fixed','db')
  env['PGPORT']='5432';m.cn_api_binding(env,'fixed','db')
