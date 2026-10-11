"""Real private files and canonical baseline readback; fake helper CAS, no cloud."""
import importlib.util
from pathlib import Path
import sys
import unittest
sys.path.insert(0,str(Path(__file__).parent))
import test_cn_release_business_recovery as fixture
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('writer',ROOT/'scripts/cn-release-recovery-writer.py');w=importlib.util.module_from_spec(spec);spec.loader.exec_module(w)

class RecoveryWriter(unittest.TestCase):
 def setUp(self):
  self.f=fixture.Baseline();self.f.setUp();self.addCleanup(self.f.doCleanups);self.s=fixture.m;self.r=fixture.r
  held=self.f.run_baseline();s=self.s
  rawhealth=s.enc(held);rawhold=s.enc(self.f.hold);scope=b'{"scope":"fixture-baseline-only"}\n';user=b'{"explicit":"resume baseline writers fixture"}\n'
  self.f.a['business']['recoveryTestDataScopeSha256']=s.sha(scope)
  self.out=s.VAR/'release-generated'/self.f.release/'terminal'/'recovery-writer-resume'
  self.approval=dict(kind='cn-recovery-writer-resume-approval-v1',scope='resume-baseline-writers-and-scoped-business-observation',
   releaseSha256=self.f.release,identity=self.f.identity,target=self.r.TARGET,issuedAt=self.f.f['issuedAt'],expiresAt=self.f.f['expiresAt'],
   bindingSha256=held['bindingSha256'],runtimeRecoveryReceiptSha256=held['runtimeRecoveryReceiptSha256'],heldHealthSha256=s.sha(rawhealth),
   holdRawSha256=s.sha(rawhold),holdGeneration=self.f.hold['generation'],userAuthorizationEvidenceSha256=s.sha(user),
   testDataScopeSha256=s.sha(scope),publicOrigin='https://app.boardx.com.cn/',recoveryApprovalSha256=s.sha(self.f.fraw))
  for name,raw in [('held-health.json',rawhealth),('held-hold.json',rawhold),('test-data-scope.json',scope),('user-authorization.json',user)]:self.f.put(self.out/name,raw)
  self.sign();self.calls=[]
 def sign(self):
  self.raw=self.s.enc(self.approval)
  self.f.put(self.s.ETC/'recovery-writer-resume-approvals'/(self.s.sha(self.raw)+'.json'),self.raw)
  self.f.put(self.s.ETC/'recovery-writer-resume-approvals'/'by-recovery'/(self.s.sha(self.f.fraw)+'.json'),self.s.enc({'approvalSha256':self.s.sha(self.raw)}))
 def invoke(self,argv,raw):
  self.calls.append((argv,raw));self.f.hold={**self.f.hold,'state':'cleared'}
 def run_clear(self,**kw):
  return w.clear(self.f.a,self.f.release,self.f.fraw,self.raw,self.f.prepared,self.s,self.r,reader=self.f.reader,call=self.f.call,clear_call=kw.get('clear_call',self.invoke),now=self.f.now)
 def test_real_baseline_evidence_and_single_cas_result(self):
  result=self.run_clear();self.assertEqual(len(self.calls),1);self.assertFalse(result['dataRestored']);self.assertFalse(result['businessAcceptancePassed'])
  self.assertEqual(result['helperResultSha256'],self.s.sha((self.out/'recovery-clear-helper.json').read_bytes()))
  self.assertEqual(self.s.parse((self.out/'recovery-clear-intent.json').read_bytes())['approvalSha256'],self.s.sha(self.raw))
  self.assertEqual(self.calls[0][0][-2],'clear')
  self.f.prepared['recoveryPlan']={'deploymentMarker':'baseline-fixture'}
  live,envelope=self.r.public(self.f.a,self.f.release,self.f.fraw,self.f.prepared,self.s,reader=self.f.reader,call=self.f.call,now=self.f.now)
  self.assertEqual(live['runtimeRevision'],self.f.identity['baselineRevision'])
  self.assertEqual(live['writerResumeApprovalSha256'],self.s.sha(self.raw))
  self.assertEqual(live['clearReceiptSha256'],self.s.sha((self.out/'recovery-clear-result.json').read_bytes()))
 def test_unknown_clear_preserves_intent_without_retry_or_result(self):
  def unknown(argv,raw):self.calls.append((argv,raw));raise TimeoutError('fixture unknown')
  with self.assertRaises(TimeoutError):self.run_clear(clear_call=unknown)
  self.assertTrue((self.out/'recovery-clear-intent.json').exists());self.assertFalse((self.out/'recovery-clear-result.json').exists())
  with self.assertRaisesRegex(ValueError,'CLEAR_ALREADY_ATTEMPTED'):self.run_clear()
  self.assertEqual(len(self.calls),1)
 def test_fresh_recovery_can_resume_after_original_deadline_without_retiming(self):
  import datetime as dt
  old=(self.f.now-dt.timedelta(hours=1)).isoformat();expired=(self.f.now-dt.timedelta(minutes=30)).isoformat()
  self.f.identity.update(requestedAt=old,deadlineAt=expired);self.f.binding.update(requestedAt=old,deadlineAt=expired)
  self.f.binding_raw=self.s.enc(self.f.binding);self.f.put(self.f.root/'binding.json',self.f.binding_raw)
  self.f.f['originalBindingSha256']=self.s.sha(self.f.binding_raw);self.f.f['inputHashes']['binding']=self.s.sha(self.f.binding_raw)
  self.f.install_recovery((self.f.root/'recovery-reconciliation.json').read_bytes())
  held=self.f.run_baseline();raw=self.s.enc(held);self.f.put(self.out/'held-health.json',raw)
  self.approval.update(bindingSha256=self.s.sha(self.f.binding_raw),heldHealthSha256=self.s.sha(raw),recoveryApprovalSha256=self.s.sha(self.f.fraw));self.sign()
  result=self.run_clear();self.assertEqual(result['identity']['requestedAt'],old);self.assertEqual(result['identity']['deadlineAt'],expired)

 def test_foreign_approval_scope_or_health_change_rejects_before_intent(self):
  self.approval['scope']='normal';self.sign()
  with self.assertRaisesRegex(ValueError,'RECOVERY_WRITER_SCHEMA'):self.run_clear()
  self.assertFalse((self.out/'recovery-clear-intent.json').exists())
 def test_real_container_drift_blocks_clear(self):
  self.f.xs[0]['State']['Running']=False
  with self.assertRaisesRegex(ValueError,'BASELINE_HEALTH'):self.run_clear()
  self.assertEqual(self.calls,[])
 def test_pinned_user_evidence_changed_or_symlink_rejected(self):
  self.f.put(self.out/'user-authorization.json',b'changed')
  with self.assertRaisesRegex(ValueError,'FILE_PIN'):self.run_clear()
  p=self.out/'held-health.json';p.unlink();p.symlink_to(self.out/'held-hold.json')
  with self.assertRaises(OSError):self.run_clear()

if __name__=='__main__':unittest.main()
