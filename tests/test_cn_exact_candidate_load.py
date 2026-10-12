"""Offline dispatch/journal counterexamples; never invokes Docker."""
import hashlib,importlib.util,json,os,tempfile,unittest
from contextlib import ExitStack
from pathlib import Path
from unittest.mock import patch
P=Path(__file__).resolve().parent/'fixtures/cn-exact-candidate/load.py'
spec=importlib.util.spec_from_file_location('exact_load',P);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class LoadTests(unittest.TestCase):
 def fixture(self):
  stack=ExitStack();self.addCleanup(stack.close);root=Path(stack.enter_context(tempfile.TemporaryDirectory()));root.chmod(0o700)
  for name in ('plan','set','bundle'):(root/name).mkdir()
  (root/'plan/cn-candidate-plan.json').write_bytes(b'{}');(root/'set/candidate-set.json').write_bytes(b'{}')
  r={'kind':'isolated-f0eb-byte-preflight-v1','historicalBytesVerified':True,'imageLoaded':False,'controlRevision':'a'*40,'githubRunId':'1'}
  raw=json.dumps(r).encode();(root/'preflight.json').write_bytes(raw);(root/'bundle/api.tar').write_bytes(b'abc')
  docker=root/'docker';docker.write_bytes(b'fixed-test-tool')
  entry={'file':'api.tar','size':3,'sha256':hashlib.sha256(b'abc').hexdigest(),'stagingTag':'fixed:test','imageId':'sha256:'+'b'*64}
  for name,value in [('PLAN_SHA',hashlib.sha256(b'{}').hexdigest()),('SET_SHA',hashlib.sha256(b'{}').hexdigest()),('SERVICES',('api',))]:stack.enter_context(patch.object(m.p,name,value))
  stack.enter_context(patch.dict(os.environ,{'GITHUB_RUN_ID':'1'}));stack.enter_context(patch.object(m.p,'environment'));stack.enter_context(patch.object(m.shutil,'which',return_value=str(docker)))
  stack.enter_context(patch.object(m.shutil,'disk_usage',return_value=type('Space',(),{'free':40*1024**3})()))
  stack.enter_context(patch.object(m.p.candidate,'validate_plan',return_value={}));stack.enter_context(patch.object(m.p.candidate,'verify_historical_bundle',return_value={'images':{'api':entry}}))
  return root,hashlib.sha256(raw).hexdigest(),entry
 def test_nonempty_daemon_has_no_claim_or_load(self):
  root,h,_=self.fixture()
  with patch.object(m,'run',return_value=b'foreign-container')as run:
   with self.assertRaises(Exception):m.load(root,h)
  self.assertFalse((root/'load-claim.json').exists());self.assertEqual(run.call_count,1)
 def test_unknown_load_cannot_dispatch_twice(self):
  root,h,_=self.fixture();calls=[]
  def run(d,args,*a,**kw):
   calls.append(args)
   if 'info'in args:return json.dumps(str(root)).encode()
   if args[-2:]==['image','load']:raise RuntimeError('TIMEOUT')
   return b''
  with patch.object(m,'run',side_effect=run):
   with self.assertRaises(Exception):m.load(root,h)
   with self.assertRaises(FileExistsError):m.load(root,h)
  self.assertEqual(sum(x[-2:]==['image','load']for x in calls),1);self.assertFalse((root/'loaded.json').exists())
 def test_existing_tag_blocks_load_but_keeps_claim(self):
  root,h,_=self.fixture()
  with patch.object(m,'run',side_effect=[b'',json.dumps(str(root)).encode(),b'existing-id'])as run:
   with self.assertRaises(Exception):m.load(root,h)
  self.assertEqual(run.call_count,3);self.assertTrue((root/'load-claim.json').exists())
 def test_success_requires_real_verifier_and_stable_reread(self):
  root,h,e=self.fixture();image={'Id':e['imageId']}
  with patch.object(m,'run',side_effect=[b'',json.dumps(str(root)).encode(),b'',b'',json.dumps([image]).encode(),json.dumps([image]).encode()]),patch.object(m.publication,'image_matches')as check:
   result=m.load(root,h)
  check.assert_called_once();self.assertTrue(result['exactImagesLoaded']);self.assertFalse(result['sixBusinessesVerified']);self.assertFalse(result['productionReady'])
 def test_loaded_tag_drift_no_success_receipt(self):
  root,h,e=self.fixture()
  with patch.object(m,'run',side_effect=[b'',json.dumps(str(root)).encode(),b'',b'',json.dumps([{'Id':e['imageId']}]).encode(),b'[]']),patch.object(m.publication,'image_matches'):
   with self.assertRaises(Exception):m.load(root,h)
  self.assertFalse((root/'loaded.json').exists())
 def test_daemon_disk_rejection_before_claim(self):
  root,h,_=self.fixture()
  with patch.object(m,'run',side_effect=[b'',json.dumps(str(root)).encode()]),patch.object(m.shutil,'disk_usage',side_effect=[type('Space',(),{'free':40*1024**3})(),type('Space',(),{'free':1024})()]):
   with self.assertRaises(Exception):m.load(root,h)
  self.assertFalse((root/'load-claim.json').exists())
 def test_directory_fsync_failure_keeps_claim_without_load(self):
  root,h,_=self.fixture();original=m.os.fsync
  def fsync(fd):
   if m.stat.S_ISDIR(os.fstat(fd).st_mode):raise OSError('FSYNC_FAILED')
   return original(fd)
  with patch.object(m,'run',side_effect=[b'',json.dumps(str(root)).encode()])as run,patch.object(m.os,'fsync',side_effect=fsync):
   with self.assertRaises(Exception):m.load(root,h)
  self.assertTrue((root/'load-claim.json').exists());self.assertEqual(run.call_count,2)
if __name__=='__main__':unittest.main()
