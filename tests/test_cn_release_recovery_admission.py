"""Pinned real runtime/package/archive evidence. No real Docker/RDS invocation."""
import datetime as dt
import importlib.util
import os
from pathlib import Path
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
def mod(name,path):
 s=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
m=mod('admission',ROOT/'scripts/cn-release-recovery-admission.py')
rf=mod('readbackfixture',ROOT/'tests/test_cn_release_runtime_readback.py')
jf=mod('entryfixture',ROOT/'tests/test_cn_release_continuation_journal.py')

class Admission(unittest.TestCase):
 def setUp(self):
  self.f=rf.ReadbackTests();self.f.setUp();self.addCleanup(self.f.doCleanups)
  self.f.b['requestedAt']=(dt.datetime.now(dt.timezone.utc)-dt.timedelta(minutes=1)).isoformat()
  self.f.b['holdHelperSha256']=rf.m.sha((ROOT/'.harness/scripts/vm/cn_maintenance_hold.py').read_bytes())
  self.f.braw=rf.enc(self.f.b);self.f.write(self.f.root/'binding.json',self.f.braw)
  self.f.write(self.f.root/'backup-intent.json',rf.enc({'bindingSha256':rf.m.sha(self.f.braw),'holdGeneration':self.f.b['hold']['generation']}))
  self.j=jf.JournalTests();self.j.setUp();self.addCleanup(self.j.doCleanups)
  self.rb=rf.m;self.e=self.j.e;self.now=dt.datetime.now(dt.timezone.utc);self.release=self.rb.sha(b'authorization')
  self.identity={k:self.f.b[k]for k in ('sourceRevision','baselineRevision','controlRevision','attemptId','requestedAt','deadlineAt')};self.identity['publicationAttemptId']='published-fixture'
  self.a=dict(kind='cn-fixed-release-approval-v1',identity=self.identity,target=m.TARGET,runtimeStage={'remoteRoot':str(self.f.root)},codeFiles={m.CODE['reader']:self.rb.sha((ROOT/m.CODE['reader']).read_bytes())})
  p=patch.object(m,'VAR',self.f.runtime.parent);p.start();self.addCleanup(p.stop)
  self.attempt=self.e.STATE/self.identity['attemptId'];self.attempt.mkdir()
  self.j.write(self.e.STATE/'active-attempt.json',self.e.encode(self.identity['attemptId']))
  self.fresh=dict(kind='cn-release-fresh-recovery-delegation-v1',releaseSha256=self.release,identity=self.identity,target=m.TARGET,
   issuedAt=(self.now-dt.timedelta(seconds=1)).isoformat(),expiresAt=(self.now+dt.timedelta(minutes=5)).isoformat(),
   runtimeRoot=str(self.f.root),originalBindingSha256=self.rb.sha(self.f.braw),upgradeSha256=self.f.b['scriptSha256'],operation='abort-original')
  inputs=m.VAR/'release-inputs'/self.release;inputs.mkdir(parents=True,mode=0o700)
  values={'binding':self.f.braw,'terminalObservation':self.f.raw,'reconciliation':rf.enc({'priorInvocationTerminal':True,'activeCloudCommands':[],'hold':self.f.b['hold'],'attemptId':self.f.b['attemptId'],'observedAt':self.now.isoformat(),'operation':'abort-original'})}
  for key,raw in values.items():self.f.write(inputs/('recovery-'+('original-binding'if key=='binding'else key)+'.json'),raw)
  self.fresh['inputHashes']={k:self.rb.sha(v)for k,v in values.items()}
  self.modules={'reader':self.rb,'entry':self.e,'runtimeObserver':mod('real_observer',ROOT/m.CODE['runtimeObserver'])}
  self.stage('backup')
 def stage(self,name):
  for path in self.attempt.iterdir():path.unlink()
  self.j.attempt=self.attempt;self.j.identity={**{k:v for k,v in self.identity.items()if k!='publicationAttemptId'},'scope':'runtime-only-reviewed-continuation'}
  self.j.start=self.identity['requestedAt'];self.j.end=self.identity['deadlineAt'];self.j.now=self.now
  self.j.make_chain(self.e.STAGES.index(name)-1)
  previous=(self.attempt/('%02d-%s.receipt.json'%(self.e.STAGES.index(name)-1,self.e.STAGES[self.e.STAGES.index(name)-1]))).read_bytes()
  self.fresh['failedStage']=name
  action=('/usr/bin/python3 -I -S -B '+str(self.f.root)+'/upgrade-draft.py '+str(self.f.root)+' '+self.rb.sha(self.f.braw)+' '+name+'\n').encode()
  verifier=b'def verify(*args): return True\n'
  manifest=dict(schemaVersion=1,**{k:v for k,v in self.identity.items()if k!='publicationAttemptId'},scope='runtime-only-reviewed-continuation',stage=name,
   previousReceiptSha256=self.rb.sha(previous),issuedAt=self.fresh['issuedAt'],expiresAt=self.fresh['expiresAt'],timeoutSeconds=10,
   actionSha256=self.rb.sha(action),observerSha256=self.rb.sha(b'observer'),verifierSha256=self.rb.sha(verifier),authorizationEvidenceSha256=self.release)
  raw=self.e.encode(manifest);h=self.rb.sha(raw);folder=self.e.REQUESTS/h;folder.mkdir(exist_ok=True)
  for key,value in {'manifest.json':raw,'action.sh':action,'observe.sh':b'observer','verify.py':verifier,'authorization.json':b'authorization'}.items():self.j.write(folder/key,value)
  self.fresh.update(failedRequestSha256=h,terminalVerifierSha256=manifest['verifierSha256'])
  prefix=self.attempt/('%02d-%s'%(self.e.STAGES.index(name),name))
  for suffix,v in [('.intent.json',{'requestSha256':h}),('.process.json',{'requestSha256':h,'pid':9999999})]:self.j.write(Path(str(prefix)+suffix),self.e.encode(v))
 def reader(self):
  rb=self.rb;fixture=self.f
  class Reader(rb.Reader):
   def file(self,path,*args,**kw):
    if path==m.HOLD:return (ROOT/'.harness/scripts/vm/cn_maintenance_hold.py').read_bytes()
    return super().file(path,*args,**kw)
  return Reader(os.getuid(),fixture.f.root)
 def invoke(self,**kw):
  return m.classify(self.a,self.release,self.e.encode(self.fresh),self.modules,reader=self.reader(),hold_reader=lambda:self.f.b['hold'],now=self.now,**kw)
 def test_real_complete_backup_tar_and_original_validator_proves_terminal(self):
  result=self.invoke();self.assertTrue(result['safeToRecover']);self.assertEqual(result['observationSha256'],self.rb.sha(self.f.raw))
  self.assertFalse(result['allExternalWritersFenced'])
 def test_empty_local_cgroup_does_not_prove_missing_backup_or_changed_tar(self):
  path=self.f.root/'host-backup/sandbox.tar';self.f.write(path,b'bad')
  with self.assertRaises(ValueError):self.invoke()
 def test_running_local_process_refuses_before_any_observer(self):
  self.e.execution_terminal=lambda _:False
  with self.assertRaisesRegex(ValueError,'LOCAL_INVOCATION_UNKNOWN'):self.invoke(phase_observer=lambda *a,**k:(_ for _ in ()).throw(AssertionError('must not observe')))
 def test_clear_intent_requires_new_rehold_approval(self):
  self.j.write(self.attempt/'15-clear-hold.intent.json',b'{}')
  result=self.invoke();self.assertEqual(result['status'],'REHOLD_APPROVAL_REQUIRED');self.assertFalse(result['safeToRecover'])
 def test_unknown_remote_stop_observer_is_not_promoted(self):
  self.stage('stop')
  def unknown(*args,**kw):raise ValueError('DATABASE_SESSIONS_UNKNOWN')
  with self.assertRaisesRegex(ValueError,'DATABASE_SESSIONS_UNKNOWN'):self.invoke(phase_observer=unknown)
 def test_expired_or_foreign_fresh_authority_rejects(self):
  self.fresh['expiresAt']=(self.now-dt.timedelta(seconds=1)).isoformat()
  with self.assertRaisesRegex(ValueError,'FRESH_RECOVERY_WINDOW'):self.invoke()
 def test_actual_rds_observer_checks_exact_finished_job_and_never_creates_again(self):
  fixture=mod('actual_rds_fixture',ROOT/'tests/test_cn_release_rds_backup.py')
  f=fixture.Tests();f.setUp();self.addCleanup(f.doCleanups);f.runop('action')
  calls=[]
  def read(argv):
   calls.append(argv);return f.runop('observe')
  with patch.object(m,'run_read',side_effect=read):
   raw=m.observe_phase('rds-backup',self.a,self.release,self.fresh,self.modules,self.f.b,self.f.braw,self.reader(),lambda:self.f.b['hold'],now=self.now)
   self.assertEqual(fixture.m.parse(raw)['requestedBackupJobId'],'123')
   f.p.job['BackupStatus']='Uploading'
   with self.assertRaises(ValueError):m.observe_phase('rds-backup',self.a,self.release,self.fresh,self.modules,self.f.b,self.f.braw,self.reader(),lambda:self.f.b['hold'],now=self.now)
  self.assertTrue(all(argv[-2:]==['observe',self.release]for argv in calls))
  self.assertEqual(sum(action=='CreateBackup'for action,_ in f.p.calls),1)
 def test_other_unknown_intent_and_tampered_original_raw_reject(self):
  self.j.write(self.attempt/'13-switch.intent.json',b'{}')
  with self.assertRaisesRegex(ValueError,'OTHER_INVOCATION_UNKNOWN'):self.invoke()
  (self.attempt/'13-switch.intent.json').unlink()
  self.f.write(m.VAR/'release-inputs'/self.release/'recovery-terminalObservation.json',b'{}')
  with self.assertRaisesRegex(ValueError,'RECOVERY_INPUT_RAW_PINS'):self.invoke()
 def test_partial_switch_inventory_cannot_prove_remote_completion(self):
  self.stage('switch');self.fresh['operation']='rollback'
  path=m.VAR/'release-inputs'/self.release/'recovery-reconciliation.json';r=self.rb.parse(path.read_bytes());r['operation']='rollback';self.f.write(path,rf.enc(r));self.fresh['inputHashes']['reconciliation']=self.rb.sha(path.read_bytes())
  self.f.write(self.f.root/'switch-intent.json',b'{}')
  canonical=self.rb.trusted_module((ROOT/m.TEMPLATE).read_bytes().replace(b'__CONFIG__',b'{}'),'actual_status')
  def partial(*args,**kw):return canonical['validate_status'](self.f.b,self.f.root,[])
  with self.assertRaises(AssertionError):self.invoke(phase_observer=partial)

 def test_foreign_publication_authority_with_valid_historical_witness_rejects(self):
  path=self.attempt/'00-consume.receipt.json';receipt=self.e.decode(path.read_bytes())
  manifest,files=self.e.load_package(receipt['requestSha256'],self.identity['attemptId']);authority=b'other publication approval'
  manifest['authorizationEvidenceSha256']=self.rb.sha(authority);mr=self.e.encode(manifest);new=self.rb.sha(mr)
  folder=self.e.REQUESTS/new;folder.mkdir()
  for name,raw in files.items():self.j.write(folder/name,authority if name=='authorization.json'else mr if name=='manifest.json'else raw)
  self.j.write(folder/'manifest.json',mr)
  receipt['requestSha256']=new;ap=self.attempt/'00-consume.admission.json';admission=self.e.decode(ap.read_bytes())
  admission.update(requestSha256=new,authorizationEvidenceSha256=self.rb.sha(authority));ar=self.e.encode(admission);self.j.write(ap,ar)
  receipt['admissionSha256']=self.rb.sha(ar);self.j.write(path,self.e.encode(receipt))
  self.j.write(self.attempt/'00-consume.intent.json',self.e.encode({'requestSha256':new}))
  self.j.write(self.attempt/'00-consume.process.json',self.e.encode({'requestSha256':new,'pid':999999}))
  with self.assertRaisesRegex(ValueError,'RECOVERY_PRIOR_RELEASE'):self.invoke()
 def test_original_reconciliation_validator_rejects_active_remote_commands(self):
  path=m.VAR/'release-inputs'/self.release/'recovery-reconciliation.json';r=self.rb.parse(path.read_bytes());r['activeCloudCommands']=['unknown']
  self.f.write(path,rf.enc(r));self.fresh['inputHashes']['reconciliation']=self.rb.sha(path.read_bytes())
  with self.assertRaises(AssertionError):self.invoke()

 def test_entry_verify_contract_returns_only_two_proven_flags_and_pins_original_raw(self):
  result=self.invoke();manifest,_=self.e.load_package(self.fresh['failedRequestSha256'],self.identity['attemptId'])
  context={'releaseSha256':self.release,'recoveryApprovalSha256':self.rb.sha(self.e.encode(self.fresh))}
  with patch.object(m,'observe',return_value=result):
   self.assertEqual(m.verify(self.f.raw,manifest,None,'pre-recovery',context),{'externalWritesTerminal':True,'safeToRecover':True})
   with self.assertRaisesRegex(ValueError,'RECOVERY_ORIGINAL_OBSERVATION'):m.verify(b'{}',manifest,None,'pre-recovery',context)
   manifest['attemptId']='foreign'
   with self.assertRaisesRegex(ValueError,'RECOVERY_FAILED_MANIFEST'):m.verify(self.f.raw,manifest,None,'pre-recovery',context)

 def test_original_session_transform_is_exact_and_does_not_retime_binding(self):
  original=(ROOT/'.harness/scripts/vm/cn-runtime-continuation/sessions-after-stop.py').read_bytes()
  changed=m.fresh_sessions_source(original)
  self.assertIn("assert b['draft'] is False",changed)
  self.assertNotIn("datetime.datetime.fromisoformat(b['expiresAt'])",changed)
  self.assertIn("v['clientSessions']==0",changed);self.assertIn("hold()==b['hold']",changed)
  with self.assertRaisesRegex(ValueError,'SESSION_TEMPLATE_SHAPE'):m.fresh_sessions_source(original+b'\n'+original)

if __name__=='__main__':unittest.main()
