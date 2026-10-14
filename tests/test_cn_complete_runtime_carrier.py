import copy,datetime as dt,importlib.util,io,json,os,tempfile,unittest,zipfile
from pathlib import Path
ROOT=Path(__file__).parents[1]
s=importlib.util.spec_from_file_location('carrier',ROOT/'scripts/cn-complete-runtime-carrier.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
G,old=m.modules()
class Carrier(unittest.TestCase):
 def fixture(self):
  now=dt.datetime.now(dt.timezone.utc);archive=b'exact offline runtime archive bytes'
  p=dict(kind='cn-complete-runtime-carrier-policy-v1',target=m.TARGET,producerRevision='a'*40,eventRevision='b'*40,controlRevision='c'*40,sourceRevision='c'*40,runId=42,runAttempt=1,event='pull_request',headBranch='worker/exact-producer',artifacts={},summarySha256=None,archiveSha256=m.sha(archive),archiveBytes=len(archive),issuedAt=(now-dt.timedelta(seconds=1)).isoformat(),expiresAt=(now+dt.timedelta(minutes=5)).isoformat(),githubProvider={'ghExecutable':'/usr/bin/gh','ghSha256':'d'*64,'authentication':'existing-root-gh','ghConfigDirectory':'/root/.config/gh'},bootstrapFiles={name:'e'*64 for name in m.FILES},storageMarginBytes=0)
  summary={k:p[k]for k in ('producerRevision','eventRevision','controlRevision','sourceRevision','archiveSha256','archiveBytes')};summary.update(runId='42',runAttempt='1',platform='linux-x64',credentialsIncluded=False)
  raw=m.encode(summary);p['summarySha256']=m.sha(raw);zips={};records={}
  for role,name,data,id in [('archive','runtime.tar.gz',archive,91),('summary','summary.json',raw,92)]:
   stream=io.BytesIO()
   with zipfile.ZipFile(stream,'w')as z:z.writestr(name,data)
   packed=stream.getvalue();zips[id]=packed;p['artifacts'][role]={'id':id,'zipSha256':m.sha(packed),'zipBytes':len(packed)}
   records[id]=dict(id=id,name=m.artifact_name(p,role),expired=False,digest='sha256:'+m.sha(packed),size_in_bytes=len(packed),workflow_run={'id':42,'head_sha':'a'*40,'repository_id':1000328649,'head_repository_id':1000328649})
  run=dict(id=42,run_attempt=1,head_sha='a'*40,head_branch=p['headBranch'],event=p['event'],path=m.WORKFLOW,status='completed',conclusion='success',repository={'full_name':'boardx/workspacex','id':1000328649})
  class Provider:
   def json(self,path):return copy.deepcopy(run if '/runs/'in path else records[int(path.split('/')[-1])])
   def fetch(self,path,out,maximum):raw=zips[int(path.split('/')[-2])];out.write(raw);return len(raw)
  return p,run,records,zips,Provider()
 def carry(self,p,provider,base,inbox):
  def publish(parent,source,name):
   try:os.stat(name,dir_fd=parent,follow_symlinks=False)
   except FileNotFoundError:pass
   else:raise ValueError('TARGET_COLLISION')
   os.rename(name,name,src_dir_fd=source,dst_dir_fd=parent)
  pin=m.sha(m.encode(p));m.validate_policy(m.encode(p),pin,dt.datetime.now(dt.timezone.utc))
  return m.carry(p,pin,provider,base=base,inbox=inbox,extract=G.extract,publish=publish)
 def test_real_zip_and_exact_event_producer_split_preserved(self):
  p,run,records,zips,provider=self.fixture()
  with tempfile.TemporaryDirectory()as folder:
   root=Path(folder);base=root/'journal';base.mkdir();inbox=root/'inbox';inbox.mkdir()
   report=self.carry(p,provider,base,inbox);dest=inbox/p['archiveSha256']
   self.assertEqual(set(x.name for x in dest.iterdir()),{'summary.json','runtime.tar.gz'})
   self.assertEqual(json.loads((dest/'summary.json').read_bytes())['eventRevision'],'b'*40)
   self.assertFalse(report['installerExecuted']);self.assertFalse(report['sudoChanged'])
   self.assertEqual((dest/'runtime.tar.gz').stat().st_mode&0o777,0o600)
 def test_wrong_head_expired_artifact_and_byte_digest_rejected(self):
  for mutation in ('head','expired','bytes'):
   p,run,records,zips,provider=self.fixture()
   if mutation=='head':run['head_sha']=p['eventRevision']
   elif mutation=='expired':records[91]['expired']=True
   else:zips[91]+=b'changed'
   with tempfile.TemporaryDirectory()as folder:
    root=Path(folder);base=root/'journal';base.mkdir();inbox=root/'inbox';inbox.mkdir()
    with self.assertRaises(ValueError):self.carry(p,provider,base,inbox)
    self.assertEqual(list(inbox.iterdir()),[])
 def test_zip_extra_member_rejected_and_attempt_not_retried(self):
  p,run,records,zips,provider=self.fixture();stream=io.BytesIO()
  with zipfile.ZipFile(stream,'w')as z:z.writestr('runtime.tar.gz',b'data');z.writestr('../escape',b'x')
  raw=stream.getvalue();zips[91]=raw;p['artifacts']['archive'].update(zipSha256=m.sha(raw),zipBytes=len(raw));records[91].update(digest='sha256:'+m.sha(raw),size_in_bytes=len(raw))
  with tempfile.TemporaryDirectory()as folder:
   root=Path(folder);base=root/'journal';base.mkdir();inbox=root/'inbox';inbox.mkdir()
   with self.assertRaises(ValueError):self.carry(p,provider,base,inbox)
   with self.assertRaises(FileExistsError):self.carry(p,provider,base,inbox)
 def test_inbox_collision_preserves_existing(self):
  p,run,records,zips,provider=self.fixture()
  with tempfile.TemporaryDirectory()as folder:
   root=Path(folder);base=root/'journal';base.mkdir();inbox=root/'inbox';inbox.mkdir();dest=inbox/p['archiveSha256'];dest.mkdir();(dest/'old').write_bytes(b'keep')
   with self.assertRaisesRegex(ValueError,'TARGET_COLLISION'):self.carry(p,provider,base,inbox)
   self.assertEqual((dest/'old').read_bytes(),b'keep')
 def test_exact_bootstrap_selection_is_pure_and_bounded(self):
  calls=[]
  def read(revision,path):calls.append((revision,path));return b'# no side effects\nVALUE=1\n'
  report=m.bootstrap_from_commit('a'*40,read);self.assertEqual(len(calls),9);self.assertFalse(report['installationAuthorized']);self.assertEqual(set(report['files']),set(m.FILES))
 def test_bootstrap_real_modules_import_from_only_frozen_closure(self):
  import subprocess,sys
  with tempfile.TemporaryDirectory()as folder:
   target=Path(folder)
   for name in m.FILES:(target/name).write_bytes((ROOT/'scripts'/name).read_bytes())
   probe="import importlib.util;from pathlib import Path;p=Path("+repr(str(target/'cn-complete-runtime-carrier.py'))+");s=importlib.util.spec_from_file_location('carrier',p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);G,old=m.modules();assert G.Github and old.no_replace;print('BOOTSTRAP_IMPORT_OK')"
   result=subprocess.run([sys.executable,'-I','-S','-B','-c',probe],cwd=folder,stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=False)
   self.assertEqual(result.returncode,0,result.stderr.decode());self.assertEqual(result.stdout,b'BOOTSTRAP_IMPORT_OK\n')
 def test_fixed_instance_is_read_bounded_and_wrong_instance_cannot_create_intent(self):
  with tempfile.TemporaryDirectory()as folder:
   root=Path(folder);(root/'instance-id').write_bytes(b'wrong-instance\n');calls=[]
   class Host:
    def directory(self,path):calls.append(path);return os.open(root,os.O_RDONLY|os.O_DIRECTORY)
    def read(self,fd,name,mode,maximum):
     self.assertion=(name,mode,maximum)
     handle=os.open(name,os.O_RDONLY|os.O_NOFOLLOW,dir_fd=fd)
     try:return os.read(handle,maximum)
     finally:os.close(handle)
   host=Host()
   with self.assertRaisesRegex(ValueError,'CARRIER_HOST_IDENTITY'):m.verify_fixed_host(host)
   self.assertEqual(calls,['/var/lib/cloud/data']);self.assertEqual(host.assertion,('instance-id',0o644,128))
   self.assertEqual(set(p.name for p in root.iterdir()),{'instance-id'})
   (root/'instance-id').write_bytes(m.TARGET['ecsInstanceId'].encode());m.verify_fixed_host(host)
 def test_existing_home_is_verified_without_repurpose(self):
  environment={'HOME':'/root','GH_TOKEN':'unprinted-fixture'};before=dict(environment);m.require_existing_home(environment);self.assertEqual(environment,before)
  environment['HOME']='/other'
  with self.assertRaisesRegex(ValueError,'CARRIER_EXISTING_ROOT_HOME'):m.require_existing_home(environment)
  self.assertEqual(environment['HOME'],'/other')
 def test_policy_has_no_unapproved_auth_or_deadline_escape(self):
  p,*_=self.fixture();p['githubProvider']['authentication']='copied-token'
  with self.assertRaisesRegex(ValueError,'CARRIER_EXISTING_ROOT_AUTH'):m.validate_policy(m.encode(p),m.sha(m.encode(p)),dt.datetime.now(dt.timezone.utc))
 @unittest.skipUnless(__import__('sys').platform=='linux'and os.geteuid()==0,'disposable Linux root only')
 def test_real_noreplace_publication(self):
  p,run,records,zips,provider=self.fixture()
  with tempfile.TemporaryDirectory(prefix='cn-carrier-unit-',dir='/run')as folder:
   root=Path(folder);base=root/'journal';base.mkdir(mode=0o700);inbox=root/'inbox';inbox.mkdir(mode=0o700)
   pin=m.sha(m.encode(p));report=m.carry(p,pin,provider,base=base,inbox=inbox,extract=G.extract,publish=old.no_replace)
   self.assertEqual(m.file_hash(inbox/p['archiveSha256']/'runtime.tar.gz'),(p['archiveBytes'],p['archiveSha256']))
if __name__=='__main__':unittest.main()
