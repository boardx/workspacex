#!/usr/bin/env python3
"""Explicit build-only tool binding; never authorizes prepare or activation."""
import datetime,fcntl,hashlib,json,os,pathlib,re,stat,subprocess,sys,tempfile,uuid
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
def trust_git_root(root,bare,expected_uid=0,boundary=None):
 root=pathlib.Path(root)
 for p in (root,*root.parents):
  if boundary is not None and p==pathlib.Path(boundary).parent:break
  st=p.lstat();require(stat.S_ISDIR(st.st_mode) and st.st_uid==expected_uid and not st.st_mode&0o022,'GIT_ROOT_TRUST')
 gitdir=root if bare else root/'.git'
 st=gitdir.lstat();require(stat.S_ISDIR(st.st_mode) and st.st_uid==expected_uid and not st.st_mode&0o022,'GIT_DIRECTORY_REQUIRED')
 for name in ('commondir','gitdir','objects/info/alternates'):
  require(not os.path.lexists(gitdir/name),'GIT_EXTERNAL_DIRECTORY')
 for name in ('objects','refs'):
  st=(gitdir/name).lstat();require(stat.S_ISDIR(st.st_mode),'GIT_CLOSURE_DIRECTORY')
 for directory,dirs,files in os.walk(gitdir,followlinks=False):
  for name in dirs+files:
   path=pathlib.Path(directory)/name;st=path.lstat()
   require(st.st_uid==expected_uid and not st.st_mode&0o022 and (stat.S_ISDIR(st.st_mode) or stat.S_ISREG(st.st_mode)),'GIT_MEMBER_TRUST')
   if stat.S_ISREG(st.st_mode):require(st.st_nlink==1,'GIT_MEMBER_HARDLINK')
 for name in ('config','HEAD'):
  st=(gitdir/name).lstat();require(stat.S_ISREG(st.st_mode) and st.st_uid==expected_uid and st.st_nlink==1 and not st.st_mode&0o022,'GIT_IDENTITY_FILE_TRUST')
 fd=os.open(gitdir/'config',os.O_RDONLY|os.O_NOFOLLOW)
 with os.fdopen(fd,'rb') as f:config=f.read()
 require(not re.search(rb'^\s*\[include(?:if)?[\s\]]',config,re.M|re.I),'GIT_CONFIG_INCLUDE')
 return gitdir
GIT_OPTIONS=['-c','core.fsmonitor=false','-c','core.hooksPath=/dev/null','-c','core.untrackedCache=false','-c','gc.auto=0']
def validate_full_prebuild(validator,prebuild_raw,validated_raw):
 # Execute the exact already hash-bound tool validator, not a second gate implementation.
 namespace={'__name__':'reviewed_preflight_validator','__file__':str(validator)}
 exec(compile(private_read(validator).decode(),str(validator),'exec'),namespace)
 result=namespace['validate'](json.loads(prebuild_raw));stored=json.loads(validated_raw)
 require(result==stored and result.get('schemaVersion')==2 and result.get('phase')=='prebuild' and result.get('ready') is True and result.get('blockers')==[],'FULL_PREBUILD_VALIDATION')
 return result

