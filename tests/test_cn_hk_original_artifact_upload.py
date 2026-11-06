import importlib.util,json,os,unittest,tempfile,datetime,hashlib,zipfile
from pathlib import Path
P=Path(__file__).resolve().parent
LOCAL=(P/'uploader.py').is_file()
REPO=P.parent
UPLOADER=P/'uploader.py' if LOCAL else REPO/'scripts/cn-hk-original-artifact-upload.py'
PLAN=P/'transfer-plan.UNBOUND.json' if LOCAL else REPO/'.github/release-plans/hk-original-artifacts.json'
LOCK=P/'sdk-requirements-pypi.lock' if LOCAL else REPO/'.github/release-plans/hk-sdk-requirements-pypi.lock'
IAM=P if LOCAL else REPO/'docs/operations/hk-release-transfer'
spec=importlib.util.spec_from_file_location('uploader',UPLOADER);u=importlib.util.module_from_spec(spec);spec.loader.exec_module(u)
def legacy_plan_fixture():
 # Legacy contracts and fake SDK catalogs must not inherit a live v2 release.
 p=json.loads(PLAN.read_bytes())
 for name in u.REBOUND_FIELDS:p.pop(name,None)
 p.update(kind='hk-original-artifact-transfer-v1',sourceRun=u.RUN,
          producerControl=u.CONTROL,prefix=f'runs/{u.RUN}/1/')
 return p
