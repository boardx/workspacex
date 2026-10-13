#!/usr/bin/env python3
"""GitHub-only bounded simulation worker; supervisor/daemon recovery stay outside.

Uses the exact-image acquisition unit's tested private-file/pipe/proc primitives.
No tokens, parent controller writes, fallback, or uncertain-start retry.
"""
import argparse, importlib.util, json, os, re, select, stat, subprocess, sys, time, uuid
from decimal import Decimal
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('simulation_unit_primitives',ROOT/'scripts/cn-exact-f0eb-unit.py')
base=importlib.util.module_from_spec(spec);spec.loader.exec_module(base)
need,read,write,sha,canonical=base.need,base.read,base.write,base.sha,base.canonical
MEMORY=6*1024**3
KNOWN_DOCKER_PEAK=2*(1024**3+256*1024**2) # serialized heavy six-infra target/control
DOCKER_RESERVE=3*1024**3 # conservative headroom above that known 2.5 GiB path
HOST_RESERVE=1536*1024**2
MAX_SECONDS=16500
LIMITS={'memory.max':str(MEMORY),'memory.swap.max':'0','pids.max':'1024','cpu.max':'300000 100000'}
PROPERTIES={'MemoryMax':str(MEMORY),'MemorySwapMax':'0','TasksMax':'1024','CPUQuotaPerSecUSec':'3s','CPUQuotaPeriodUSec':'100ms','TimeoutStopUSec':'15s','Delegate':'yes','KillMode':'control-group','SendSIGKILL':'yes','Restart':'no','Transient':'yes','Type':'exec','LimitCORE':'0'}
ENV_KEYS=frozenset(('PATH','HOME','LANG','GIT_CONFIG_NOSYSTEM','GIT_CONFIG_GLOBAL','GIT_TERMINAL_PROMPT','GIT_ALLOW_PROTOCOL','PYTHONDONTWRITEBYTECODE','CN_ARCHIVE_TEST_NODE','CN_ARCHIVE_TEST_RUNTIME','CN_TEST_PLAYWRIGHT','CN_TEST_CHROMIUM','NODE_PATH','GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT','GITHUB_ACTIONS','CN_API_STARTUP_NODE','CN_API_STARTUP_PG_IMAGE','CN_SIX_REDIS_IMAGE','CN_SIX_OWNER_ROOT','CN_SIX_KILL_TARGET_ROOT','CN_SIX_KILL_CONTROL_ROOT','CN_SIM14_REGISTRY_ROOT','CN_API_OWNER_ROOT','CN_SIX_SOURCE_COMMIT'))

def safe_env(env):
    # The setup receipt's Node executable must cross the worker boundary;
    # six-session requires this exact resolved runtime rather than PATH lookup.
    return {k:v for k,v in env.items() if k in ENV_KEYS}

def resource_gate(raw):
    match=re.search(r'^MemTotal:\s+([0-9]+) kB$',raw,re.M)
    need(match is not None,'SIMULATION_MEMTOTAL')
    total=int(match[1])*1024
    need(total>=MEMORY+DOCKER_RESERVE+HOST_RESERVE,'SIMULATION_HOST_MEMORY_INSUFFICIENT')
    return {'memTotalBytes':total,'workerMemoryMaxBytes':MEMORY,'knownDockerFixtureCapsBytes':KNOWN_DOCKER_PEAK,'dockerMemoryReserveBytes':DOCKER_RESERVE,'hostReserveBytes':HOST_RESERVE,'dockerAggregateEnforced':False}

def host_resources():
    return resource_gate(Path('/proc/meminfo').read_text())

def python_identity():
    executable=Path(sys.executable).absolute();target=executable.resolve(strict=True)
    need(target.is_file() and os.access(executable,os.X_OK),'SIMULATION_INTERPRETER')
    cfg=Path(sys.prefix)/'pyvenv.cfg'
    return {'executable':str(executable),'target':str(target),'targetSha256':sha(read(target,64*1024**2)),
            'prefix':sys.prefix,'basePrefix':sys.base_prefix,
            'venvConfigSha256':sha(read(cfg,16384)) if sys.prefix!=sys.base_prefix else None}

