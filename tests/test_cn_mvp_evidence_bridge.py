import hashlib,importlib.util,json,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
def module(name,file):
 s=importlib.util.spec_from_file_location(name,Path(__file__).parents[1]/'scripts'/file);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
E=module('portal','cn-release-mvp-evidence.py');M=module('master_evidence','cn-release-mvp-master.py')
P=module('materializer','cn-release-mvp-evidence-materializer.py')
C=module('bridge_client_tests','cn-release-mvp-bridge-client.py')
class Evidence(unittest.TestCase):
 def fixture(self,mode='approval'):
  identity={'sourceRevision':'a'*40,'controlRevision':'b'*40,'releaseId':'test-release','contentManifestSha256':'c'*64}
  payload={'identity':identity,'buildRunId':12,'transferRunId':13,'requestedAt':'2026-10-14T02:00:00Z','deadlineAt':'2026-10-14T02:30:00Z'}
  pin=E.sha(E.encode(payload));root=Path('/fixed-root');data={};refs={}
  def retain(key,value):
   raw=E.encode(value);name=key+'.json';data[root/'objects'/name]=raw;refs[key]={'name':name,'sha256':E.sha(raw)};return raw
  approval={'kind':'cn-fixed-release-approval-v1','target':{'accountId':'1177216024653153','region':'cn-shanghai','ecsInstanceId':'i-uf6ga92ewloganobbln6'},'mvp':{'acceptanceScope':'mvp-non-model','contentManifestSha256':'c'*64,'buildRunId':12,'transferRunId':13},'identity':{'sourceRevision':'a'*40,'controlRevision':'b'*40,'requestedAt':payload['requestedAt'],'deadlineAt':payload['deadlineAt']}}
  approval['acquire']={'requests':{phase:{'runId':12,'runAttempt':1}for phase in ('consume','publication')}}
  raw=retain('approval',approval);data[Path('/etc/workspacex-cn/release-approvals')/(E.sha(raw)+'.json')]=raw
  retain('binding',payload)
  data[root/(pin+'.json')]=E.encode({'kind':'cn-mvp-root-evidence-record-v1','selector':payload,'files':refs})
  return payload,pin,root,data,refs
 def test_returns_only_actually_installed_matching_approval(self):
  payload,pin,root,data,_=self.fixture();r=E.resolve('approval',payload,pin,data.__getitem__,root,structural_only=True)
  self.assertFalse(r['authorityGrantedByPortal']);self.assertEqual(r['buildRunId'],12)
 def test_live_portal_rejects_noncanonical_approval(self):
  payload,pin,root,data,_=self.fixture()
  with self.assertRaises(ValueError):E.resolve('approval',payload,pin,data.__getitem__,root)
 def test_changed_original_bytes_rejected(self):
  payload,pin,root,data,_=self.fixture();data[root/'objects'/'approval.json']+=b' '
  with self.assertRaisesRegex(ValueError,'EVIDENCE_BYTES_CHANGED'):E.resolve('approval',payload,pin,data.__getitem__,root,structural_only=True)
 def test_approval_not_in_installed_store_rejected(self):
  payload,pin,root,data,_=self.fixture()
  for k in list(data):
   if str(k).startswith('/etc/'):data[k]=b'{}'
  with self.assertRaisesRegex(ValueError,'APPROVAL_NOT_INSTALLED'):E.resolve('approval',payload,pin,data.__getitem__,root,structural_only=True)
 def test_selector_run_identity_drift_rejected(self):
  payload,pin,root,data,_=self.fixture();payload['transferRunId']=99
  with self.assertRaisesRegex(ValueError,'SELECTOR_HASH'):E.resolve('approval',payload,pin,data.__getitem__,root,structural_only=True)
 def test_root_reference_traversal_rejected(self):
  payload,pin,root,data,refs=self.fixture();refs['approval']['name']='../secret'
  data[root/(pin+'.json')]=E.encode({'kind':'cn-mvp-root-evidence-record-v1','selector':payload,'files':refs})
  with self.assertRaisesRegex(ValueError,'EVIDENCE_PATH'):E.resolve('approval',payload,pin,data.__getitem__,root,structural_only=True)
 def test_missing_materializer_blocks_before_build(self):
  flags={k:True for k in ['fixedReleaseInstalled','advanceInstalled','controlInstalled','approvalStoreInstalled','sudoFixedEntryAllowed','evidencePortalInstalled']}
  with self.assertRaisesRegex(ValueError,'ROOT_BRIDGE_NOT_READY'):M.bridge_admission(flags)
 def originals(self):
  payload,_,root,data,refs=self.fixture()
  originals={k:data[root/'objects'/v['name']]for k,v in refs.items()}
  return payload,originals
 def test_offline_materializer_preserves_bytes_and_grants_no_authority(self):
  payload,originals=self.originals();files,report=P.prepare('approval',payload,originals,originals['approval'])
  self.assertFalse(report['authorityGranted']);self.assertFalse(report['installed']);self.assertFalse(report['productionAccepted'])
  self.assertIn(originals['approval'],files.values())
  with tempfile.TemporaryDirectory()as folder:
   dest=Path(folder)/'proposal';P.write_proposal(dest,files,report)
   self.assertEqual((dest/'proposal.json').stat().st_mode&0o777,0o600)
   with self.assertRaises(FileExistsError):P.write_proposal(dest,files,report)
 def test_materializer_requires_matching_installed_original(self):
  payload,originals=self.originals()
  with self.assertRaisesRegex(ValueError,'ORIGINAL_INSTALLED_APPROVAL_REQUIRED'):P.prepare('approval',payload,originals,b'{}')
 def test_materializer_rejects_extra_originals(self):
  payload,originals=self.originals();originals['secret']=b'{}'
  with self.assertRaisesRegex(ValueError,'ORIGINAL_CLOSURE'):P.prepare('approval',payload,originals,originals['approval'])
 def test_materializer_rejects_content_binding_drift(self):
  payload,originals=self.originals();a=json.loads(originals['approval']);a['mvp']['contentManifestSha256']='d'*64;originals['approval']=E.encode(a)
  with self.assertRaisesRegex(ValueError,'APPROVAL_CONTENT_AND_RUNS'):P.prepare('approval',payload,originals,originals['approval'])
 def terminal_originals(self):
  payload,originals=self.originals();payload['productionRunId']=14;rows=[];originals={'binding':E.encode(payload)};previous=None
  for stage in E.module().STAGES:
   raw=E.encode({'stage':stage,'observed':True});originals['evidence-'+stage]=raw
   row={'stage':stage,'identity':payload['identity'],'status':'SUCCEEDED','previousReceiptSha256':previous,'evidenceSha256':E.sha(raw)}
   if stage=='acceptance':row.update(checks={k:'PASSED'for k in E.module().CHECKS},modelQuality='SKIPPED',futureV2Content='NOT_APPLICABLE')
   previous=E.sha(E.encode(row));rows.append(row)
  originals['receipts']=E.encode(rows);return payload,originals
 def test_untyped_terminal_evidence_cannot_be_packaged_as_verified(self):
  payload,originals=self.terminal_originals()
  with self.assertRaises((ValueError,KeyError)):P.prepare('terminal',payload,originals)
 def test_actual_bridge_zip_and_digest_rechecked(self):
  import io,zipfile
  stream=io.BytesIO()
  with zipfile.ZipFile(stream,'w')as z:z.writestr('result.json',E.encode({'ok':True}))
  raw=stream.getvalue();row={'id':1,'name':'cn-mvp-approval-15-1','expired':False,'size_in_bytes':len(raw),'workflow_run':{'id':15},'digest':'sha256:'+E.sha(raw)}
  def reader(url,path=None,limit=None):
   if path is None:return {'total_count':1,'artifacts':[row]}
   path.write_bytes(raw)
  self.assertEqual(C.raw_result(15,'approval',reader),{'ok':True})
  row['digest']='sha256:'+'0'*64
  with self.assertRaisesRegex(ValueError,'BRIDGE_ZIP_CHANGED'):C.raw_result(15,'approval',reader)
 def test_cold_master_calls_actual_bridge_interfaces_in_order(self):
  payload,_,_,_,_=self.fixture();identity=payload['identity'];calls=[]
  request={'stage':'build','controlRevision':'b'*40,'releaseId':'test-release','requestedAt':payload['requestedAt'],'deadlineAt':payload['deadlineAt'],'inputs':{'candidate_plan':json.dumps({'sourceRevision':'a'*40,'controlRevision':'b'*40})}}
  bundle={'identity':identity,'rootBridgeStatus':{k:True for k in ['fixedReleaseInstalled','advanceInstalled','controlInstalled','approvalStoreInstalled','sudoFixedEntryAllowed','evidencePortalInstalled','trustedEvidenceMaterializerInstalled']},'buildRequest':request,'reviewedTransferPolicy':{}}
  def dispatch(req,path):calls.append(req['stage']);return {'runId':{'build':12,'transfer':13,'production':14}[req['stage']]}
  def evidence(stage,selector,base,root):
   calls.append(stage);self.assertEqual(selector['buildRunId'],12);self.assertEqual(selector['transferRunId'],13)
   if stage=='approval':return {'releaseSha256':'d'*64}
   self.assertEqual(selector['productionRunId'],14);return {'terminal':{'status':'SUCCEEDED_MVP','fullBusinessAcceptance':False}}
  with tempfile.TemporaryDirectory() as folder,patch.object(M.D,'coordinate',side_effect=dispatch),patch.object(M.T,'derive',return_value={'transferRaw':'{}','templateRaw':'{}'}),patch.object(M.E,'obtain',side_effect=evidence):
   r=M.cold_prepare(bundle,'b'*40,Path(folder));self.assertEqual(r['status'],'SUCCEEDED_MVP')
  self.assertEqual(calls,['build','transfer','approval','production','terminal'])
 def test_cold_scoped_policy_prepares_and_finalizes_through_separate_entry(self):
  payload,_,_,_,_=self.fixture();calls=[]
  request={'stage':'build','controlRevision':'b'*40,'releaseId':'test-release','requestedAt':payload['requestedAt'],'deadlineAt':payload['deadlineAt'],'inputs':{'candidate_plan':json.dumps({'sourceRevision':'a'*40,'controlRevision':'b'*40})}}
  flags={k:True for k in ['fixedReleaseInstalled','advanceInstalled','controlInstalled','approvalStoreInstalled','sudoFixedEntryAllowed','evidencePortalInstalled','trustedEvidenceMaterializerInstalled','approvedCloudPreparationEntryInstalled','approvedCloudPreparationPolicyInstalled']}
  bundle={'identity':payload['identity'],'rootBridgeStatus':flags,'buildRequest':request,'reviewedTransferPolicy':{},'approvedPreparationPolicySha256':'e'*64}
  def dispatch(req,path):
   calls.append(req['stage'])
   if req['stage']in ('prepare','finalize'):
    self.assertEqual(req['inputs']['policy_sha256'],'e'*64)
    self.assertEqual(req['inputs']['operation'],'prepare'if req['stage']=='prepare'else'terminal')
   return {'runId':{'build':12,'transfer':13,'prepare':15,'production':14,'finalize':16}[req['stage']]}
  def evidence(stage,*args):
   calls.append(stage)
   return {'releaseSha256':'d'*64}if stage=='approval'else {'terminal':{'status':'SUCCEEDED_MVP','fullBusinessAcceptance':False}}
  with tempfile.TemporaryDirectory()as folder,patch.object(M.D,'coordinate',side_effect=dispatch),patch.object(M.T,'derive',return_value={'transferRaw':'{}','templateRaw':'{}'}),patch.object(M.E,'obtain',side_effect=evidence):
   self.assertEqual(M.cold_prepare(bundle,'b'*40,Path(folder))['status'],'SUCCEEDED_MVP')
  self.assertEqual(calls,['build','transfer','prepare','approval','production','finalize','terminal'])
 def test_policy_without_new_explicit_entry_blocks_before_build(self):
  payload,_,_,_,_=self.fixture()
  flags={k:True for k in ['fixedReleaseInstalled','advanceInstalled','controlInstalled','approvalStoreInstalled','sudoFixedEntryAllowed','evidencePortalInstalled','trustedEvidenceMaterializerInstalled']}
  with tempfile.TemporaryDirectory()as folder,patch.object(M.D,'coordinate')as dispatch:
   with self.assertRaisesRegex(ValueError,'EXPLICIT_ROOT_PREPARATION_NOT_READY'):
    M.cold_prepare({'identity':payload['identity'],'rootBridgeStatus':flags,'approvedPreparationPolicySha256':'e'*64},'b'*40,Path(folder))
  dispatch.assert_not_called()
if __name__=='__main__':unittest.main()