class Tests(unittest.TestCase):
 def plan(self):
  p=legacy_plan_fixture();p['expiresAt']=(datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(minutes=30)).isoformat();p['uploaderFiles']={name:u.sha((UPLOADER.parent/name).read_bytes())for name in p['uploaderFiles']};p['uploaderRoleArn']='acs:ram::1177216024653153:role/workspacexgithubhongkongtransferrole';os.environ.update(REVIEWED_ROLE_ARN=p['uploaderRoleArn'],REVIEWED_OIDC_SUBJECT=p['subject'],REVIEWED_PROVIDER_ARN=p['oidcProviderArn']);return p
 def test_legacy_fixture_does_not_inherit_live_v2_fields(self):
  p=self.plan();self.assertEqual(p['kind'],'hk-original-artifact-transfer-v1')
  self.assertFalse(set(p)&u.REBOUND_FIELDS);self.assertEqual(p['sourceRun'],u.RUN)
  self.assertEqual(p['producerControl'],u.CONTROL)
  self.assertEqual(p['prefix'],f'runs/{u.RUN}/1/')
 def test_checked_in_historical_plan_cannot_authorize_changed_code(self):
  from unittest.mock import patch
  p=json.loads(PLAN.read_bytes())
  os.environ.update(REVIEWED_ROLE_ARN=p['uploaderRoleArn'],
   REVIEWED_OIDC_SUBJECT=p['subject'],REVIEWED_PROVIDER_ARN=p['oidcProviderArn'])
  expiry=datetime.datetime.fromisoformat(p['expiresAt'].replace('Z','+00:00'))
  class Clock(datetime.datetime):
   @classmethod
   def now(cls,tz=None):return expiry-datetime.timedelta(seconds=1)
  # Freeze observation time, never rewrite the reviewed plan's deadline/pins.
  with patch.object(u.datetime,'datetime',Clock),self.assertRaisesRegex(ValueError,'HK_TRANSFER_REJECTED'):u.validate_plan(p)
  if p['kind']=='hk-original-artifact-transfer-v2':
   self.assertEqual(p['sourceRevision'],u.SOURCE)
   template=PLAN.with_name('hk-revalidation-template.json').read_bytes()
   self.assertEqual(u.sha(template),p['revalidationTemplateSha256'])
   spec=importlib.util.spec_from_file_location('proof_binding',UPLOADER.with_name('cn-hk-generate-proof.py'))
   proof=importlib.util.module_from_spec(spec);spec.loader.exec_module(proof)
   with patch.object(proof.datetime,'datetime',Clock):
    proof.validate_binding(p,json.loads(template),template)
  with patch.object(u,'gh',return_value={}),self.assertRaises(ValueError):
   # The actual plan cannot admit absent provider run identity.
   with patch.object(u.datetime,'datetime',Clock):u.validate_source_run(p)
 def v3(self):
  p=self.plan();p.update(kind='hk-original-artifact-transfer-v3',sourceRun=38852606085,sourceRunAttempt=2,
      producerControl='5acebbb6741ed13c6379407aa0529c0eb8695b72',sourceRevision='bc3d1254ce05c915801fb73fe6698072730a051c',
      prefix='runs/38852606085/2/',producerWorkflowSha256='a'*64,candidatePlanRawSha256='b'*64,revalidationTemplateSha256='c'*64)
  return p
 def test_exact_attempt_two_plan_metadata_and_proof_binding(self):
  from unittest.mock import patch
  p=self.v3();u.validate_plan(p);record=p['artifacts']['api']
  value=dict(id=record['id'],name='cn-image-candidate-api-38852606085-2',expired=False,size_in_bytes=record['bytes'],
      digest='sha256:'+record['sha256'],workflow_run=dict(id=p['sourceRun'],head_sha=p['producerControl'],repository_id=1000328649,head_repository_id=1000328649))
  with patch.object(u,'gh',return_value=value):u.metadata('api',record,p)
  value['name']=value['name'][:-1]+'1'
  with patch.object(u,'gh',return_value=value),self.assertRaises(ValueError):u.metadata('api',record,p)
  spec=importlib.util.spec_from_file_location('proof2',UPLOADER.with_name('cn-hk-generate-proof.py'));proof=importlib.util.module_from_spec(spec);spec.loader.exec_module(proof)
  template=dict(controlRevision=p['producerControl'],verifierRevision=p['producerControl'],runId=p['sourceRun'],runAttempt=2,repositoryId=1000328649,
      artifactIds={k:v['id']for k,v in p['artifacts'].items()},producerWorkflowSha256=p['producerWorkflowSha256'],candidatePlanRawSha256=p['candidatePlanRawSha256'])
  raw=json.dumps(template).encode();p['revalidationTemplateSha256']=u.sha(raw);proof.validate_binding(p,template,raw)
  template['runAttempt']=1
  with self.assertRaises(AssertionError):proof.validate_binding(p,template,raw)
 def test_attempt_two_provider_path_and_original_zip(self):
  from unittest.mock import patch
  import io,base64
  p=self.v3();raw=json.dumps(dict(sourceRevision=p['sourceRevision'],controlRevision=p['producerControl'])).encode()
  data=io.BytesIO()
  with zipfile.ZipFile(data,'w')as z:z.writestr('cn-candidate-plan.json',raw)
  archive=data.getvalue();p['candidatePlanRawSha256']=u.sha(raw);p['producerWorkflowSha256']=u.sha(b'workflow')
  p['artifacts']['plan']=dict(id=999,bytes=len(archive),sha256=u.sha(archive));calls=[]
  run=dict(id=p['sourceRun'],run_attempt=2,head_sha=p['producerControl'],status='completed',conclusion='success',event='workflow_dispatch',head_branch='main',path=u.WORKFLOW,
      repository=dict(id=1000328649,full_name=u.REPO),head_repository=dict(id=1000328649))
  meta=dict(id=999,name='cn-candidate-plan-38852606085-2',expired=False,size_in_bytes=len(archive),digest='sha256:'+u.sha(archive),
      workflow_run=dict(id=p['sourceRun'],head_sha=p['producerControl'],repository_id=1000328649,head_repository_id=1000328649))
  def gh(path,output=None,limit=None):
   calls.append(path)
   if output is not None:output.write_bytes(archive);return
   if '/attempts/'in path:return run
   if '/contents/'in path:return dict(encoding='base64',content=base64.b64encode(b'workflow').decode())
   return meta
  with patch.object(u,'gh',side_effect=gh):u.validate_source_run(p)
  self.assertIn('/repos/'+u.REPO+'/actions/runs/38852606085/attempts/2',calls)
  self.assertFalse(any('/attempts/1'in path for path in calls))
  run['run_attempt']=1
  with patch.object(u,'gh',side_effect=gh),self.assertRaises(ValueError):u.validate_source_run(p)
 def test_attempt_scope_cannot_be_latest_or_foreign_prefix(self):
  for attempt in (True,0,3,'latest'):
   p=self.v3();p['sourceRunAttempt']=attempt
   with self.assertRaises(ValueError):u.validate_plan(p)
  p=self.v3();p['prefix']='runs/38852606085/1/'
  with self.assertRaises(ValueError):u.validate_plan(p)
 def test_fixed_source(self):
  p=self.plan();u.validate_plan(p);p['sourceRun']+=1
  with self.assertRaises(ValueError):u.validate_plan(p)
 def test_foreign_endpoint(self):
  p=self.plan();p['endpoint']='https://evil.example'
  with self.assertRaises(ValueError):u.validate_plan(p)
 def test_wrong_prefix(self):
  p=self.plan();p['prefix']='runs/other/'
  with self.assertRaises(ValueError):u.validate_plan(p)
 def test_unbound_role(self):
  v=self.plan();v['uploaderRoleArn']='__ROLE_ARN_FROM_CREATE_ROLE__'
  with self.assertRaises(Exception):u.validate_plan(v)
 def test_nine_exact_resources(self):
  v=json.loads((IAM/'role-policy.json').read_bytes());objects=v['Statement'][1]['Resource'];self.assertEqual(len(objects),9);self.assertTrue(all(not x.endswith('*')for x in objects));self.assertEqual(set(v['Statement'][1]['Action']),{'oss:PutObject','oss:GetObject'})
 def iam_contract(self, plan, trust, policy, reader):
  # STS API operation AssumeRoleWithOIDC is distinct from the RAM trust action.
  self.assertEqual(trust, {'Version':'1','Statement':[{
   'Action':'sts:AssumeRole','Effect':'Allow',
   'Principal':{'Federated':[plan['oidcProviderArn']]},
   'Condition':{'StringEquals':{'oidc:aud':'sts.aliyuncs.com',
    'oidc:iss':'https://token.actions.githubusercontent.com','oidc:sub':plan['subject']}}
  }]})
  self.assertEqual(set(plan['artifacts']),{'plan','set','api','web','agent','sandbox','postgres'})
  bucket='acs:oss:*:'+plan['accountId']+':'+plan['bucket']
  objects={bucket+'/'+plan['prefix']+name+'.zip' for name in plan['artifacts']}
  objects.update(bucket+'/'+plan['prefix']+name+'.json' for name in ('proof','policy'))
  self.assertEqual(policy['Version'],'1');self.assertEqual(len(policy['Statement']),2)
  meta,writer=policy['Statement']
  self.assertEqual(meta,{'Action':['oss:GetBucketInfo','oss:GetBucketAcl'],'Effect':'Allow','Resource':[bucket]})
  self.assertEqual(set(writer),{'Action','Effect','Resource'});self.assertEqual(writer['Effect'],'Allow')
  self.assertEqual(set(writer['Action']),{'oss:PutObject','oss:GetObject'});self.assertEqual(len(writer['Action']),2)
  self.assertEqual(set(writer['Resource']),objects);self.assertEqual(len(writer['Resource']),9)
  self.assertEqual(reader['Version'],'1');self.assertEqual(len(reader['Statement']),1)
  read=reader['Statement'][0]
  self.assertEqual(set(read),{'Action','Effect','Principal','Resource'});self.assertEqual(read['Effect'],'Allow')
  self.assertEqual(read['Action'],['oss:GetObject'])
  self.assertEqual(read['Principal'],['arn:sts::'+plan['accountId']+':assumed-role/workspacexcnproductionecsrole/*'])
  self.assertEqual(set(read['Resource']),objects);self.assertEqual(len(read['Resource']),9)
 def iam_documents(self):
  return [legacy_plan_fixture()]+[json.loads(path.read_bytes()) for path in (IAM/'role-trust.json',IAM/'role-policy.json',IAM/'bucket-read-policy.DRAFT.json')]
 def test_plan_trust_writer_reader_contract(self):
  self.iam_contract(*self.iam_documents())
 def test_trust_api_action_subject_provider_drift_rejected(self):
  for mutation in ('api-operation','foreign-provider','broader-subject','extra-statement'):
   with self.subTest(mutation=mutation):
    plan,trust,policy,reader=self.iam_documents();statement=trust['Statement'][0]
    if mutation=='api-operation':statement['Action']='sts:AssumeRoleWithOIDC'
    if mutation=='foreign-provider':statement['Principal']['Federated']=['acs:ram::1177216024653153:oidc-provider/Other']
    if mutation=='broader-subject':statement['Condition']['StringEquals']['oidc:sub']='repo:boardx/workspacex:*'
    if mutation=='extra-statement':trust['Statement'].append(dict(statement))
    with self.assertRaises(AssertionError):self.iam_contract(plan,trust,policy,reader)
 def test_plan_object_and_permission_drift_rejected(self):
  for mutation in ('different-attempt','wildcard','extra-object','delete','reader-write','other-account'):
   with self.subTest(mutation=mutation):
    plan,trust,policy,reader=self.iam_documents();writer=policy['Statement'][1]
    if mutation=='different-attempt':plan['prefix']='runs/other/1/'
    if mutation=='wildcard':writer['Resource'][0]=writer['Resource'][0].rsplit('/',1)[0]+'/*'
    if mutation=='extra-object':writer['Resource'].append(writer['Resource'][0]+'-other')
    if mutation=='delete':writer['Action'].append('oss:DeleteObject')
    if mutation=='reader-write':reader['Statement'][0]['Action'].append('oss:PutObject')
    if mutation=='other-account':plan['accountId']='9999999999999999'
    with self.assertRaises(AssertionError):self.iam_contract(plan,trust,policy,reader)
 def test_bucket_principal(self):
  p=json.loads((IAM/'bucket-read-policy.DRAFT.json').read_bytes());self.assertEqual(p['Statement'][0]['Principal'],['arn:sts::1177216024653153:assumed-role/workspacexcnproductionecsrole/*']);self.assertEqual(p['Statement'][0]['Action'],['oss:GetObject'])
 def test_official_sdk_lock(self):
  import re,urllib.parse
  lines=LOCK.read_text().splitlines();self.assertEqual(len(lines),16);names=set()
  for line in lines:
   package,rest=line.split(' @ ');url,pin=rest.split(' --hash=sha256:');parts=urllib.parse.urlsplit(url)
   self.assertEqual(parts.scheme,'https');self.assertEqual(parts.hostname,'files.pythonhosted.org');self.assertIsNone(parts.username);self.assertIsNone(parts.password);self.assertEqual(parts.query,'');self.assertRegex(pin,r'^[a-f0-9]{64}$');self.assertNotIn(package,names);names.add(package)
  self.assertIn('oss2',names)
 def test_sdk_session_no_redirect(self):
  class S:
   trust_env=True
   def request(self,*args,**kwargs):return kwargs
   def send(self,*args,**kwargs):return kwargs
  session=S();u.pin_session(session,'fixed.oss-cn-hongkong.aliyuncs.com');self.assertFalse(session.trust_env)
  result=session.request('GET','https://fixed.oss-cn-hongkong.aliyuncs.com/key');self.assertEqual(result,{'allow_redirects':False,'verify':True,'proxies':{}})
  with self.assertRaises(ValueError):session.request('GET','https://evil.example/key')
  with self.assertRaises(ValueError):session.request('DELETE','https://fixed.oss-cn-hongkong.aliyuncs.com/key')
 def test_gh_oversize_kills(self):
  class FakeProcess:
   def __init__(self,*a,**k):import io;self.stdout=io.BytesIO(b'abcde');self.killed=False
   def poll(self):return None
   def kill(self):self.killed=True
   def wait(self,**k):return 0
  original=u.subprocess.Popen;u.subprocess.Popen=FakeProcess
  try:
   with tempfile.TemporaryDirectory()as d:
    with self.assertRaises(ValueError):u.gh('/fixed',Path(d)/'x',4)
  finally:u.subprocess.Popen=original
if __name__=='__main__':unittest.main()
