#!/usr/bin/env python3
"""Draft GitHub runner -> exact private Hong Kong OSS original-ZIP cache.
No production publication, no proof fabrication, no IAM changes, no retries.
"""
import argparse,datetime,hashlib,json,os,re,signal,subprocess,time,sys,shutil,logging
from urllib.parse import urlsplit
from pathlib import Path
REPO='boardx/workspacex';RUN=38146134231;CONTROL='27bada5321e45fbdd5f0506fd06d08fa29ea24ce';ACCOUNT='1177216024653153'
def need(ok):
 if not ok:raise ValueError('HK_TRANSFER_REJECTED')
def sha(b):return hashlib.sha256(b).hexdigest()
def rawjson(b):
 def pairs(rows):
  d={}
  for k,v in rows:need(k not in d);d[k]=v
  return d
 return json.loads(b,object_pairs_hook=pairs)
def gh(path,output=None,limit=None):
 args=['gh','api','--hostname','github.com',path]
 if output is None:
  r=subprocess.run(args,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=60);need(r.returncode==0 and len(r.stdout)<=4*1024**2);return rawjson(r.stdout)
 need(type(limit)is int and 0<limit<=4*1024**3)
 with output.open('xb') as f:
  output.chmod(0o600);process=subprocess.Popen(args,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL);count=0
  try:
   while True:
    block=process.stdout.read(min(1024**2,limit-count+1))
    if not block:break
    count+=len(block);need(count<=limit);f.write(block)
   need(process.wait(timeout=5)==0 and count==limit);f.flush();os.fsync(f.fileno())
  finally:
   if process.poll()is None:process.kill();process.wait()
   process.stdout.close()
def digest_file(path,expected_size):
 need(path.stat().st_size==expected_size);h=hashlib.sha256()
 with path.open('rb') as f:
  for b in iter(lambda:f.read(1024**2),b''):h.update(b)
 return h.hexdigest()
def metadata(name,record):
 m=gh(f'/repos/{REPO}/actions/artifacts/{record["id"]}')
 expected=f'cn-candidate-plan-{RUN}-1' if name=='plan' else f'cn-image-candidate-set-{RUN}-1' if name=='set' else f'cn-image-candidate-{name}-{RUN}-1'
 need(m['id']==record['id'] and m['name']==expected and m['expired'] is False and m['size_in_bytes']==record['bytes'] and m['digest']=='sha256:'+record['sha256'] and m['workflow_run']['id']==RUN and m['workflow_run']['head_sha']==CONTROL)
 return {k:m[k]for k in ('id','name','expired','size_in_bytes','digest','workflow_run')}
def validate_plan(v):
 need(set(v)=={'kind','accountId','bucket','region','endpoint','prefix','sourceRun','producerControl','artifacts','expiresAt','uploaderRoleArn','subject','oidcProviderArn','uploaderFiles'})
 need(v['kind']=='hk-original-artifact-transfer-v1' and v['accountId']==ACCOUNT and v['sourceRun']==RUN and v['producerControl']==CONTROL)
 need(v['region']=='cn-hongkong' and v['endpoint']=='https://oss-cn-hongkong.aliyuncs.com' and re.fullmatch('[a-z0-9][a-z0-9-]{1,61}[a-z0-9]',v['bucket']))
 need(v['prefix']=='runs/38146134231/1/' and v['bucket']=='workspacex-hk-release-cache-1177216024653153')
 need(set(v['artifacts'])=={'plan','set','api','web','agent','sandbox','postgres'})
 for x in v['artifacts'].values():need(set(x)=={'id','bytes','sha256'} and type(x['id'])is int and type(x['bytes'])is int and 0<x['bytes']<=4*1024**3 and re.fullmatch('[a-f0-9]{64}',x['sha256']))
 need(datetime.datetime.now(datetime.timezone.utc)<datetime.datetime.fromisoformat(v['expiresAt'].replace('Z','+00:00')))
 need(re.fullmatch('acs:ram::1177216024653153:role/[a-z0-9-]+',v['uploaderRoleArn']))
 need(v['uploaderRoleArn']==os.environ.get('REVIEWED_ROLE_ARN') and v['subject']==os.environ.get('REVIEWED_OIDC_SUBJECT') and v['oidcProviderArn']==os.environ.get('REVIEWED_PROVIDER_ARN'))
 verify_code(v)
 return v

def verify_code(v):
 root=Path(__file__).resolve().parent
 files=v['uploaderFiles'];need(set(files)=={'cn-hk-original-artifact-upload.py','bounded_workers.py','cn-hk-generate-proof.py'})
 for name,pin in files.items():
  path=Path(__file__)if name=='cn-hk-original-artifact-upload.py'else root/name
  need(re.fullmatch('[a-f0-9]{64}',pin) and not path.is_symlink() and sha(path.read_bytes())==pin)
