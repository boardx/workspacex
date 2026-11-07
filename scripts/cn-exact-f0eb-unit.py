#!/usr/bin/env python3
"""GitHub-only transient service. No parent-controller mutation or retry.

The unit owns resource limits; the unchanged Domain owns descendant cleanup.
The read token crosses stdin only after the real unit and kernel are verified.
"""
import argparse,hashlib,importlib.util,json,os,re,select,shutil,stat,subprocess,sys,time,uuid
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
MEMORY=3*1024**3
SECONDS=2100
PROPERTIES={'MemoryMax':str(MEMORY),'MemorySwapMax':'0','TasksMax':'128','CPUQuotaPerSecUSec':'2s','CPUQuotaPeriodUSec':'100ms','RuntimeMaxUSec':'35min','TimeoutStopUSec':'15s','Delegate':'yes','KillMode':'control-group','SendSIGKILL':'yes','Restart':'no','Transient':'yes','Type':'exec','LimitCORE':'0'}
LIMITS={'memory.max':str(MEMORY),'memory.swap.max':'0','pids.max':'128','cpu.max':'200000 100000'}
ENV_KEYS=('PATH','LANG','GITHUB_ACTIONS','GITHUB_REPOSITORY','GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT','EXACT_CHECKOUT_SHA')

def need(value,code):
 if not value:raise RuntimeError(code)
def sha(data):return hashlib.sha256(data).hexdigest()
def canonical(value):return (json.dumps(value,sort_keys=True,separators=(',',':'))+'\n').encode()
def read(path,limit=65536):
 fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
 try:
  before=os.fstat(fd);need(stat.S_ISREG(before.st_mode)and before.st_nlink==1 and before.st_size<=limit,'PRIVATE_FILE')
  data=os.read(fd,limit+1);after=os.fstat(fd);named=path.lstat()
  need(len(data)<=limit and (before.st_dev,before.st_ino,before.st_size,before.st_mtime_ns,before.st_ctime_ns)==(after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns,after.st_ctime_ns)==(named.st_dev,named.st_ino,named.st_size,named.st_mtime_ns,named.st_ctime_ns),'FILE_DRIFT');return data
 finally:os.close(fd)
