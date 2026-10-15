import io,tarfile,copy,hashlib,importlib.util,json,os,pathlib,tempfile,unittest
from unittest.mock import patch
ROOT=pathlib.Path(__file__).resolve().parent.parent
spec=importlib.util.spec_from_file_location('web_release',ROOT/'scripts/web-only-release.py');w=importlib.util.module_from_spec(spec);spec.loader.exec_module(w)
class FakeDocker:
 def __init__(self,executable):self.calls=[];self.applied=False;self.drift=False
 def value(self,s):
  return {'Id':s+('-new' if s=='web' and self.applied else '-old'),'Image':NEW if s=='web' and self.applied else OLD,'State':{'Running':True,'StartedAt':'new' if s=='web' and self.applied else 'old'},'Config':{'Labels':{'com.docker.compose.project':'example','com.docker.compose.service':s,'com.docker.compose.config-hash':'hash-'+s},'Env':['SECRET=never-receipt']},'Mounts':[],'NetworkSettings':{'Networks':{'existing':{}}}}
 def run(self,args,**kw):
  self.calls.append(args)
  if 'up' in args:
   self.applied='rollback-web.json' not in ' '.join(args);return b''
  if '--hash' in args:
   assert '--no-interpolate' not in args
   p=pathlib.Path(args[args.index('--file')+1]);assert p.stat().st_mode & 0o777==0o600
   return '\n'.join(s+' hash-'+s for s in json.loads(p.read_text())['services']).encode()
  if 'ps' in args:return (args[-1]+'-id').encode()
  raise AssertionError(args)
 def json(self,args,**kw):
  self.calls.append(args)
  if args[:2]==['container','inspect']:return [self.value(args[-1].removesuffix('-id'))]
  if args[:2]==['image','inspect']:return [{'Id':args[-1],'Os':'linux','Architecture':'amd64','Config':{'Labels':{'org.opencontainers.image.revision':SOURCE if args[-1]==NEW else BASE}}}]
  if 'config' in args:
   d={'services':{s:{'image':OLD,'environment':{'SETTING':'unchanged'}} for s in SERVICES}}
   if any(a.endswith('/web.json') for a in args):d['services']['web']['image']=NEW
   if self.drift and any(a.endswith('/web.json') for a in args):d['services']['api']['environment']={'SETTING':'changed'}
   return d
  raise AssertionError(args)