def pin_session(session,hostname):
 session.trust_env=False;original=session.request;original_send=session.send
 def valid(method,url):
  parsed=urlsplit(url);need(parsed.scheme=='https' and parsed.hostname==hostname and parsed.port in (None,443) and parsed.username is None and parsed.password is None and method.upper()in {'GET','PUT'})
 def options(kwargs):kwargs.update(allow_redirects=False,verify=True,proxies={})
 def request(method,url,**kwargs):valid(method,url);options(kwargs);return original(method,url,**kwargs)
 def send(prepared,**kwargs):valid(prepared.method,prepared.url);options(kwargs);return original_send(prepared,**kwargs)
 session.request=request;session.send=send

def sync_dir(path):
 fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY)
 try:os.fsync(fd)
 finally:os.close(fd)

def save_json(path,value):
 with path.open('x')as f:
  path.chmod(0o600);json.dump(value,f,sort_keys=True);f.flush();os.fsync(f.fileno())
 sync_dir(path.parent)

def bucket_for(v):
 # Each process owns its SDK/session. No pooled SDK object crosses processes.
 import oss2
 from requests.adapters import HTTPAdapter
 logging.disable(logging.CRITICAL);oss2.defaults.request_retries=0
 auth=oss2.StsAuth(os.environ['ALIBABA_CLOUD_ACCESS_KEY_ID'],os.environ['ALIBABA_CLOUD_ACCESS_KEY_SECRET'],os.environ['ALIBABA_CLOUD_SECURITY_TOKEN'])
 session=oss2.Session();session.session.mount('https://',HTTPAdapter(max_retries=0));pin_session(session.session,v['bucket']+'.oss-cn-hongkong.aliyuncs.com')
 return oss2.Bucket(auth,v['endpoint'],v['bucket'],connect_timeout=30,session=session)

def observe(bucket,v):
 info=bucket.get_bucket_info();acl=bucket.get_bucket_acl()
 need(info.name==v['bucket'] and info.location=='oss-cn-hongkong' and info.owner.id==ACCOUNT and acl.acl=='private')

def upload_one(v,output,name,record,bucket,before=None):
 validate_plan(v);observe(bucket,v)
 path=Path(record['path']);key=record['key']
 # Same directory and exclusive per-object filename; never overwrite/resume.
 save_json(output/(name+'.put-intent.json'),dict(key=key,sha256=record['sha256'],bytes=record['bytes']))
 with path.open('rb')as stream:response=bucket.put_object(key,stream,headers={'x-oss-forbid-overwrite':'true'})
 need(response.status==200)
 h=hashlib.sha256();count=0;result=bucket.get_object(key)
 try:
  while True:
   block=result.read(1024**2)
   if not block:break
   count+=len(block);need(count<=record['bytes']);h.update(block)
 finally:result.close()
 need(count==record['bytes'] and h.hexdigest()==record['sha256']);observe(bucket,v)
 if before is not None:need(metadata(name,record)==before)
 validate_plan(v)
 return dict(key=key,artifactId=record['id'],sha256=h.hexdigest(),bytes=count,readbackVerified=True)

class ArtifactWorker:
 def __init__(self,v,output):self.v=v;self.output=output
 def __call__(self,name):
  v=self.v;record=v['artifacts'][name];started=time.monotonic()
  validate_plan(v);before=metadata(name,record);path=self.output/(name+'.zip')
  gh(f'/repos/{REPO}/actions/artifacts/{record["id"]}/zip',path,record['bytes'])
  need(digest_file(path,record['bytes'])==record['sha256']);need(metadata(name,record)==before)
  downloaded=time.monotonic()
  receipt=upload_one(v,self.output,name,dict(record,path=path,key=v['prefix']+name+'.zip'),bucket_for(v),before)
  import resource
  save_json(self.output/(name+'.worker-result.json'),dict(receipt=receipt,downloadSeconds=downloaded-started,putReadbackSeconds=time.monotonic()-downloaded,workerMaxRssKiB=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,zipBytes=path.stat().st_size))
  return receipt

class ProofWorker:
 def __init__(self,v,output,seconds):self.v=v;self.output=output;self.seconds=seconds
 def __call__(self,name):
  validate_plan(self.v);need(name=='proof-generation')
  result=subprocess.run([sys.executable,'-I','-B',str(Path(__file__).with_name('cn-hk-generate-proof.py')),'--bundle',str(self.output),'--control',str(Path('producer-control').resolve()),'--template','.github/release-plans/hk-revalidation-template.json','--output',str(self.output/'revalidation')],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=self.seconds)
  need(result.returncode==0 and len(result.stdout)<16384);validate_plan(self.v)
  return rawjson(result.stdout)

