"""Real canonical stage validation and credential-free registry readback port tests."""
import importlib.util
import json
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'tests'))
import test_cn_release_continuation_acquire as fixture
spec=importlib.util.spec_from_file_location('publication_observer',ROOT/'scripts/cn-release-publication-observer.py');p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)

class StageTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):fixture.AcquireTests.setUpClass()
 @classmethod
 def tearDownClass(cls):fixture.AcquireTests.tearDownClass()
 def setUp(self):
  self.f=fixture.AcquireTests();self.f.setUp();self.addCleanup(self.f.doCleanups);self.f.publication_inputs();self.f.bind()
  self.contents={n:(self.f.root/'out'/n).read_bytes() for n in p.FILES}
 def test_original_canonical_stage_validation_and_tar_tamper(self):
  import test_cn_candidate_host as hf
  f=fixture.f
  result=p.validate_stage(self.contents,self.f.inputs['set'],self.f.root,hf.h,f.c,f.rv,f.pub,f.a);self.assertEqual(set(result[3]),{'api','web','agent','sandbox','postgres'})
  path=self.f.root/'api.tar';path.write_bytes(path.read_bytes()+b'tamper')
  with self.assertRaises(Exception):p.validate_stage(self.contents,self.f.inputs['set'],self.f.root,hf.h,f.c,f.rv,f.pub,f.a)
 def test_exact_stage_files_bound_into_observer_record(self):
  identity={k:self.f.r[k] for k in ('sourceRevision','controlRevision','requestedAt','deadlineAt')};identity.update(baselineRevision='c'*40,attemptId='runtime-test')
  record=p.bundle(p.encode(self.f.r),self.contents,identity,{k:'a'*64 for k in p.PHASES},{'cn-release-publication-observer.py':'b'*64,'cn-release-acquire-observer.py':'c'*64})
  value=json.loads(record['approval.json']);self.assertEqual(set(value['publicationFiles']),set(p.FILES));self.assertEqual(value['publicationFiles']['candidate-revalidation.json'],p.sha(self.f.inputs['proof']))

