"""Local package integration, not production generators or cloud execution."""
import datetime as dt
import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1]
def load(name):
 s=importlib.util.spec_from_file_location(name,ROOT/'scripts'/('cn-release-'+name+'.py'));m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
r=load('stage-router');d=load('fixed-driver')
class RouterTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.base=Path(self.tmp.name);self.requests=self.base/'requests';self.requests.mkdir();self.outputs=self.base/'outputs';self.outputs.mkdir()
  now=dt.datetime.now(dt.timezone.utc);identity=dict(sourceRevision='a'*40,baselineRevision='b'*40,controlRevision='c'*40,publicationAttemptId='publication-one',attemptId='release-one',requestedAt=now.isoformat(),deadlineAt=(now+dt.timedelta(minutes=30)).isoformat())
  self.a=dict(kind='cn-fixed-release-approval-v1',identity=identity,issuedAt=identity['requestedAt'],expiresAt=identity['deadlineAt'],codeFiles={'scripts/cn-release-stage-contract.py':r.e.digest((ROOT/'scripts/cn-release-stage-contract.py').read_bytes())})
  raw=r.e.encode(self.a);self.release=r.e.digest(raw)
  original_read=r.e.read
  def read(path,*args):
   if Path(path)==ROOT/'scripts/cn-release-stage-contract.py':return Path(path).read_bytes()
   return original_read(path,*args)
  for p in (patch.object(r,'OUTPUTS',self.outputs),patch.object(r.e,'REQUESTS',self.requests),patch.object(r.e,'OWNER',os.getuid()),patch.object(r.e,'directory',lambda p:None),patch.object(r.e,'read',read),patch.object(d,'e',r.e)):
   p.start();self.addCleanup(p.stop)
  self.router=r.Router(self.release,self.a,raw);self.router.base.mkdir()
 def generate(self,stage,prior=None):
  with patch.object(self.router,'action',return_value=(b'printf "fixture\\n"\n',30)),patch.object(self.router,'prepare_context',return_value={'fixtureOnly':True}):
   return self.router.generate(self.release,stage,prior)
 def test_actual_packages_all_stages_bind_prior_and_authority(self):
  previous=None
  for stage in r.e.STAGES:
   request=self.generate(stage,previous)
   m=d.package_identity(request,self.a,stage,previous,self.release)
   self.assertEqual(m['stage'],stage);self.assertEqual(self.router.lookup(self.release,stage),request)
   previous=r.e.digest((stage+'receipt').encode())
 def test_other_publication_attempt_same_source_rejected(self):
  request=self.generate('consume');other={**self.a,'identity':{**self.a['identity'],'publicationAttemptId':'publication-two'}}
  with self.assertRaisesRegex(r.e.Rejected,'PACKAGE_RELEASE_AUTHORITY'):d.package_identity(request,other,'consume',None,self.release)
 def test_context_tamper_blocks_lookup(self):
  self.generate('consume');p=self.router.base/'stages/consume/observer-context.json';p.write_bytes(b'{}\n')
  with self.assertRaisesRegex(r.e.Rejected,'OBSERVER_CONTEXT_CHANGED'):self.router.lookup(self.release,'consume')
 def test_generation_failure_not_retried(self):
  with patch.object(self.router,'action',side_effect=RuntimeError('fixture failure')):
   with self.assertRaises(RuntimeError):self.router.generate(self.release,'consume',None)
  with self.assertRaisesRegex(r.e.Rejected,'GENERATION_UNKNOWN'):self.generate('consume')
 def test_real_entry_process_chain_pauses_at_a5_and_resumes_without_replay(self):
  import shlex
  state=self.base/'state';state.mkdir(mode=0o700)
  effects=self.base/'effects';effects.mkdir(mode=0o700);calls=self.base/'dispatches'
  approved=False
  def admission(release,stage):return 'WAITING_FOR_WRITER_APPROVAL' if stage=='clear-hold' and not approved else None
  def action(stage):
   raw=r.e.encode({'stage':stage,'verified':True}).decode()
   return ('printf %s '+shlex.quote(raw)+' > '+shlex.quote(str(effects/stage))+'\nprintf x >> '+shlex.quote(str(calls))+'\ncat '+shlex.quote(str(effects/stage))+'\n').encode(),3
  def contract(stage):
   observer=('cat '+shlex.quote(str(effects/stage))+'\n').encode()
   verifier=b"import json\ndef verify(raw,m,previous,mode):\n assert json.loads(raw)=={'stage':m['stage'],'verified':True}\n return {'externalWritesTerminal':True} if mode=='terminal' else True\n"
   return observer,verifier
  # Real router generation, raw package loader, fixed-driver predecessor checks,
  # fork/READY/fsync entry and original receipt chain. Action generation,
  # observer-context generation and stage contracts are replaced here by local
  # file fixtures; this test does NOT validate canonical materializer wiring.
  with patch.object(r.e,'STATE',state),patch.object(r.e,'CGROUP_BASE',None),patch.object(self.router,'preflight'),patch.object(self.router,'admission',admission),patch.object(self.router,'action',action),patch.object(self.router,'contract',contract),patch.object(self.router,'prepare_context',return_value={'localProcessFixture':True}):
   result=d.coordinate(self.release,self.a,self.router,executor=r.e.entry)
   self.assertEqual(result['status'],'WAITING_FOR_WRITER_APPROVAL');self.assertEqual(calls.stat().st_size,15)
   self.assertFalse((state/'release-one/15-clear-hold.intent.json').exists())
   approved=True
   result=d.coordinate(self.release,self.a,self.router,executor=r.e.entry)
   self.assertEqual(result['status'],'CHAIN_COMPLETED');self.assertEqual(calls.stat().st_size,17)
   result=d.coordinate(self.release,self.a,self.router,executor=r.e.entry,mode='status')
   self.assertEqual(result['status'],'CHAIN_COMPLETED');self.assertEqual(calls.stat().st_size,17)

 def test_generated_verifier_executes_the_pinned_source_bytes(self):
  _,raw=self.router.contract('consume');compile(raw,'verify.py','exec')
  self.assertIn(b"exec(compile(source,p,'exec'),ns)",raw);self.assertNotIn(b'exec_module',raw)

if __name__=='__main__':unittest.main()
