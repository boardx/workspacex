#!/usr/bin/env python3
"""Fixed installed CLI. Development checkout cannot authorize recovery."""
import fcntl,json,os,pathlib,re,stat,sys
ROOT=pathlib.Path('/usr/local/lib/workspacex-cn')
FILES={'cn-production-rds-identity-probe.py':'cn-production-rds-identity-probe.py','cn_production_recovery_stream.py':'cn_production_recovery_stream.py','cn-production-recovery-executor.py':'cn-production-recovery-executor.py','cn_production_recovery_executor.py':'cn_production_recovery_executor.py','cn_production_recovery_transport.py':'cn_production_recovery_transport.py','recovery-readback.cjs':'cn-production-recovery-readback.cjs','cn-production-recovery-catalog.cjs':'cn-production-recovery-catalog.cjs','cn-production-recovery-fidelity.cjs':'cn-production-recovery-fidelity.cjs'}
def bootstrap():
 # Validate installed Python sources before executing their import-time code.
 if os.geteuid()!=0 or os.getegid()!=0 or pathlib.Path(__file__).resolve()!=ROOT/'cn-production-recovery-executor.py':raise RuntimeError('INSTALLED_ROOT_ENTRYPOINT')
 import hashlib
 def read(path,mode):
  p=pathlib.Path(path)
  for parent in p.parents:
   st=parent.lstat()
   if not stat.S_ISDIR(st.st_mode) or st.st_uid!=0 or st.st_gid!=0 or st.st_mode&0o022:raise RuntimeError('BOOTSTRAP_PARENT')
  fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW)
  with os.fdopen(fd,'rb') as f:
   st=os.fstat(f.fileno())
   if not stat.S_ISREG(st.st_mode) or st.st_uid!=0 or st.st_gid!=0 or st.st_nlink!=1 or stat.S_IMODE(st.st_mode)!=mode:raise RuntimeError('BOOTSTRAP_FILE')
   raw=f.read(1024*1024+1)
   if len(raw)>1024*1024:raise RuntimeError('BOOTSTRAP_BOUND')
   return raw
 profile=json.loads(read('/etc/workspacex-cn/trusted-tool-binding.json',0o600))
 for target in FILES.values():
  if hashlib.sha256(read(ROOT/target,0o700)).hexdigest()!=profile['filesSha256']['.harness/scripts/vm/'+target]:raise RuntimeError('BOOTSTRAP_CLOSURE')
 sys.path.insert(0,str(ROOT))
def load_runtime():
 # Never execute dependency code until installed-source closure is checked.
 # Keep rejection inside the redacted CLI handler and imports inert for review.
 bootstrap()
 global Protected,Executor,Journal,validate,require,sha,Transport
 from cn_production_recovery_executor import Protected,Executor,Journal,validate,require,sha
 from cn_production_recovery_transport import Transport
def require_lock():
 path='/var/lib/workspacex-cn/runtime/release.lock';parent=pathlib.Path(path).parent.lstat()
 require(parent.st_uid==0 and parent.st_gid==0 and stat.S_IMODE(parent.st_mode)==0o700,'CANONICAL_DIRECTORY')
 inherited=os.fstat(9);fd=os.open(path,os.O_RDWR|os.O_NOFOLLOW)
 try:
  actual=os.fstat(fd);require(stat.S_ISREG(actual.st_mode) and actual.st_uid==0 and actual.st_gid==0 and actual.st_nlink==1 and stat.S_IMODE(actual.st_mode)==0o600 and (actual.st_dev,actual.st_ino)==(inherited.st_dev,inherited.st_ino),'CANONICAL_FD9')
  try:fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
  except BlockingIOError:pass
  else:fcntl.flock(fd,fcntl.LOCK_UN);raise RuntimeError('CANONICAL_LOCK_NOT_HELD')
  fcntl.flock(9,fcntl.LOCK_EX|fcntl.LOCK_NB)
 finally:os.close(fd)
def main(args):
 load_runtime()
 require(os.geteuid()==0 and os.getegid()==0,'ROOT_ONLY')
 require(len(args)==2 and args[0] in ('--preflight-capability','--capability-check','--execute-production-recovery'),'USAGE')
 protected=Protected();profile=json.loads(protected.read('/etc/workspacex-cn/trusted-tool-binding.json',private=True))
 require(re.fullmatch('[a-f0-9]{40}',profile['toolRevision']) is not None,'TOOL_REVISION')
 plan_path=pathlib.Path(args[1]);plan=json.loads(protected.read(plan_path,private=True));identity=validate(plan)
 require(plan_path==pathlib.Path('/etc/workspacex-cn/maintenance-recovery')/identity['sourceRevision']/identity['attemptId']/'recovery-plan.json','FIXED_PLAN_PATH')
 require(plan['toolRevision']==profile['toolRevision'],'TOOL_BINDING')
 for source,target in FILES.items():
  expected=profile['filesSha256']['.harness/scripts/vm/'+target];protected.read(ROOT/target,expected)
 require(pathlib.Path(__file__).resolve()==ROOT/'cn-production-recovery-executor.py','INSTALLED_ENTRYPOINT')
 for key,target in [('fidelityRunner','cn-production-recovery-readback.cjs'),('catalogModule','cn-production-recovery-catalog.cjs'),('fidelityModule','cn-production-recovery-fidelity.cjs'),('productionIdentityProbe','cn-production-rds-identity-probe.py')]:require(plan[key]['path']==str(ROOT/target) and plan[key]['sha256']==profile['filesSha256']['.harness/scripts/vm/'+target],'RUNNER_CLOSURE')
 require(plan['writerTransport']['sha256']==profile['filesSha256'][plan['writerTransport']['sourcePath']],'WRITER_TRANSPORT_CLOSURE')
 transport=Transport(protected,require_lock);transport.capability(plan)
 if args[0]=='--preflight-capability':return {'schemaVersion':1,'kind':'production-recovery-preflight','identity':identity,'toolRevision':profile['toolRevision'],'planSha256':sha(protected.read(plan_path,private=True)),'liveWritesHeldProven':False,'ready':False}
 executor=Executor(plan,protected,transport,None);fact=executor.guard()
 if args[0]=='--capability-check':return {'schemaVersion':1,'kind':'production-recovery-capability','identity':identity,'toolRevision':profile['toolRevision'],'guard':fact,'planSha256':sha(protected.read(plan_path,private=True)),'ready':False}
 journal=Journal(plan_path.parent/'production-recovery-journal.json',identity);executor.journal=journal
 result=executor.run();raw=json.dumps(result,sort_keys=True).encode()
 # Result artifact is journaled; never public-print catalog facts or object keys.
 journal.record('receipt-intent',receiptSha256=sha(raw));out=plan_path.parent/'production-recovery-result.json'
 fd=os.open(out,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb') as f:f.write(raw);f.flush();os.fsync(f.fileno())
 directory=os.open(out.parent,os.O_RDONLY|os.O_DIRECTORY)
 try:os.fsync(directory)
 finally:os.close(directory)
 executor.guard();journal.record('receipt-durable',receiptSha256=sha(raw))
 return {'schemaVersion':1,'kind':'production-recovery-completed','identity':identity,'receiptSha256':sha(raw),'writesHeld':True,'ready':False}
if __name__=='__main__':
 try:print(json.dumps(main(sys.argv[1:]),sort_keys=True))
 except BaseException:print(json.dumps({'error':'PRODUCTION_RECOVERY_REJECTED','writesHeld':True,'ready':False}));sys.exit(1)
