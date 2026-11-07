import importlib.util
import json
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1]
def module(name):
 s=importlib.util.spec_from_file_location(name,ROOT/'scripts'/(name+'.py'));m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
m=module('schema-cn-acl-profile')
class Boundaries(unittest.TestCase):
 def test_source_only_permissions_and_no_password_fields(self):
  role={'name':'migration_admin','login':True,'inherit':True,'superuser':False,'bypassrls':True,'createrole':True,'createdb':True,'replication':True}
  quote=lambda x:'"'+x+'"'
  sql=m.role_sql({'roles':[role],'memberships':[]},quote);self.assertIn('BYPASSRLS',sql);self.assertIn('NOSUPERUSER',sql)
  with self.assertRaises(ValueError):m.role_sql({'roles':[{**role,'password':'secret'}],'memberships':[]},quote)
 def test_nonroot_no_capabilities_required(self):
  m.running_nonroot('Uid:\t999 999 999 999\nCapEff:\t0000000000000000\nNoNewPrivs:\t1')
  for text in ('Uid: 0 0 0 0\nCapEff: 0\nNoNewPrivs: 1','Uid: 999 999 999 999\nCapEff: 1\nNoNewPrivs: 1'):
   with self.assertRaises(ValueError):m.running_nonroot(text)
 def test_readback_rejects_added_or_changed_permission(self):
  snapshot={'roles':[{'name':'a','superuser':False}],'memberships':[]}
  with self.assertRaises(ValueError):m.readback(snapshot,[{'name':'a','superuser':True}],[])
  with self.assertRaises(ValueError):m.readback(snapshot,snapshot['roles'],[{'role':'a','member':'b'}])

import os
if os.environ.get('WSX_ACL_REAL')=='1':
 import sys
 sys.path.insert(0,str(Path(__file__).resolve().parent))
 import test_schema_acl_rehearsal as fixture
 class RealFaithful(unittest.TestCase):
  # Reuse fixture setup/helpers without inheriting its different default-policy tests.
  run_docker=fixture.RealOwnerAcl.run_docker
  psql=fixture.RealOwnerAcl.psql
  remove_source=fixture.RealOwnerAcl.remove_source
  assert_source_unchanged=fixture.RealOwnerAcl.assert_source_unchanged
  assert_rehearsal_cleaned=fixture.RealOwnerAcl.assert_rehearsal_cleaned
  def setUp(self):
   fixture.RealOwnerAcl.setUp(self)
   self.psql('ALTER ROLE migration_admin BYPASSRLS CREATEDB CREATEROLE REPLICATION; CREATE ROLE provider_admin SUPERUSER LOGIN;')
   self.snapshot['roles']=[json.loads(self.psql("SELECT json_build_object('name',rolname,'login',rolcanlogin,'inherit',rolinherit,'superuser',rolsuper,'bypassrls',rolbypassrls,'createrole',rolcreaterole,'createdb',rolcreatedb,'replication',rolreplication) FROM pg_roles WHERE rolname='"+name+"'")) for name in ('app_rw','migration_admin','provider_admin','postgres')]
   self.archive.unlink();self.key.unlink();self.archive,self.key=self.acl.encrypt_dump([self.docker,'exec','--user','postgres',self.cid,'pg_dump','--format=custom','--username=postgres','--dbname=workspacex'],self.root)
   self.write_profile()
  def write_profile(self):
   # Trust/identity below is explicitly a synthetic local fixture adapter; not host qualification.
   capture={'database':'workspacex_a1cb_20261006','role':'migration_admin','ledger':self.ledger,**{k:self.snapshot[k] for k in ('roles','memberships','catalog')}}
   records={'intent.json':{'environment':'cn','source':m.SOURCE,'tag':m.TAG},'source-capture.json':capture,'snapshot.json':self.snapshot,'receipt.json':{'status':'OWNER_ACL_SOURCE_CAPTURED','environment':'cn','archiveSha256':self.acl.file_sha(self.archive)}}
   for name,value in records.items():(self.root/name).write_text(json.dumps(value))
   records['receipt.json']['snapshotSha256']=self.acl.file_sha(self.root/'snapshot.json');(self.root/'receipt.json').write_text(json.dumps(records['receipt.json']))
   profile={'kind':'cn-source-faithful-isolated-clone-v1','environment':'cn','source':m.SOURCE,'tag':m.TAG,'captureDirectory':str(self.root),'files':{name:self.acl.file_sha(self.root/name) for name in m.FILES},'imageId':self.image,'createdAt':time.time()}
   self.profile=self.root/'profile.json';self.profile.write_text(json.dumps(profile))
  def test_profile_actual_nonroot_isolated_restore_and_source_privileges(self):
   with patch.object(self.acl,'load_cn_profile',return_value=m),patch.object(m,'trusted',side_effect=lambda p:Path(p)):
    result=self.acl.rehearse(self.docker,self.image,self.archive,self.key,self.ledger,self.snapshot,self.files,self.root/'faithful',cn_profile=self.profile)
   self.assertTrue(result['cnFaithfulSourceProfileUsed']);self.assertEqual(result['apiBootstrap'],'NOT_PERFORMED');self.assert_source_unchanged();self.assert_rehearsal_cleaned(self.root/'faithful')
  def test_privileged_source_without_profile_is_still_refused(self):
   output=self.root/'default-refused'
   with self.assertRaisesRegex(ValueError,'PRIVILEGED_ROLE_COPY_FORBIDDEN'):
    self.acl.rehearse(self.docker,self.image,self.archive,self.key,self.ledger,self.snapshot,self.files,output)
   self.assertFalse(output.exists());self.assert_source_unchanged()
  def test_profile_tampered_snapshot_refused_before_clone(self):
   (self.root/'snapshot.json').write_text('{}')
   with patch.object(self.acl,'load_cn_profile',return_value=m),patch.object(m,'trusted',side_effect=lambda p:Path(p)):
    with self.assertRaisesRegex(ValueError,'CN_PROFILE_PROOF_DRIFT'):self.acl.rehearse(self.docker,self.image,self.archive,self.key,self.ledger,self.snapshot,self.files,self.root/'refused',cn_profile=self.profile)
   self.assertFalse((self.root/'refused').exists())
 class RealCnNoPostgres(RealFaithful):
  def psql(self,sql):
   return self.run_docker('exec','--user','postgres',self.cid,'psql','-X','-w','-v','ON_ERROR_STOP=1','-At','--username='+getattr(self,'source_admin','postgres'),'--dbname=workspacex','-c',sql)
  def setUp(self):
   super().setUp()
   self.psql('CREATE ROLE rds_bootstrap SUPERUSER LOGIN;')
   self.source_admin='rds_bootstrap'
   self.psql('ALTER ROLE postgres RENAME TO rds_system_admin;')
   roles_query="SELECT COALESCE(json_agg(json_build_object('name',rolname,'login',rolcanlogin,'inherit',rolinherit,'superuser',rolsuper,'bypassrls',rolbypassrls,'createrole',rolcreaterole,'createdb',rolcreatedb,'replication',rolreplication) ORDER BY rolname),'[]'::json) FROM pg_roles WHERE left(rolname,3)<>'pg_'"
   self.snapshot['roles']=json.loads(self.psql(roles_query));self.snapshot['memberships']=json.loads(self.psql(self.acl.BUILTIN_MEMBERSHIPS_SQL));self.snapshot['catalog']=json.loads(self.psql(self.acl.CATALOG_SQL))
   self.archive.unlink();self.key.unlink();self.archive,self.key=self.acl.encrypt_dump([self.docker,'exec','--user','postgres',self.cid,'pg_dump','--format=custom','--username='+self.source_admin,'--dbname=workspacex'],self.root)
   self.write_profile()
  def test_no_postgres_source_actual_restore_and_scaffold_identity(self):
   self.assertNotIn('postgres',[r['name'] for r in self.snapshot['roles']])
   with patch.object(self.acl,'load_cn_profile',return_value=m),patch.object(m,'trusted',side_effect=lambda p:Path(p)):
    result=self.acl.rehearse(self.docker,self.image,self.archive,self.key,self.ledger,self.snapshot,self.files,self.root/'no-postgres',cn_profile=self.profile)
   self.assertEqual(result['cloneScaffoldingNotSourceRoles'],['postgres']);self.assertFalse(json.loads((self.root/'no-postgres'/'clone-bootstrap-role.json').read_bytes())['sourceRole']);self.assert_source_unchanged();self.assert_rehearsal_cleaned(self.root/'no-postgres')

