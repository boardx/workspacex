"""Command/cleanup fixtures. Not actual baseline migration acceptance."""
import importlib.util,json,pathlib,tempfile,unittest
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('baseline_schema',pathlib.Path(__file__).with_name('cn_auto_baseline_schema.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
SOURCE='a'*40;ATTEMPT='gha-10-1';IMAGE='sha256:'+'b'*64
class HostFixture:
 def __init__(self,fail_migrate=False):self.calls=[];self.containers=[];self.networks=[];self.fail_migrate=fail_migrate;self.owner=None
 def __call__(self,args,data=None,timeout=120):
  self.calls.append((args,data));a=args[len(m.DOCKER):]
  if a[0]=='inspect':
   if a[1].startswith('workspacex-cn-'):return json.dumps([{'State':{'Running':True},'Config':{'Labels':{'org.opencontainers.image.revision':SOURCE}},'Image':IMAGE} for _ in range(4)]).encode()
   return json.dumps([{'Config':{'Labels':{'wsx.auto.baseline':self.owner}}}]).encode()
  if a[:2]==['image','inspect']:return json.dumps([{'Id':IMAGE,'Config':{'Labels':{'org.opencontainers.image.revision':SOURCE}}}]).encode()
  if a[0]=='exec' and a[1]=='workspacex-cn-api-1':return b'[{"name":"001.sql","checksum":"'+b'c'*64+b'"}]'
  if a[:2]==['network','create']:self.owner=a[-2].split('=',1)[1];self.networks=['network'];return b'network'
  if a[:2]==['network','ls']:return b' '.join(n.encode() for n in self.networks)
  if a[:2]==['network','inspect']:return json.dumps([{'Labels':{'wsx.auto.baseline':self.owner},'Containers':{}}]).encode()
  if a[:2]==['network','rm']:self.networks=[];return b''
  if a[0]=='run':
   if '-d' in a:self.containers=['container'];return b'container'
   if a[-1]=='src/infrastructure/db/migrate-cli.ts':
    if self.fail_migrate:raise m.NotReady('FIXTURE_MIGRATION_FAILED')
    return b'applied fixture migrations'
   assert '-i' in a, 'Docker must attach CAPTURE stdin';request=json.loads(data);return json.dumps({'baselineSha':SOURCE,'sourceInventorySha256':request['identity']['sourceInventorySha256'],'scope':'schema-only-isolated-baseline','schemaVersion':1,'schemaSha256':'d'*64,'catalog':{}}).encode()
  if a[0]=='ps':return b' '.join(c.encode() for c in self.containers)
  if a[0]=='rm':self.containers=[];return b''
  return b'ok'
class BaselineSchema(unittest.TestCase):
 def context(self,host,root):
  def private(path,mode=0o600):
   if path.endswith('auto-preparation-policy.json'):return json.dumps({'environment':{'postgresImage':IMAGE}}).encode()
   if path.endswith('cn-baseline-schema-contract.cjs'):return b'/* trusted capture fixture */'
   return pathlib.Path(path).read_bytes()
  return patch.multiple(m,private=private,directory=lambda p:p.mkdir(mode=0o700,exist_ok=True),require_capacity=lambda p:None)
 def test_isolated_replay_capture_and_cleanup(self):
  with tempfile.TemporaryDirectory() as raw:
   root=pathlib.Path(raw);host=HostFixture()
   with self.context(host,root):m.produce(SOURCE,ATTEMPT,host,root/'schema',root/'work')
   self.assertTrue((root/'schema'/(SOURCE+'.json')).is_file());self.assertEqual(host.containers,[]);self.assertEqual(host.networks,[]);self.assertEqual(list((root/'work').iterdir()),[])
   self.assertTrue(any(a[:len(m.DOCKER)+3]==m.DOCKER+['network','create','--internal'] for a,_ in host.calls))
   for args,_ in host.calls:
    if 'run' in args:self.assertIn('--pull=never',args);self.assertIn('--memory',args);self.assertNotIn('--publish',args)
   self.assertFalse(any('password=' in str(a).lower() for a,_ in host.calls))
   ready=[a for a,_ in host.calls if 'pg_isready' in a]
   self.assertTrue(ready);self.assertIn('127.0.0.1',ready[0])
 def test_low_host_capacity_stops_before_creating_containers_or_credentials(self):
  with tempfile.TemporaryDirectory() as raw:
   root=pathlib.Path(raw);host=HostFixture()
   with self.context(host,root),patch.object(m,'require_capacity',side_effect=m.NotReady('MEMORY_HEADROOM_REQUIRED')),self.assertRaisesRegex(m.NotReady,'MEMORY_HEADROOM_REQUIRED'):
    m.produce(SOURCE,ATTEMPT,host,root/'schema',root/'work')
   self.assertFalse(any('run' in a or 'create' in a for a,_ in host.calls));self.assertEqual(list((root/'work').iterdir()),[])
 def test_migration_failure_never_publishes_and_cleans_owned_resources(self):
  with tempfile.TemporaryDirectory() as raw:
   root=pathlib.Path(raw);host=HostFixture(True)
   with self.context(host,root),self.assertRaisesRegex(m.NotReady,'FIXTURE_MIGRATION_FAILED'):m.produce(SOURCE,ATTEMPT,host,root/'schema',root/'work')
   self.assertFalse((root/'schema'/(SOURCE+'.json')).exists());self.assertEqual(host.containers,[]);self.assertEqual(host.networks,[]);self.assertEqual(list((root/'work').iterdir()),[])
 def test_existing_bound_schema_avoids_replaying(self):
  with tempfile.TemporaryDirectory() as raw:
   root=pathlib.Path(raw);host=HostFixture()
   with self.context(host,root):m.produce(SOURCE,ATTEMPT,host,root/'schema',root/'work');host.calls=[];m.produce(SOURCE,'gha-11-1',host,root/'schema',root/'work')
   self.assertFalse(any('run' in a for a,_ in host.calls))
 def test_wrong_runtime_source_rejected_before_creating_local_resources(self):
  host=HostFixture();original=host.__call__
  def runner(args,data=None,timeout=120):return original(args,data,timeout).replace(SOURCE.encode(),b'e'*40)
  with self.context(host,None),self.assertRaisesRegex(m.NotReady,'BASELINE_RUNTIME_SOURCE'):m.produce(SOURCE,ATTEMPT,runner)
  self.assertFalse(any('run' in a for a,_ in host.calls))
 def test_invalid_identity_rejected_before_host_calls(self):
  host=HostFixture()
  with self.assertRaises(m.NotReady):m.produce('../x',ATTEMPT,host)
  self.assertEqual(host.calls,[])
if __name__=='__main__':unittest.main()
