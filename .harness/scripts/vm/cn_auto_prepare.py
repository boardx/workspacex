#!/usr/bin/env python3
"""Bounded root dispatcher for a once-installed, source-pinned real host provider.
No provider/policy means NOT_READY. This dispatcher itself does not attest that a
backup, restore, browser or cleanup happened: the pinned provider must execute it.
Its complete stage output remains subject to the TS receipt-builder contract.
"""
import datetime,fcntl,hashlib,json,os,pathlib,re,signal,stat,subprocess,sys,tempfile,time
POLICY='/etc/workspacex-cn/auto-preparation-policy.json'
PROVIDER='/usr/local/lib/workspacex-cn/cn_auto_prepare_provider.py'
ROOT='/var/lib/workspacex-cn/auto-preparation'
LOCK='/var/lib/workspacex-cn/runtime/release.lock'
ACTIVE=None
def terminate(signum,frame):
 if ACTIVE is not None:
  try:os.killpg(ACTIVE.pid,signal.SIGKILL)
  except ProcessLookupError:pass
  ACTIVE.wait()
 raise NotReady('INTERRUPTED_PROVIDER_JOINED')
STAGES=('backup','restoreIsolated','shadowReadiness','shadowBusiness','cleanupIsolated')
class NotReady(RuntimeError):pass
def require(value,code):
 if not value:raise NotReady(code)
def private(path,mode=0o600,*,uid=0,boundary='/'):
 p=pathlib.Path(path);require(p.is_absolute() and '..' not in p.parts,'PRIVATE_PATH')
 for parent in p.parents:
  s=parent.lstat();require(stat.S_ISDIR(s.st_mode) and not stat.S_ISLNK(s.st_mode) and s.st_uid==uid and not s.st_mode&0o022,'PRIVATE_PARENT')
  if str(parent)==boundary:break
 fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
 with os.fdopen(fd,'rb') as f:
  s=os.fstat(f.fileno());require(stat.S_ISREG(s.st_mode) and s.st_uid==uid and s.st_gid==uid and s.st_nlink==1 and stat.S_IMODE(s.st_mode)==mode and s.st_size<=16*1024*1024,'PRIVATE_FILE')
  value=f.read(16*1024*1024+1);end=os.fstat(f.fileno());live=p.lstat()
  require((s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns)==(end.st_dev,end.st_ino,end.st_size,end.st_mtime_ns,end.st_ctime_ns) and (s.st_dev,s.st_ino)==(live.st_dev,live.st_ino),'PRIVATE_CHANGED')
  return value

def validate(request,stage,policy):
 require(stage in STAGES and set(request)=={'identity','images','migrationPlanSha256','dependencies'},'REQUEST')
 i=request['identity'];require(set(i)=={'sourceRevision','baselineSourceRevision','baselineSha256','release','attemptId'},'IDENTITY')
 require(all(re.fullmatch('[a-f0-9]{40}',i[k]) for k in ('sourceRevision','baselineSourceRevision')) and re.fullmatch('[a-f0-9]{64}',i['baselineSha256']) and re.fullmatch('[a-z0-9][a-z0-9._-]{0,127}',i['attemptId']) and re.fullmatch(r'v?\d+\.\d+\.\d+(?:-[a-zA-Z0-9]+(?:[.-][a-zA-Z0-9]+)*)?',i['release']),'IDENTITY')
 require(set(request['images'])=={'api','web','agent','sandbox'} and all(re.fullmatch('sha256:[a-f0-9]{64}',v) for v in request['images'].values()) and re.fullmatch('[a-f0-9]{64}',request['migrationPlanSha256']) and isinstance(request['dependencies'],dict) and all(re.fullmatch('[a-f0-9]{64}',v) for v in request['dependencies'].values()),'BINDINGS')
 require(set(policy)=={'schemaVersion','kind','toolRevision','provider','environment','timeouts'} and policy['schemaVersion']==1 and policy['kind']=='cn-auto-preparation-host-policy' and re.fullmatch('[a-f0-9]{40}',policy['toolRevision']),'POLICY')
 require(policy['provider']['path']==PROVIDER and set(policy['provider'])=={'path','sha256'} and re.fullmatch('[a-f0-9]{64}',policy['provider']['sha256']),'PROVIDER')
 require(set(policy['timeouts'])==set(STAGES) and all(type(n) is int and 1<=n<=1800 for n in policy['timeouts'].values()),'TIMEOUT_POLICY')
 require(isinstance(policy['environment'],dict) and policy['environment'],'ENVIRONMENT_POLICY')

