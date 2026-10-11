"""Real router -> delegation -> canonical materializer -> observer records.

Only installation/physical root locations and ownership are adapted for macOS;
router methods, generators, bundle builders and contracts execute unchanged.
"""
import importlib.util
import json
import os
from pathlib import Path
import unittest
from unittest.mock import patch
import test_cn_release_acquire_delegation as fixture

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('acquire_router',ROOT/'scripts/cn-release-stage-router.py');r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)

class RouterIntegration(unittest.TestCase):
 @classmethod
 def setUpClass(cls):fixture.DelegationTests.setUpClass()
 @classmethod
 def tearDownClass(cls):fixture.DelegationTests.tearDownClass()
 def setUp(self):
  self.f=fixture.DelegationTests();self.f.setUp();self.addCleanup(self.f.doCleanups);self.root=self.f.f.root
  a=self.f.release
  for name in (*r.MODULES.values(),'scripts/cn-release-stage-contract.py'):
   a['codeFiles'][name]=fixture.d.sha((ROOT/name).read_bytes())
  raw=fixture.d.encode(a);release=fixture.d.sha(raw)
  self.input=self.root/'router-inputs';self.output=self.root/'router-output';(self.input/release).mkdir(parents=True)
  for name,data in self.f.f.inputs.items():
   path=self.input/release/(name+'.json');path.write_bytes(data);path.chmod(0o600)
  real_read=r.e.read
  def read(path,limit=r.e.MAX):
   path=Path(path)
   # A versioned installed code tree is represented by the exact repository
   # bytes here. Production e.read still requires private root-owned files.
   if path.is_relative_to(ROOT):return path.read_bytes()
   if path==fixture.d.receipt_path(a):return self.physical.read_bytes()
   return real_read(path,limit)
  for ctx in (patch.object(r,'INPUTS',self.input),patch.object(r,'OUTPUTS',self.output),patch.object(r,'CONTROL',self.f.f.repo),patch.object(r.e,'OWNER',os.getuid()),patch.object(r.e,'directory',lambda path:None),patch.object(r.e,'read',side_effect=read)):
   ctx.start();self.addCleanup(ctx.stop)
  self.router=r.Router(release,a,raw);self.router.base.mkdir(parents=True)
  self.consume=self.router.load('consume-observer');self.pub=self.router.load('publication-observer')
  self.consume.APPROVALS=self.root/'consume-records';self.pub.APPROVALS=self.root/'pub-records'
  self.consume.APPROVALS.mkdir();self.pub.APPROVALS.mkdir()
 def chain(self,reconcile):
  folder,_=self.router.acquire('consume');(self.root/'delegated-consume').symlink_to(folder,target_is_directory=True)
  live=self.f.receipt();self.physical=self.root/'physical-promoted.json';self.physical.write_bytes(live);self.physical.chmod(0o600)
  chain=self.f.completion(live,reconcile=reconcile);entry=fixture.d.load_entry(ROOT)
  for ctx in (patch.object(r.e,'STATE',entry.STATE),patch.object(r.e,'REQUESTS',entry.REQUESTS),patch.object(self.router.load('acquire'),'load_entry',return_value=entry)):
   ctx.start();self.addCleanup(ctx.stop)
  return chain
 def test_actual_consume_and_publication_context_and_contract(self):
  self.check_chain(False)
 def test_reconciled_consume_generates_actual_next_publication(self):
  self.check_chain(True)
 def check_chain(self,reconcile):
  folder,result=self.router.acquire('consume');action,_=self.router.action('consume');observer,verifier=self.router.contract('consume')
  self.assertIn(b'stage-contract.py observe consume',observer);self.assertIn(b"ns['verify']('consume'",verifier)
  context=self.router.prepare_context('consume',action,observer)
  record=json.loads((self.consume.APPROVALS/context['requestSha256']/'approval.json').read_bytes())
  source_sha=self.f.release['codeFiles'][r.MODULES['consume-observer']]
  self.assertEqual(record['observerSha256'],source_sha);self.assertNotEqual(record['observerSha256'],fixture.d.sha(observer))
  self.assertEqual(record['actionSha256'],fixture.d.sha(action));self.assertEqual(result['requestSha256'],context['requestSha256'])
  self.chain(reconcile)
  pubfolder,pubresult=self.router.acquire('publication')
  self.assertEqual(pubresult['runtimeReceiptSha256'],fixture.d.sha(self.physical.read_bytes()))
  for phase in self.pub.PHASES:
   action,_=self.router.action(phase);obs,_=self.router.contract(phase)
   context=self.router.prepare_context(phase,action,obs)
   record=json.loads((self.pub.APPROVALS/context['requestSha256']/'approval.json').read_bytes())
   self.assertEqual(record['actionSha256'][phase],fixture.d.sha(action))
   self.assertEqual(record['publicationFiles'],{name:fixture.d.sha((pubfolder/name).read_bytes()) for name in self.pub.FILES})
   self.assertEqual(record['observerFiles']['cn-release-publication-observer.py'],self.f.release['codeFiles'][r.MODULES['publication-observer']])
  self.assertEqual(self.router.acquire('publication')[1],pubresult)
 def test_existing_generated_file_tamper_refuses_context(self):
  folder,_=self.router.acquire('consume');path=folder/'parameters.json';path.write_bytes(path.read_bytes()+b' ')
  with self.assertRaisesRegex(Exception,'ACQUIRE_FILE_CHANGED'):self.router.prepare_context('consume',b'anything',b'observer')

if __name__=='__main__':unittest.main()