if __name__=='__main__':unittest.main()

class CloneIsolation(unittest.TestCase):
 def row(self):
  return {'Id':'cid','Image':'image','Name':'/name','Config':{'User':'postgres','Labels':{'wsx.schema-rehearsal':'token'},'Env':['POSTGRES_HOST_AUTH_METHOD=trust','POSTGRES_DB=workspacex','PGDATA=/var/lib/postgresql/data/pgdata']},'HostConfig':{'NetworkMode':'none','ReadonlyRootfs':True,'CapDrop':['ALL'],'SecurityOpt':['no-new-privileges'],'Memory':1073741824,'PidsLimit':128,'NanoCpus':1000000000,'Tmpfs':{'/tmp':'','/var/run/postgresql':'','/var/lib/postgresql/data':''}},'Mounts':[{'Type':'tmpfs'}]}
 def check(self,row):return m.isolation(row,'cid','image','name','token',[])
 def test_network_ports_host_access_caps_and_secret_env_are_refused(self):
  self.check(self.row())
  for field,value in [('NetworkMode','host'),('Privileged',True),('Binds',['/var/run/docker.sock:/sock']),('PortBindings',{'5432/tcp':[]}),('ReadonlyRootfs',False),('CapDrop',[]),('PidMode','host'),('Memory',0)]:
   row=self.row();row['HostConfig'][field]=value
   with self.subTest(field=field),self.assertRaises(ValueError):self.check(row)
  row=self.row();row['Config']['Env'].append('MIGRATION_DB_PASSWORD=secret')
  with self.assertRaisesRegex(ValueError,'CN_CLONE_ENV'):self.check(row)

class MissingSourcePostgres(unittest.TestCase):
 def test_only_unchanged_initial_clone_scaffold_is_allowed(self):
  scaffold={'name':'postgres','superuser':True};app={'name':'app_rw','superuser':False};snapshot={'roles':[app],'memberships':[]}
  m.readback(snapshot,[app,scaffold],[],scaffold)
  for roles,initial in (([app,scaffold],None),([app,{**scaffold,'superuser':False}],scaffold),([app,scaffold,{'name':'extra'}],scaffold)):
   with self.assertRaises(ValueError):m.readback(snapshot,roles,[],initial)
