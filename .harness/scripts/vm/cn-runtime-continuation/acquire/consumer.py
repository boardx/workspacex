"""HK untrusted original ZIP consumer. GET-only; exact reviewed bytes; no publication."""
import datetime,hashlib,json,logging,os,re,shutil,stat,time,zipfile
from pathlib import Path
BUCKET='workspacex-hk-release-cache-1177216024653153'
ENDPOINT='https://oss-cn-hongkong.aliyuncs.com'
PREFIX=CONFIG['prefix']
SOURCE=CONFIG['sourceRevision']
CONTROL=CONFIG['controlRevision']
INBOX=Path('/var/lib/workspacex-cn/candidate-inbox')
RUNTIME=Path('/var/lib/workspacex-cn/runtime')
ATTEMPT=CONFIG['attemptId']
sha=lambda raw:hashlib.sha256(raw).hexdigest()
def validate(v):
 assert v['kind']=='cn-hk-consumer-v1' and v['bucket']==BUCKET and v['endpoint']==ENDPOINT and v['prefix']==PREFIX
 assert v['sourceRevision']==SOURCE and v['controlRevision']==CONTROL and v['runId']==CONFIG['runId'] and v['runAttempt']==CONFIG['runAttempt']
 assert set(v['objects'])=={'api','web','agent','sandbox','postgres','plan','set','proof','policy'}
 assert re.fullmatch('hk-[a-z0-9-]{1,64}',v['destinationName'])
 for name,x in v['objects'].items():
  assert x['key']==PREFIX+name+('.zip'if name not in ('proof','policy')else '.json') and re.fullmatch('[a-f0-9]{64}',x['sha256'])
  assert type(x['bytes'])is int and 0<x['bytes']<= (256*1024 if name in ('proof','policy')else 2*1024**3)
 assert sum(x['bytes']for x in v['objects'].values())<5*1024**3
 assert type(v['maxSeconds'])is int and 1<=v['maxSeconds']<=1200
 assert v == CONFIG
 now=datetime.datetime.now(datetime.timezone.utc);issued=datetime.datetime.fromisoformat(v['issuedAt']);expiry=datetime.datetime.fromisoformat(v['expiresAt'])
 assert issued<=now<expiry and expiry-issued<=datetime.timedelta(minutes=30)
 return v

def extract(z,folder,limits):
 with zipfile.ZipFile(z)as archive:
  items=archive.infolist();assert len(items)==len(limits)and {x.filename for x in items}==set(limits)
  for x in items:assert not x.is_dir()and stat.S_IFMT(x.external_attr>>16)in (0,stat.S_IFREG)and not x.flag_bits&1 and 0<x.file_size<=limits[x.filename]
  for x in items:
   with archive.open(x)as src,(folder/x.filename).open('xb')as dst:
    os.chmod(dst.name,0o600);total=0
    while True:
     raw=src.read(min(1048576,limits[x.filename]-total+1))
     if not raw:break
     total+=len(raw);assert total<=limits[x.filename];dst.write(raw)
    assert total==x.file_size;dst.flush();os.fsync(dst.fileno())

def download_one(bucket,x,path,check):
 check();response=bucket.get_object(x['key']);assert int(response.headers['Content-Length'])==x['bytes'];h=hashlib.sha256();count=0
 try:
  with path.open('xb')as f:
   path.chmod(0o600)
   while True:
    check();raw=response.read(min(1048576,x['bytes']-count+1))
    if not raw:break
    count+=len(raw);assert count<=x['bytes'];h.update(raw);f.write(raw)
   assert count==x['bytes']and h.hexdigest()==x['sha256'];f.flush();os.fsync(f.fileno())
 finally:
  if hasattr(response,'close'):response.close()
 check()

