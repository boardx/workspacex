#!/usr/bin/env python3
"""DRAFT trusted import wrapper. Never execute/install without controlled review.
Compatibility: promotion keeps exact source/installed privileged-tool comparison.
A1 remains a runtime baseline; its older deploy script cannot satisfy this new
import-guard tool identity. Use a reviewed candidate containing matching control
sources and a controlled installation; never waive the existing drift check.
"""
import argparse
from contextlib import contextmanager
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import tempfile

ROOT='/usr/local/lib/workspacex-cn'
RUNTIME=Path('/var/lib/workspacex-cn/runtime')
RELEASES=Path('/etc/workspacex-cn/releases')
CONFIG=Path('/etc/workspacex-cn/hosted-import-control.json')
TOOLS={'validator':ROOT+'/verify-hosted-handoff.py','producer':ROOT+'/hosted-release.py','canonicalVerifier':ROOT+'/canonical_control.py','preflight':ROOT+'/verify-cn-release-preflight.sh','maintenanceHold':ROOT+'/cn_maintenance_hold.py','importer':'/usr/local/bin/workspacex-cn-import-hosted-artifacts'}
FILES=('plan.json','sealed/build-input.json','sealed/release.json','sealed/release.sealed.json','sealed/artifact-build.json')

def require(value,code):
 if not value:raise ValueError(code)
def sha(value):return hashlib.sha256(value).hexdigest()
def protected(path,mode=0o600):
 path=Path(path)
 for parent in [path.parent,*path.parent.parents]:
  s=parent.lstat();require(stat.S_ISDIR(s.st_mode) and s.st_uid==0 and s.st_mode&0o022==0,'UNTRUSTED_PARENT')
 s=path.lstat();modes=mode if isinstance(mode,tuple) else (mode,)
 require(stat.S_ISREG(s.st_mode) and (s.st_uid,s.st_gid,s.st_nlink)==(0,0,1) and stat.S_IMODE(s.st_mode) in modes,'UNTRUSTED_FILE')
 return path.read_bytes()
def read_json(path):return json.loads(protected(path))

def transact(identity,ops):
 """Injectable operation boundary; validation and prebuild precede publication."""
 with ops.lock():
  ops.admit_maintenance()
  evidence,manifest,seal=ops.validate(identity)
  require(all(evidence[k]==identity[k] for k in ('sourceRevision','release','attemptId')),'IMPORT_IDENTITY_MISMATCH')
  require(sha(manifest)==evidence['manifestSha256'] and sha(seal)==evidence['sealSha256'],'IMPORT_ARTIFACT_MISMATCH')
  marker={'schemaVersion':1,'stage':'hosted-protected-artifact-import','state':'pending',**identity,'manifestSha256':sha(manifest),'sealSha256':sha(seal),'expectedInputSha256':evidence['expectedInputSha256'],'canonicalControlSha256':evidence['canonicalControlSha256'],'canonicalVerifierSha256':evidence['canonicalVerifierSha256'],'prepared':False,'productionActivated':False}
  # Exact candidate checkout/config context is restored before import completion.
  # Any restoration failure retains a pending/reconciliation marker.
  with ops.candidate_context(identity,marker):
   # Verify the ORIGINAL before-build protected receipt. Never refresh it here.
   ops.preflight('prebuild',identity)
   repeated,repeated_manifest,repeated_seal=ops.validate(identity)
   require(repeated_manifest==manifest and repeated_seal==seal and repeated['receiptSha256']==evidence['receiptSha256'],'IMPORT_CHANGED_AFTER_PREFLIGHT')
   ops.begin(marker)
   ops.publish('manifest',manifest)
   ops.publish('seal',seal)
   ops.verify_published(marker)
   ops.preflight('preactivate',identity)
  marker['state']='complete'
  ops.complete(marker)
  return marker

def prebuild(identity,ops):
 """Run before hosted build; postbuild import only verifies this original receipt."""
 marker={'schemaVersion':1,'stage':'hosted-protected-artifact-import','state':'pending',**identity,'prepared':False,'productionActivated':False}
 with ops.lock():
  ops.admit_maintenance()
  with ops.candidate_context(identity,marker):
   ops.preflight('prebuild',identity,collect=True)

