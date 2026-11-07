#!/usr/bin/env python3
"""Preserve exact historical ZIP bytes inside GitHub only. No image load/build/admission."""
import argparse,hashlib,json,os,re,selectors,shutil,signal,stat,subprocess,time
from pathlib import Path
REPO='boardx/workspacex'
RUN=38146134231
CONTROL='27bada5321e45fbdd5f0506fd06d08fa29ea24ce'
BRANCH='worker/codex-cn-autonomous-release'
LABEL='cn-preserve-f0eb-38146134231'
SOURCE='f0eb9d07398a66fdd5646a9e6b855fa1b940e571'
SPECS={'agent': {'id': 11704877196, 'zipBytes': 410873957, 'zipSha256': 'baca72ccc242f4a4233531a07941ac8b943f0d9c639ab1baff8ebd76d6f717f3'}, 'api': {'id': 11705141666, 'zipBytes': 983577941, 'zipSha256': '98911883a5a05c1d26c06e39af43d7b7c24585192892543a67a1a79d41f1dde2'}, 'postgres': {'id': 11704517675, 'zipBytes': 460160021, 'zipSha256': 'fbec6c72df7be5886e0e45a8584dc27d40d038819e745c60d4f1abda52dbfcca'}, 'sandbox': {'id': 11705066985, 'zipBytes': 1577550220, 'zipSha256': '7c4e2654b03a721036548c9b4fceb5eddc8e8d2ef36df111183871a2ac0d5c6a'}, 'web': {'id': 11704512913, 'zipBytes': 393732413, 'zipSha256': '19c720096e107f073b93b14afcc4ea31af3b129ed47e807eb46d6613710c5a24'}, 'plan': {'id': 11704303102, 'zipBytes': 1010, 'zipSha256': 'cabf792681b6768f4fd6302a47a001317eebbd23d33497244aa295a7dc8d803c'}, 'set': {'id': 11705296861, 'zipBytes': 5255, 'zipSha256': '017b64edf5cefcecbf3d42a439034ff9478388bb3b0ab704fa8041564a4b4576'}}
def need(ok,code):
 if not ok:raise RuntimeError(code)
def canonical(v):return (json.dumps(v,sort_keys=True,separators=(',',':'))+'\n').encode()
def safe_env():
 env={k:v for k,v in os.environ.items() if k not in ('GH_DEBUG','DEBUG','GH_HOST','GITHUB_API_URL','GITHUB_GRAPHQL_URL')}
 env.update(GH_HOST='github.com',GH_PROMPT_DISABLED='1',NO_COLOR='1')
 return env
def stream(command,limit,timeout,sink=None):
 p=subprocess.Popen(command,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,env=safe_env(),start_new_session=True)
 selector=selectors.DefaultSelector();selector.register(p.stdout,selectors.EVENT_READ);deadline=time.monotonic()+timeout;size=0;digest=hashlib.sha256();data=bytearray()
 try:
  while selector.get_map():
   need(time.monotonic()<deadline,'READ_DEADLINE')
   for key,_ in selector.select(min(.1,max(0,deadline-time.monotonic()))):
    block=os.read(key.fileobj.fileno(),65536)
    if not block:selector.unregister(key.fileobj);continue
    size+=len(block);need(size<=limit,'READ_SIZE_LIMIT');digest.update(block)
    if sink:sink.write(block)
    else:data.extend(block)
  need(p.wait(timeout=max(.01,deadline-time.monotonic()))==0,'READ_FAILED')
  return size,digest.hexdigest(),bytes(data)
 finally:
  if p.poll() is None:
   try:os.killpg(p.pid,signal.SIGKILL)
   except ProcessLookupError:pass
   p.wait(timeout=5)
  selector.close();p.stdout.close()
def validate_metadata(value,service):
 spec=SPECS[service]
 name=('cn-candidate-plan'if service=='plan'else'cn-image-candidate-set'if service=='set'else'cn-image-candidate-'+service)+'-'+str(RUN)+'-1'
 need(type(value)is dict and value.get('id')==spec['id'] and value.get('name')==name,'ARTIFACT_IDENTITY')
 need(value.get('size_in_bytes')==spec['zipBytes'] and value.get('digest')=='sha256:'+spec['zipSha256'] and value.get('expired')is False,'ARTIFACT_BYTES_OR_EXPIRY')
 w=value.get('workflow_run',{});need(w.get('id')==RUN and w.get('head_sha')==CONTROL and w.get('repository_id')==1000328649,'PRODUCER_IDENTITY')
 return {k:value[k]for k in ('id','name','size_in_bytes','digest','expired','created_at','expires_at','workflow_run')}
def metadata(gh,service):
 _,_,raw=stream([gh,'api','repos/'+REPO+'/actions/artifacts/'+str(SPECS[service]['id'])],65536,30)
 return validate_metadata(json.loads(raw),service)
def private_file(path,raw):
 fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb')as f:f.write(raw);f.flush();os.fsync(f.fileno())
