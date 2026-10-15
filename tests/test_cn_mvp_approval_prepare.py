"""Full canonical approval and byte-real provider ZIP fixtures, no live authority."""
import base64,copy,importlib.util,io,json,tempfile,unittest,zipfile
from pathlib import Path
import test_cn_release_approval_plan as base
import test_cn_mvp_chain as chain
spec=importlib.util.spec_from_file_location('prep',base.ROOT/'scripts/cn-release-mvp-approval-prepare.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class Prepare(unittest.TestCase):
 @classmethod
 def setUpClass(cls):base.ApprovalPlanTests.setUpClass()
 @classmethod
 def tearDownClass(cls):base.ApprovalPlanTests.tearDownClass()
 def setUp(self):
  self.base=base.ApprovalPlanTests();self.base.setUp();self.addCleanup(self.base.doCleanups)
  p=self.base.parameters;i,run,listing=chain.Chain().fixture()
  i.update(sourceRevision=p['identity']['sourceRevision'],controlRevision=p['identity']['controlRevision'])
  run['head_sha']=i['controlRevision']
  for row in listing['artifacts']:row['workflow_run']['head_sha']=i['controlRevision']
  self.payload=dict(identity=i,buildRunId=42,transferRunId=43,requestedAt=p['identity']['requestedAt'],deadlineAt=p['identity']['deadlineAt'])
  p['mvp']=dict(acceptanceScope='mvp-non-model',contentManifestSha256=i['contentManifestSha256'],buildRunId=42,transferRunId=43,
    stageInputs={k:'a'*64 for k in base.p.module('mvp-contract').STAGE_INPUT_FIELDS})
  p['mvp']['stageInputs']['contentRequestSha256']=i['contentManifestSha256']
  for request in p['acquireRequests'].values():request.update(runId=42,runAttempt=1)
  raw,install,report=base.p.generate(p,self.base.probe);approval=json.loads(raw)
  self.blueprint=dict(kind='cn-mvp-approved-blueprint-v1',selector=self.payload,parameters=p,
    probeSha256=m.E.sha(self.base.probe.read_bytes()),controlBundleSha256=json.loads(report)['controlBundleSha256'],githubPolicy={},codeFiles=approval['codeFiles'])
  plan=m.E.encode(dict(sourceRevision=i['sourceRevision'],controlRevision=i['controlRevision']));self.archives={}
  def archive(files):
   stream=io.BytesIO()
   with zipfile.ZipFile(stream,'w')as z:
    for name,body in files.items():z.writestr(name,body)
   return stream.getvalue()
  for index,files in [(0,{'cn-candidate-plan.json':plan}),(1,{'candidate-plan.json':plan,'candidate-set.json':b'{}'})]:
   row=listing['artifacts'][index];data=archive(files);self.archives[row['id']]=data
   row.update(size_in_bytes=len(data),digest='sha256:'+m.E.sha(data))
  bound=m.E.module().bind(i,run,listing)
  policy=m.E.encode(dict(runId=42,runAttempt=1,controlRevision=i['controlRevision'],verifierRevision=i['controlRevision'],candidatePlanRawSha256=m.E.sha(plan),candidateSetRawSha256=m.E.sha(b'{}'),artifactIds={k:v['id']for k,v in bound['artifacts'].items()},producerWorkflowSha256=m.E.sha(b'actualworkflow'),issuedAt=p['issuedAt'],expiresAt=p['expiresAt']))
  template=m.E.encode(dict(runId=42,runAttempt=1))
  upload=m.E.encode(dict(sourceRun=42,sourceRunAttempt=1,producerControl=i['controlRevision'],sourceRevision=i['sourceRevision'],candidatePlanRawSha256=m.E.sha(plan),revalidationTemplateSha256=m.E.sha(template)))
  data=archive({'upload-plan.json':upload,'hk-template.json':template,'proof.json':m.E.encode(dict(sourceRevision=i['sourceRevision'])),'policy.json':policy,'receipt.json':b'{}'})
  self.archives[99]=data;row=dict(id=99,name='cn-hk-originals-43-1',expired=False,size_in_bytes=len(data),digest='sha256:'+m.E.sha(data),workflow_run={'id':43,'head_sha':i['controlRevision']})
  transfer={**run,'id':43,'path':'.github/workflows/transfer-cn-candidates-via-hongkong.yml'}
  self.metadata={f'/repos/boardx/workspacex/contents/.github/workflows/build-cn-image-candidates.yml?ref={i["controlRevision"]}':{'encoding':'base64','content':base64.b64encode(b'actualworkflow').decode()},f'/repos/boardx/workspacex/actions/runs/42':run,f'/repos/boardx/workspacex/actions/runs/42/artifacts?per_page=100':listing,
   f'/repos/boardx/workspacex/actions/runs/43':transfer,f'/repos/boardx/workspacex/actions/runs/43/artifacts?per_page=100':dict(total_count=1,artifacts=[row]),'/repos/boardx/workspacex/actions/artifacts/99':row}
 def provider(self,path,out=None,limit=None):
  if out is not None:
   raw=self.archives[int(path.split('/')[-2])];out.write_bytes(raw);return
  return self.metadata[path]
 def derive(self):return m.derive(m.E.encode(self.blueprint),self.base.probe.read_bytes(),github=self.provider)
 def test_real_zip_originals_derive_full_canonical_approval(self):
  files,report=self.derive();a=json.loads(files['approval.json'])
  self.assertEqual(a['mvp']['buildRunId'],42);self.assertEqual(a['mvp']['transferRunId'],43)
  self.assertIn('scripts/cn-release-mvp-private-input.py',a['codeFiles'])
  self.assertEqual(a['codeFiles'],self.blueprint['codeFiles']);self.assertFalse(report['installed']);self.assertFalse(report['authorityGranted'])
  for request in a['acquire']['requests'].values():
   self.assertEqual(request['inputs']['proof'],m.E.sha(files['proof.json']));self.assertEqual(request['runId'],42)
 def test_changed_zip_or_wrong_source_rejected(self):
  self.archives[99]+=b'changed'
  with self.assertRaises(ValueError):self.derive()
 def test_caller_booleans_and_code_changes_rejected(self):
  self.blueprint['approved']=True
  with self.assertRaisesRegex(ValueError,'BLUEPRINT_SCHEMA'):self.derive()
  del self.blueprint['approved'];self.blueprint['codeFiles']['scripts/cn-release-fixed-driver.py']='0'*64
  with self.assertRaisesRegex(ValueError,'BLUEPRINT_CODE_CLOSURE'):self.derive()
 def policy(self):
  p=copy.deepcopy(self.blueprint['parameters'])
  p['mvp'].update(buildRunId=0,transferRunId=0)
  for request in p['acquireRequests'].values():request['runId']=0
  return dict(kind='cn-mvp-cloud-preparation-policy-v1',action='install-approved-control-data',identity=self.payload['identity'],target=p['target'],
   requestedAt=self.payload['requestedAt'],deadlineAt=self.payload['deadlineAt'],parametersTemplate=p,rootInputPins={n:('c'*64 if n=='mvp-content-request.json' else 'a'*64) for n in ('mvp-profile.json','mvp-schema-request.json','mvp-content-request.json','mvp-content-backup.json','mvp-nonmodel-fixtures.json','mvp-nonmodel-credentials.json','mvp-existing-environment.json','mvp-runtime-manifest.json')},
   **{k:self.blueprint[k]for k in ('probeSha256','controlBundleSha256','githubPolicy','codeFiles')})
 def test_future_ids_come_from_bound_provider_not_preinstalled_blueprint(self):
  policy=self.policy();files,report=m.derive_from_policy(m.E.encode(policy),self.payload,self.base.probe.read_bytes(),github=self.provider)
  a=json.loads(files['approval.json']);self.assertEqual(a['mvp']['buildRunId'],42);self.assertFalse(report['installed'])
  self.assertEqual(policy['parametersTemplate']['mvp']['buildRunId'],0)
 def test_policy_scope_and_future_id_guards(self):
  policy=self.policy();policy['identity']={**policy['identity'],'sourceRevision':'0'*40}
  with self.assertRaisesRegex(ValueError,'POLICY_SELECTOR_BINDING'):m.derive_from_policy(m.E.encode(policy),self.payload,self.base.probe.read_bytes(),github=self.provider)
  policy=self.policy();policy['parametersTemplate']['acquireRequests']['consume']['runId']=42
  with self.assertRaisesRegex(ValueError,'POLICY_ACQUIRE_PLACEHOLDERS'):m.derive_from_policy(m.E.encode(policy),self.payload,self.base.probe.read_bytes(),github=self.provider)
 def test_missing_blueprint_never_prepares_and_positive_writes_exact_bytes(self):
  selector=m.E.sha(m.E.encode(self.payload));raw=m.E.encode(self.blueprint)
  values={m.BLUEPRINTS/(selector+'.json'):raw,m.BLUEPRINTS/'objects'/(self.blueprint['probeSha256']+'.json'):self.base.probe.read_bytes()}
  with tempfile.TemporaryDirectory()as out:
   with self.assertRaises(KeyError):m.prepare(selector,reader=lambda path:{}[path],github=self.provider,outputs=Path(out))
   self.assertEqual(list(Path(out).iterdir()),[])
   report=m.prepare(selector,reader=lambda path:values[path],github=self.provider,outputs=Path(out))
   folder=Path(out)/selector
   self.assertEqual(m.E.sha((folder/'approval.json').read_bytes()),report['approvalSha256'])
   self.assertFalse(report['installed']);self.assertEqual((folder/'approval.json').stat().st_mode&0o777,0o600)
 def test_exclusive_intent_prevents_retry_after_failed_provider(self):
  selector=m.E.sha(m.E.encode(self.payload));raw=m.E.encode(self.blueprint)
  values={m.BLUEPRINTS/(selector+'.json'):raw,m.BLUEPRINTS/'objects'/(self.blueprint['probeSha256']+'.json'):self.base.probe.read_bytes()}
  with tempfile.TemporaryDirectory()as out:
   def fail(*args):raise ValueError('provider unavailable')
   with self.assertRaisesRegex(ValueError,'provider unavailable'):m.prepare(selector,reader=lambda path:values[path],github=fail,outputs=Path(out))
   self.assertTrue((Path(out)/selector/'intent.json').is_file())
   with self.assertRaises(FileExistsError):m.prepare(selector,reader=lambda path:values[path],github=self.provider,outputs=Path(out))
if __name__=='__main__':unittest.main()