def verify_marker(marker,manifest,seal,revision,attempt):
 require(marker.get('schemaVersion')==1 and marker.get('stage')=='hosted-protected-artifact-import' and marker.get('state')=='complete','HOSTED_IMPORT_NOT_COMPLETE')
 require(marker.get('sourceRevision')==revision and marker.get('attemptId')==attempt and marker.get('prepared') is False and marker.get('productionActivated') is False,'HOSTED_IMPORT_IDENTITY_MISMATCH')
 require(sha(manifest)==marker.get('manifestSha256') and sha(seal)==marker.get('sealSha256'),'HOSTED_IMPORT_ARTIFACT_CHANGED')

class InstalledOperations:
 def __init__(self,identity,bundle):
  self.identity=identity;self.bundle=Path(bundle) if bundle is not None else None;self.revision=identity['sourceRevision'];self.attempt=identity['attemptId'];self.marker=RELEASES/(self.revision+'.hosted-import.json')
  self.manifest=RELEASES/(self.revision+'.json');self.seal=RELEASES/(self.revision+'.sealed.json')
  self.config=read_json(CONFIG)
  require(set(self.config)=={'schemaVersion','toolSha256','controlSha256','collectorSha256'},'IMPORT_CONTROL_FIELDS')
  require(self.config['schemaVersion']==1 and set(self.config['toolSha256'])==set(TOOLS),'IMPORT_CONTROL_TOOLS')
  for key,path in TOOLS.items():require(sha(protected(path,(0o700,0o755)))==self.config['toolSha256'][key],'INSTALLED_TOOL_DRIFT')
  self.collector=ROOT+'/collect-cn-release-preflight.sh';require(sha(protected(self.collector,(0o700,0o755)))==self.config['collectorSha256'],'COLLECTOR_DRIFT')
  self.expected=Path('/etc/workspacex-cn/hosted-imports')/self.revision/self.attempt/'expected.json';self.control=Path(ROOT+'/hosted-control/canonical-control.json')
  expected=read_json(self.expected)
  require(all(expected.get(k)==identity[k] for k in identity),'PROTECTED_EXPECTED_IDENTITY')
  require(expected.get('expectedCanonicalControlSha256')==self.config['controlSha256'] and sha(protected(self.control))==self.config['controlSha256'],'PROTECTED_CONTROL_MISMATCH')
  require(expected.get('expectedPythonToolHash')==self.config['toolSha256']['producer'] and expected.get('expectedCanonicalVerifierHash')==self.config['toolSha256']['canonicalVerifier'],'PROTECTED_EXPECTED_TOOL_MISMATCH')
  runner=protected('/etc/workspacex-cn/runner-user').decode().strip();require(re.fullmatch('[a-z_][a-z0-9_-]*',runner),'RUNNER_IDENTITY_INVALID')
  import pwd
  self.runner_gid=pwd.getpwnam(runner).pw_gid
 def command(self,argv,cwd=None,accepted=(0,),environment=None):
  env={'PATH':'/usr/local/bin:/usr/bin:/bin','HOME':'/root','GIT_CONFIG_NOSYSTEM':'1','GIT_CONFIG_GLOBAL':'/dev/null','GIT_NO_REPLACE_OBJECTS':'1','GIT_NO_LAZY_FETCH':'1'}
  if environment:env.update(environment)
  result=subprocess.run(argv,cwd=cwd,env=env,pass_fds=(9,),stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=300,check=False)
  require(result.returncode in accepted,'PROTECTED_OPERATION_FAILED')
  return result.stdout.decode().strip()
 @contextmanager
 def lock(self):
  root=RUNTIME.lstat();require(stat.S_ISDIR(root.st_mode) and (root.st_uid,root.st_gid,stat.S_IMODE(root.st_mode))==(0,0,0o700),'RUNTIME_UNTRUSTED')
  path=RUNTIME/'release.lock';protected(path)
  fd=os.open(path,os.O_RDWR|os.O_NOFOLLOW)
  try:
   require((os.fstat(fd).st_dev,os.fstat(fd).st_ino)==(path.lstat().st_dev,path.lstat().st_ino),'LOCK_INODE_CHANGED')
   if fd!=9:os.dup2(fd,9,inheritable=True)
   else:os.set_inheritable(9,True)
   fcntl.flock(9,fcntl.LOCK_EX|fcntl.LOCK_NB)
   yield
  finally:
   os.close(9)
   if fd!=9:os.close(fd)
 def admit_maintenance(self):self.command(['/usr/bin/python3',TOOLS['maintenanceHold'],'admit',str(RUNTIME)])
 def validate(self,identity):
  # Snapshot each bounded regular file through O_NOFOLLOW directory descriptors.
  root_fd=os.open(self.bundle,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
  temp=Path(tempfile.mkdtemp(prefix='.hosted-import-',dir=RUNTIME))
  try:
   (temp/'sealed').mkdir(mode=0o700)
   sealed_fd=os.open('sealed',os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=root_fd)
   try:
    for relative in FILES:
     name=relative.split('/')[-1];parent=sealed_fd if '/' in relative else root_fd
     fd=os.open(name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=parent)
     try:
      info=os.fstat(fd);require(stat.S_ISREG(info.st_mode) and info.st_nlink==1 and info.st_size<=4*1024*1024,'UNSAFE_RUNNER_ARTIFACT')
      data=os.read(fd,4*1024*1024+1);require(len(data)==info.st_size and len(data)<=4*1024*1024,'ARTIFACT_SNAPSHOT_CHANGED')
     finally:os.close(fd)
     (temp/relative).write_bytes(data);(temp/relative).chmod(0o600)
   finally:os.close(sealed_fd)
   self.command(['/usr/bin/python3','-I',TOOLS['validator'],'--plan',str(temp/'plan.json'),'--sealed-dir',str(temp/'sealed'),'--expected',str(self.expected),'--control',str(self.control),'--control-sha256',self.config['controlSha256'],'--output',str(temp/'evidence.json')])
   evidence=json.loads((temp/'evidence.json').read_bytes())
   require(evidence.get('handoffValidated') is True and evidence.get('prepared') is False and evidence.get('productionActivated') is False,'IMPORT_VALIDATION_REJECTED')
   return evidence,(temp/'sealed/release.json').read_bytes(),(temp/'sealed/release.sealed.json').read_bytes()
  finally:os.close(root_fd);shutil.rmtree(temp)
 @contextmanager
 def candidate_context(self,identity,marker):
  repository=Path('/opt/workspacex-cn/repository')
  info=repository.lstat();require(stat.S_ISDIR(info.st_mode) and info.st_uid==0 and info.st_mode&0o022==0,'CANDIDATE_REPOSITORY_UNTRUSTED')
  def git(*args,accepted=(0,)):return self.command(['/usr/bin/git','-C',str(repository),*args],accepted=accepted)
  require(git('remote','get-url','origin')=='/opt/workspacex-cn/release-origin-cache.git','CANDIDATE_ORIGIN_UNTRUSTED')
  require(git('status','--porcelain')=='','CANDIDATE_BASELINE_DIRTY')
  baseline=git('rev-parse','HEAD');baseline_ref=git('symbolic-ref','-q','HEAD',accepted=(0,1))
  require(re.fullmatch('[a-f0-9]{40}',baseline),'CANDIDATE_BASELINE_INVALID')
  git('cat-file','-e',identity['sourceRevision']+'^{commit}')
  git('merge-base','--is-ancestor',identity['sourceRevision'],'origin/main')
  changed=False
  try:
   changed=True
   git('checkout','--quiet','--detach',identity['sourceRevision'])
   require(git('rev-parse','HEAD')==identity['sourceRevision'] and git('status','--porcelain')=='','CANDIDATE_CHECKOUT_INVALID')
   self.command(['/usr/bin/corepack','pnpm@9.15.0','--dir',str(repository),'install','--offline','--frozen-lockfile','--ignore-scripts'],environment={'COREPACK_ENABLE_NETWORK':'0'})
   self.command(['/usr/bin/node','--import','tsx','packages/cloud-deploy/src/cn-candidate-config-cli.ts','prepare',identity['sourceRevision'],identity['release'],identity['attemptId']],cwd=repository)
   yield
  finally:
   if changed:
    try:
     git('checkout','--quiet',baseline_ref.removeprefix('refs/heads/')) if baseline_ref else git('checkout','--quiet','--detach',baseline)
     # Restore the baseline dependency graph as well as its Git identity.
     # Candidate node_modules must not survive a supposedly restored checkout.
     self.command(['/usr/bin/corepack','pnpm@9.15.0','--dir',str(repository),'install','--offline','--frozen-lockfile','--ignore-scripts'],environment={'COREPACK_ENABLE_NETWORK':'0'})
     require(git('rev-parse','HEAD')==baseline and git('symbolic-ref','-q','HEAD',accepted=(0,1))==baseline_ref and git('status','--porcelain')=='','CANDIDATE_BASELINE_RESTORE_FAILED')
    except Exception:
     failed=dict(marker,state='candidate-context-reconciliation-required')
     if self.marker.exists():self.complete(failed)
     else:self.write_once(self.marker,json.dumps(failed,sort_keys=True).encode(),0o600)
     raise ValueError('CANDIDATE_BASELINE_RESTORE_FAILED') from None
 def preflight(self,phase,identity,collect=False):
  argv=[phase,identity['sourceRevision'],identity['release'],identity['attemptId']]
  if collect or phase=='preactivate':self.command([self.collector,*argv])
  self.command([TOOLS['preflight'],*argv])
 def write_once(self,path,data,mode,gid=0):
  fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,mode)
  try:
   os.fchown(fd,0,gid);os.fchmod(fd,mode)
   with os.fdopen(fd,'wb',closefd=False) as handle:handle.write(data);handle.flush();os.fsync(fd)
  finally:os.close(fd)
  self.sync_parent(path)
 def sync_parent(self,path):
  fd=os.open(Path(path).parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
  try:os.fsync(fd)
  finally:os.close(fd)
 def begin(self,marker):
  info=RELEASES.lstat();require(stat.S_ISDIR(info.st_mode) and info.st_uid==0 and info.st_mode&0o022==0,'RELEASES_UNTRUSTED')
  require(not self.manifest.exists() and not self.seal.exists(),'ARTIFACT_ALREADY_EXISTS_RECONCILE')
  self.write_once(self.marker,json.dumps(marker,sort_keys=True).encode(),0o600)
 def publish(self,kind,data):self.write_once(self.manifest if kind=='manifest' else self.seal,data,0o640,self.runner_gid)
 def verify_published(self,marker):
  for path,key in ((self.manifest,'manifestSha256'),(self.seal,'sealSha256')):
   info=path.lstat();require(stat.S_ISREG(info.st_mode) and (info.st_uid,info.st_gid,stat.S_IMODE(info.st_mode),info.st_nlink)==(0,self.runner_gid,0o640,1) and sha(path.read_bytes())==marker[key],'PUBLISHED_ARTIFACT_MISMATCH')
 def complete(self,marker):
  temporary=self.marker.with_suffix('.complete.tmp')
  self.write_once(temporary,json.dumps(marker,sort_keys=True).encode(),0o600)
  os.replace(temporary,self.marker);self.sync_parent(self.marker)

def guard(revision,attempt):
 path=RELEASES/(revision+'.hosted-import.json')
 if not path.exists() and not path.is_symlink():return # ordinary publisher unchanged
 marker=read_json(path)
 verify_marker(marker,(RELEASES/(revision+'.json')).read_bytes(),(RELEASES/(revision+'.sealed.json')).read_bytes(),revision,attempt)

def main():
 require(os.geteuid()==0,'ROOT_REQUIRED')
 parser=argparse.ArgumentParser();parser.add_argument('--verify-import',action='store_true');parser.add_argument('--prebuild',action='store_true');parser.add_argument('source');parser.add_argument('attempt');parser.add_argument('--release');parser.add_argument('--bundle')
 a=parser.parse_args();require(re.fullmatch('[a-f0-9]{40}',a.source) and re.fullmatch('[a-z0-9][a-z0-9._-]{0,127}',a.attempt),'INPUT_IDENTITY_INVALID')
 if a.verify_import:guard(a.source,a.attempt);print('HOSTED_IMPORT_GUARD_PASSED');return
 require(not(a.prebuild and a.verify_import),'INVALID_MODE')
 require(a.release is not None and (a.bundle is not None or a.prebuild) and re.fullmatch(r'v?\d+\.\d+\.\d+(?:-[a-zA-Z0-9]+(?:[.-][a-zA-Z0-9]+)*)?',a.release),'RELEASE_INPUT_REQUIRED')
 identity={'sourceRevision':a.source,'release':a.release,'attemptId':a.attempt};ops=InstalledOperations(identity,a.bundle)
 if a.prebuild:
  prebuild(identity,ops);print('HOSTED_REAL_PROTECTED_PREBUILD_COMPLETE');return
 transact(identity,ops);print('HOSTED_PROTECTED_ARTIFACT_IMPORT_COMPLETE_NOT_PREPARED')
if __name__=='__main__':
 try:main()
 except (ValueError,OSError,TypeError,KeyError,subprocess.SubprocessError):print('HOSTED_PROTECTED_ARTIFACT_IMPORT_REJECTED',file=sys.stderr);sys.exit(1)