class RemoteTests(unittest.TestCase):
 def setUp(self):
  self.archive=fixture.f.a;self.blobs={};self.images={};self.published={};self.calls=[]
  for index,service in enumerate(('api','web','agent','sandbox','postgres','redis')):
   config='sha256:'+str(index+1)*64;raw=p.encode({'schemaVersion':2,'mediaType':'application/vnd.oci.image.manifest.v1+json','config':{'digest':config},'layers':[]})
   repository='base-redis' if service=='redis' else self.archive.REPOSITORIES[service];ref=self.archive.PREFIX+'/'+repository+'@sha256:'+p.sha(raw);self.blobs[ref]=raw;self.published[service]={'image':ref};self.images[service]={'imageId':config}
  self.intent={'redisImage':self.published['redis']['image']}
  self.adapter=types.SimpleNamespace(docker='/usr/bin/docker',check_validity=lambda:None,command=self.command)
 def command(self,args,**kwargs):self.calls.append(args);return self.blobs[args[-1]]
 def test_all_six_exact_remote_manifest_digests_and_configs(self):
  value=p.remote_readback(self.adapter,self.images,self.published,self.intent,self.archive);self.assertEqual(set(value),set(self.published));self.assertEqual(len(self.calls),6)
  self.assertTrue(all(x[:5]==['/usr/bin/docker','buildx','imagetools','inspect','--raw'] for x in self.calls))
 def test_foreign_registry_digest_tamper_and_wrong_config_rejected(self):
  import copy
  bad=copy.deepcopy(self.published);bad['api']['image']='example.invalid/x@sha256:'+'a'*64
  with self.assertRaisesRegex(ValueError,'APPROVED_REGISTRY_REFERENCE'):p.remote_readback(self.adapter,self.images,bad,self.intent,self.archive)
  key=self.published['api']['image'];original=self.blobs[key];self.blobs[key]=original+b' '
  with self.assertRaisesRegex(ValueError,'REMOTE_MANIFEST_DIGEST'):p.remote_readback(self.adapter,self.images,self.published,self.intent,self.archive)
  self.blobs[key]=original;self.images['api']['imageId']='sha256:'+'f'*64
  with self.assertRaisesRegex(ValueError,'REMOTE_CONFIG_MISMATCH'):p.remote_readback(self.adapter,self.images,self.published,self.intent,self.archive)
 def test_original_authentication_reused_but_mutation_commands_blocked(self):
  # Inheritance delegates the actual authentication method; it is never invoked
  # in these offline tests. The fake command port captures only whitelist calls.
  class Base:
   def authenticate(self):raise AssertionError('NO_NETWORK_IN_TESTS')
   def command(self,argv,**kwargs):return argv
  host=types.SimpleNamespace(Commands=Base,legacy=types.SimpleNamespace(ROLE='fixture-role',ALIYUN='/fixture/aliyun'))
  cls=p.readonly_adapter_type(host,self.archive,set(self.blobs));adapter=cls();adapter.docker='/usr/bin/docker';self.assertIs(cls.authenticate,Base.authenticate)
  reference=next(iter(self.blobs));argv=[adapter.docker,'buildx','imagetools','inspect','--raw',reference];self.assertEqual(adapter.command(argv),argv)
  for operation in ('push','pull','load','tag','image'):
   with self.assertRaisesRegex(ValueError,'OBSERVER_COMMAND_NOT_READ_ONLY'):adapter.command([adapter.docker,operation,reference])
  with self.assertRaisesRegex(ValueError,'OBSERVER_COMMAND_NOT_READ_ONLY'):adapter.command([adapter.docker,'buildx','imagetools','inspect','--raw','foreign/image'])
 def test_verifier_requires_live_readback_not_receipt_flags(self):
  manifest={'stage':'publish','scope':'runtime-only-reviewed-continuation','actionSha256':'a'*64}
  with patch.object(p,'observe',side_effect=ValueError('REMOTE_AUTH_FAILED')):
   with self.assertRaisesRegex(ValueError,'REMOTE_AUTH_FAILED'):p.verify(b'{"ready":true}',manifest,None,'terminal','b'*64)

class VerifyModes(unittest.TestCase):
 def test_all_phases_original_action_terminal_and_reconcile(self):
  for phase in p.PHASES:
   manifest={'stage':phase,'scope':'runtime-only-reviewed-continuation','actionSha256':'a'*64}
   receipt=p.encode({'kind':'fixture-original-receipt'})
   observed=p.encode({'actionSha256':'a'*64,'entryIdentity':{},'publicationFiles':{'approval.json':'b'*64},'publishedReceiptSha256':p.sha(receipt)})
   action={'check-plan':p.CHECK_MARKER,'publication-stage':p.encode({'ok':True,'staged':6,'approvalSha256':'b'*64,'publisherCalled':False,'canonicalModified':False}),'publish':b'CN_CANDIDATE_PUBLISHED='+receipt+b'\n'}[phase]
   with patch.object(p,'observe',return_value=observed):
    self.assertTrue(p.verify(action,manifest,None,'advance','c'*64))
    self.assertIs(p.verify(observed,manifest,None,'reconcile','c'*64),True)
    self.assertEqual(p.verify(observed,manifest,None,'terminal','c'*64),{'externalWritesTerminal':True})
    with self.assertRaisesRegex(ValueError,'PUBLICATION_OBSERVATION_CHANGED'):p.verify(observed+b' ',manifest,None,'reconcile','c'*64)
 def test_real_installed_python_names(self):
  import re
  source=(ROOT/'scripts/cn-release-publication-observer.py').read_text()
  self.assertIn("r'[a-zA-Z0-9_-]+\\.py'",source)
  for name in ('cn_candidate_host.py','hosted-release.py','canonical_control.py'):
   self.assertIsNotNone(re.fullmatch(r'[a-zA-Z0-9_-]+\.py',name))

if __name__=='__main__':unittest.main()