def pipeline(v,output,seconds,worker=None,context=None):
 # Reviewed adjacent module; include it in the deployed code hash closure.
 sys.path.insert(0,str(Path(__file__).resolve().parent))
 if worker is None:verify_code(v)
 from bounded_workers import run,TransferStopped
 started=time.monotonic()
 try:
  receipts,states=run(list(v['artifacts']),worker or ArtifactWorker(v,output),seconds,context=context)
 except TransferStopped as e:
  save_json(output/'pipeline-failed.json',dict(states=e.states,externalWritesTerminal=False,retryAllowed=False,elapsedSeconds=time.monotonic()-started))
  raise
 need(set(receipts)==set(v['artifacts']) and all(x=='succeeded'for x in states.values()))
 # Recheck exact complete child receipts before proof; no reported flags alone.
 for name,record in v['artifacts'].items():
  need(receipts[name]==dict(key=v['prefix']+name+'.zip',artifactId=record['id'],sha256=record['sha256'],bytes=record['bytes'],readbackVerified=True))
 save_json(output/'pipeline-complete.json',dict(states=states,elapsedSeconds=time.monotonic()-started,workers=2,proofGenerated=False))
 return receipts

def capacity(v,output):
 required=sum(x['bytes']for x in v['artifacts'].values())*2+3825868800+2*1024**3
 need(shutil.disk_usage(output).free>=required)
 return required

def main():
 need(sys.platform=='linux')
 p=argparse.ArgumentParser();p.add_argument('--plan',type=Path,required=True);p.add_argument('--plan-sha256',required=True);p.add_argument('--output',type=Path,required=True);args=p.parse_args()
 raw=args.plan.read_bytes();need(sha(raw)==args.plan_sha256);v=validate_plan(rawjson(raw));args.output.mkdir(mode=0o700)
 # Unchanged conservative all-seven ZIP/extraction capacity admission.
 capacity(v,args.output)
 started=time.monotonic();deadline=started+1500
 signal.signal(signal.SIGALRM,lambda *_:(_ for _ in ()).throw(TimeoutError()));signal.alarm(1500)
 bucket=bucket_for(v);observe(bucket,v)
 initial=gh(f'/repos/{REPO}/actions/runs/{RUN}/attempts/1');need(initial['id']==RUN and initial['head_sha']==CONTROL and initial['conclusion']=='success' and initial['status']=='completed')
 seconds=min(deadline-time.monotonic(),(datetime.datetime.fromisoformat(v['expiresAt'].replace('Z','+00:00'))-datetime.datetime.now(datetime.timezone.utc)).total_seconds())
 receipts=pipeline(v,args.output,seconds)
 with (args.output/'upload-plan.json').open('xb')as f:os.chmod(f.name,0o600);f.write(raw);f.flush();os.fsync(f.fileno())
 validate_plan(v);proofwork=args.output/'revalidation'
 left=min(1200,deadline-time.monotonic());need(left>0)
 # Proof's nested canonical/gh children share a supervised process group too.
 from bounded_workers import run,TransferStopped
 try:proofresults,_=run(['proof-generation'],ProofWorker(v,args.output,left),left)
 except TransferStopped as e:
  save_json(args.output/'proof-failed.json',dict(states=e.states,externalWritesTerminal=False,retryAllowed=False));raise
 proofresult=proofresults['proof-generation']
 for name,pathkey in (('proof','proofPath'),('policy','policyPath')):
  need(time.monotonic()<deadline);path=Path(proofresult[pathkey]);data=path.read_bytes();need(0<len(data)<=256*1024)
  receipts[name]=upload_one(v,args.output,name,dict(id=None,bytes=len(data),sha256=sha(data),path=path,key=v['prefix']+name+'.json'),bucket)
 need(gh(f'/repos/{REPO}/actions/runs/{RUN}/attempts/1')==initial);validate_plan(v);need(time.monotonic()<deadline)
 receipt=dict(kind='hk-untrusted-original-zip-cache-receipt-v1',planRawSha256=args.plan_sha256,bucket=v['bucket'],region=v['region'],prefix=v['prefix'],objects=receipts,proofGenerated=True,productionReady=False)
 save_json(args.output/'receipt.json',receipt)
 print(json.dumps(dict(ok=True,objects=len(receipts),productionReady=False)))

if __name__=='__main__':
 try:main()
 except BaseException as e:
  print(json.dumps(dict(ok=False,status='rejected-or-unknown',errorType=type(e).__name__,retryAllowed=False)));raise SystemExit(1)
