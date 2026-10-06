import types,unittest,json,importlib.util,sys,tempfile,hashlib,os
from pathlib import Path
# Disposable local preload; production resolves its protected exact FD module set.
spec=importlib.util.spec_from_file_location('epoch_recovery',Path(__file__).with_name('cn-maintenance-recovery-evidence-verifier.py'));module=importlib.util.module_from_spec(spec);sys.modules['epoch_recovery']=module;spec.loader.exec_module(module)
from pathlib import Path
from unittest.mock import patch
from test_cn_backup_package import fixture
from retained_epoch_capture import RetainedEpochCapture,CaptureRetainedBackupHost
from cn_backup_package import DATABASES,IMAGE
from writer_fence import digest
class CaptureTests(unittest.TestCase):
 def setUp(self):
  self.root_patch=patch('retained_epoch_capture.EVIDENCE_ROOT',Path('/private'));self.root_patch.start();self.addCleanup(self.root_patch.stop)
  self.p,_=fixture();self.b={'identity':self.p['identity'],'toolRevision':self.p['toolRevision'],'host':{'instanceId':'i-uf6ga92ewloganobbln6','bootId':'12345678-1234-1234-1234-123456789012'},'epoch':'c'*64,'holdGeneration':'d'*32,'targetInstanceId':'pgm-isolated','providerBindingSha256':self.p['providerBindingSha256']};self.saved={}
  actor=types.SimpleNamespace(identity=self.b['identity'],plan={'holdGeneration':self.b['holdGeneration']},hold=lambda:None,observe=lambda:{'host':self.b['host'],'sourceActualObservation':True},assert_blocked=lambda actual:None,journal=types.SimpleNamespace(value={'events':[{'state':'held'}]}))
  host=CaptureRetainedBackupHost.__new__(CaptureRetainedBackupHost);host.actor=actor;host.plan=self.p;host.root=Path('/private/backup');host.permission_captures={db:{'facts':{'database':db},'scope':{}} for db in DATABASES};host.relays=[]
  self.result={'cleanupVerified':True,'currentEpochVerified':False,'databases':{}}
  for db in DATABASES:
   self.result['databases'][db]={'ciphertextSha256':'f'*64,'ciphertextBytes':10}
   proof={'facts':{'database':db,'session':{'pid':10,'backendStart':'start'}},'readOnlyEvidence':{'exeSha256':'a'*64}}
   host.relays.append(types.SimpleNamespace(proof={'backendProof':proof},receipts=[{'path':'/proof','sha256':'a'*64}]))
  self.root=Path('/private')/self.p['identity']['sourceRevision']/self.p['identity']['attemptId'];self.capture=RetainedEpochCapture(host,actor,self.b,str(self.root),object())
  # Source method boundaries are mocked only for these disposable SQL-free tests.
  self.capture.snapshot_ciphertext=lambda db,receipt:{'path':str(self.root/(db+'.ciphertext.cms')),'sha256':receipt['ciphertextSha256'],'bytes':receipt['ciphertextBytes']}
  host.host={'backup':self.p,'connection':{'transport':{db:{'fixedProvider':True} for db in DATABASES}}}
  source={'identity':self.b['identity'],'toolRevision':self.b['toolRevision']};source_raw=json.dumps(source).encode()
  actor.plan.update(identity=self.b['identity'],toolRevision=self.b['toolRevision'],runtimeSourcePlanSha256=digest(source),runtimeSealPath='/var/lib/workspacex-cn/runtime/'+self.b['identity']['attemptId']+'/sealed-writer-runtime.json')
  actor.plan['controlSessions']={db:{'pid':10+n} for n,db in enumerate(DATABASES)};actor.plan['diagnosticSessions']={db:{'pid':100+n} for n,db in enumerate(DATABASES)}
  actor.transport=types.SimpleNamespace(plan=actor.plan,manifest_sha=__import__('hashlib').sha256(source_raw).hexdigest(),control_connections={db:types.SimpleNamespace(binding=b) for db,b in actor.plan['controlSessions'].items()},diagnostic_connections={db:types.SimpleNamespace(binding=b) for db,b in actor.plan['diagnosticSessions'].items()})
  seal={'kind':'sealed-maintenance-writer-runtime','runtimePlan':actor.plan,'runtimePlanSha256':digest(actor.plan),'identity':self.b['identity'],'toolRevision':self.b['toolRevision'],'sourcePlanPath':'/protected/actor-plan','sourcePlanSha256':actor.transport.manifest_sha,'sourcePlanCanonicalSha256':digest(source)}
  host_raw=json.dumps(host.host).encode();host.reference={'path':'/protected/host','sha256':__import__('hashlib').sha256(host_raw).hexdigest()}
  profile={'backupHostPlan':host.reference,'toolRevision':self.b['toolRevision']}
  self.originals={'/protected/host':host_raw,'/protected/actor-plan':source_raw,actor.plan['runtimeSealPath']:json.dumps(seal).encode(),'/etc/workspacex-cn/trusted-tool-binding.json':json.dumps(profile).encode()}
  host.read=lambda path:self.originals[path]
  self.capture.save_raw=lambda name,raw:self.save(str(self.root/(name+'.json')),json.loads(raw))
 def save(self,path,value):self.saved[path]=json.loads(json.dumps(value));return {'path':path,'sha256':digest(value)}
 def test_actual_lease_path_generates_unqualified_raw_draft(self):
  with patch('retained_epoch_capture.write_collection',self.save),patch('retained_epoch_capture.BackupLease') as lease:
   lease.return_value.run.return_value=self.result;ref=self.capture.run_production();lease.return_value.run.assert_called_once()
  draft=self.saved[ref['path']];self.assertFalse(draft['ready']);self.assertFalse(draft['qualified']);self.assertEqual(set(draft['dumpLanes']),set(DATABASES));self.assertIn('isolation',draft['requiredExternalInputs'])
  self.assertGreaterEqual(draft['captureStartedAt'],draft['before']['value']['observedAt']);self.assertLessEqual(draft['captureEndedAt'],draft['after']['value']['observedAt'])
  outputs=self.capture.actual_production_outputs();self.assertEqual(len(outputs),12)
  self.assertEqual(self.capture.actual_input_references(),draft['inputReferences']);self.assertEqual(len(draft['inputReferences']),7)
  for kind,item in outputs.items():
   if kind.startswith(('permissions:','dump:','backend:')):self.assertGreaterEqual(item['startedAt'],draft['before']['value']['observedAt']);self.assertLessEqual(item['endedAt'],draft['after']['value']['observedAt'])
  self.assertEqual(self.saved[draft['permissions'][DATABASES[0]]['path']]['facts']['database'],DATABASES[0])
 def test_input_snapshot_rejects_original_hash_drift(self):
  self.originals['/protected/host']+=b' '
  with self.assertRaisesRegex(RuntimeError,'HOST_SOURCE_PIN'):self.capture.snapshot_inputs()
  self.assertIsNone(self.capture.input_references)
 def test_input_snapshot_rejects_root_profile_substitution(self):
  profile=json.loads(self.originals['/etc/workspacex-cn/trusted-tool-binding.json']);profile['backupHostPlan']['sha256']='0'*64
  self.originals['/etc/workspacex-cn/trusted-tool-binding.json']=json.dumps(profile).encode()
  with self.assertRaisesRegex(RuntimeError,'HOST_ROOT_PROFILE'):self.capture.snapshot_inputs()
 def test_input_snapshot_rejects_actual_session_drift(self):
  self.capture.actor.transport.control_connections[DATABASES[0]].binding={'pid':999}
  with self.assertRaisesRegex(RuntimeError,'ACTUAL_SIX_SESSIONS'):self.capture.snapshot_inputs()
 def test_input_snapshot_rejects_source_plan_drift(self):
  self.originals['/protected/actor-plan']+=b' '
  with self.assertRaisesRegex(RuntimeError,'ACTOR_ORIGINAL_PIN'):self.capture.snapshot_inputs()
 def test_actual_inputs_unavailable_before_source_snapshot(self):
  with self.assertRaisesRegex(RuntimeError,'INPUTS_NOT_SNAPSHOTTED'):self.capture.actual_input_references()
 def test_exact_raw_snapshot_is_private_and_exclusive(self):
  with tempfile.TemporaryDirectory() as folder:
   self.capture.root=Path(folder);raw=b'{ "source": "actual" }\n'
   with patch.object(self.capture,'private_output_parent'):
    ref=RetainedEpochCapture.save_raw(self.capture,'witness',raw)
    self.assertEqual(Path(ref['path']).read_bytes(),raw);self.assertEqual(ref['sha256'],hashlib.sha256(raw).hexdigest())
    self.assertEqual(os.stat(ref['path']).st_mode&0o777,0o600)
    with self.assertRaises(FileExistsError):RetainedEpochCapture.save_raw(self.capture,'witness',raw)
 def test_ciphertext_copy_hash_and_exclusive_path(self):
  with tempfile.TemporaryDirectory() as folder:
   root=Path(folder);self.capture.root=root/'attempt';self.capture.root.mkdir(mode=0o700);self.capture.host.root=root/'source';self.capture.host.root.mkdir()
   raw=b'encrypted-fixture-only';db=DATABASES[0];(self.capture.host.root/(db+'.dump.cms')).write_bytes(raw)
   receipt={'ciphertextSha256':hashlib.sha256(raw).hexdigest(),'ciphertextBytes':len(raw)}
   with patch.object(self.capture,'private_output_parent'),patch('retained_epoch_capture.Protected') as protected:
    ref=RetainedEpochCapture.snapshot_ciphertext(self.capture,db,receipt)
    self.assertEqual(Path(ref['path']).read_bytes(),raw);self.assertEqual(os.stat(ref['path']).st_mode&0o777,0o600);protected.return_value.recheck.assert_called_once()
    with self.assertRaises(FileExistsError):RetainedEpochCapture.snapshot_ciphertext(self.capture,db,receipt)
 def test_unknown_cleanup_never_generates_success_draft(self):
  with patch('retained_epoch_capture.write_collection',self.save),patch('retained_epoch_capture.BackupLease') as lease:
   lease.return_value.run.side_effect=RuntimeError('OWNED_CHILDREN_JOIN_UNKNOWN')
   with self.assertRaisesRegex(RuntimeError,'JOIN_UNKNOWN'):self.capture.run_production()
  self.assertIsNone(self.capture.draft);self.assertNotIn(str(self.root/'capture-draft.json'),self.saved)
 def test_non_source_host_rejected(self):
  with self.assertRaisesRegex(RuntimeError,'SOURCE_HOST'):RetainedEpochCapture(types.SimpleNamespace(),self.capture.actor,self.b,'/private/capture',object())
 def test_missing_actual_backends_rejected(self):
  self.capture.host.relays=[]
  with patch('retained_epoch_capture.write_collection',self.save),patch('retained_epoch_capture.BackupLease') as lease:
   lease.return_value.run.return_value=self.result
   with self.assertRaisesRegex(RuntimeError,'ACTUAL_FACTS_MISSING'):self.capture.run_production()
  self.assertIsNone(self.capture.draft)
 def test_collection_flags_cannot_replace_external_raw_inputs(self):
  draft={'kind':'source-owned-epoch-capture-draft','binding':self.b,'qualified':False}
  qr=types.SimpleNamespace(json=lambda ref:draft)
  with patch('retained_epoch_capture.QualificationReader',return_value=qr):
   with self.assertRaisesRegex(RuntimeError,'EXTERNAL_INPUTS'):self.capture.stage_external_evidence({'path':str(self.root/'capture-draft.json')}, {'objectsPassed':True,'replayPassed':True},object())
 def test_final_policy_is_external_and_output_hash_exact(self):
  output={'path':'/private/output','sha256':'a'*64};policyref={'path':'/private/policy','sha256':'b'*64};invref={'path':'/private/invocation','sha256':'c'*64};stagedref={'path':str(self.root/'qualification-input-draft.json'),'sha256':'d'*64}
  staged={'kind':'source-owned-qualification-input-draft','binding':self.b,'qualified':False,'input':{'sourcePolicy':None,'outputRoot':str(self.root/'qualified-current-epoch')},'outputs':{'collection':output}}
  policy={'kind':'source-approved-epoch-policy','binding':self.b,'invocations':{'collection':invref}}
  invocation={'binding':self.b,'output':output,'kind':'collection'}
  values={stagedref['path']:staged,policyref['path']:policy,invref['path']:invocation}
  qr=types.SimpleNamespace(json=lambda ref:values[ref['path']],expand=lambda ref:ref,blocks=lambda ref:iter([b'actual-ref']),finish=lambda:None)
  with patch('retained_epoch_capture.QualificationReader',return_value=qr),patch('retained_epoch_capture.write_collection',self.save):
   ref=self.capture.finalize(stagedref,object(),policyref)
  self.assertEqual(self.saved[ref['path']]['sourcePolicy'],policyref)
 def test_final_policy_wrong_actual_output_rejected(self):
  output={'path':'/private/output','sha256':'a'*64};policyref={'path':'/private/policy','sha256':'b'*64};invref={'path':'/private/invocation','sha256':'c'*64};stagedref={'path':str(self.root/'qualification-input-draft.json'),'sha256':'d'*64}
  values={stagedref['path']:{'kind':'source-owned-qualification-input-draft','binding':self.b,'qualified':False,'input':{'sourcePolicy':None,'outputRoot':str(self.root/'qualified-current-epoch')},'outputs':{'collection':output}},policyref['path']:{'kind':'source-approved-epoch-policy','binding':self.b,'invocations':{'collection':invref}},invref['path']:{'binding':self.b,'output':{'path':'/private/output','sha256':'f'*64},'kind':'collection'}}
  qr=types.SimpleNamespace(json=lambda ref:values[ref['path']],expand=lambda ref:ref)
  with patch('retained_epoch_capture.QualificationReader',return_value=qr),patch('retained_epoch_capture.write_collection',self.save):
   with self.assertRaisesRegex(RuntimeError,'FINAL_INVOCATION_BINDING'):self.capture.finalize(stagedref,object(),policyref)
  self.assertEqual(self.saved,{})
 def test_fixed_attempt_root_rejects_other_attempt_or_arbitrary_directory(self):
  for wrong in ('/private/capture',str(self.root.parent/'other-attempt')):
   with self.assertRaisesRegex(RuntimeError,'FIXED_ATTEMPT_ROOT'):RetainedEpochCapture(self.capture.host,self.capture.actor,self.b,wrong,object())
 def test_production_root_matches_actual_qualifier_entry_contract(self):
  expected=Path('/etc/workspacex-cn/maintenance-evidence')/self.p['identity']['sourceRevision']/self.p['identity']['attemptId']
  with patch('retained_epoch_capture.EVIDENCE_ROOT',Path('/etc/workspacex-cn/maintenance-evidence')):
   capture=RetainedEpochCapture(self.capture.host,self.capture.actor,self.b,str(expected),object())
   self.assertEqual((capture.root/'qualification-input.json').parent.parent.parent,Path('/etc/workspacex-cn/maintenance-evidence'))
   self.assertEqual(str(capture.root/'qualified-current-epoch'),str(expected/'qualified-current-epoch'))
 def test_finalizer_rejects_staged_input_from_other_root(self):
  with self.assertRaisesRegex(RuntimeError,'FIXED_STAGED_PATH'):self.capture.finalize({'path':'/private/elsewhere/qualification-input-draft.json'},object(),{})
if __name__=='__main__':unittest.main()
