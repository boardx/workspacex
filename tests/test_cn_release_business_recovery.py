"""Original recovery binding and real private files; synthetic daemon readbacks."""
import datetime as dt
import importlib.util
import sys
from pathlib import Path
import unittest
sys.path.insert(0,str(Path(__file__).parent))
from test_cn_release_business_state import LiveState,m,REPO
spec=importlib.util.spec_from_file_location('recovery',REPO/'scripts/cn-release-business-recovery.py');r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)
class Baseline(LiveState):
 def setUp(self):
  super().setUp()
  script=b'approved recovery runtime fixture';self.put(self.root/'upgrade-draft.py',script)
  b=self.binding;b.update(r.TARGET);b['scriptSha256']=m.sha(script);b['rollbackImages']={s:'repo/'+s+'@sha256:'+'a'*64 for s in r.SERVICES};b['expectedContainers']={'/workspacex-cn-'+s+'-1':{'id':'old-'+s,'image':b['rollbackImages'][s]}for s in r.SERVICES}
  self.binding_raw=m.enc(b);self.put(self.root/'binding.json',self.binding_raw)
  rec={'priorInvocationTerminal':True,'activeCloudCommands':[],'hold':self.hold,'attemptId':'fixture','observedAt':(self.now-dt.timedelta(seconds=3)).isoformat()};recr=m.enc(rec);self.put(self.root/'recovery-reconciliation.json',recr)
  self.f={'kind':'cn-release-fresh-recovery-delegation-v1','releaseSha256':self.release,'identity':self.identity,'target':r.TARGET,'operation':'rollback','issuedAt':(self.now-dt.timedelta(seconds=2)).isoformat(),'expiresAt':(self.now+dt.timedelta(minutes=10)).isoformat(),'runtimeRoot':str(self.root),'originalBindingSha256':m.sha(self.binding_raw),'upgradeSha256':m.sha(script),'inputHashes':{'binding':m.sha(self.binding_raw),'reconciliation':m.sha(recr)}}
  self.install_recovery(recr)
  self.xs=[]
  for service in r.SERVICES:self.xs.append({'Name':'/workspacex-cn-'+service+'-1','Id':'new-'+service,'Config':{'Image':b['rollbackImages'][service],'Labels':{'com.docker.compose.service':service,'com.docker.compose.project':'workspacex-cn','com.docker.compose.project.working_dir':'/fixture','com.docker.compose.project.config_files':b['composeFiles'][0]['path']+','+str(self.root/'rollback-images.json')}},'State':{'Running':True,'Restarting':False,'Status':'running','Health':{'Status':'healthy'}},'RestartCount':0})
  self.put(self.root/'rollback-images.json',m.enc({'services':{k:{'image':v}for k,v in b['rollbackImages'].items()}}))
 def install_recovery(self,recr):
  self.fraw=m.enc(self.f);b=self.binding
  recovery={'kind':'f0eb-fresh-recovery-v1','authorizationEvidenceSha256':m.sha(self.fraw),'originalBindingSha256':m.sha(self.binding_raw),'operation':self.f['operation'],'issuedAt':self.f['issuedAt'],'expiresAt':self.f['expiresAt'],'reconciliationSha256':m.sha(recr),**{k:b[k]for k in ('attemptId','sourceRevision','baselineRevision','hold')}}
  self.put(self.root/'recovery-binding.json',m.enc(recovery));op=self.f['operation'];self.put(self.root/(op+'-intent.json'),m.enc({'bindingSha256':m.sha(self.binding_raw),'holdGeneration':'e'*32}));self.put(self.root/(op+'-result.json'),m.enc({'oldExactFiveRunning'if op=='abort-original'else'exactFiveRunning':True,'holdRetained':True,'businessAcceptancePassed':False}))
 def call(self,argv):
  if 'image'in argv:return m.enc([{'Os':'linux','Architecture':'amd64','RepoDigests':[argv[-1]]}])
  if 'inspect'in argv:return m.enc(self.xs)
  return m.enc(self.hold)
 def run_baseline(self,**kw):return r.health(self.a,self.release,self.fraw,self.prepared,m,reader=self.reader,call=self.call,now=self.now,**kw)
 def test_baseline_actual_files_old_five_digest_and_no_data_restore_claim(self):
  v=self.run_baseline();self.assertEqual(v['runtimeRevision'],self.identity['baselineRevision']);self.assertFalse(v['dataRestored']);self.assertFalse(v['businessAcceptancePassed']);self.assertEqual(len(v['containers']),5)
 def test_baseline_candidate_image_or_wrong_config_rejected(self):
  self.xs[0]['Config']['Image']='candidate'
  with self.assertRaisesRegex(ValueError,'BASELINE_IMAGE'):self.run_baseline()
 def test_baseline_fresh_window_separate_from_expired_release(self):
  self.now+=dt.timedelta(minutes=6);self.assertTrue(self.run_baseline()['runtimeHealthy'])
  self.now+=dt.timedelta(minutes=6)
  with self.assertRaisesRegex(ValueError,'RECOVERY_FRESH_WINDOW'):self.run_baseline()
  self.assertTrue(self.run_baseline(read_only=True)['runtimeHealthy'])
 def test_baseline_wrong_generation_rejected(self):
  self.hold={**self.hold,'generation':'0'*32}
  with self.assertRaisesRegex(ValueError,'RECOVERY_HOLD'):self.run_baseline()
 def test_baseline_abort_requires_exact_original_ids_and_no_switch(self):
  self.f['operation']='abort-original';self.install_recovery((self.root/'recovery-reconciliation.json').read_bytes());(self.root/'switch-intent.json').unlink()
  for x in self.xs:x['Config']['Labels']['com.docker.compose.project.config_files']=self.binding['composeFiles'][0]['path']
  with self.assertRaisesRegex(ValueError,'ORIGINAL_CONTAINER_ID'):self.run_baseline()
  for x in self.xs:x['Id']=self.binding['expectedContainers'][x['Name']]['id']
  self.assertTrue(self.run_baseline()['runtimeHealthy'])
 def public_fixture(self):
  health=self.run_baseline();self.held_raw=m.enc(health);self.held_hold_raw=m.enc(self.hold);self.scope_raw=m.enc({'fixture':'baseline scope'});self.user_raw=m.enc({'fixture':'explicit recovery writer approval'});self.a['business']={'recoveryTestDataScopeSha256':m.sha(self.scope_raw)};self.prepared['recoveryPlan']={'deploymentMarker':'baseline'}
  a={'kind':'cn-recovery-writer-resume-approval-v1','scope':'resume-baseline-writers-and-scoped-business-observation','releaseSha256':self.release,'identity':self.identity,'target':r.TARGET,'issuedAt':self.f['issuedAt'],'expiresAt':self.f['expiresAt'],'bindingSha256':health['bindingSha256'],'runtimeRecoveryReceiptSha256':health['runtimeRecoveryReceiptSha256'],'heldHealthSha256':m.sha(m.enc(health)),'holdRawSha256':m.sha(m.enc(self.hold)),'holdGeneration':self.hold['generation'],'userAuthorizationEvidenceSha256':m.sha(self.user_raw),'testDataScopeSha256':m.sha(self.scope_raw),'publicOrigin':'https://app.boardx.com.cn/','recoveryApprovalSha256':m.sha(self.fraw)}
  self.writer=a;self.hold={**self.hold,'state':'cleared'};self.install_public()
 def install_public(self):
  raw=m.enc(self.writer);base=m.ETC/'recovery-writer-resume-approvals';self.put(base/(m.sha(raw)+'.json'),raw);self.put(base/'by-recovery'/(m.sha(self.fraw)+'.json'),m.enc({'approvalSha256':m.sha(raw)}))
  clear={'kind':'cn-recovery-hold-cleared-v1','approvalSha256':m.sha(raw),'recoveryApprovalSha256':m.sha(self.fraw),'hold':self.hold,'businessAcceptancePassed':False,'dataRestored':False,**{k:self.writer[k]for k in ('releaseSha256','identity','bindingSha256','runtimeRecoveryReceiptSha256','heldHealthSha256','holdRawSha256','testDataScopeSha256')}}
  self.clear_path=m.VAR/'release-generated'/self.release/'terminal'/'recovery-writer-resume'/'recovery-clear-result.json';helper_raw=m.enc(self.hold);clear['helperResultSha256']=m.sha(helper_raw);self.put(self.clear_path.parent/'recovery-clear-helper.json',helper_raw);self.put(self.clear_path,m.enc(clear))
  links={k:clear[k]for k in ('releaseSha256','identity','bindingSha256','runtimeRecoveryReceiptSha256','heldHealthSha256','holdRawSha256','testDataScopeSha256','approvalSha256','recoveryApprovalSha256')};self.put(self.clear_path.parent/'recovery-clear-intent.json',m.enc({'kind':'cn-recovery-hold-clear-intent-v1',**links}))
  for name,raw in [('held-health.json',self.held_raw),('held-hold.json',self.held_hold_raw),('user-authorization.json',self.user_raw),('test-data-scope.json',self.scope_raw)]:self.put(self.clear_path.parent/name,raw)
 def read_public(self,**kw):return r.public(self.a,self.release,self.fraw,self.prepared,m,reader=self.reader,call=self.call,now=self.now,**kw)
 def test_actual_baseline_clear_links_separate_writer_scope(self):
  self.public_fixture();live,envelope=self.read_public();self.assertEqual(live['runtimeRevision'],self.identity['baselineRevision']);self.assertEqual(live['writerResumeApprovalSha256'],m.sha(envelope['raw'].encode()));self.assertFalse(live['boundary']['writesHeld'])
 def test_baseline_clear_cannot_be_normal_candidate_or_wrong_scope(self):
  self.public_fixture();self.writer['testDataScopeSha256']='0'*64;self.install_public()
  with self.assertRaisesRegex(ValueError,'RECOVERY_TEST_SCOPE'):self.read_public()
 def test_baseline_clear_missing_or_changed_actual_receipt_rejects(self):
  self.public_fixture();v=m.parse(self.clear_path.read_bytes());v['hold']['generation']='0'*32;self.put(self.clear_path,m.enc(v))
  with self.assertRaisesRegex(ValueError,'RECOVERY_ACTUAL_CLEAR'):self.read_public()
 def test_baseline_readback_after_fresh_window_does_not_reauthorize_action(self):
  self.public_fixture();self.now+=dt.timedelta(minutes=11)
  with self.assertRaisesRegex(ValueError,'RECOVERY_WRITER_WINDOW'):self.read_public()
  self.assertEqual(self.read_public(read_only=True)[0]['runtimeRevision'],self.identity['baselineRevision'])
 def test_baseline_replaced_after_clear_cannot_inherit_previous_health(self):
  self.public_fixture();self.xs[0]['Id']='replacement-same-image'
  with self.assertRaisesRegex(ValueError,'RECOVERY_CLEAR_BASELINE_DRIFT'):self.read_public()
 def test_missing_clear_intent_is_not_success(self):
  self.public_fixture();(self.clear_path.parent/'recovery-clear-intent.json').unlink()
  with self.assertRaises(FileNotFoundError):self.read_public()
# Only run the new recovery scenarios, not inherited normal-public fixtures.
for name in list(vars(LiveState)):
 if name.startswith('test_'):setattr(Baseline,name,None)
del LiveState
if __name__=='__main__':unittest.main()