def run(v):
 validate(v);assert os.geteuid()==os.getegid()==0;logging.disable(logging.CRITICAL)
 from cn_candidate_authenticated_oss import verify_host,pin_session,ACCOUNT,ROLE,REGION
 from cn_candidate_revalidation import admit
 import cn_image_candidate as candidate
 import oss2
 oss2.defaults.request_retries=0
 from requests.adapters import HTTPAdapter
 from alibabacloud_credentials.client import Client
 from alibabacloud_credentials.models import Config
 from aliyunsdkcore.client import AcsClient
 from aliyunsdkcore.auth.credentials import StsTokenCredential
 from aliyunsdksts.request.v20150401.GetCallerIdentityRequest import GetCallerIdentityRequest
 parent=Path('/var/lib/workspacex-cn')
 for p in (parent,*parent.parents):
  s=p.lstat();assert stat.S_ISDIR(s.st_mode)and s.st_uid==s.st_gid==0 and not s.st_mode&0o022
 assert shutil.disk_usage(parent).free>=2*sum(x['bytes']for x in v['objects'].values())+2*1024**3
 deadline=time.monotonic()+v['maxSeconds']
 def check():assert time.monotonic()<deadline and datetime.datetime.now(datetime.timezone.utc)<datetime.datetime.fromisoformat(v['expiresAt'])
 verify_host();credential=Client(Config(type='ecs_ram_role',role_name=ROLE,disable_imds_v1=True,timeout=2000,connect_timeout=2000)).get_credential()
 assert all(isinstance(x,str)and x for x in (credential.access_key_id,credential.access_key_secret,credential.security_token))
 sts=AcsClient(region_id=REGION,credential=StsTokenCredential(credential.access_key_id,credential.access_key_secret,credential.security_token),auto_retry=False,connect_timeout=5,timeout=10,verify=True,proxy={});pin_session(sts.session,'sts.cn-shanghai.aliyuncs.com',{'POST'});sts.session.mount('https://',HTTPAdapter(max_retries=0))
 request=GetCallerIdentityRequest();request.set_protocol_type('https');request.set_endpoint('sts.cn-shanghai.aliyuncs.com');request.set_method('POST');request.set_accept_format('json');ident=json.loads(sts.do_action_with_exception(request))
 assert ident['AccountId']==ACCOUNT and ident['IdentityType']=='AssumedRoleUser' and re.fullmatch('acs:ram::'+ACCOUNT+':assumed-role/'+ROLE+'/[^/*\\s]{1,128}',ident['Arn'],re.IGNORECASE)
 session=oss2.Session();session.session.mount('https://',HTTPAdapter(max_retries=0));pin_session(session.session,BUCKET+'.oss-cn-hongkong.aliyuncs.com',{'GET'})
 bucket=oss2.Bucket(oss2.StsAuth(credential.access_key_id,credential.access_key_secret,credential.security_token),ENDPOINT,BUCKET,session=session,connect_timeout=10)
 os.umask(0o077);root=parent/v['destinationName'];root.mkdir(mode=0o700);cache=root/'original';cache.mkdir(mode=0o700)
 # Original object bytes are untrusted until the independently pinned SHA matches.
 for name,x in v['objects'].items():download_one(bucket,x,cache/(name+('.zip'if name not in ('proof','policy')else '.json')),check)
 result=verify_downloaded(v,root,check)
 result['bundle']=str(promote_verified(root,result,check));result['promotedToExactPublisherInbox']=True
 with (root/'promoted-receipt.json').open('x')as f:json.dump(result,f,sort_keys=True);f.write('\n')
 return result

