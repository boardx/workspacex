#!/usr/bin/env python3
"""Explicit build-only tool binding; never authorizes prepare or activation."""
import datetime,fcntl,hashlib,json,os,pathlib,re,stat,subprocess,sys
FILES={
 '.harness/scripts/vm/build-cn-release-candidate.sh':'/usr/local/bin/workspacex-cn-build-candidate',
 '.harness/scripts/vm/deploy-cn-production.sh':'/usr/local/bin/workspacex-cn-deploy',
 '.harness/scripts/vm/publish-cn-release.sh':'/usr/local/lib/workspacex-cn/publish-cn-release.sh',
 '.harness/scripts/vm/verify-cn-release-preflight.sh':'/usr/local/lib/workspacex-cn/verify-cn-release-preflight.sh',
 '.harness/scripts/vm/collect-cn-release-preflight.sh':'/usr/local/lib/workspacex-cn/collect-cn-release-preflight.sh',
 '.harness/scripts/vm/cn-release-preflight-evidence.mjs':'/usr/local/lib/workspacex-cn/cn-release-preflight-evidence.mjs',
 '.harness/scripts/vm/cn-release-orphans.py':'/usr/local/lib/workspacex-cn/cn-release-orphans.py',
 '.harness/scripts/vm/cn-bootstrap-source-probe.mjs':'/usr/local/lib/workspacex-cn/cn-bootstrap-source-probe.mjs',
 '.harness/scripts/vm/cn-build-tool-identity.py':'/usr/local/lib/workspacex-cn/cn-build-tool-identity.py',
 '.agents/skills/workspacex-cn-release/scripts/validate_preflight.py':None,
}
def require(value,code):
 if not value:raise ValueError(code)
def private_read(path,mode=None):
 p=pathlib.Path(path)
 for parent in p.parents:
  s=parent.lstat();require(stat.S_ISDIR(s.st_mode) and s.st_uid==0 and not s.st_mode&0o022,'TOOL_PARENT_TRUST')
 fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW)
 with os.fdopen(fd,'rb') as f:
  s=os.fstat(f.fileno());require(stat.S_ISREG(s.st_mode) and s.st_uid==0 and s.st_nlink==1 and not s.st_mode&0o022 and (mode is None or stat.S_IMODE(s.st_mode)==mode),'TOOL_FILE_TRUST')
  raw=f.read();a=os.fstat(f.fileno());require((s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns)==(a.st_dev,a.st_ino,a.st_size,a.st_mtime_ns,a.st_ctime_ns),'TOOL_FILE_CHANGED');return raw
def validate_identity(value,app,release,attempt,phase):
 require(phase=='prebuild','BUILD_ONLY_PHASE')
 require(value.get('schemaVersion')==1 and value.get('mode')=='build-only','BUILD_ONLY_MANIFEST')
 require(value.get('applicationRevision')==app and value.get('release')==release and value.get('attemptId')==attempt,'APPLICATION_BINDING')
 tool=value.get('toolRevision');require(isinstance(tool,str) and re.fullmatch('[a-f0-9]{40}',tool),'TOOL_REVISION')
 require(value.get('toolRoot')=='/opt/workspacex-cn/release-tools/'+tool,'TOOL_ROOT')
 require(set(value.get('filesSha256',{}))==set(FILES),'TOOL_CLOSURE')
 source=value.get('applicationSource',{})
 require(source.get('path')=='/var/lib/workspacex-cn/build-sources/'+app+'.git' and source.get('ref')=='refs/heads/candidate','APPLICATION_SOURCE_PATH')
 require(re.fullmatch('[a-f0-9]{40}',source.get('treeSha','')) and re.fullmatch('[a-f0-9]{64}',source.get('inventorySha256','')),'APPLICATION_OBJECT_IDENTITIES')
 return value['toolRoot']
def sealed_receipt(binding,manifest_raw,seal_raw,prebuild_raw,inspect):
 manifest=json.loads(manifest_raw);seal=json.loads(seal_raw);prebuild=json.loads(prebuild_raw)
 app=binding['applicationRevision']
 require(manifest.get('sourceRevision')==app and manifest.get('release')==binding['release'],'MANIFEST_APPLICATION_IDENTITY')
 require(seal.get('schemaVersion')==1 and seal.get('status')=='sealed' and seal.get('sourceRevision')==app and seal.get('manifestSha256')==hashlib.sha256(manifest_raw).hexdigest(),'SEAL_BINDING')
 try:
  issued=datetime.datetime.fromisoformat(prebuild['issuedAt'].replace('Z','+00:00'));expires=datetime.datetime.fromisoformat(prebuild['expiresAt'].replace('Z','+00:00'));now=datetime.datetime.now(datetime.timezone.utc)
  require(issued<=now<expires and 0<(expires-issued).total_seconds()<=3600,'PREBUILD_EXPIRED')
 except (KeyError,TypeError):raise ValueError('PREBUILD_TIME_REQUIRED')
 require(prebuild.get('phase')=='prebuild' and prebuild.get('sourceSha')==app and prebuild.get('release')==binding['release'] and prebuild.get('attemptId')==binding['attemptId'],'PREBUILD_IDENTITY')
 bootstrap=prebuild.get('checks',{}).get('bootstrap.compatibility',{})
 meta=bootstrap.get('metadata',{})
 require(bootstrap.get('status')=='passed' and meta.get('evidenceMode')=='source-static' and meta.get('readOnlyTransaction') is False and meta.get('stateClass')=='unknown' and all(meta.get(k) is False for k in ('schemaContract','permissionContract','agentSeedContract')),'STATIC_DYNAMIC_CONFUSION')
 require(set(manifest.get('images',{}))=={'web','api','agent','sandbox','postgres','redis'},'SEALED_SERVICE_CLOSURE')
 digests={}
 for service,artifact in manifest['images'].items():
  image=artifact.get('image','');match=re.fullmatch(r'[a-z0-9][a-z0-9./:_-]*@(sha256:[a-f0-9]{64})',image)
  require(match,'IMMUTABLE_IMAGE_REQUIRED')
  actual=re.search(r'^Digest:\s+(sha256:[a-f0-9]{64})\s*$',inspect(image),re.M)
  require(actual and actual.group(1)==match.group(1),'REGISTRY_DIGEST_MISMATCH');digests[service]=image
 return {'schemaVersion':1,'mode':'build-only','applicationRevision':app,'toolRevision':binding['toolRevision'],'release':binding['release'],'attemptId':binding['attemptId'],'filesSha256':binding['filesSha256'],'applicationSource':binding['applicationSource'],'manifestSha256':hashlib.sha256(manifest_raw).hexdigest(),'sealSha256':hashlib.sha256(seal_raw).hexdigest(),'prebuildSha256':hashlib.sha256(prebuild_raw).hexdigest(),'images':digests,'registryReadbackVerified':True,'prepared':False,'productionActivated':False,'ready':False}