def duration_us(value):
    # systemctl renders RuntimeMaxUSec in human duration form, e.g. 4h 35min.
    units={'h':3600000000,'min':60000000,'s':1000000,'ms':1000,'us':1}
    tokens=re.findall(r'([0-9]+(?:\.[0-9]+)?)\s*(min|ms|us|h|s)',value)
    need(tokens and re.sub(r'([0-9]+(?:\.[0-9]+)?)\s*(min|ms|us|h|s)','',value).strip()=='','SIMULATION_DURATION')
    total=sum(Decimal(n)*units[u] for n,u in tokens)
    need(total==int(total),'SIMULATION_DURATION');return int(total)

def command(args,timeout=10):
    return base.command(args,timeout)

def show(unit):
    need(re.fullmatch(r'wsx-cn-simulation-[a-f0-9]{32}\.service',unit),'SIMULATION_UNIT_NAME')
    args=['/usr/bin/systemctl','show',unit,'--no-pager','--property='+','.join((*PROPERTIES,'RuntimeMaxUSec','Id','LoadState','ActiveState','MainPID','InvocationID','ControlGroup','ExecStart'))]
    p=subprocess.run(args,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,env=safe_env(os.environ),timeout=10)
    need(len(p.stdout)<=65536,'SIMULATION_SHOW_BOUND');v=base.parse_show(p.stdout)
    need(p.returncode==0 or(p.returncode==1 and v.get('Id')==unit and v.get('LoadState')=='not-found'),'SIMULATION_SHOW_FAILED')
    return v

def bridge_argv(root):
    # Resolving a venv's Python symlink discards the existing CI SDK packages.
    # Preserve the interpreter path originally used by the supervisor.
    return [str(Path(sys.executable).absolute()),'-I','-B',str(ROOT/'scripts/cn-release-simulation-unit.py'),'--bridge','--root',str(root)]

def validate_show(v,unit,argv,seconds,invocation=None):
    need(v.get('Id')==unit and v.get('LoadState')=='loaded' and v.get('ActiveState')=='active','SIMULATION_UNIT_NOT_ACTIVE')
    need(all(v.get(k)==x for k,x in PROPERTIES.items()) and duration_us(v.get('RuntimeMaxUSec',''))==seconds*1000000,'SIMULATION_PROPERTIES')
    need(re.fullmatch('[a-f0-9]{32}',v.get('InvocationID','')) and(invocation is None or invocation==v['InvocationID']),'SIMULATION_INVOCATION')
    need(v.get('ControlGroup')=='/system.slice/'+unit,'SIMULATION_CONTROL_GROUP')
    need(v.get('MainPID','').isdigit() and int(v['MainPID'])>1,'SIMULATION_MAIN_PID')
    prefix='{ path='+argv[0]+' ; argv[]='+' '.join(argv)+' ; ignore_errors=no ;'
    need(v.get('ExecStart','').startswith(prefix),'SIMULATION_EXECSTART')
    return int(v['MainPID'])

WORKER_SUITES=frozenset(('all','release','linux-api-outer-recovery','linux-application-recovery-complete','linux-six-business','linux-boundary-reap'))

