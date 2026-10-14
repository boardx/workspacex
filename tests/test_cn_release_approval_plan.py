"""Full offline proposal bytes; cloud/provider identity fields remain fixtures."""
import copy
import importlib.util
import json
from pathlib import Path
import sys
import unittest
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'tests'))
import test_cn_release_acquire_delegation as fixture
s=importlib.util.spec_from_file_location('plan',ROOT/'scripts/cn-release-approval-plan.py');p=importlib.util.module_from_spec(s);s.loader.exec_module(p)
class ApprovalPlanTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):fixture.DelegationTests.setUpClass()
 @classmethod
 def tearDownClass(cls):fixture.DelegationTests.tearDownClass()
 def setUp(self):
  self.f=fixture.DelegationTests();self.f.setUp();self.addCleanup(self.f.doCleanups)
  a=self.f.release
  self.parameters={k:copy.deepcopy(a[k])for k in ('identity','target','issuedAt','expiresAt')}
  self.parameters.update(acquireRequests=a['acquire']['requests'],runtimeStaticInputHashes={k:'a'*64 for k in ('authorization','template','migrationDiff')},runtimeRoot='/var/lib/workspacex-cn/runtime/upgrade-f0eb-fixture',
   business={**{k:'b'*64 for k in ('runtimeProfileSha256','planSha256','testDataScopeSha256','recoveryPlanSha256','recoveryTestDataScopeSha256')},'stableWindowSeconds':30},
   rds={'sdkManifestSha256':'c'*64,'sdkRoot':str(p.module('rds-backup').SDK_ROOT),'dbInstanceId':p.module('rds-backup').DB,'roleName':p.module('rds-backup').ROLE,'principalArn':'fixture','holdHelperSha256':'d'*64,'permissionEvidence':{'path':'/etc/workspacex-cn/rds-capability.json','sha256':'e'*64}})
  self.probe=self.f.f.root/'probe.json';self.probe.write_text('{"targets":[]}')
 def test_complete_parameters_and_code_closure_fit_and_contract_paths_match(self):
  raw,plan,report=p.generate(self.parameters,self.probe);a=json.loads(raw);plan=json.loads(plan);report=json.loads(report)
  self.assertEqual(report['approvalBytes'],len(raw));self.assertLessEqual(len(raw),65536)
  self.assertGreater(len(a['codeFiles']),35);self.assertFalse(report['approvalGranted']);self.assertFalse(report['targetCapabilitiesVerified'])
  r=p.module('stage-router');path=Path(plan['controlBundle']['targetRoot'])/'scripts/cn-release-stage-contract.py'
  for stage in r.e.STAGES:
   observer,verifier=r.render_contract(path,a['codeFiles']['scripts/cn-release-stage-contract.py'],stage)
   self.assertEqual(a['runtime']['stageVerifierSha256'][stage],r.e.digest(verifier));self.assertEqual(a['runtime']['stageObserverSha256'][stage],r.e.digest(observer))
  self.assertNotIn('sdkFiles',a['rds']);self.assertEqual(a['identity'],self.parameters['identity'])
 def test_mvp_metadata_preserves_canonical_driver_and_acquire_compatibility(self):
  for request in self.parameters['acquireRequests'].values():request['runAttempt']=1
  self.parameters['mvp']={'acceptanceScope':'mvp-non-model','contentManifestSha256':'f'*64,'buildRunId':self.parameters['acquireRequests']['consume']['runId'],'transferRunId':13}
  raw,_,_=p.generate(self.parameters,self.probe);a=json.loads(raw)
  self.assertEqual(a['mvp'],self.parameters['mvp']);d=p.module('fixed-driver')
  self.assertEqual(d.validate(d.e.digest(raw),raw,d.e.instant(a['issuedAt']))['mvp'],a['mvp'])
  p.module('acquire-delegation').approval(raw,now=d.e.instant(a['issuedAt']))
 def test_mvp_cannot_label_an_old_acquire_as_new_build(self):
  self.parameters['mvp']={'acceptanceScope':'mvp-non-model','contentManifestSha256':'f'*64,'buildRunId':self.parameters['acquireRequests']['consume']['runId']+1,'transferRunId':13}
  with self.assertRaisesRegex(Exception,'MVP_ACQUIRE_BUILD_BINDING'):p.generate(self.parameters,self.probe)
 def test_complete_request_limit_cannot_be_hidden_by_small_manifest_reference(self):
  self.parameters['rds']['principalArn']='x'*65536
  with self.assertRaisesRegex(Exception,'COMPLETE_APPROVAL_TOO_LARGE'):p.generate(self.parameters,self.probe)
 def test_inline_sdk_and_missing_static_inputs_rejected(self):
  self.parameters['rds']['sdkFiles']={'file.py':'a'*64}
  with self.assertRaisesRegex(Exception,'SDK_MANIFEST_REFERENCE_REQUIRED'):p.generate(self.parameters,self.probe)
  del self.parameters['rds']['sdkFiles'];del self.parameters['runtimeStaticInputHashes']['authorization']
  with self.assertRaisesRegex(Exception,'STATIC_INPUTS'):p.generate(self.parameters,self.probe)
if __name__=='__main__':unittest.main()