def require_lock():
 require(os.readlink('/proc/self/fd/9')==LOCK,'LOCK_DESCRIPTOR')
 s=os.stat(9);require(stat.S_ISREG(s.st_mode) and (s.st_uid,s.st_gid,stat.S_IMODE(s.st_mode),s.st_nlink)==(0,0,0o600,1),'LOCK_FILE')
 with open(LOCK,'r+b') as other:
  try:fcntl.flock(other,fcntl.LOCK_EX|fcntl.LOCK_NB)
  except BlockingIOError:return
  fcntl.flock(other,fcntl.LOCK_UN);raise NotReady('LOCK_NOT_HELD')

def bounded(argv,payload,seconds):
 global ACTIVE
 # Bound only provider stdout/stderr, never the actual encrypted backup files.
 # A global RLIMIT_FSIZE would silently cap every production dump as well.
 with tempfile.TemporaryFile() as out,tempfile.TemporaryFile() as err,tempfile.TemporaryFile() as inp:
  inp.write(json.dumps(payload).encode());inp.seek(0)
  p=subprocess.Popen(argv,stdin=inp,stdout=out,stderr=err,start_new_session=True,pass_fds=(9,),env={'PATH':'/usr/local/bin:/usr/bin:/bin','HOME':'/nonexistent','LANG':'C.UTF-8'})
  ACTIVE=p;deadline=time.monotonic()+seconds
  while p.poll() is None:
   code='PROVIDER_OUTPUT_BOUND' if os.fstat(out.fileno()).st_size>16*1024*1024 or os.fstat(err.fileno()).st_size>1024*1024 else 'PROVIDER_TIMEOUT_JOINED' if time.monotonic()>=deadline else None
   if code:
    try:os.killpg(p.pid,signal.SIGKILL)
    except ProcessLookupError:pass
    p.wait();raise NotReady(code)
   time.sleep(.01)
  ACTIVE=None
  require(p.returncode==0,'PROVIDER_REJECTED')
  require(out.tell()<=16*1024*1024 and err.tell()<=1024*1024,'PROVIDER_OUTPUT_BOUND')
  out.seek(0);return out.read()