def validate_worker(command_,checkout):
    need(len(command_) in (14,16,18) and command_[:4]==[str(Path(sys.executable).absolute()),'-I','-B',str(checkout/'scripts/cn-release-simulation.py')],'SIMULATION_FIXED_WORKER')
    need(command_[4]=='--output' and Path(command_[5]).is_absolute() and str(Path(command_[5]).resolve())==command_[5],'SIMULATION_OUTPUT')
    need(command_[6]=='--workers' and command_[7] in ('1','3') and command_[8:11]==['--timeout-seconds','300','--rounds'] and command_[11] in ('1','10') and command_[12]=='--seed' and command_[13].isdigit() and 0<=int(command_[13])<=2**32-1,'SIMULATION_FIXED_ARGUMENTS')
    suite='all' if len(command_)==14 else command_[15]
    need(len(command_)==14 or(command_[14]=='--suite' and suite in WORKER_SUITES),'SIMULATION_FIXED_SUITE')
    need(len(command_)!=18 or(command_[16]=='--mode' and command_[17] in ('acceptance','development')),'SIMULATION_FIXED_MODE')
    need(command_[11]!='10' or suite=='all','SIMULATION_TEN_ALL_REQUIRED')

FAULT_MODES={'api-outer-sigkill':'--child','api-outer-noop':'--noop'}
FAULT_PATH='tests/cn_release_api_outer_recovery_linux.py'

def current_unit_context():
    # The worker is a descendant of the observed service; environment alone is
    # never evidence of that service, its limits, or its invocation identity.
    need(sys.platform=='linux' and os.geteuid()==0,'SIMULATION_FAULT_LINUX_ROOT')
    pid=os.getpid();ticks=base.process_identity(pid)
    membership=Path('/proc/self/cgroup').read_text().splitlines()
    need(len(membership)==1,'SIMULATION_FAULT_MEMBERSHIP')
    match=re.fullmatch(r'0::(/system.slice/(wsx-cn-simulation-[a-f0-9]{32}\.service))/.*',membership[0])
    need(match is not None,'SIMULATION_FAULT_OUTSIDE_UNIT')
    manager=show(match[2]);mainpid=manager.get('MainPID','')
    need(mainpid.isdigit() and int(mainpid)>1,'SIMULATION_FAULT_MAIN_PID')
    argv=Path('/proc/'+mainpid+'/cmdline').read_bytes().split(b'\0')[:-1]
    need(len(argv)==7,'SIMULATION_FAULT_BRIDGE_COMMAND')
    root=Path(argv[-1].decode());need(argv==[x.encode()for x in bridge_argv(root)],'SIMULATION_FAULT_BRIDGE_COMMAND')
    plan=json.loads(read(root/'simulation-unit-input.json',262144));gate(root,plan)
    claim=json.loads(read(root/'simulation-unit-claim.json'));need(claim['unit']==match[2],'SIMULATION_FAULT_UNIT')
    observed=json.loads(read(root/'simulation-unit-observed.json'))
    need(observe(root,plan,claim,observed['invocationId'])==observed,'SIMULATION_FAULT_OBSERVATION')
    need(Path('/proc/self/cgroup').read_text().splitlines()==membership and base.process_identity(pid)==ticks,'SIMULATION_FAULT_PROCESS_DRIFT')
    return root,plan,observed

def admit_fault(command_,checkout,env,sha_,run_id,receipt_root,mode):
    need(mode in FAULT_MODES and checkout==ROOT,'SIMULATION_FAULT_MODE')
    expected=[str(Path(sys.executable).absolute()),'-I','-B',str(ROOT/FAULT_PATH),FAULT_MODES[mode]]
    need([str(x)for x in command_]==expected,'SIMULATION_FAULT_FIXED_COMMAND')
    root,plan,observed=current_unit_context()
    need(plan['sha']==sha_ and plan['runId']==run_id and env.get('GITHUB_RUN_ID')==run_id,'SIMULATION_FAULT_SOURCE_IDENTITY')
    allowed={'PATH','GITHUB_RUN_ID','GITHUB_ACTIONS','CN_API_STARTUP_PG_IMAGE','CN_SIM14_CHILD_ROOT','CN_SIM14_DEADLINE'}
    need(set(env)<=allowed and env.get('CN_API_STARTUP_PG_IMAGE')==plan['env'].get('CN_API_STARTUP_PG_IMAGE'),'SIMULATION_FAULT_ENV')
    registry=Path(plan['env']['CN_SIM14_REGISTRY_ROOT'])
    folder=receipt_root.parent
    need(folder.name=='api-outer-recovery' and re.fullmatch(r'round-[0-9]{2}',folder.parent.name) and folder.parent.parent==registry and receipt_root.name==('success' if mode=='api-outer-sigkill' else 'uncertain'),'SIMULATION_FAULT_RECEIPT_ROOT')
    need(str(receipt_root.resolve())==str(receipt_root) and env.get('CN_SIM14_CHILD_ROOT')==str(folder/'target'),'SIMULATION_FAULT_CHILD_ROOT')
    # Independently bind the fixed loaded fault source to the complete admitted
    # control commit, not a caller-provided script hash.
    original=command(['/usr/bin/git','-c','safe.directory='+str(ROOT),'-c','safe.directory='+str(ROOT/'.git'),'-C',ROOT,'show',sha_+':'+FAULT_PATH])
    need(sha(original)==sha(read(ROOT/FAULT_PATH,65536)),'SIMULATION_FAULT_SOURCE_DRIFT')
    return {'unit':observed['unit'],'invocationId':observed['invocationId'],'sourceSha':sha_,'faultSourceSha256':sha(original),'mode':mode}