SOURCE='a'*40;BASE='b'*40;IMAGE_CONFIG=json.dumps({'os':'linux','architecture':'amd64','config':{'Labels':{'org.opencontainers.image.revision':SOURCE}}}).encode();NEW='sha256:'+hashlib.sha256(IMAGE_CONFIG).hexdigest();OLD='sha256:'+'2'*64;SERVICES=['api','web','agent','sandbox','sandbox-sessions']
class Tests(unittest.TestCase):
 def setUp(self):
  self.t=tempfile.TemporaryDirectory();self.root=pathlib.Path(self.t.name);self.d=FakeDocker('docker')
  def pin(name):
   p=self.root/name;p.write_text('{}');return {'path':str(p),'sha256':w.m.sha_file(p)}
  compose=pin('compose.json');env=pin('existing.env');archive=self.root/'web.tar'
  with tarfile.open(archive,'w') as t:
   for name,raw in [('manifest.json',json.dumps([{'Config':'config.json'}]).encode()),('config.json',IMAGE_CONFIG)]:
    i=tarfile.TarInfo(name);i.size=len(raw);t.addfile(i,io.BytesIO(raw))
  art={'path':str(archive),'sha256':w.m.sha_file(archive)};lock=self.root/'release.lock';lock.touch(mode=0o600)
  self.config={'kind':'single-host-web-only-v1','sourceRevision':SOURCE,'baselineRevision':BASE,'project':'example','docker':'/usr/bin/docker','webService':'web','services':SERVICES,'baseline':{s:w.snapshot(self.d.value(s)) for s in SERVICES},'webImageId':NEW,'composeFiles':[compose],'envFile':env,'lockFile':str(lock),'artifact':{**art,'runId':'123','artifactId':'456'},'browser':{}}
  self.path=self.root/'config.json';self.output=self.root/'result'
 def tearDown(self):self.t.cleanup()
 def run_release(self,apply=True,browser=None):
  self.path.write_text(json.dumps(self.config))
  with patch.object(w.m,'Docker',return_value=self.d),patch.object(w,'browser',side_effect=browser or (lambda c,o,mode:{'passed':True,'mode':mode})):
   return w.release(self.path,self.output,apply)
 def mutations(self):return [a for a in self.d.calls if 'up' in a]
 def assert_web_only(self):
  for a in self.mutations():
   self.assertEqual(a[-1],'web');self.assertEqual(a[-5:],['--no-deps','--pull','never','--no-build','web'])
   self.assertNotIn('down',a);self.assertNotIn('build',a)
 def test_plan_no_application_mutation(self):
  self.assertEqual(self.run_release(False)['status'],'PLANNED');self.assertEqual(self.mutations(),[])
 def test_snapshot_mount_order_is_semantically_stable(self):
  v=self.d.value('api');v['Mounts']=[{'Type':'bind','Source':'/one','Destination':'/first','RW':False},{'Type':'bind','Source':'/two','Destination':'/second','RW':False}]
  before=w.snapshot(v);v['Mounts'].reverse();self.assertEqual(before,w.snapshot(v))
 def test_snapshot_mount_content_still_changes_identity(self):
  v=self.d.value('api');v['Mounts']=[{'Type':'bind','Source':'/one','Destination':'/first','RW':False}]
  before=w.snapshot(v);v['Mounts'][0]['RW']=True;self.assertNotEqual(before['mounts'],w.snapshot(v)['mounts'])
 def test_snapshot_bind_order_stable_but_dns_order_remains_significant(self):
  v=self.d.value('web');v['HostConfig']={'Binds':['/one:/first:ro','/two:/second:ro'],'Dns':['192.0.2.1','192.0.2.2']}
  before=w.snapshot(v);v['HostConfig']['Binds'].reverse();self.assertEqual(before,w.snapshot(v))
  v['HostConfig']['Dns'].reverse();self.assertNotEqual(before['hostConfiguration'],w.snapshot(v)['hostConfiguration'])
 def test_snapshot_bind_options_still_change_identity(self):
  v=self.d.value('web');v['HostConfig']={'Binds':['/one:/first:ro']};before=w.snapshot(v)
  v['HostConfig']['Binds']=['/one:/first:rw'];self.assertNotEqual(before['hostConfiguration'],w.snapshot(v)['hostConfiguration'])
 def test_resolved_secret_model_removed_after_hashing(self):
  self.assertEqual(self.run_release(False)['status'],'PLANNED')
  hashes=[a for a in self.d.calls if '--hash' in a];self.assertTrue(hashes)
  for a in hashes:
   self.assertNotIn('--no-interpolate',a);self.assertFalse(pathlib.Path(a[a.index('--file')+1]).exists())
 def test_hash_failure_removes_private_resolved_model(self):
  original=self.d.run;seen=[]
  def run(args,**kw):
   if '--hash' in args:
    seen.append(pathlib.Path(args[args.index('--file')+1]));raise w.m.Rejected('HASH_FAILED')
   return original(args,**kw)
  self.d.run=run;self.assertEqual(self.run_release()['code'],'HASH_FAILED')
  self.assertTrue(seen);self.assertTrue(all(not p.exists() for p in seen));self.assertEqual(self.mutations(),[])
 def test_incomplete_resolved_hashes_rejected(self):
  original=self.d.run
  def run(args,**kw):return b'api hash-api' if '--hash' in args else original(args,**kw)
  self.d.run=run;self.assertEqual(self.run_release()['code'],'CONFIG_HASH_CLOSURE');self.assertEqual(self.mutations(),[])
 def test_success_preserves_all_non_web_ids_and_start_times(self):
  r=self.run_release();self.assertEqual(r['status'],'SUCCEEDED');self.assertTrue(r['backendAndDataUnchanged']);self.assert_web_only();self.assertEqual(len(self.mutations()),1)
  self.assertNotIn('never-receipt',json.dumps(r))
 def test_cas_rejects_drift_before_mutation(self):
  self.config['baseline']['api']['id']='other';self.assertEqual(self.run_release()['code'],'BASELINE_CAS_FAILED');self.assertEqual(self.mutations(),[])
 def test_non_image_config_change_rejected(self):
  self.d.drift=True;self.assertEqual(self.run_release()['code'],'NON_IMAGE_COMPOSE_CHANGE');self.assertEqual(self.mutations(),[])
 def test_browser_failure_restores_only_web_and_verifies_baseline(self):
  modes=[]
  def browser(c,o,mode):
   modes.append(mode)
   if mode=='candidate':raise w.m.Rejected('BROWSER_PROBE_FAILED')
   return {'passed':True,'mode':mode}
  r=self.run_release(browser=browser);self.assertEqual(r['status'],'ROLLED_BACK');self.assertEqual(modes,['baseline','candidate','baseline']);self.assertEqual(len(self.mutations()),2);self.assertFalse(self.d.applied);self.assert_web_only()
 def test_backend_drift_never_reported_as_successful_rollback(self):
  def browser(c,o,mode):
   if mode=='candidate':self.d.value=lambda s:{**FakeDocker.value(self.d,s),'Id':'external-change' if s=='api' else FakeDocker.value(self.d,s)['Id']}
   return {'passed':True,'mode':mode}
  result=self.run_release(browser=browser);self.assertEqual(result['status'],'FAILED_OR_UNCERTAIN');self.assertEqual(result['rollbackCode'],'BACKEND_OR_DATA_CHANGED');self.assert_web_only()
 def test_live_compose_drift_rejected_before_up(self):
  original=self.d.value
  def value(s):
   v=original(s);v['Config']['Labels']['com.docker.compose.config-hash']='drift';return v
  self.d.value=value;self.assertEqual(self.run_release()['code'],'LIVE_CONFIG_DRIFT');self.assertEqual(self.mutations(),[])
 def test_rollback_input_drift_does_not_execute_untrusted_up(self):
  def browser(c,o,mode):
   if mode=='candidate':
    pathlib.Path(self.config['composeFiles'][0]['path']).write_text('drift');raise w.m.Rejected('BROWSER_PROBE_FAILED')
   return {'passed':True,'mode':mode}
  self.assertEqual(self.run_release(browser=browser)['status'],'FAILED_OR_UNCERTAIN');self.assertEqual(len(self.mutations()),1);self.assert_web_only()
 def test_archive_loaded_image_mismatch_rejected(self):
  p=pathlib.Path(self.config['artifact']['path'])
  with tarfile.open(p,'w') as t:
   for name,raw in [('manifest.json',b'[{"Config":"config.json"}]'),('config.json',IMAGE_CONFIG+b' ')]:
    i=tarfile.TarInfo(name);i.size=len(raw);t.addfile(i,io.BytesIO(raw))
  self.config['artifact']['sha256']=w.m.sha_file(p)
  self.assertEqual(self.run_release()['code'],'ARCHIVE_IMAGE_IDENTITY');self.assertEqual(self.mutations(),[])
 def test_baseline_browser_failure_never_mutates(self):
  def browser(*args):raise w.m.Rejected('BROWSER_PROBE_FAILED')
  self.assertEqual(self.run_release(browser=browser)['status'],'REJECTED');self.assertEqual(self.mutations(),[])
if __name__=='__main__':unittest.main()