def verify_downloaded(v,root,check):
 from cn_candidate_revalidation import admit
 import cn_image_candidate as candidate
 cache=root/'original'
 proof=(cache/'proof.json').read_bytes();policy=(cache/'policy.json').read_bytes();cap=admit(proof,v['objects']['proof']['sha256'],v['objects']['policy']['sha256'],policy)
 pv=json.loads(proof)
 for name in ('api','web','agent','sandbox','postgres','plan','set'):
  expected=v['objects'][name];actual=pv['github']['artifacts'][name]
  assert actual['artifactId']==expected['artifactId']and actual['zipBytes']==expected['bytes']and actual['zipSha256']==expected['sha256']
 for name,limits in [('plan',{'cn-candidate-plan.json':16384}),('set',{'candidate-set.json':256*1024,'candidate-plan.json':16384})]:
  folder=root/name;folder.mkdir(mode=0o700);extract(cache/(name+'.zip'),folder,limits)
 planraw=(root/'plan/cn-candidate-plan.json').read_bytes();setraw=(root/'set/candidate-set.json').read_bytes();assert sha(planraw)==v['candidatePlanRawSha256']and sha(setraw)==v['candidateSetRawSha256']
 assert (root/'set/candidate-plan.json').read_bytes()==planraw
 plan=candidate.validate_plan(json.loads(planraw));receipt=cap.check(plan,setraw,sha(setraw),sha(planraw));bundle=root/'bundle';bundle.mkdir(mode=0o700)
 for name,item in receipt['images'].items():
  check();folder=root/name;folder.mkdir(mode=0o700);extract(cache/(name+'.zip'),folder,{'candidate-plan.json':16384,'candidate-fragment.json':256*1024,name+'.tar':item['size']})
  assert (folder/'candidate-plan.json').read_bytes()==planraw
  fragment=(folder/'candidate-fragment.json').read_bytes();assert sha(fragment)==pv['fragmentSha256'][name]
  assert candidate.validate_historical_receipt(fragment,plan,sha(fragment))['images']=={name:item}
  os.rename(folder/(name+'.tar'),bundle/(name+'.tar'))
 check();verified=cap.verify_bundle(bundle,plan,setraw,sha(setraw),sha(planraw));check()
 for name,raw in [('candidate-plan.json',planraw),('candidate-set.json',setraw),('revalidation.json',proof),('revalidation-policy.json',policy)]:
  with (bundle/name).open('xb')as f:(bundle/name).chmod(0o600);f.write(raw);f.flush();os.fsync(f.fileno())
 result=dict(kind='cn-hk-consumed-revalidated-bundle-v1',root=str(root),bundle=str(bundle),originalZipsPreserved=True,proofGenerated=False,proofSha256=sha(proof),policySha256=sha(policy),expiresAt=cap.expires_at,sourceRevision=SOURCE,controlRevision=CONTROL,images=verified['images'],cloudWrites=0,publicationExecuted=False,productionReady=False,finishedAt=datetime.datetime.now(datetime.timezone.utc).isoformat())
 with (root/'receipt.json').open('x')as f:json.dump(result,f,sort_keys=True);f.write('\n')
 return result


def promote_verified(root,result,check):
 """Canonical lock + kernel no-replace rename; no Docker/publication/config change."""
 import ctypes,fcntl
 bundle=root/'bundle';assert result['bundle']==str(bundle) and result['sourceRevision']==SOURCE and result['controlRevision']==CONTROL
 for p in (root,*root.parents):
  s=p.lstat();assert stat.S_ISDIR(s.st_mode)and s.st_uid==s.st_gid==0 and not s.st_mode&0o022
 assert set(p.name for p in bundle.iterdir())=={'api.tar','web.tar','agent.tar','sandbox.tar','postgres.tar','candidate-plan.json','candidate-set.json','revalidation.json','revalidation-policy.json'}
 for p in bundle.iterdir():
  s=p.lstat();assert stat.S_ISREG(s.st_mode)and s.st_uid==s.st_gid==0 and s.st_nlink==1 and stat.S_IMODE(s.st_mode)==0o600
 fd=os.open(RUNTIME/'release.lock',os.O_RDWR|os.O_NOFOLLOW);s=os.fstat(fd);assert stat.S_ISREG(s.st_mode)and s.st_uid==s.st_gid==0 and s.st_nlink==1 and stat.S_IMODE(s.st_mode)==0o600
 fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
 try:
  check();assert datetime.datetime.now(datetime.timezone.utc)<datetime.datetime.fromisoformat(result['expiresAt'])
  for p in (INBOX.parent,*INBOX.parent.parents):
   s=p.lstat();assert stat.S_ISDIR(s.st_mode)and s.st_uid==s.st_gid==0 and not s.st_mode&0o022
  for p in (INBOX,INBOX/SOURCE):
   if not p.exists():p.mkdir(mode=0o700)
   s=p.lstat();assert stat.S_ISDIR(s.st_mode)and s.st_uid==s.st_gid==0 and not s.st_mode&0o022
  target=INBOX/SOURCE/ATTEMPT;assert not target.exists()and not target.is_symlink(),'PUBLISHER_INBOX_EXISTS_RECONCILE'
  libc=ctypes.CDLL(None,use_errno=True);rename=libc.renameat2;rename.argtypes=[ctypes.c_int,ctypes.c_char_p,ctypes.c_int,ctypes.c_char_p,ctypes.c_uint];rename.restype=ctypes.c_int
  assert rename(-100,os.fsencode(bundle),-100,os.fsencode(target),1)==0,'PROMOTE_FAILED_RECONCILE'
  d=os.open(target.parent,os.O_RDONLY|os.O_DIRECTORY);os.fsync(d);os.close(d)
  return target
 finally:os.close(fd)