def private_root(root):
    need(root.parent==Path('/var/lib') and re.fullmatch('wsx-cn-simulation-[A-Za-z0-9_-]+',root.name) and root.resolve()==root,'SIMULATION_PRIVATE_ROOT')
    for p in (root,*root.parents):
        st=p.lstat();need(stat.S_ISDIR(st.st_mode) and st.st_uid==0 and st.st_gid==0 and not st.st_mode&0o022,'SIMULATION_ROOT_TRUST')
    need(stat.S_IMODE(root.stat().st_mode)==0o700,'SIMULATION_ROOT_MODE')

def gate(root,plan):
    need(sys.platform=='linux' and os.geteuid()==0 and os.environ.get('GITHUB_ACTIONS')=='true' and plan['env'].get('GITHUB_ACTIONS')=='true','SIMULATION_GITHUB_ROOT')
    private_root(root)
    need(re.fullmatch('[a-f0-9]{40}',plan.get('sha','')) and re.fullmatch('[0-9]+',plan.get('runId','')) and plan['env'].get('GITHUB_RUN_ID')==plan['runId'],'SIMULATION_INPUT_IDENTITY')
    need(set(plan['env'])<=ENV_KEYS and plan['checkout']==str(ROOT),'SIMULATION_INPUT_ENV')
    need(type(plan.get('seconds')) is int and 0<plan['seconds']<=MAX_SECONDS,'SIMULATION_BUDGET')
    need(python_identity()==plan['pythonIdentity'],'SIMULATION_INTERPRETER_DRIFT')
    need(os.environ.get('GITHUB_RUN_ID')==plan['runId'],'SIMULATION_MANAGER_RUN_ID')
    validate_worker(plan['command'],ROOT)
    need(command(['/usr/bin/git','-c','safe.directory='+str(ROOT),'-c','safe.directory='+str(ROOT/'.git'),'-c','core.hooksPath=/dev/null','-C',ROOT,'rev-parse','HEAD']).decode().strip()==plan['sha'],'SIMULATION_CHECKOUT_SHA')

