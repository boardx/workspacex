import copy, hashlib, importlib.util, json, tempfile, unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('chain',Path(__file__).parents[1]/'scripts/cn-release-mvp-chain.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class Chain(unittest.TestCase):
 def fixture(self):
  identity=dict(sourceRevision='a'*40,controlRevision='b'*40,releaseId='mvp-1',contentManifestSha256='c'*64)
  run=dict(id=42,repository={'full_name':'boardx/workspacex'},path='.github/workflows/build-cn-image-candidates.yml',event='workflow_dispatch',head_branch='main',head_sha='b'*40,run_attempt=1,status='completed',conclusion='success')
  names=['cn-candidate-plan','cn-image-candidate-set']+['cn-image-candidate-'+s for s in m.SERVICES]
  rows=[dict(id=i+1,name=n+'-42-1',expired=False,size_in_bytes=10,digest='sha256:'+'d'*64,workflow_run={'id':42,'head_sha':'b'*40})for i,n in enumerate(names)]
  return identity,run,dict(total_count=7,artifacts=rows)
 def test_binding(self):
  i,r,a=self.fixture();self.assertEqual(m.bind(i,r,a)['sourceRun'],42)
 def test_runtime_transfer_derivation_preserves_destination(self):
  i,r,a=self.fixture();bound=m.bind(i,r,a)
  raw=json.dumps(dict(sourceRevision=i['sourceRevision'],controlRevision=i['controlRevision'])).encode()
  template=dict(runId=42,runAttempt=1,controlRevision=i['controlRevision'],verifierRevision=i['controlRevision'],artifactIds={k:v['id']for k,v in bound['artifacts'].items()},candidatePlanRawSha256=hashlib.sha256(raw).hexdigest(),producerWorkflowSha256='f'*64)
  policy=dict(bucket='fixed-reviewed-bucket',uploaderRoleArn='fixed-reviewed-role',expiresAt='fixed-reviewed-expiry')
  with tempfile.TemporaryDirectory()as folder:
   for name in ('cn-hk-original-artifact-upload.py','cn-hk-generate-proof.py','bounded_workers.py'):(Path(folder)/name).write_bytes(b'reviewed')
   derived=m.transfer_plan(bound,policy,raw,json.dumps(template).encode(),folder)
   self.assertEqual(derived['bucket'],policy['bucket']);self.assertEqual(derived['sourceRevision'],i['sourceRevision']);self.assertEqual(derived['sourceRunAttempt'],1)
   for field,value in [('runId',43),('candidatePlanRawSha256','0'*64),('verifierRevision','0'*40)]:
    changed={**template,field:value}
    with self.subTest(field=field),self.assertRaises(ValueError):m.transfer_plan(bound,policy,raw,json.dumps(changed).encode(),folder)
 def test_build_admission_rejects(self):
  for k,v in [('run_attempt',2),('head_sha','d'*40),('conclusion','failure'),('event','push'),('path','other')]:
   i,r,a=self.fixture();r[k]=v
   with self.subTest(k=k),self.assertRaises(ValueError):m.bind(i,r,a)
 def test_artifact_rejects(self):
  for key,value in [('expired',True),('digest',None),('id',True),('size_in_bytes',0)]:
   i,r,a=self.fixture();a['artifacts'][0][key]=value
   with self.subTest(key=key),self.assertRaises(ValueError):m.bind(i,r,a)
 def receipts(self):
  i,_,_=self.fixture();out=[];previous=None
  for stage in m.STAGES:
   row=dict(stage=stage,identity=i,status='SUCCEEDED',previousReceiptSha256=previous,evidenceSha256='e'*64)
   if stage=='acceptance':row.update(checks={k:'PASSED'for k in m.CHECKS},modelQuality='SKIPPED',futureV2Content='NOT_APPLICABLE')
   out.append(row);previous=hashlib.sha256(json.dumps(row,sort_keys=True,separators=(',',':')).encode()).hexdigest()
  return i,out
 def test_terminal_scope(self):
  i,r=self.receipts();self.assertFalse(m.terminal(i,r)['fullBusinessAcceptance'])
 def test_missing_content_acceptance(self):
  i,r=self.receipts();r[-1]['checks'].pop('content_readback')
  with self.assertRaises(ValueError):m.terminal(i,r)
 def test_weak_previous_green_not_sufficient(self):
  i,r=self.receipts();r[-1]['checks']={'login':'PASSED'}
  with self.assertRaises(ValueError):m.terminal(i,r)
 def test_drift_rejected(self):
  i,r=self.receipts();r[1]['previousReceiptSha256']='0'*64
  with self.assertRaises(ValueError):m.terminal(i,r)
if __name__=='__main__':unittest.main()