def atomic_receipt(output,result):
 output=pathlib.Path(output);parent=output.parent
 for d in (parent,*parent.parents):
  st=d.lstat();require(stat.S_ISDIR(st.st_mode) and st.st_uid==0 and not st.st_mode&0o022,'RECEIPT_PARENT_TRUST')
 raw=(json.dumps(result,sort_keys=True)+'\n').encode();temporary=parent/('.build-only.'+uuid.uuid4().hex+'.tmp')
 fd=os.open(temporary,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600);identity=os.fstat(fd)
 try:
  with os.fdopen(fd,'wb') as f:f.write(raw);f.flush();os.fsync(f.fileno())
  os.link(temporary,output,follow_symlinks=False) # atomic EXCL, existing final is never replaced
  directory=os.open(parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
  try:os.fsync(directory)
  finally:os.close(directory)
 finally:
  st=temporary.lstat()
  if (st.st_dev,st.st_ino)==(identity.st_dev,identity.st_ino):temporary.unlink()
 require(private_read(output,0o600)==raw,'RECEIPT_READBACK')
 return hashlib.sha256(raw).hexdigest()
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
def sealed_receipt(binding,manifest_raw,seal_raw,prebuild_raw,inspect,validate_prebuild):
 manifest=json.loads(manifest_raw);seal=json.loads(seal_raw);prebuild=json.loads(prebuild_raw)
 app=binding['applicationRevision']
 require(manifest.get('sourceRevision')==app and manifest.get('release')==binding['release'],'MANIFEST_APPLICATION_IDENTITY')
 require(seal.get('schemaVersion')==1 and seal.get('status')=='sealed' and seal.get('sourceRevision')==app and seal.get('manifestSha256')==hashlib.sha256(manifest_raw).hexdigest(),'SEAL_BINDING')
 full=validate_prebuild(prebuild_raw)
 require(full.get('ready') is True and full.get('blockers')==[] and full.get('schemaVersion')==2,'FULL_PREBUILD_VALIDATION')
 require(full.get('phase')=='prebuild' and full.get('sourceSha')==app and full.get('release')==binding['release'] and full.get('attemptId')==binding['attemptId'],'PREBUILD_IDENTITY')
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
 trust_git_root(root,False)
 source=value['applicationSource'];repo=pathlib.Path(source['path']);trust_git_root(repo,True)
 def git(*args):return subprocess.check_output(['git',*GIT_OPTIONS,'-C',root,*args],env=env,stderr=subprocess.DEVNULL)
 require(git('rev-parse','HEAD').decode().strip()==value['toolRevision'] and not git('status','--porcelain'),'TOOL_HEAD_DIRTY')
 for name,installed in FILES.items():
  raw=private_read(pathlib.Path(root)/name);actual=hashlib.sha256(raw).hexdigest()
  require(actual==value['filesSha256'][name] and raw==git('show',value['toolRevision']+':'+name),'TOOL_OBJECT_DRIFT')
  if installed:require(private_read(installed)==raw,'INSTALLED_TOOL_DRIFT')
 for d in (repo,*repo.parents):
  st=d.lstat();require(stat.S_ISDIR(st.st_mode) and st.st_uid==0 and not st.st_mode&0o022,'APPLICATION_CACHE_TRUST')
 require(not (repo/'objects/info/alternates').exists() and not list((repo/'objects/pack').glob('*.promisor')),'APPLICATION_BORROWED_OBJECTS')
 def source_git(*args):return subprocess.check_output(['git',*GIT_OPTIONS,'-C',str(repo),*args],env=env,stderr=subprocess.DEVNULL)
 require(source_git('rev-parse','--is-bare-repository').strip()==b'true' and source_git('rev-parse',source['ref']+'^{commit}').decode().strip()==app and source_git('rev-parse',app+'^{tree}').decode().strip()==source['treeSha'],'APPLICATION_SOURCE_IDENTITY')
 config=subprocess.run(['git',*GIT_OPTIONS,'-C',str(repo),'config','--local','--get-regexp','remote\\..*\\.promisor|extensions\\.partialclone'],env=env,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL)
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
  validated=str(pathlib.Path(prebuild).with_name('prebuild.validated.json'))
  prebuild_raw=private_read(prebuild,0o600);validated_raw=private_read(validated,0o600)
  def validate_bound(raw):return validate_full_prebuild(pathlib.Path(root)/'.agents/skills/workspacex-cn-release/scripts/validate_preflight.py',raw,validated_raw)
  def inspect(image):return subprocess.check_output(['docker','buildx','imagetools','inspect',image],stderr=subprocess.DEVNULL,timeout=30).decode()
  result=sealed_receipt(value,private_read(manifest),private_read(seal),prebuild_raw,inspect,validate_bound)
  result['toolBindingSha256']=hashlib.sha256(private_read(path,0o600)).hexdigest()
  result['validatedPrebuildSha256']=hashlib.sha256(validated_raw).hexdigest()
  result['prebuildReceiptSha256']=json.loads(validated_raw)['receiptSha256']
  atomic_receipt(output,result)
  print('CN_BUILD_ONLY_SEALED_RECEIPT ready=false')
 else:print(source['path'] if source_mode else root)
if __name__=='__main__':
 try:main()
 except BaseException:print('CN_BUILD_TOOL_IDENTITY_REJECTED',file=sys.stderr);sys.exit(1)