def validate_event(env,payload):
 need(env.get('GITHUB_ACTIONS')=='true'and env.get('GITHUB_REPOSITORY')==REPO,'GITHUB_SCOPE_ONLY')
 need(env.get('GITHUB_RUN_ATTEMPT')=='1','NO_RUN_RETRY')
 if env.get('GITHUB_EVENT_NAME')=='workflow_dispatch':
  need(env.get('GITHUB_REF')=='refs/heads/main','MANUAL_MAIN_ONLY');expected=env.get('GITHUB_SHA','')
 else:
  need(env.get('GITHUB_EVENT_NAME')=='pull_request' and payload.get('action')=='labeled'and payload.get('label',{}).get('name')==LABEL,'EXACT_LABEL_EVENT_ONLY')
  pr=payload.get('pull_request',{});head=pr.get('head',{});base=pr.get('base',{})
  need(head.get('repo',{}).get('full_name')==REPO and base.get('repo',{}).get('full_name')==REPO and head.get('ref')==BRANCH and base.get('ref')=='main'and pr.get('state')=='open','EXACT_SAME_REPO_PR_ONLY')
  expected=head.get('sha','')
 need(re.fullmatch('[a-f0-9]{40}',expected)and env.get('PRESERVE_CHECKOUT_SHA')==expected,'EXACT_CHECKOUT_SHA')
 return expected
def folder(service):
 event=Path(os.environ['GITHUB_EVENT_PATH']);need(event.stat().st_size<=1024*1024,'EVENT_SIZE')
 expected=validate_event(os.environ,json.loads(event.read_bytes()))
 head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=Path(__file__).resolve().parents[1],stderr=subprocess.DEVNULL,timeout=5).decode().strip();need(head==expected,'CHECKOUT_NOT_EVENT_HEAD')
 run=os.environ.get('GITHUB_RUN_ID','');attempt=os.environ.get('GITHUB_RUN_ATTEMPT','')
 need(re.fullmatch('[0-9]+',run)and attempt=='1','RUN_SCOPE')
 base=Path(os.environ['RUNNER_TEMP']).resolve();need(base.is_dir(),'RUNNER_TEMP')
 return base/('f0eb-original-'+run+'-'+attempt+'-'+service)

def acquire(service):
 target=folder(service);target.mkdir(mode=0o700);gh=shutil.which('gh');need(gh,'GH_REQUIRED')
 before=metadata(gh,service);spec=SPECS[service];path=target/'original.zip'
 fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb')as sink:
  size,digest,_=stream([gh,'api','repos/'+REPO+'/actions/artifacts/'+str(spec['id'])+'/zip'],spec['zipBytes'],900,sink)
  sink.flush();os.fsync(sink.fileno())
 need(size==spec['zipBytes']and digest==spec['zipSha256'],'ORIGINAL_ZIP_HASH')
 after=metadata(gh,service);need(before==after,'ARTIFACT_CHANGED_DURING_READ')
 receipt={'kind':'cn-historical-original-zip-preservation-v1','service':service,'sourceRevision':SOURCE,'producerControlRevision':CONTROL,'producerRunId':RUN,'producerRunAttempt':1,'originalMetadata':before,'zipBytes':size,'zipSha256':digest,'originalCandidateSetExpiresAt':'2026-10-11T15:12:35.570854+00:00','productionReady':False,'releaseReady':False,'proofRefreshed':False,'imageLoaded':False,'ghExecutableSha256':hashlib.sha256(Path(gh).read_bytes()).hexdigest()}
 private_file(target/'receipt.json',canonical(receipt))
 with open(os.environ['GITHUB_OUTPUT'],'a')as f:f.write('directory='+str(target)+'\n')
 print(json.dumps({'service':service,'zipBytes':size,'zipSha256':digest,'preservedLocally':True,'uploaded':False,'productionReady':False}))
def cleanup(service):
 target=folder(service);st=target.lstat();need(stat.S_ISDIR(st.st_mode)and st.st_uid==os.geteuid()and stat.S_IMODE(st.st_mode)==0o700,'OWNED_DIRECTORY')
 need({x.name for x in target.iterdir()}=={'original.zip','receipt.json'},'OWNED_FILE_SET')
 for p in target.iterdir():
  s=p.lstat();need(stat.S_ISREG(s.st_mode)and s.st_uid==os.geteuid()and s.st_nlink==1 and stat.S_IMODE(s.st_mode)==0o600,'OWNED_FILE')
 receipt=json.loads((target/'receipt.json').read_bytes());spec=SPECS[service]
 need(receipt.get('service')==service and receipt.get('zipSha256')==spec['zipSha256'] and (target/'original.zip').stat().st_size==spec['zipBytes'],'CLEANUP_IDENTITY')
 (target/'original.zip').unlink();(target/'receipt.json').unlink();target.rmdir()
def main():
 p=argparse.ArgumentParser();p.add_argument('mode',choices=['acquire','cleanup']);p.add_argument('--service',choices=list(SPECS),required=True);a=p.parse_args()
 try:(acquire if a.mode=='acquire'else cleanup)(a.service);return 0
 except Exception:print(json.dumps({'status':'FAILED_NO_RETRY','productionReady':False}));return 1
if __name__=='__main__':raise SystemExit(main())