def verify_stage_refs(refs,directory):
 # Re-read actual provider artifacts, including large encrypted dumps, without
 # loading them into JSON memory or trusting a provider-supplied hash alone.
 require(isinstance(refs,list) and 0<len(refs)<=128,'RAW_REFERENCES')
 seen=set()
 for ref in refs:
  require(isinstance(ref,dict) and set(ref)=={'path','sha256'} and isinstance(ref['path'],str) and re.fullmatch('[a-f0-9]{64}',ref.get('sha256','')),'RAW_REFERENCE')
  p=pathlib.Path(ref['path']);require(p.is_absolute() and '..' not in p.parts and p not in seen,'RAW_REFERENCE_PATH');seen.add(p)
  try:parts=p.relative_to(directory).parts
  except ValueError:raise NotReady('RAW_REFERENCE_SCOPE')
  require(bool(parts),'RAW_REFERENCE_SCOPE');parent=os.open(directory,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
  try:
   for part in parts[:-1]:
    child=os.open(part,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=parent);s=os.fstat(child)
    require(s.st_uid==os.geteuid() and not s.st_mode&0o022,'RAW_REFERENCE_PARENT');os.close(parent);parent=child
   fd=os.open(parts[-1],os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=parent)
   with os.fdopen(fd,'rb') as f:
    before=os.fstat(f.fileno());limit=64*1024**3 if p.name.endswith('.dump.cms') else 16*1024**2
    require(stat.S_ISREG(before.st_mode) and before.st_uid==os.geteuid() and before.st_gid==os.getegid() and stat.S_IMODE(before.st_mode)==0o600 and before.st_nlink==1 and 0<before.st_size<=limit,'RAW_REFERENCE_FILE')
    digest=hashlib.sha256();count=0
    while True:
     chunk=f.read(1024*1024)
     if not chunk:break
     digest.update(chunk);count+=len(chunk);require(count<=limit,'RAW_REFERENCE_BOUND')
    after=os.fstat(f.fileno());live=os.stat(parts[-1],dir_fd=parent,follow_symlinks=False)
    attrs=lambda s:(s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
    require(attrs(before)==attrs(after)==attrs(live) and count==before.st_size and digest.hexdigest()==ref['sha256'],'RAW_REFERENCE_HASH_OR_CHANGED')
  finally:os.close(parent)

def dispatch(request,stage,read=private,run=bounded,policy_path=POLICY,root=ROOT):
 policy_bytes=read(policy_path);policy=json.loads(policy_bytes);validate(request,stage,policy)
 require(hashlib.sha256(read(PROVIDER,0o700)).hexdigest()==policy['provider']['sha256'],'PROVIDER_SOURCE')
 directory=pathlib.Path(root)/request['identity']['sourceRevision']/request['identity']['attemptId']
 # Production parents are pre-installed root private; never create arbitrary roots.
 parent=pathlib.Path(root);s=parent.lstat();require(stat.S_ISDIR(s.st_mode) and s.st_uid==os.geteuid() and stat.S_IMODE(s.st_mode)==0o700,'OUTPUT_ROOT')
 for p in (directory.parent,directory):
  try:p.mkdir(mode=0o700)
  except FileExistsError:pass
  s=p.lstat();require(stat.S_ISDIR(s.st_mode) and s.st_uid==os.geteuid() and stat.S_IMODE(s.st_mode)==0o700,'OUTPUT_DIRECTORY')
 target=directory/(stage+'.json')
 require(not target.exists() and not target.is_symlink(),'EXISTING_STAGE_RECONCILIATION_REQUIRED')
 intent=directory/(stage+'.intent.json')
 try:intent_fd=os.open(intent,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 except FileExistsError:raise NotReady('EXISTING_INTENT_RECONCILIATION_REQUIRED')
 with os.fdopen(intent_fd,'wb') as f:f.write(json.dumps(request,sort_keys=True).encode());f.flush();os.fsync(f.fileno())
 output=run(['/usr/bin/python3','-I','-S','-B',PROVIDER,'--stage',stage],{'request':request,'policy':policy,'policySha256':hashlib.sha256(policy_bytes).hexdigest()},policy['timeouts'][stage])
 result=json.loads(output)
 require(isinstance(result,dict),'PROVIDER_RECORD')
 require(result.get('schemaVersion')==1 and result.get('kind')=='cn-auto-preparation-stage' and result.get('stage')==stage and all(result.get(k)==request[k] for k in ('identity','images','migrationPlanSha256','dependencies')),'PROVIDER_IDENTITY')
 now=datetime.datetime.now(datetime.timezone.utc).timestamp()
 start=datetime.datetime.fromisoformat(result['issuedAt'].replace('Z','+00:00')).timestamp();end=datetime.datetime.fromisoformat(result['expiresAt'].replace('Z','+00:00')).timestamp()
 require(start<=now<end and 0<end-start<=3600 and isinstance(result.get('facts'),dict) and bool(result.get('refs')),'PROVIDER_EVIDENCE')
 verify_stage_refs(result['refs'],directory)
 target=directory/(stage+'.json')
 try:fd=os.open(target,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 except FileExistsError:raise NotReady('EXISTING_STAGE_RECONCILIATION_REQUIRED')
 with os.fdopen(fd,'wb') as f:f.write(output);f.flush();os.fsync(f.fileno())
 directory_fd=os.open(directory,os.O_RDONLY|os.O_DIRECTORY)
 try:os.fsync(directory_fd)
 finally:os.close(directory_fd)
 return {'path':str(target),'sha256':hashlib.sha256(output).hexdigest()}

def main():
 require(os.geteuid()==0 and os.getegid()==0 and sys.platform=='linux','ROOT_LINUX_REQUIRED')
 for sig in (signal.SIGTERM,signal.SIGINT,signal.SIGHUP):signal.signal(sig,terminate)
 require(len(sys.argv)==3 and sys.argv[1]=='--stage','USAGE');require_lock()
 raw=sys.stdin.buffer.read(65537);require(len(raw)<=65536,'REQUEST_BOUND')
 print(json.dumps(dispatch(json.loads(raw),sys.argv[2]),sort_keys=True))
if __name__=='__main__':
 try:main()
 except BaseException as error:
  code=str(error) if isinstance(error,NotReady) else 'POLICY_OR_PROVIDER_UNAVAILABLE'
  print('CN_AUTO_PREPARATION_NOT_READY:'+code,file=sys.stderr);sys.exit(3)