def observe(root,plan,claim,invocation=None):
    unit=claim['unit'];argv=bridge_argv(root);v=show(unit);pid=validate_show(v,unit,argv,plan['seconds'],invocation)
    ticks=base.process_identity(pid)
    need(Path('/proc/'+str(pid)+'/cmdline').read_bytes().split(b'\0')[:-1]==[x.encode()for x in argv],'SIMULATION_PROC_COMMAND')
    need(Path('/proc/'+str(pid)+'/cgroup').read_text().splitlines()==['0::'+v['ControlGroup']],'SIMULATION_PROC_GROUP')
    group=Path('/sys/fs/cgroup')/v['ControlGroup'].lstrip('/');need(group.resolve()==group,'SIMULATION_GROUP_PATH');st=group.stat()
    limits={k:(group/k).read_text().strip()for k in LIMITS};need(limits==LIMITS,'SIMULATION_KERNEL_LIMITS')
    ancestors=[]
    for parent in group.parents:
        if parent==Path('/sys/fs'):break
        row={'path':str(parent),'limits':{}}
        for key in LIMITS:
            if(parent/key).exists():
                value=(parent/key).read_text().strip();need(len(value)<=128 and re.fullmatch(r'(?:max|[0-9]+)(?: [0-9]+)?',value),'SIMULATION_ANCESTOR_LIMIT')
                row['limits'][key]=value
        ancestors.append(row) # inherited constraints may tighten the unit cap
    need(sha(read(ROOT/'scripts/cn-release-simulation-unit.py',1048576))==claim['bridgeSha256'] and sha(read(root/'simulation-unit-input.json',262144))==claim['inputSha256'],'SIMULATION_SOURCE_INPUT_DRIFT')
    after=show(unit);current=group.stat();need(validate_show(after,unit,argv,plan['seconds'],v['InvocationID'])==pid and base.process_identity(pid)==ticks and (current.st_dev,current.st_ino)==(st.st_dev,st.st_ino),'SIMULATION_IDENTITY_DRIFT')
    return {'unit':unit,'invocationId':v['InvocationID'],'controlGroup':v['ControlGroup'],'pid':pid,'pidStartTicks':ticks,'device':st.st_dev,'inode':st.st_ino,'limits':limits,'ancestors':ancestors}

def release_frame(fd,seconds=45):
    end=time.monotonic()+seconds;data=b''
    while b'\n'not in data:
        remaining=end-time.monotonic();need(remaining>0,'SIMULATION_RELEASE_TIMEOUT')
        ready,_,_=select.select([fd],[],[],remaining);need(ready,'SIMULATION_RELEASE_TIMEOUT')
        block=os.read(fd,min(4096,8193-len(data)));need(block,'SIMULATION_RELEASE_EOF');data+=block;need(len(data)<=8192,'SIMULATION_RELEASE_BOUND')
    need(data.endswith(b'\n') and data.count(b'\n')==1,'SIMULATION_RELEASE_SHAPE')
    v=json.loads(data);need(type(v)is dict and set(v)=={'readySha256','invocationId'} and re.fullmatch('[a-f0-9]{64}',v.get('readySha256','')) and re.fullmatch('[a-f0-9]{32}',v.get('invocationId','')),'SIMULATION_RELEASE_SHAPE');return v

def resource_snapshot(obs):
    group=Path('/sys/fs/cgroup')/obs['controlGroup'].lstrip('/');st=group.stat();need((st.st_dev,st.st_ino)==(obs['device'],obs['inode']),'SIMULATION_METRICS_INODE')
    value={}
    for key in ('memory.current','memory.peak','pids.current'):
        raw=(group/key).read_text().strip();need(raw.isdigit(),'SIMULATION_METRICS');value[key]=int(raw)
    for key in ('memory.events','cpu.stat'):
        rows=dict(x.split()for x in (group/key).read_text().splitlines());need(all(v.isdigit()for v in rows.values()),'SIMULATION_METRICS');value[key]={k:int(v)for k,v in rows.items()}
    after=group.stat();need((after.st_dev,after.st_ino)==(obs['device'],obs['inode']),'SIMULATION_METRICS_INODE')
    return value

