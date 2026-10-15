"""Exact new producer binding; no cloud writes or credential operations."""
import base64,copy,datetime,hashlib,importlib.util,json,tempfile,unittest,zipfile
from pathlib import Path
from unittest.mock import patch
import test_cn_hk_original_artifact_upload as old
u=old.u;ROOT=old.REPO
spec=importlib.util.spec_from_file_location('hk_proof',ROOT/'scripts/cn-hk-generate-proof.py');g=importlib.util.module_from_spec(spec);spec.loader.exec_module(g)
class Rebound(unittest.TestCase):
 def fixture(self):
  plan=old.Tests().plan();plan.update(kind='hk-original-artifact-transfer-v2',sourceRun=38386036159,producerControl='9bb9c401497877c09f7a432a87bc6291de83bbe5',sourceRevision=u.SOURCE,prefix='runs/38386036159/1/',producerWorkflowSha256=u.sha(b'exact-reviewed-workflow'),candidatePlanRawSha256='a'*64,revalidationTemplateSha256='b'*64)
  return plan
 def source_fixture(self,folder,source=None,control=None):
  p=self.fixture();raw=(json.dumps(dict(sourceRevision=u.SOURCE if source is None else source,controlRevision=p['producerControl'] if control is None else control),sort_keys=True)+'\n').encode();zip_path=folder/'source.zip'
  with zipfile.ZipFile(zip_path,'w')as z:z.writestr('cn-candidate-plan.json',raw)
  data=zip_path.read_bytes();p['artifacts']['plan']=dict(id=900,bytes=len(data),sha256=u.sha(data));p['candidatePlanRawSha256']=u.sha(raw)
  run=dict(id=p['sourceRun'],head_sha=p['producerControl'],status='completed',conclusion='success',run_attempt=1,event='workflow_dispatch',head_branch='main',path=u.WORKFLOW,repository=dict(id=1000328649,full_name=u.REPO),head_repository=dict(id=1000328649))
  meta=dict(id=900,name='cn-candidate-plan-38386036159-1',expired=False,size_in_bytes=len(data),digest='sha256:'+u.sha(data),workflow_run=dict(id=p['sourceRun'],head_sha=p['producerControl'],repository_id=1000328649,head_repository_id=1000328649))
  content=dict(encoding='base64',content=base64.b64encode(b'exact-reviewed-workflow').decode())
  def gh(path,output=None,limit=None):
   if output is not None:self.assertEqual(limit,len(data));output.write_bytes(data);return
   return copy.deepcopy(content if '/contents/'in path else meta if '/artifacts/'in path else run)
  return p,run,meta,content,gh
 def test_new_run_plan_uses_exact_prefix_legacy_stays_fixed(self):
  p=self.fixture();u.validate_plan(p)
  for k,value in [('prefix','runs/38146134231/1/'),('sourceRevision','0'*40),('sourceRun',True),('producerControl','main'),('revalidationTemplateSha256','not-a-pin')]:
   with self.subTest(k=k),self.assertRaises(ValueError):u.validate_plan({**p,k:value})
  original=old.Tests().plan();original['sourceRun']=p['sourceRun']
  with self.assertRaises(ValueError):u.validate_plan(original)
 def test_actual_source_admission_reads_success_recipe_plan_and_rechecks(self):
  with tempfile.TemporaryDirectory()as td:
   p,run,meta,content,gh=self.source_fixture(Path(td))
   with patch.object(u,'gh',side_effect=gh):self.assertEqual(u.validate_source_run(p),run)
   for obj,key,value in [(run,'status','in_progress'),(run,'conclusion','failure'),(run,'run_attempt',2),(run,'event','pull_request'),(run,'head_branch','other'),(run,'head_sha','0'*40),(run,'path','.github/workflows/other.yml'),(meta,'expired',True),(meta,'digest','sha256:'+'0'*64),(content,'content',base64.b64encode(b'other-workflow').decode())]:
    with self.subTest(key=key,value=value):
     saved=obj[key];obj[key]=value
     try:
      with patch.object(u,'gh',side_effect=gh),self.assertRaises(ValueError):u.validate_source_run(p)
     finally:obj[key]=saved
   for source,control in [('0'*40,None),(None,'0'*40)]:
    with tempfile.TemporaryDirectory()as other:
     changed,_,_,_,read=self.source_fixture(Path(other),source,control)
     with patch.object(u,'gh',side_effect=read),self.assertRaises(ValueError):u.validate_source_run(changed)
   run['repository']['id']=1
   with patch.object(u,'gh',side_effect=gh),self.assertRaises(ValueError):u.validate_source_run(p)
 def test_before_after_drift_and_source_plan_hash_reject(self):
  with tempfile.TemporaryDirectory()as td:
   p,run,meta,content,gh=self.source_fixture(Path(td));p['candidatePlanRawSha256']='0'*64
   with patch.object(u,'gh',side_effect=gh),self.assertRaises(ValueError):u.validate_source_run(p)
   p,run,meta,content,gh=self.source_fixture(Path(td));calls=0
   def drift(path,*args):
    nonlocal calls
    result=gh(path,*args)
    if '/runs/'in path:
     calls+=1
     if calls>1:result['head_sha']='0'*40
    return result
   with patch.object(u,'gh',side_effect=drift),self.assertRaises(ValueError):u.validate_source_run(p)
 def test_proof_template_run_control_ids_hashes_and_expiry_are_bound(self):
  p=self.fixture();template=dict(controlRevision=p['producerControl'],verifierRevision=p['producerControl'],repositoryId=1000328649,runId=p['sourceRun'],runAttempt=1,artifactIds={k:v['id']for k,v in p['artifacts'].items()},producerWorkflowSha256=p['producerWorkflowSha256'],candidatePlanRawSha256=p['candidatePlanRawSha256'])
  raw=json.dumps(template).encode();p['revalidationTemplateSha256']=u.sha(raw)
  self.assertEqual(g.validate_binding(p,template,raw)[0],p['producerControl'])
  for key,value in [('runId',38146134231),('verifierRevision','0'*40),('runAttempt',2),('candidatePlanRawSha256','0'*64),('producerWorkflowSha256','0'*64)]:
   with self.subTest(key=key),self.assertRaises(AssertionError):g.validate_binding(p,{**template,key:value},raw)
  with self.assertRaises(AssertionError):g.validate_binding(p,template,b'drift')
  expired={**p,'expiresAt':(datetime.datetime.now(datetime.timezone.utc)-datetime.timedelta(seconds=1)).isoformat()}
  with self.assertRaises(AssertionError):g.validate_binding(expired,template,raw)
 def test_workflow_admits_source_before_oidc_and_does_not_expand_permissions(self):
  text=(ROOT/'.github/workflows/transfer-cn-candidates-via-hongkong.yml').read_text()
  self.assertLess(text.index('m.validate_source_run(plan)'),text.index('Verify actual OIDC claims'))
  self.assertIn('ref: ${{ steps.plan.outputs.control }}',text)
  self.assertIn('group: hk-original-artifacts-${{ inputs.plan_sha256 }}',text)
  self.assertIn('workspacexgithubhongkongtransferrole',text)
if __name__=='__main__':unittest.main()
