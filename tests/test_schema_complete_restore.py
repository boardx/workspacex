import importlib.util
from pathlib import Path
import unittest
from unittest.mock import Mock,patch
ROOT=Path(__file__).resolve().parents[1]
def module():
 s=importlib.util.spec_from_file_location('complete',ROOT/'scripts/schema-complete-restore.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
class CompleteLedger(unittest.TestCase):
 def test_complete_is_exact_baseline_plus_three_and_never_baseline_mode(self):
  m=module();trusted=patch.object(m,'trusted',side_effect=lambda p:Path(p));trusted.start();self.addCleanup(trusted.stop);core=m.load('schema-restore-rehearsal');base={f'old_{i}.sql':'a'*64 for i in range(435)};complete={**base,**core.MIGRATIONS}
  m.check_complete_ledger(base,complete)
  for bad in [base,{**complete,'extra.sql':'b'*64},{**complete,next(iter(core.MIGRATIONS)):'c'*64}]:
   with self.assertRaises(ValueError):m.check_complete_ledger(base,bad)
  with self.assertRaises(ValueError):m.check_complete_ledger(complete,complete)
 def test_no_root_does_not_create_or_restore(self):
  m=module()
  with patch.object(m.os,'geteuid',return_value=501),self.assertRaisesRegex(ValueError,'ROOT_COMPLETE_QUALIFICATION_REQUIRED'):m.qualify_complete('/usr/bin/docker','sha256:'+'a'*64,{},Path('/unused'))
if __name__=='__main__':unittest.main()

class CloneFlowFixtures(unittest.TestCase):
 """Synthetic Docker/pipe ports only; NOT actual restore or production evidence."""
 def run_fixture(self,bad_catalog=False,cleanup_fail=False):
  import tempfile,json,stat
  from types import SimpleNamespace
  m=module()
  with patch.object(m,'trusted',side_effect=lambda p:Path(p)):
   core=m.load('schema-restore-rehearsal');acl=m.load('schema-acl-rehearsal')
  base={f'old_{i}.sql':'a'*64 for i in range(435)};complete={**base,**core.MIGRATIONS};image='sha256:'+'a'*64;cid='b'*64
  role=lambda name,superuser=False:{'name':name,'login':True,'inherit':True,'superuser':superuser,'bypassrls':superuser,'createrole':superuser,'createdb':superuser,'replication':superuser}
  snapshot={'roles':[role('postgres',True),role('app_rw')],'memberships':[],'catalog':{'schema:public':{'owner':'postgres'}},'migrationRole':'postgres'};queries=[]
  class Docker:
   owned=False;name='';token=''
   def json(self,args):
    if args[:2]==['image','inspect']:return [{'Id':image,'Config':{'Env':['PGDATA=/var/lib/postgresql/data']}}]
    return [{'Id':cid,'Image':image,'Name':'/'+self.name,'Config':{'Labels':{'wsx.complete-rehearsal':self.token}},'HostConfig':{'NetworkMode':'none','Privileged':False},'Mounts':[{'Type':'tmpfs'}]}]
   def run(self,args,**kw):
    if args[0]=='create':self.name=args[args.index('--name')+1];self.token=args[args.index('--label')+1].split('=')[1];self.owned=True;return cid.encode()
    if args[0]=='ps':return cid.encode() if self.owned else b''
    if args[0]=='rm':
     if cleanup_fail:raise RuntimeError('cannot remove owned clone')
     self.owned=False;return b''
    if args[0]=='exec':
     sql=args[-1];queries.append(sql)
     if sql==acl.POSTGRES_ROLE_SQL:return json.dumps(snapshot['roles'][0]).encode()
     if sql==acl.BUILTIN_MEMBERSHIPS_SQL:return b'[]'
     if sql==acl.CATALOG_SQL:return json.dumps({'drift':True} if bad_catalog else snapshot['catalog']).encode()
     if 'json_object_agg(name,checksum)' in sql:return json.dumps(complete).encode()
     if sql.startswith('SELECT count(*)'):return b'0'
     if sql=='SELECT 1':return b'1'
    return b''
  d=Docker();engine=SimpleNamespace(Docker=lambda _:d)
  def load(name):return {'schema-restore-rehearsal':core,'schema-acl-rehearsal':acl,'minimal-docker-release':engine}[name]
  with tempfile.TemporaryDirectory() as directory:
   root=Path(directory);paths={name:root/name for name in ('archive','key')};binding={'fixtureOnly':True};inputs={'archive':{'sha256':'c'*64}};data=(paths,base,complete,snapshot,binding)
   parent_stat=SimpleNamespace(st_uid=0,st_mode=stat.S_IFDIR|0o755)
   with patch.object(m,'load',side_effect=load),patch.object(m,'trusted',side_effect=lambda p:Path(p)),patch.object(m.os,'geteuid',return_value=0),patch.object(m,'read_inputs',return_value=data),patch.object(m,'preflight_tools',return_value=binding),patch.object(Path,'lstat',return_value=parent_stat),patch.object(core,'pipe') as pipe:
    try:result=m.qualify_complete('/usr/bin/docker',image,inputs,root/'out')
    except ValueError:result=json.loads((root/'out/receipt.json').read_text())
   return result,queries,d.owned,pipe.call_count
 def test_complete_clone_restores_acl_and_never_replays_reviewed_migrations(self):
  result,queries,owned,restores=self.run_fixture();self.assertEqual(result['status'],'COMPLETE_SCHEMA_RESTORE_QUALIFIED');self.assertTrue(result['sqlNotReplayed']);self.assertEqual(result['reviewedMigrationStatementsExecuted'],0);self.assertFalse(owned);self.assertEqual(restores,1)
  self.assertFalse(any('INSERT INTO public._kernel_migrations' in sql for sql in queries));self.assertTrue(any('ROLLBACK' in sql and 'billing_orders' in sql for sql in queries))
 def test_catalog_drift_cleans_owned_clone_and_never_reports_success(self):
  result,queries,owned,_=self.run_fixture(bad_catalog=True);self.assertEqual(result['status'],'COMPLETE_RESTORE_FAILED');self.assertEqual(result['code'],'RESTORED_OWNER_ACL_DRIFT');self.assertFalse(owned)
 def test_cleanup_failure_cannot_report_qualified(self):
  result,_,owned,_=self.run_fixture(cleanup_fail=True);self.assertEqual(result['status'],'COMPLETE_RESTORE_FAILED');self.assertTrue(owned)

class FreshPinnedInputs(unittest.TestCase):
 def fixture(self,root):
  import json,time
  m=module()
  with patch.object(m,'trusted',side_effect=lambda p:Path(p)):core=m.load('schema-restore-rehearsal')
  image='sha256:'+'a'*64;base={f'old_{i}.sql':'a'*64 for i in range(435)};binding={'environment':'us','sourceRevision':m.SOURCE,'tag':m.TAG,'database':'workspacex','role':'postgres','postgresImageId':image,'capturedAt':time.time(),'sourceContainerId':'b'*64,'targetApiImageId':'sha256:'+'c'*64,'targetApiRepoDigest':'registry.example/api@sha256:'+'d'*64,'toolPins':{name:core.file_sha(ROOT/'scripts'/name) for name in ('schema-complete-restore.py','schema-restore-rehearsal.py','schema-acl-rehearsal.py','minimal-docker-release.py')}}
  values={'archive':b'ciphertext-fixture'*100,'key':b'e'*64,'snapshot':b'{}','baselineLedger':json.dumps(base).encode(),'completeLedger':json.dumps({**base,**core.MIGRATIONS}).encode(),'binding':json.dumps(binding).encode()};refs={}
  for name,raw in values.items():
   path=root/name;path.write_bytes(raw);path.chmod(0o600);refs[name]={'path':str(path),'sha256':core.file_sha(path)}
  return m,image,refs
 def test_fresh_inputs_and_hash_private_ttl_negatives(self):
  import tempfile,os,time
  with tempfile.TemporaryDirectory() as directory:
   root=Path(directory);m,image,refs=self.fixture(root)
   # Root ownership checker is isolated here; crypto/pins/mode/age use real files.
   with patch.object(m,'trusted',side_effect=lambda p:Path(p)):
    m.read_inputs(refs,image)
    (root/'archive').write_bytes(b'tampered')
    with self.assertRaisesRegex(ValueError,'COMPLETE_INPUT_HASH'):m.read_inputs(refs,image)
   m,image,refs=self.fixture(root);(root/'key').chmod(0o644)
   with patch.object(m,'trusted',side_effect=lambda p:Path(p)),self.assertRaisesRegex(ValueError,'FRESH_PRIVATE_INPUT_REQUIRED'):m.read_inputs(refs,image)
   m,image,refs=self.fixture(root);old=time.time()-1801;os.utime(root/'archive',(old,old))
   with patch.object(m,'trusted',side_effect=lambda p:Path(p)),self.assertRaisesRegex(ValueError,'FRESH_PRIVATE_INPUT_REQUIRED'):m.read_inputs(refs,image)
 def test_symlink_or_nonroot_input_refuses(self):
  import tempfile
  m=module()
  with tempfile.TemporaryDirectory() as directory:
   path=Path(directory)/'real';path.write_text('fixture');link=Path(directory)/'link';link.symlink_to(path)
   with self.assertRaises(ValueError):m.trusted(link)

 def test_wrong_tool_pin_cannot_execute_any_imported_module(self):
  import tempfile,json,hashlib
  with tempfile.TemporaryDirectory() as directory:
   root=Path(directory);m,image,refs=self.fixture(root);binding=json.loads((root/'binding').read_text());binding['toolPins']['schema-acl-rehearsal.py']='0'*64;(root/'binding').write_text(json.dumps(binding));refs['binding']['sha256']=hashlib.sha256((root/'binding').read_bytes()).hexdigest()
   with patch.object(m,'trusted',side_effect=lambda p:Path(p)),patch.object(m,'load') as load:
    with self.assertRaisesRegex(ValueError,'COMPLETE_TOOL_DRIFT'):m.read_inputs(refs,image)
    load.assert_not_called()
    with patch.object(m.os,'geteuid',return_value=0),self.assertRaisesRegex(ValueError,'COMPLETE_TOOL_DRIFT'):m.qualify_complete('/usr/bin/docker',image,refs,root/'unused')
    load.assert_not_called()

class ConsumerProofFixtures(FreshPinnedInputs):
 def proof_fixture(self,root):
  import json,time,hashlib
  m,image,refs=self.fixture(root);base=json.loads((root/'baselineLedger').read_text());complete=json.loads((root/'completeLedger').read_text());binding=json.loads((root/'binding').read_text());snapshot={'catalog':{'schema:public':{'owner':'postgres'}}};out=root/'out';out.mkdir(mode=0o700)
  intent={'name':'owned-clone','ownerLabel':'owned-label','imageId':image,'network':'none','schemaState':'COMPLETE','sourceBinding':binding,'inputPins':refs,'sqlReplayAllowed':False}
  records={'intent.json':intent,'restored-catalog.json':snapshot['catalog'],'restored.json':{'status':'COMPLETE_SCHEMA_RESTORED','ledgerCount':438,'ledgerSha256':hashlib.sha256(json.dumps(complete,sort_keys=True).encode()).hexdigest(),'archiveSha256':refs['archive']['sha256'],'cloneImageId':image,'sourceOwnerAclRestored':True},'cleanup.json':{'name':'owned-clone','ownerLabel':'owned-label','removed':True},'receipt.json':{'status':'COMPLETE_SCHEMA_RESTORE_QUALIFIED','schemaState':'COMPLETE','ledgerCount':438,'sqlNotReplayed':True,'reviewedMigrationStatementsExecuted':0,'appRoleTransactionRollback':True,'sourceDatabaseAccessed':False,'productionDatabaseWriteAttempted':False,'activationAllowed':False,'createdAt':time.time(),'sourceBinding':binding,'inputPins':refs}}
  for name,value in records.items():
   path=out/name;path.write_text(json.dumps(value));path.chmod(0o600)
  manifest={'kind':'complete-schema-restore-qualification-v1','createdAt':time.time(),'imageId':image,'inputPins':refs,'sourceBinding':binding,'files':{name:hashlib.sha256((out/name).read_bytes()).hexdigest() for name in records}}
  path=out/'qualification.json';path.write_text(json.dumps(manifest));path.chmod(0o600)
  return m,image,refs,out,({},base,complete,snapshot,binding)
 def consume(self,m,image,refs,out,data,now=None):
  with patch.object(m.os,'geteuid',return_value=0),patch.object(m,'trusted',side_effect=lambda p:Path(p)),patch.object(m,'private_output',side_effect=lambda p:Path(p)),patch.object(m,'read_inputs',return_value=data):return m.validate_qualification(refs,image,out,now)
 def test_original_manifest_validates_read_only_without_refreshing_times(self):
  import tempfile
  with tempfile.TemporaryDirectory() as directory:
   m,image,refs,out,data=self.proof_fixture(Path(directory));before={p.name:(p.read_bytes(),p.stat().st_mtime_ns) for p in out.iterdir()};result=self.consume(m,image,refs,out,data);self.assertTrue(result['readOnlyValidation']);self.assertEqual(before,{p.name:(p.read_bytes(),p.stat().st_mtime_ns) for p in out.iterdir()})
 def test_tamper_expiry_and_spliced_rehashed_receipt_refused(self):
  import tempfile,json,hashlib,time
  for mode in ('tamper','expired','manifest-expired','receipt-expired','splice','cleanup','catalog','extra'):
   with self.subTest(mode=mode),tempfile.TemporaryDirectory() as directory:
    m,image,refs,out,data=self.proof_fixture(Path(directory));path=out/'receipt.json';manifest=json.loads((out/'qualification.json').read_text())
    if mode=='tamper':path.write_text('{}')
    if mode=='manifest-expired':manifest['createdAt']=time.time()-1801;(out/'qualification.json').write_text(json.dumps(manifest))
    if mode in ('splice','cleanup','catalog','receipt-expired'):
     name={'splice':'receipt.json','cleanup':'cleanup.json','catalog':'restored-catalog.json','receipt-expired':'receipt.json'}[mode];p=out/name;value=json.loads(p.read_text())
     if mode=='receipt-expired':value['createdAt']=time.time()-1801
     if mode=='splice':value['sourceBinding']={**value['sourceBinding'],'sourceContainerId':'f'*64}
     if mode=='cleanup':value['removed']=False
     if mode=='catalog':value['schema:public']['owner']='foreign'
     p.write_text(json.dumps(value));manifest['files'][name]=hashlib.sha256(p.read_bytes()).hexdigest();(out/'qualification.json').write_text(json.dumps(manifest))
    if mode=='extra':(out/'unapproved.json').write_text('{}')
    now=time.time()+1801 if mode=='expired' else None
    with self.assertRaises(ValueError):self.consume(m,image,refs,out,data,now)
