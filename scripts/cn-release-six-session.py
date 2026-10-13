"""Parent-held lifecycle for the isolated six-journey lane; no production API.
The caller must own its application Domain and invoke finish only after closing
it. CI finally independently calls six_infra.recover_all after its outer Domain
is empty, so Session death does not rely on this class's finally running.
"""
import importlib.util
import hashlib
import json
import os
from pathlib import Path
import re
import selectors
import subprocess
import stat
import time
ROOT=Path(__file__).resolve().parents[1]
def load(name,path):
    spec=importlib.util.spec_from_file_location(name,path);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
infra=load('six_infra_session',ROOT/'scripts/cn-release-six-infra.py')
domains=load('six_session_domains',ROOT/'scripts/cn_release_simulation_domain.py')
PREPARE_BUDGET=120
APPLICATION_BUDGET=1200
CLEANUP_BUDGET=90
BUILD_BUDGET=900
ARTIFACT_ZONE_BYTES=2*1024**3


def measured_tree_bytes(root,deadline=None):
    """Sample via anchored dirfds; no symbolic link is traversed."""
    total=0;count=0
    def check():
        if deadline is not None and time.monotonic()>=deadline:raise TimeoutError('SIX_BUILD_TIMEOUT')
    def walk(fd,depth):
        nonlocal total,count
        check()
        if depth>64:raise RuntimeError('SIX_SCRATCH_FILE_LIMIT')
        before=os.fstat(fd)
        if before.st_uid!=os.getuid():raise RuntimeError('SIX_SCRATCH_DIRECTORY')
        with os.scandir(fd)as entries:
            for entry in entries:
                check();count+=1
                if count>100000:raise RuntimeError('SIX_SCRATCH_FILE_LIMIT')
                try:info=os.stat(entry.name,dir_fd=fd,follow_symlinks=False)
                except FileNotFoundError:continue
                if stat.S_ISDIR(info.st_mode):
                    try:child=os.open(entry.name,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=fd)
                    except FileNotFoundError:continue
                    try:
                        opened=os.fstat(child)
                        if (opened.st_dev,opened.st_ino)!=(info.st_dev,info.st_ino):raise RuntimeError('SIX_SCRATCH_DIRECTORY')
                        walk(child,depth+1)
                        named=os.stat(entry.name,dir_fd=fd,follow_symlinks=False)
                        if (named.st_dev,named.st_ino)!=(opened.st_dev,opened.st_ino):raise RuntimeError('SIX_SCRATCH_DIRECTORY')
                    finally:os.close(child)
                elif stat.S_ISREG(info.st_mode)or stat.S_ISLNK(info.st_mode):total+=info.st_size
                else:raise RuntimeError('SIX_SCRATCH_TYPE')
                if total>ARTIFACT_ZONE_BYTES:raise RuntimeError('SIX_SCRATCH_LIMIT')
    try:fd=os.open(root,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    except FileNotFoundError:return 0
    try:walk(fd,0)
    finally:os.close(fd)
    return total


def private_receipt(path):
    flags=os.O_RDONLY|os.O_NOFOLLOW;fd=os.open(path,flags)
    try:
        before=os.fstat(fd)
        if not stat.S_ISREG(before.st_mode)or before.st_uid!=0 or before.st_nlink!=1 or stat.S_IMODE(before.st_mode)!=0o600 or before.st_size>16384:raise RuntimeError('SIX_RUNTIME_RECEIPT')
        raw=os.read(fd,16385)
        after=os.fstat(fd);named=path.lstat()
        fields=lambda info:(info.st_dev,info.st_ino,info.st_size,info.st_mtime_ns,info.st_ctime_ns,info.st_uid,info.st_mode,info.st_nlink)
        if len(raw)!=before.st_size or fields(before)!=fields(after)or fields(after)!=fields(named):raise RuntimeError('SIX_RUNTIME_RECEIPT_CHANGED')
        return json.loads(raw)
    finally:os.close(fd)


def validate_production_runtime(output,commit):
    runtime=private_receipt(output/'next-worker-runtime.json');started=private_receipt(output/'next-launch-started.json');exited=private_receipt(output/'next-launch-exit.json');summary=private_receipt(output/'next-build-summary.json')
    sealed=private_receipt(output/'production-web/summary.json')
    if summary!=sealed or not re.fullmatch(r'[a-f0-9]{40}',commit)or summary.get('sourceCommit')!=commit or not re.fullmatch(r'[a-f0-9]{64}',str(summary.get('manifestSha256'))):raise RuntimeError('SIX_RUNTIME_SEALED_MANIFEST')
    identity=runtime.get('process',{});cgroup=identity.get('cgroup',{})
    if runtime.get('kind')!='cn-next-production-runtime-v1' or started.get('mode')!='production-single' or started.get('process')!={k:identity.get(k)for k in ('pid','startTicks')} or type(identity.get('pid'))is not int or identity['pid']<=1 or not re.fullmatch(r'[1-9][0-9]*',str(identity.get('startTicks'))):raise RuntimeError('SIX_RUNTIME_IDENTITY')
    heap=runtime.get('heapSizeLimitBytes')
    if type(heap)is not int or not 2048*1024**2<=heap<2304*1024**2:raise RuntimeError('SIX_RUNTIME_HEAP')
    rows=started.get('resources',{}).get('observations',[])
    if not any(all(row.get(k)==cgroup.get(k)for k in ('inode','device','pathSha256'))for row in rows):raise RuntimeError('SIX_RUNTIME_CGROUP')
    if not any(row.get('available')is True and row.get('memory.max')==str(6*1024**3)for row in rows):raise RuntimeError('SIX_RUNTIME_UNIT')
    if any(value.get('manifestSha256')!=summary.get('manifestSha256')or value.get('sourceCommit')!=summary.get('sourceCommit')for value in (started,exited)):raise RuntimeError('SIX_RUNTIME_MANIFEST')
    if any(value.get('kind')!='cn-next-launch-v1'or value.get('mode')!='production-single'for value in (started,exited)):raise RuntimeError('SIX_RUNTIME_LAUNCH_KIND')
    if (exited.get('exitCode'),exited.get('signal'))not in ((0,None),(143,None),(None,'SIGTERM')):raise RuntimeError('SIX_RUNTIME_ABNORMAL_EXIT')
    if exited.get('started')is not True or exited.get('fatal',{}).get('jsHeapOom')is not False or exited.get('fatal',{}).get('otherFatal')is not False:raise RuntimeError('SIX_RUNTIME_EXIT')
    return dict(verified=True,heapSizeLimitBytes=heap,process=identity,manifestSha256=summary['manifestSha256'])


def production_command(env,verify=False):
    command=[env['CN_API_STARTUP_NODE'],'--import',str(ROOT/'node_modules/tsx/dist/loader.mjs'),str(ROOT/'tests/fixtures/cn-six-business/next-production-build.ts')]
    return command+(['--verify']if verify else [])


class Session:
    def __init__(self,root,run_id,round_id,commit,env,images):
        if root.name!='six-owners' or not root.is_absolute()or not re.fullmatch('round-(0[1-9]|10)',round_id):raise ValueError('SIX_SESSION_ROOT')
        for path in (root,*root.parents):
            info=path.lstat()
            if path.is_symlink()or not stat.S_ISDIR(info.st_mode)or info.st_uid!=0 or info.st_mode&0o022:raise RuntimeError('SIX_SESSION_ROOT_UNTRUSTED')
        self.root=root;self.output=root/round_id;self.output.mkdir(mode=0o700)
        self.env=dict(env);self.run_id=run_id;self.round_id=round_id;self.commit=commit;self.images=images
        self.lease_domain=None;self.lease_process=None;self.owner=None;self.started=time.monotonic();self.buffer=b'';self.prepared=False;self.production_cleanups=[]
        self.log=(self.output/'lease.log').open('xb')
        infra.durable(self.output,'session-intent.json',dict(runId=run_id,roundId=round_id,commit=commit,prepareBudgetSeconds=PREPARE_BUDGET,applicationBudgetSeconds=APPLICATION_BUDGET,cleanupBudgetSeconds=CLEANUP_BUDGET,productionAccepted=False,egressIsolated=False))
    def response(self,seconds=15):
        selector=selectors.DefaultSelector();selector.register(self.lease_process.stdout,selectors.EVENT_READ);end=time.monotonic()+seconds
        try:
            while b'\n'not in self.buffer:
                if time.monotonic()>=end:raise TimeoutError('SIX_LEASE_RESPONSE_TIMEOUT')
                if not selector.select(.1):continue
                chunk=os.read(self.lease_process.stdout.fileno(),4096)
                if not chunk:raise RuntimeError('SIX_LEASE_RESPONSE_EOF')
                self.buffer+=chunk
                if len(self.buffer)>16384:raise RuntimeError('SIX_LEASE_RESPONSE_LIMIT')
            raw,self.buffer=self.buffer.split(b'\n',1);return json.loads(raw)
        finally:selector.close()
    def request(self,value,seconds=15):
        self.lease_process.stdin.write((json.dumps(value)+'\n').encode());self.lease_process.stdin.flush();return self.response(seconds)
    def prepare(self):
        node=self.env['CN_API_STARTUP_NODE'];lease_dir=self.output/'port-leases';lease_dir.mkdir(mode=0o700)
        self.lease_domain=domains.Domain()
        self.lease_process=self.lease_domain.spawn([node,'--import',str(ROOT/'node_modules/tsx/dist/loader.mjs'),str(ROOT/'scripts/cn-release-six-port-lease.ts')],cwd=ROOT,env={**self.env,'CN_SIX_LEASE_DIR':str(lease_dir)},stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL)
        ready=self.response();isolated=ready.get('environment')
        if ready.get('reserved')is not True or ready.get('kind')!='cn-six-lease-v1'or not isinstance(isolated,dict)or not all(isinstance(k,str)and isinstance(v,str)for k,v in isolated.items()):raise RuntimeError('SIX_LEASE_INVALID')
        # The original allocator receives an empty inherited env, so these are
        # newly held sockets/leases, never reuse of a developer's stack.
        ports={r:int(isolated[k])for r,k in [('postgres','PGPORT'),('redis','REDIS_PORT')]}
        self.owner=infra.Owner(self.output,self.run_id,self.round_id,self.commit,self.images,ports,isolated['WORKSPACEX_DB'],deadline=self.started+PREPARE_BUDGET)
        infra.durable(self.output,'port-reservation.json',dict(reserved=True,environment=isolated))
        if self.request({'command':'release'})!={'released':True}:raise RuntimeError('SIX_LEASE_RELEASE_UNPROVEN')
        self.owner.start(deadline=self.started+PREPARE_BUDGET)
        if time.monotonic()-self.started>PREPARE_BUDGET:raise TimeoutError('SIX_PREPARE_TIMEOUT')
        self.prepared=True
        self.environment={**self.env,**isolated,**self.owner.environment,'GITHUB_RUN_ID':self.run_id,'CN_RELEASE_FULLSTACK_FIXTURE':'1','CN_SIX_REPORT_PATH':str(self.output/'playwright-report.json'),'CN_SIX_OUTPUT_DIR':str(self.output/'playwright-output'),'PGUSER':'postgres','PGPASSWORD':'postgres_dev'}
        self.environment.pop('WORKSPACEX_REUSE_INFRA',None)
        infra.durable(self.output,'session-ready.json',dict(prepared=True,prepareSeconds=time.monotonic()-self.started,report=self.environment['CN_SIX_REPORT_PATH'],productionAccepted=False,egressIsolated=False))
        return self.environment
    def production_build(self):
        if self.environment.get('CN_SIX_WEB_MODE','dev')!='production-single':return
        self.environment['CN_SIX_WEB_ARTIFACT']=str(self.output/'production-web')
        domain=domains.Domain();process=None;cleanup=None;error=None;started=time.monotonic()
        digest=hashlib.sha256();total=0;current=None;peak=None;exit_code=None
        selector=selectors.DefaultSelector();scratch=ROOT/'apps/web/.next-cn-six-production'
        try:
            process=domain.spawn(production_command(self.environment),cwd=ROOT,env=self.environment,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
            selector.register(process.stdout,selectors.EVENT_READ);end=started+BUILD_BUDGET
            while True:
                if time.monotonic()>=end:raise TimeoutError('SIX_BUILD_TIMEOUT')
                current=measured_tree_bytes(scratch,end);peak=max(peak or 0,current)
                if not selector.select(.2):continue
                raw=os.read(process.stdout.fileno(),65536)
                if not raw:break
                total+=len(raw);digest.update(raw)
                if total>16*1024*1024:raise RuntimeError('SIX_BUILD_OUTPUT_LIMIT')
            exit_code=process.wait(timeout=max(.01,end-time.monotonic()))
            if exit_code!=0:raise RuntimeError('SIX_BUILD_FAILED')
        except Exception as exc:error=str(exc)if str(exc)in ('SIX_BUILD_TIMEOUT','SIX_BUILD_FAILED','SIX_BUILD_OUTPUT_LIMIT','SIX_SCRATCH_LIMIT','SIX_SCRATCH_FILE_LIMIT','SIX_SCRATCH_TYPE')else type(exc).__name__
        finally:
            selector.close()
            try:cleanup=domain.close(process)
            except Exception as exc:error='build-cleanup-'+type(exc).__name__
            self.production_cleanups.append(cleanup)
            if isinstance(cleanup,dict)and cleanup.get('verified')is True and cleanup.get('populated')==0:
                try:
                    current=measured_tree_bytes(scratch,time.monotonic()+15);peak=max(peak or 0,current)
                except Exception as exc:error='build-final-zone-'+type(exc).__name__
            if process is not None and process.stdout is not None:process.stdout.close()
            infra.durable(self.output,'next-build-cleanup.json',dict(kind='cn-six-build-cleanup-v1',cleanup=cleanup,verified=isinstance(cleanup,dict)and cleanup.get('verified')is True and cleanup.get('populated')==0))
            infra.durable(self.output,'next-build-observation.json',dict(kind='cn-six-build-observation-v1',elapsedSeconds=time.monotonic()-started,wallBudgetSeconds=BUILD_BUDGET,heapMiB=2048,exitCode=exit_code,error=error,outputBytes=total,outputSha256=digest.hexdigest(),scratchCurrentBytes=current,scratchObservedPeakBytes=peak,scratchMaxBytes=ARTIFACT_ZONE_BYTES,isolatedTemporaryMaxBytes=3*ARTIFACT_ZONE_BYTES,productionAccepted=False,multiRoundReuse=False))
        if error is not None:raise RuntimeError(error)
        if not isinstance(cleanup,dict)or cleanup.get('verified')is not True or cleanup.get('populated')!=0:raise RuntimeError('SIX_BUILD_CLEANUP_UNPROVEN')
        self.verify_production()
    def verify_production(self):
        if self.environment.get('CN_SIX_WEB_MODE','dev')!='production-single':return
        domain=domains.Domain();process=None;cleanup=None
        try:
            process=domain.spawn(production_command(self.environment,True),cwd=ROOT,env=self.environment,stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
            if process.wait(timeout=60)!=0:raise RuntimeError('SIX_ARTIFACT_VERIFY_FAILED')
        finally:
            try:cleanup=domain.close(process)
            finally:self.production_cleanups.append(cleanup)
        if cleanup.get('verified')is not True or cleanup.get('populated')!=0:raise RuntimeError('SIX_ARTIFACT_VERIFY_CLEANUP')
    def finish(self,application_cleanup):
        began=time.monotonic();daemon=None;lease=None;error=None
        # Do not delete DB resources while app descendants could still write.
        app_ok=isinstance(application_cleanup,dict)and application_cleanup.get('verified')is True and application_cleanup.get('populated')==0 and all(isinstance(proof,dict)and proof.get('verified')is True and proof.get('populated')==0 for proof in getattr(self,'production_cleanups',[]))
        try:
            if not app_ok:raise RuntimeError('SIX_APPLICATION_CLEANUP_UNPROVEN')
            if self.owner is not None:daemon=self.owner.close(deadline=began+60)
            clear=daemon is None or daemon.get('verified')is True
            if self.lease_process is not None:
                reply=self.request({'command':'dispose','verified':clear},seconds=max(.001,min(15,began+CLEANUP_BUDGET-time.monotonic())))
                if reply!={'disposed':True,'verified':clear}:raise RuntimeError('SIX_LEASE_DISPOSE_UNPROVEN')
                self.lease_process.wait(timeout=10)
                if self.lease_process.returncode:raise RuntimeError('SIX_LEASE_EXIT_FAILED')
        except Exception as exc:error=type(exc).__name__
        finally:
            if self.lease_domain is not None:
                try:lease=self.lease_domain.close(self.lease_process)
                except Exception as exc:error='lease-'+type(exc).__name__
            for pipe in (self.lease_process.stdin,self.lease_process.stdout)if self.lease_process is not None else ():
                pipe.close()
            self.log.close()
        verified=app_ok and error is None and(daemon is None or daemon.get('verified')is True)and(lease is None or lease.get('verified')is True)
        value=dict(kind='cn-six-session-cleanup-v1',verified=verified,applicationCleanup=application_cleanup,daemonCleanup=daemon,leaseCleanup=lease,error=error,cleanupSeconds=time.monotonic()-began,totalSessionSeconds=time.monotonic()-self.started,productionAccepted=False,egressIsolated=False)
        infra.durable(self.output,'session-cleanup.json',value);return value


def playwright_command(env):
    return [env['CN_API_STARTUP_NODE'],str(ROOT/'apps/web/node_modules/@playwright/test/cli.js'),'test','--config',str(ROOT/'apps/web/playwright.cn-six-business.config.ts')]


def validate_report(path,required_titles):
    if path.is_symlink()or not path.is_file()or path.stat().st_size>2*1024*1024:raise RuntimeError('SIX_REPORT_REQUIRED')
    report=json.loads(path.read_bytes());stats=report.get('stats',{})
    if len(required_titles)!=6 or len(set(required_titles))!=6:raise ValueError('SIX_FIXED_TITLE_INVENTORY_REQUIRED')
    if stats.get('expected')!=6 or any(stats.get(k)!=0 for k in ('unexpected','flaky','skipped'))or report.get('errors'):raise RuntimeError('SIX_REPORT_NOT_ALL_PASSED')
    specs=[]
    def walk(suites):
        for suite in suites:
            specs.extend(suite.get('specs',[]));walk(suite.get('suites',[]))
    walk(report.get('suites',[]))
    if len(specs)!=6 or {s.get('title')for s in specs}!=set(required_titles):raise RuntimeError('SIX_REPORT_CASE_INVENTORY')
    for spec in specs:
        tests=spec.get('tests',[])
        if spec.get('ok')is not True or len(tests)!=1:raise RuntimeError('SIX_REPORT_SPEC_FAILED')
        test=tests[0];results=test.get('results',[])
        if test.get('projectName')!='cn-six-business'or test.get('expectedStatus')!='passed'or test.get('status')!='expected'or len(results)!=1 or results[0].get('status')!='passed'or results[0].get('retry')!=0 or results[0].get('errors'):raise RuntimeError('SIX_REPORT_ATTEMPT_FAILED')
    return dict(verified=True,journeyCount=6,aggregateCaseCount=1,durationMilliseconds=stats.get('duration'),titles=sorted(required_titles),productionAccepted=False,egressIsolated=False)

def report_diagnostic(path):
    if path.is_symlink()or not path.is_file()or path.stat().st_size>2*1024*1024:return {'reportAvailable':False}
    value=json.loads(path.read_bytes());stats=value.get('stats',{});errors=value.get('errors',[])
    if not isinstance(errors,list):return {'reportAvailable':True,'malformedErrors':True}
    projected=[]
    for error in errors[:8]:
        message=error.get('message','')if isinstance(error,dict)else''
        if not isinstance(message,str):message=''
        projected.append(dict(messageBytes=len(message.encode()),messageSha256=hashlib.sha256(message.encode()).hexdigest(),chatWarmup='[chat-route-warmup]'in message,budget300s='300000ms'in message))
    return dict(reportAvailable=True,statistics={k:stats[k]for k in ('expected','unexpected','flaky','skipped','duration')if isinstance(stats.get(k),(int,float))and not isinstance(stats.get(k),bool)},globalErrorCount=len(errors),globalErrors=projected)


def run_round(root,run_id,round_id,commit,env,images,required_titles):
    session=None;application=None;process=None;app_cleanup=None;session_cleanup=None;report=None;failure=None;production_runtime=None
    begin=time.monotonic();stage='prepare';diagnostic=None
    try:
        application=domains.Domain()
        session=Session(root,run_id,round_id,commit,env,images)
        prepared=session.prepare()
        stage='build';session.production_build()
        stage='application'
        with (session.output/'application.log').open('xb')as log:
            process=application.spawn(playwright_command(prepared),cwd=ROOT,env=prepared,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
            selector=selectors.DefaultSelector();selector.register(process.stdout,selectors.EVENT_READ);end=time.monotonic()+APPLICATION_BUDGET;total=0
            try:
                while True:
                    if time.monotonic()>=end:raise TimeoutError('SIX_APPLICATION_TIMEOUT')
                    if prepared.get('CN_SIX_WEB_MODE')=='production-single':measured_tree_bytes(session.output/'production-web/runtime',end)
                    if not selector.select(.1):continue
                    raw=os.read(process.stdout.fileno(),65536)
                    if not raw:break
                    total+=len(raw)
                    if total>16*1024*1024:raise RuntimeError('SIX_APPLICATION_LOG_LIMIT')
                    log.write(raw)
                if process.wait(timeout=max(.01,end-time.monotonic()))!=0:raise RuntimeError('SIX_APPLICATION_FAILED')
            finally:selector.close()
        stage='report';report=validate_report(Path(prepared['CN_SIX_REPORT_PATH']),required_titles)
    except Exception as exc:
        failure=type(exc).__name__;reason=str(exc)
        diagnostic=dict(stage=stage,reason=reason if reason in ('SIX_APPLICATION_TIMEOUT','SIX_APPLICATION_FAILED','SIX_APPLICATION_LOG_LIMIT','SIX_REPORT_REQUIRED','SIX_REPORT_NOT_ALL_PASSED','SIX_REPORT_CASE_INVENTORY','SIX_REPORT_SPEC_FAILED','SIX_REPORT_ATTEMPT_FAILED')else'UNCLASSIFIED',exitCode=process.returncode if process is not None else None)
        if session is not None:
            try:diagnostic['report']=report_diagnostic(session.output/'playwright-report.json')
            except Exception:diagnostic['report']={'reportAvailable':False,'projectionFailed':True}
    finally:
        if application is not None:
            try:app_cleanup=application.close(process)
            except Exception as exc:failure='application-cleanup-'+type(exc).__name__
        if process is not None and process.stdout is not None:process.stdout.close()
        if session is not None:
            try:
                if failure is None and app_cleanup is not None and app_cleanup.get('verified')is True:
                    try:
                        session.verify_production()
                        if session.environment.get('CN_SIX_WEB_MODE')=='production-single':
                            production_runtime=validate_production_runtime(session.output,session.commit)
                            production_runtime['runtimeActualBytes']=measured_tree_bytes(session.output/'production-web/runtime',time.monotonic()+15)
                            production_runtime['runtimeMaxBytes']=ARTIFACT_ZONE_BYTES
                    except Exception as exc:failure='artifact-verify-'+type(exc).__name__
                session_cleanup=session.finish(app_cleanup)
            except Exception as exc:failure='session-cleanup-'+type(exc).__name__
    result=dict(kind='cn-six-business-isolated-result-v1',verified=failure is None and report is not None and session_cleanup is not None and session_cleanup.get('verified')is True,failure=failure,diagnostic=diagnostic,productionRuntime=production_runtime,report=report,applicationCleanup=app_cleanup,sessionCleanup=session_cleanup,elapsedSeconds=time.monotonic()-begin,productionAccepted=False,egressIsolated=False)
    if session is not None:infra.durable(session.output,'result.json',result)
    return result