class Unit:
    def __init__(self,checkout,root,sha_,run_id,seconds=MAX_SECONDS):
        self.checkout=checkout;self.root=root;self.sha=sha_;self.run_id=run_id;self.seconds=seconds;self.process=None;self.observed=None;self.closed=False;self.started=False;self.last_metrics=None
    def spawn(self,command_,*,cwd,env,start_new_session=True):
        need(not self.started and cwd==self.checkout==ROOT,'SIMULATION_ONE_START');self.started=True
        cmd=[str(x)for x in command_]
        plan={'checkout':str(self.checkout),'sha':self.sha,'runId':self.run_id,'seconds':self.seconds,'command':cmd,'env':safe_env(env),'pythonIdentity':python_identity()}
        gate(self.root,plan);resources=host_resources();self.resources=resources
        write(self.root/'simulation-unit-input.json',plan)
        self.claim={'unit':'wsx-cn-simulation-'+uuid.uuid4().hex+'.service','inputSha256':sha(read(self.root/'simulation-unit-input.json',262144)),'bridgeSha256':sha(read(ROOT/'scripts/cn-release-simulation-unit.py',1048576))}
        write(self.root/'simulation-unit-claim.json',{**self.claim,'resources':resources})
        props=['MemoryMax='+str(MEMORY),'MemorySwapMax=0','TasksMax=1024','CPUQuota=300%','CPUQuotaPeriodSec=100ms','RuntimeMaxSec='+str(self.seconds),'TimeoutStopSec=15','Delegate=yes','KillMode=control-group','SendSIGKILL=yes','Restart=no','LimitCORE=0','UnsetEnvironment=GH_TOKEN GITHUB_TOKEN']
        argv=['/usr/bin/systemd-run','--quiet','--pipe','--wait','--service-type=exec','--unit='+self.claim['unit'],*['--property='+x for x in props],
              '--setenv=GITHUB_ACTIONS=true','--setenv=GITHUB_RUN_ID='+self.run_id,'--',*bridge_argv(self.root)]
        # Manager environment and argv contain no fixture environment or tokens.
        self.process=subprocess.Popen(argv,stdin=subprocess.PIPE,env={'PATH':env.get('PATH',os.defpath),'LANG':'C.UTF-8'},start_new_session=start_new_session)
        end=time.monotonic()+45
        while not(self.root/'simulation-unit-ready.json').exists():
            need(self.process.poll()is None and time.monotonic()<end,'SIMULATION_START_UNKNOWN');time.sleep(.1)
        self.observed=observe(self.root,plan,self.claim)
        need(json.loads(read(self.root/'simulation-unit-ready.json'))==self.observed,'SIMULATION_READY_DRIFT')
        write(self.root/'simulation-unit-observed.json',self.observed)
        base.send_frame(self.process.stdin.fileno(),canonical({'readySha256':sha(read(self.root/'simulation-unit-ready.json')),'invocationId':self.observed['invocationId']}),time.monotonic()+10)
        self.process.stdin.close();self.start_time=time.monotonic()
        return self
    def wait(self,timeout):
        end=time.monotonic()+min(timeout,self.seconds)
        while True:
            try:return self.process.wait(timeout=min(5,max(.01,end-time.monotonic())))
            except subprocess.TimeoutExpired:
                need(time.monotonic()<end,'SIMULATION_WAIT_TIMEOUT')
                try:
                    self.last_metrics=resource_snapshot(self.observed)
                    print(json.dumps({'simulationResourceUnit':self.claim['unit'],'metrics':self.last_metrics}),flush=True)
                except (OSError,RuntimeError,ValueError):pass # disappearance never becomes successful cleanup
    def close(self,process):
        need(not self.closed and process in (None,self),'SIMULATION_CLOSE_IDENTITY');self.closed=True
        try:
            if self.process and self.process.stdin and not self.process.stdin.closed:self.process.stdin.close()
            if self.observed is None and(self.root/'simulation-unit-ready.json').exists():
                plan=json.loads(read(self.root/'simulation-unit-input.json',262144));self.observed=observe(self.root,plan,self.claim)
            need(self.observed is not None,'SIMULATION_CLEANUP_OWNERSHIP_UNKNOWN')
            obs=self.observed;unit=self.claim['unit'];group=Path('/sys/fs/cgroup')/obs['controlGroup'].lstrip('/');v=show(unit)
            if v.get('LoadState')=='not-found':need(not group.exists(),'SIMULATION_UNIT_ABSENCE_UNPROVEN')
            else:
                need(v.get('Id')==unit and v.get('InvocationID')==obs['invocationId'] and v.get('ControlGroup')in(obs['controlGroup'],''),'SIMULATION_STOP_IDENTITY')
                if group.exists():
                    current=group.stat();need((current.st_dev,current.st_ino)==(obs['device'],obs['inode']),'SIMULATION_STOP_INODE')
                    self.last_metrics=resource_snapshot(obs)
                write(self.root/'simulation-unit-stop-claim.json',{'unit':unit,'invocationId':obs['invocationId'],'inode':obs['inode']})
                command(['/usr/bin/systemctl','stop',unit],20)
                end=time.monotonic()+20
                while group.exists() and time.monotonic()<end:time.sleep(.1)
                need(not group.exists(),'SIMULATION_UNIT_NOT_EMPTY');after=show(unit)
                need(after.get('LoadState')=='not-found' or(after.get('InvocationID')==obs['invocationId'] and after.get('ActiveState')in('inactive','failed')),'SIMULATION_UNIT_TERMINAL')
            result={'kind':'linux-systemd-owned-resource-cleanup','verified':True,'populated':0,'removed':True,'unit':unit,'invocationId':obs['invocationId'],'observation':obs,'resources':self.resources,'metrics':self.last_metrics,'limits':LIMITS}
            write(self.root/'simulation-unit-cleanup.json',result);return result
        except BaseException:
            write(self.root/'simulation-unit-cleanup.json',{'verified':False,'reason':'SIMULATION_UNIT_CLEANUP_UNKNOWN','metrics':self.last_metrics});raise
        finally:
            if self.process:
                if self.process.poll()is None:self.process.kill()
                self.process.wait(timeout=5) # reap only the local systemd-run client