def write(path,value):
 data=canonical(value);temporary=path.with_name(path.name+'.pending');fd=os.open(temporary,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 try:
  with os.fdopen(fd,'wb')as out:out.write(data);out.flush();os.fsync(out.fileno())
  os.link(temporary,path,follow_symlinks=False);temporary.unlink()
 finally:
  parent=os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
  try:os.fsync(parent)
  finally:os.close(parent)
def command(args,timeout=10):
 # No token in argv/environment; no raw error body is exposed.
 env={k:v for k,v in os.environ.items()if k in ENV_KEYS}
 p=subprocess.run([str(x)for x in args],stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,env=env,timeout=timeout)
 need(p.returncode==0 and len(p.stdout)<=65536,'UNIT_COMMAND_FAILED');return p.stdout
def load(name,path):
 spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
def gate(owned,head):
 need(sys.platform=='linux'and os.geteuid()==0 and os.environ.get('GITHUB_ACTIONS')=='true'and os.environ.get('GITHUB_REPOSITORY')=='boardx/workspacex'and os.environ.get('GITHUB_RUN_ATTEMPT')=='1','GITHUB_UNIT_ONLY')
 need(re.fullmatch('[a-f0-9]{40}',head or'')and head==os.environ.get('EXACT_CHECKOUT_SHA'),'UNIT_HEAD')
 st=owned.lstat();need(owned.parent==Path('/var/lib')and re.fullmatch('wsx-exact-f0eb-[A-Za-z0-9_-]+',owned.name)and owned.resolve()==owned and st.st_uid==0 and stat.S_ISDIR(st.st_mode)and stat.S_IMODE(st.st_mode)==0o700,'UNIT_PRIVATE_ROOT')
def parse_show(raw):
 result={}
 for line in raw.decode().splitlines():
  key,sep,value=line.partition('=');need(sep and key not in result,'UNIT_SHOW_SHAPE');result[key]=value
 return result
def show(unit):
 need(re.fullmatch(r'wsx-exact-[a-f0-9]{32}\.service',unit),'UNIT_NAME')
 args=['/usr/bin/systemctl','show',unit,'--no-pager','--property='+','.join((*PROPERTIES,'Id','LoadState','ActiveState','SubState','MainPID','InvocationID','ControlGroup','ExecStart'))]
 reply=subprocess.run(args,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,env={k:v for k,v in os.environ.items()if k in ENV_KEYS},timeout=10)
 need(len(reply.stdout)<=65536,'UNIT_SHOW_BOUND');value=parse_show(reply.stdout)
 need(reply.returncode==0 or(reply.returncode==1 and value.get('Id')==unit and value.get('LoadState')=='not-found'),'UNIT_SHOW_FAILED');return value
def expected_argv(owned,head):return [str(Path(sys.executable).resolve()),'-I','-B',str(owned/'launch/scripts/cn-exact-f0eb-unit.py'),'--bridge','--owned',str(owned),'--head',head]
def validate_show(value,unit,argv,invocation=None):
 need(value.get('Id')==unit and value.get('LoadState')=='loaded'and value.get('ActiveState')=='active','UNIT_NOT_ACTIVE')
 need(all(value.get(k)==v for k,v in PROPERTIES.items()),'UNIT_PROPERTY_DRIFT')
 need(re.fullmatch('[a-f0-9]{32}',value.get('InvocationID',''))and(invocation is None or invocation==value['InvocationID']),'UNIT_INVOCATION_DRIFT')
 need(value.get('ControlGroup')=='/system.slice/'+unit,'UNIT_CGROUP')
 need(value.get('MainPID','').isdigit()and int(value['MainPID'])>1,'UNIT_PID')
 prefix='{ path='+argv[0]+' ; argv[]='+' '.join(argv)+' ; ignore_errors=no ;'
 need(value.get('ExecStart','').startswith(prefix),'UNIT_EXECSTART')
 return int(value['MainPID'])
def process_identity(pid):
 raw=Path('/proc/'+str(pid)+'/stat').read_text();fields=raw.rsplit(')',1)[1].split();need(len(fields)>19 and fields[19].isdigit(),'UNIT_PROC_STAT')
 return int(fields[19])
def observe(owned,head,claim,invocation=None):
 unit=claim['unit'];argv=expected_argv(owned,head);v=show(unit);pid=validate_show(v,unit,argv,invocation)
 start=process_identity(pid);need(Path('/proc/'+str(pid)+'/cmdline').read_bytes().split(b'\0')[:-1]==[x.encode()for x in argv],'UNIT_CMDLINE')
 need(Path('/proc/'+str(pid)+'/cgroup').read_text().splitlines()==['0::'+v['ControlGroup']],'UNIT_PROCESS_CGROUP')
 group=Path('/sys/fs/cgroup')/v['ControlGroup'].lstrip('/');need(group.resolve()==group,'UNIT_CGROUP_PATH');st=group.stat()
 values={name:(group/name).read_text().strip()for name in LIMITS};need(values==LIMITS,'UNIT_KERNEL_LIMITS')
 # Finite ancestor constraints can only tighten these limits; record their raw
 # bounded values without enabling or changing any controller.
 ancestors=[]
 for parent in group.parents:
  if parent==Path('/sys/fs'):break
  row={'path':str(parent),'limits':{}}
  for key in LIMITS:
   f=parent/key
   if f.exists():
    value=f.read_text().strip();need(len(value)<=128 and re.fullmatch(r'(?:max|[0-9]+)(?: [0-9]+)?',value),'ANCESTOR_LIMIT_SHAPE');row['limits'][key]=value
  ancestors.append(row)
 need(sha(read(Path(argv[3]),1048576))==claim['bridgeSha256'],'UNIT_BRIDGE_DRIFT')
 after=show(unit);need(validate_show(after,unit,argv,v['InvocationID'])==pid and process_identity(pid)==start and (group.stat().st_dev,group.stat().st_ino)==(st.st_dev,st.st_ino),'UNIT_OBSERVATION_DRIFT')
 return {'unit':unit,'invocationId':v['InvocationID'],'controlGroup':v['ControlGroup'],'pid':pid,'pidStartTicks':start,'device':st.st_dev,'inode':st.st_ino,'limits':values,'ancestors':ancestors}
def frame(fd,seconds=30):
 end=time.monotonic()+seconds;data=b''
 while b'\n'not in data:
  remaining=end-time.monotonic();need(remaining>0,'TOKEN_FRAME_TIMEOUT');ready,_,_=select.select([fd],[],[],remaining);need(ready,'TOKEN_FRAME_TIMEOUT')
  chunk=os.read(fd,min(4096,65537-len(data)));need(chunk,'TOKEN_FRAME_EOF');data+=chunk;need(len(data)<=65536,'TOKEN_FRAME_SIZE')
 need(data.endswith(b'\n')and data.count(b'\n')==1,'TOKEN_FRAME_SHAPE')
 value=json.loads(data);need(type(value)is dict and set(value)=={'token','readySha256','invocationId'}and type(value['token'])is str and 0<len(value['token'])<=32768 and '\x00'not in value['token']and '\n'not in value['token'],'TOKEN_FRAME_SHAPE');return value
def send_frame(fd,raw,end):
 need(0<len(raw)<=65536,'TOKEN_FRAME_SIZE');os.set_blocking(fd,False);offset=0
 while offset<len(raw):
  remaining=end-time.monotonic();need(remaining>0,'TOKEN_SEND_TIMEOUT');_,ready,_=select.select([],[fd],[],remaining);need(ready,'TOKEN_SEND_TIMEOUT')
  try:written=os.write(fd,raw[offset:])
  except BlockingIOError:continue
  need(written>0,'TOKEN_SEND_EOF');offset+=written
def bridge(owned,head):
 safe={k:v for k,v in os.environ.items()if k in ENV_KEYS};os.environ.clear();os.environ.update(safe)
 gate(owned,head);claim=json.loads(read(owned/'unit-claim.json'));obs=observe(owned,head,claim)
 need(obs['pid']==os.getpid(),'BRIDGE_MAIN_PID');write(owned/'unit-ready.json',obs)
 release=frame(0);need(release['readySha256']==sha(read(owned/'unit-ready.json'))and release['invocationId']==obs['invocationId'],'TOKEN_RELEASE_BINDING')
 need(observe(owned,head,claim,obs['invocationId'])==obs,'TOKEN_RELEASE_DRIFT')
 domainmod=load('exact_unit_domain',ROOT/'scripts/cn_release_simulation_domain.py');domain=domainmod.Domain();child=None;cleanup={'verified':False};code=1
 try:
  need(domain.path.parent==Path('/sys/fs/cgroup')/obs['controlGroup'].lstrip('/'),'DOMAIN_UNIT_ANCESTOR')
  env={k:v for k,v in os.environ.items()if k in ENV_KEYS};env['GH_TOKEN']=release.pop('token');env['PYTHONDONTWRITEBYTECODE']='1'
  child=domain.spawn([sys.executable,'-I','-B',str(ROOT/'scripts/cn-exact-f0eb-github.py'),'--worker','--owned',str(owned),'--head',head],cwd=ROOT,env=env,stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
  env.pop('GH_TOKEN');code=child.wait(timeout=1800)
 finally:
  cleanup=domain.close(child);write(owned/'unit-worker-result.json',{'workerExitCode':code,'domainCleanup':cleanup,'unit':obs['unit'],'invocationId':obs['invocationId'],'productionReady':False})
 return code if cleanup.get('verified')is True else 1
def service_argv(owned,head,unit):
 props=['MemoryMax='+str(MEMORY),'MemorySwapMax=0','TasksMax=128','CPUQuota=200%','CPUQuotaPeriodSec=100ms','RuntimeMaxSec=2100','TimeoutStopSec=15','Delegate=yes','KillMode=control-group','SendSIGKILL=yes','Restart=no','LimitCORE=0','UnsetEnvironment=GH_TOKEN GITHUB_TOKEN']
 args=['/usr/bin/systemd-run','--quiet','--wait','--pipe','--service-type=exec','--unit='+unit]
 args+=['--property='+x for x in props]
 for k in ENV_KEYS:
  if k in os.environ:args+=['--setenv='+k+'='+os.environ[k]]
 return args+['--',*expected_argv(owned,head)]
def cleanup_unit(claim,observation,owned):
 need(observation is not None,'UNIT_OWNERSHIP_UNKNOWN');unit=claim['unit'];path=Path('/sys/fs/cgroup')/observation['controlGroup'].lstrip('/')
 v=show(unit)
 if v.get('LoadState')=='not-found':
  need(not path.exists(),'UNIT_ABSENCE_UNPROVEN');return {'verified':True,'populated':0,'removed':True,'observedAbsent':True}
 need(v.get('Id')==unit and v.get('InvocationID')==observation['invocationId']and v.get('ControlGroup')in (observation['controlGroup'],''),'STOP_UNIT_IDENTITY')
 if path.exists():need((path.stat().st_dev,path.stat().st_ino)==(observation['device'],observation['inode']),'STOP_UNIT_INODE')
 write(owned/'unit-stop-claim.json',{'unit':unit,'invocationId':observation['invocationId'],'inode':observation['inode']})
 command(['/usr/bin/systemctl','stop',unit],20)
 end=time.monotonic()+20
 while path.exists()and time.monotonic()<end:time.sleep(.1)
 need(not path.exists(),'UNIT_STOP_NOT_EMPTY');after=show(unit)
 need(after.get('LoadState')=='not-found'or(after.get('InvocationID')==observation['invocationId']and after.get('ActiveState')in ('inactive','failed')),'UNIT_TERMINAL_STATE')
 return {'verified':True,'populated':0,'removed':True}
def run(owned,head):
 end_total=time.monotonic()+SECONDS
 gate(owned,head);token=os.environ.get('GH_TOKEN');need(type(token)is str and token,'READ_TOKEN_REQUIRED')
 # Root-owned exact checkout is the only executable source passed to systemd.
 git=['git','-c','safe.directory='+str(ROOT),'-c','safe.directory='+str(ROOT/'.git'),'-c','core.hooksPath=/dev/null','-c','protocol.file.allow=always']
 launch=owned/'launch';command([*git,'clone','--no-hardlinks','--no-checkout','--',ROOT,launch],60);command([*git,'-C',launch,'checkout','--detach',head],60)
 need(command([*git,'-C',launch,'rev-parse','HEAD']).decode().strip()==head,'UNIT_CHECKOUT_HEAD')
 claim={'unit':'wsx-exact-'+uuid.uuid4().hex+'.service','head':head,'bridgeSha256':sha(read(launch/'scripts/cn-exact-f0eb-unit.py',1048576)),'githubRunId':os.environ['GITHUB_RUN_ID']}
 write(owned/'unit-claim.json',claim);proc=None;observed=None;cleanup={'verified':False};code=1
 try:
  env={k:v for k,v in os.environ.items()if k in ENV_KEYS}
  proc=subprocess.Popen(service_argv(owned,head,claim['unit']),stdin=subprocess.PIPE,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,env=env)
  end=time.monotonic()+45
  while not (owned/'unit-ready.json').exists():
   need(proc.poll()is None and time.monotonic()<end,'UNIT_START_UNKNOWN');time.sleep(.1)
  observed=observe(owned,head,claim);need(json.loads(read(owned/'unit-ready.json'))==observed,'UNIT_READY_DRIFT')
  write(owned/'unit-observed.json',observed)
  raw=canonical({'token':token,'readySha256':sha(read(owned/'unit-ready.json')),'invocationId':observed['invocationId']});need(len(raw)<=65536,'TOKEN_FRAME_SIZE')
  send_frame(proc.stdin.fileno(),raw,min(end_total,time.monotonic()+10));proc.stdin.close();del raw;del token
  remaining=end_total-time.monotonic();need(remaining>0,'UNIT_TOTAL_DEADLINE');code=proc.wait(timeout=remaining)
 finally:
  if proc and proc.stdin and not proc.stdin.closed:proc.stdin.close()
  # No second StartUnit, even if the first acknowledgement or handshake is lost.
  if observed is None and (owned/'unit-ready.json').exists():
   try:observed=observe(owned,head,claim)
   except Exception:pass
  try:cleanup=cleanup_unit(claim,observed,owned)
  except Exception:cleanup={'verified':False,'reason':'EXACT_UNIT_CLEANUP_UNKNOWN'}
  if proc and proc.poll()is None:
   # This is only our local systemd-run client, never a process-name scan.
   proc.kill();proc.wait(timeout=5)
  write(owned/'unit-cleanup.json',cleanup)
 need(cleanup.get('verified')is True,'UNIT_CLEANUP_UNKNOWN')
 result=json.loads(read(owned/'unit-worker-result.json'));need(result.get('unit')==claim['unit']and observed and result.get('invocationId')==observed['invocationId']and result.get('domainCleanup',{}).get('verified')is True,'UNIT_WORKER_RESULT')
 return code,cleanup
if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('--bridge',action='store_true',required=True);parser.add_argument('--owned',type=Path,required=True);parser.add_argument('--head',required=True);args=parser.parse_args()
 try:raise SystemExit(bridge(args.owned,args.head))
 except Exception as error:
  try:
   gate(args.owned,args.head);reason=str(error);reason=reason if re.fullmatch('[A-Z][A-Z0-9_]{0,79}',reason)else'UNIT_UNCLASSIFIED'
   write(args.owned/'unit-bridge-diagnostic.json',{'reason':reason,'productionReady':False})
  except Exception:pass
  raise SystemExit(1)
