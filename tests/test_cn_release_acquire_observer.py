"""Real synthetic ZIP/tar canonical readonly observation; root ownership fixture only."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import shutil
import stat
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'tests'))
import test_cn_release_continuation_acquire as fixture
spec=importlib.util.spec_from_file_location('observer',ROOT/'scripts/cn-release-acquire-observer.py');o=importlib.util.module_from_spec(spec);spec.loader.exec_module(o)

class ObserverTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):fixture.AcquireTests.setUpClass()
 @classmethod
 def tearDownClass(cls):fixture.AcquireTests.tearDownClass()
 def setUp(self):
  self.f=fixture.AcquireTests();self.f.setUp();self.addCleanup(self.f.doCleanups);self.f.bind()
  self.root=self.f.root;self.state=self.root/'state';self.state.mkdir();(self.state/'runtime').mkdir();(self.state/'runtime/release.lock').write_bytes(b'lock');(self.state/'runtime/release.lock').chmod(0o600)
  self.request_raw=o.encode(self.f.r);self.request_sha=o.sha(self.request_raw);self.config_raw=(self.root/'out/consumer-request.json').read_bytes();self.config=json.loads(self.config_raw)
  self.original=self.state/self.config['destinationName'];(self.original/'original').mkdir(parents=True)
  for n,x in self.config['objects'].items():
   raw=self.f.inputs[n] if n in ('proof','policy') else self.f.provider.blobs[x['artifactId']]
   p=self.original/'original'/(n+('.json' if n in ('proof','policy') else '.zip'));p.write_bytes(raw);p.chmod(0o600)
  self.inbox=self.state/'candidate-inbox'/self.f.r['sourceRevision']/self.f.r['attemptId'];self.inbox.mkdir(parents=True)
  for n,key in (('candidate-plan.json','plan'),('candidate-set.json','set'),('revalidation.json','proof'),('revalidation-policy.json','policy')):
   p=self.inbox/n;p.write_bytes(self.f.inputs[key]);p.chmod(0o600)
  for service in ('api','web','agent','sandbox','postgres'):
   p=self.inbox/(service+'.tar');shutil.copyfile(self.root/(service+'.tar'),p);p.chmod(0o600)
  self.receipt=o.encode(dict(sourceRevision=self.f.r['sourceRevision'],controlRevision=self.f.r['controlRevision'],root=str(self.original),bundle=str(self.inbox),images=json.loads(self.f.inputs['set'])['images'],proofSha256=self.f.r['inputs']['proof'],policySha256=self.f.r['inputs']['policy']))
  (self.original/'promoted-receipt.json').write_bytes(self.receipt);(self.original/'promoted-receipt.json').chmod(0o600)
  self.code=self.root/'code';folder=self.code/self.f.r['controlRevision'];folder.mkdir(parents=True)
  for name in o.MODULES:shutil.copyfile(ROOT/'scripts'/name,folder/name);(folder/name).chmod(0o700)
  self.script=self.root/'observer.py';shutil.copyfile(ROOT/'scripts/cn-release-acquire-observer.py',self.script);self.script.chmod(0o700)
  self.identity={k:self.f.r[k] for k in ('sourceRevision','controlRevision','requestedAt','deadlineAt')};self.identity.update(baselineRevision='c'*40,attemptId='runtime-test')
  self.manifest={**self.identity,'stage':'consume','scope':'runtime-only-reviewed-continuation','actionSha256':'a'*64}
  self.approvals=self.root/'approved';approved=self.approvals/self.request_sha;approved.mkdir(parents=True)
  for name,raw in o.bundle(self.request_raw,self.config_raw,self.identity,'a'*64,o.sha(self.script.read_bytes())).items():(approved/name).write_bytes(raw);(approved/name).chmod(0o600)
  real_fstat,real_directory=os.fstat,o.directory
  def ownership(fd):
   s=real_fstat(fd);v={k:getattr(s,k) for k in dir(s) if k.startswith('st_')};v.update(st_uid=0,st_gid=0);return types.SimpleNamespace(**v)
  # Real files, fstat modes, nofollow opens, hashes, locks, canonical subprocess.
  # Only fixture ancestry and root ownership are adapted for unprivileged macOS.
  for p in (patch.object(o,'STATE',self.state),patch.object(o,'CODE',self.code),patch.object(o,'APPROVALS',self.approvals),patch.object(o,'SELF',self.script),patch.object(o,'directory',lambda path:os.open(path,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)),patch.object(o.os,'fstat',side_effect=ownership)):
   p.start();self.addCleanup(p.stop)
 def test_real_original_zip_and_five_tar_canonical_readonly(self):
  before={str(p):p.read_bytes() for p in self.state.rglob('*') if p.is_file()};raw=o.observe(self.request_sha);v=json.loads(raw)
  self.assertEqual(v['runtimeReceiptSha256'],o.sha(self.receipt));self.assertEqual(len(v['files']),18);self.assertEqual(v['cloudCalls'],0);self.assertFalse(v['writesPerformed'])
  self.assertEqual(before,{str(p):p.read_bytes() for p in self.state.rglob('*') if p.is_file()})
  self.assertTrue(o.verify(raw,self.manifest,None,'reconcile',self.request_sha));self.assertTrue(o.verify(self.receipt,self.manifest,None,'advance',self.request_sha));self.assertEqual(o.verify(raw,self.manifest,None,'terminal',self.request_sha),{'externalWritesTerminal':True})
 def test_installed_observer_private_0600_or_0700_only(self):
  for mode in (0o600,0o700):
   self.script.chmod(mode);self.assertTrue(o.observe(self.request_sha))
  self.script.chmod(0o755)
  with self.assertRaisesRegex(ValueError,'UNTRUSTED_FILE'):o.observe(self.request_sha)
 def test_zip_tar_proof_and_private_receipt_tamper_rejected(self):
  paths=[self.original/'original/api.zip',self.inbox/'api.tar',self.inbox/'revalidation.json',self.original/'promoted-receipt.json']
  for path in paths:
   with self.subTest(path=path.name):
    original=path.read_bytes();path.write_bytes(original+b'x')
    with self.assertRaises((ValueError,json.JSONDecodeError)):o.observe(self.request_sha)
    path.write_bytes(original)
 def test_wrong_stage_unknown_action_and_changed_observation_rejected(self):
  raw=o.observe(self.request_sha)
  for key,value in (('stage','publish'),('actionSha256','b'*64)):
   with self.assertRaises(ValueError):o.verify(raw,{**self.manifest,key:value},None,'terminal',self.request_sha)
  value=json.loads(raw);value['files']['inbox/api.tar']['sha256']='0'*64
  with self.assertRaisesRegex(ValueError,'OBSERVATION_CHANGED'):o.verify(o.encode(value),self.manifest,None,'terminal',self.request_sha)
 def test_code_tamper_no_canonical_execution(self):
  (self.code/self.f.r['controlRevision']/'cn_candidate_revalidation.py').write_bytes(b'raise RuntimeError("untrusted")')
  with patch.object(o.subprocess,'run',side_effect=AssertionError('MUST_NOT_EXECUTE')):
   with self.assertRaises(ValueError):o.observe(self.request_sha)
 def test_file_changed_during_canonical_recheck_rejected(self):
  real=o.subprocess.run
  def run(*args,**kwargs):
   result=real(*args,**kwargs);path=self.inbox/'api.tar';path.write_bytes(path.read_bytes()+b'x');return result
  with patch.object(o.subprocess,'run',side_effect=run):
   with self.assertRaisesRegex(ValueError,'FILE_CHANGED_DURING_OBSERVATION'):o.observe(self.request_sha)
 def test_shared_release_lock_refuses_concurrent_writer(self):
  import fcntl
  fd=os.open(self.state/'runtime/release.lock',os.O_RDONLY)
  try:
   fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
   with self.assertRaises(BlockingIOError):o.observe(self.request_sha)
  finally:os.close(fd)
 def test_symlink_tar_not_followed(self):
  target=self.inbox/'api.tar';target.unlink();target.symlink_to(self.root/'api.tar')
  with self.assertRaises(OSError):o.observe(self.request_sha)

if __name__=='__main__':unittest.main()