def bridge(root):
    plan=json.loads(read(root/'simulation-unit-input.json',262144));gate(root,plan)
    claim=json.loads(read(root/'simulation-unit-claim.json'));obs=observe(root,plan,claim)
    need(obs['pid']==os.getpid(),'SIMULATION_BRIDGE_PID');write(root/'simulation-unit-ready.json',obs)
    release=release_frame(0)
    need(release['readySha256']==sha(read(root/'simulation-unit-ready.json')) and release['invocationId']==obs['invocationId'],'SIMULATION_RELEASE_BINDING')
    need(observe(root,plan,claim,obs['invocationId'])==obs,'SIMULATION_RELEASE_DRIFT')
    # Creation is inside the verified resource unit; no migration to a parent's domain.
    spec=importlib.util.spec_from_file_location('simulation_worker_domain',ROOT/'scripts/cn_release_simulation_domain.py')
    domainmod=importlib.util.module_from_spec(spec);spec.loader.exec_module(domainmod);domain=domainmod.Domain();child=None;code=1
    try:
        need(domain.path.parent==Path('/sys/fs/cgroup')/obs['controlGroup'].lstrip('/'),'SIMULATION_DOMAIN_PARENT')
        child=domain.spawn(plan['command'],cwd=ROOT,env=plan['env'],stdin=subprocess.DEVNULL,start_new_session=True)
        code=child.wait(timeout=plan['seconds'])
    finally:
        cleanup=domain.close(child);write(root/'simulation-unit-worker-result.json',{'workerExitCode':code,'domainCleanup':cleanup})
    return code if cleanup.get('verified')is True else 1

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--bridge',action='store_true',required=True);parser.add_argument('--root',type=Path,required=True);args=parser.parse_args()
    try:raise SystemExit(bridge(args.root))
    except Exception as error:
        reason=str(error);reason=reason if re.fullmatch('[A-Z][A-Z0-9_]{0,79}',reason)else'SIMULATION_BRIDGE_UNCLASSIFIED'
        print(json.dumps({'simulationResourceBridge':'failed','reason':reason}),flush=True);raise SystemExit(1)