def main():
 receipt_mode=len(sys.argv)>1 and sys.argv[1]=='--receipt'
 source_mode=len(sys.argv)>1 and sys.argv[1]=='--source'
 args=sys.argv[2:] if receipt_mode or source_mode else sys.argv[1:]
 require(os.geteuid()==0 and len(args)==(9 if receipt_mode else 5),'ROOT_ARGUMENTS')
 path,app,release,attempt,phase=args[:5];value=json.loads(private_read(path,0o600));root=validate_identity(value,app,release,attempt,phase)
 env={'PATH':'/usr/bin:/bin','HOME':'/nonexistent','GIT_CONFIG_NOSYSTEM':'1','GIT_CONFIG_GLOBAL':'/dev/null','GIT_NO_LAZY_FETCH':'1','GIT_NO_REPLACE_OBJECTS':'1','GIT_TERMINAL_PROMPT':'0'}
 def git(*args):return subprocess.check_output(['git','-C',root,*args],env=env,stderr=subprocess.DEVNULL)
 require(git('rev-parse','HEAD').decode().strip()==value['toolRevision'] and not git('status','--porcelain'),'TOOL_HEAD_DIRTY')
 for name,installed in FILES.items():
  raw=private_read(pathlib.Path(root)/name);actual=hashlib.sha256(raw).hexdigest()
  require(actual==value['filesSha256'][name] and raw==git('show',value['toolRevision']+':'+name),'TOOL_OBJECT_DRIFT')
  if installed:require(private_read(installed)==raw,'INSTALLED_TOOL_DRIFT')
 source=value['applicationSource'];repo=pathlib.Path(source['path'])
 for d in (repo,*repo.parents):
  st=d.lstat();require(stat.S_ISDIR(st.st_mode) and st.st_uid==0 and not st.st_mode&0o022,'APPLICATION_CACHE_TRUST')
 require(not (repo/'objects/info/alternates').exists() and not list((repo/'objects/pack').glob('*.promisor')),'APPLICATION_BORROWED_OBJECTS')
 def source_git(*args):return subprocess.check_output(['git','-C',str(repo),*args],env=env,stderr=subprocess.DEVNULL)
 require(source_git('rev-parse','--is-bare-repository').strip()==b'true' and source_git('rev-parse',source['ref']+'^{commit}').decode().strip()==app and source_git('rev-parse',app+'^{tree}').decode().strip()==source['treeSha'],'APPLICATION_SOURCE_IDENTITY')
 config=subprocess.run(['git','-C',str(repo),'config','--local','--get-regexp','remote\\..*\\.promisor|extensions\\.partialclone'],env=env,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL)
 require(config.returncode==1 and not config.stdout,'APPLICATION_PARTIAL_CONFIG')
 source_git('fsck','--full','--no-reflogs')
 require(hashlib.sha256(source_git('ls-tree','-r','-z',app)).hexdigest()==source['inventorySha256'],'APPLICATION_INVENTORY_DRIFT')
 if receipt_mode:
  lock='/var/lib/workspacex-cn/runtime/release.lock'
  require(os.readlink('/proc/'+str(os.getppid())+'/fd/9')==lock,'CANONICAL_LOCK_FD')
  fd=os.open(lock,os.O_WRONLY|os.O_NOFOLLOW)
  try:
   try:fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
   except BlockingIOError:pass
   else:raise ValueError('CANONICAL_LOCK_NOT_HELD')
  finally:os.close(fd)
  manifest,seal,prebuild,output=args[5:]
  def inspect(image):return subprocess.check_output(['docker','buildx','imagetools','inspect',image],stderr=subprocess.DEVNULL,timeout=30).decode()
  result=sealed_receipt(value,private_read(manifest),private_read(seal),private_read(prebuild,0o600),inspect)
  result['toolBindingSha256']=hashlib.sha256(private_read(path,0o600)).hexdigest()
  parent=pathlib.Path(output).parent
  for d in (parent,*parent.parents):
   st=d.lstat();require(stat.S_ISDIR(st.st_mode) and st.st_uid==0 and not st.st_mode&0o022,'RECEIPT_PARENT_TRUST')
  fd=os.open(output,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
  with os.fdopen(fd,'w') as f:json.dump(result,f,sort_keys=True);f.write('\n');f.flush();os.fsync(f.fileno())
  print('CN_BUILD_ONLY_SEALED_RECEIPT ready=false')
 else:print(source['path'] if source_mode else root)
if __name__=='__main__':
 try:main()
 except BaseException:print('CN_BUILD_TOOL_IDENTITY_REJECTED',file=sys.stderr);sys.exit(1)
