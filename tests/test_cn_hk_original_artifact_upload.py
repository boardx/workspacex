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
