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
class Tests(unittest.TestCase):
 def plan(self):
  p=json.loads(PLAN.read_bytes());p['expiresAt']=(datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(minutes=30)).isoformat();p['uploaderRoleArn']='acs:ram::1177216024653153:role/workspacexgithubhongkongtransferrole';os.environ.update(REVIEWED_ROLE_ARN=p['uploaderRoleArn'],REVIEWED_OIDC_SUBJECT=p['subject'],REVIEWED_PROVIDER_ARN=p['oidcProviderArn']);return p
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
  return [json.loads(path.read_bytes()) for path in (PLAN,IAM/'role-trust.json',IAM/'role-policy.json',IAM/'bucket-read-policy.DRAFT.json')]
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
