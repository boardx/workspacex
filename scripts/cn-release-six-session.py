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
import shutil
import time
ROOT=Path(__file__).resolve().parents[1]
def load(name,path):
    spec=importlib.util.spec_from_file_location(name,path);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
infra=load('six_infra_session',ROOT/'scripts/cn-release-six-infra.py')
domains=load('six_session_domains',ROOT/'scripts/cn_release_simulation_domain.py')
PREPARE_BUDGET=120
APPLICATION_BUDGET=1200
CLEANUP_BUDGET=90


class Session:
    def __init__(self,root,run_id,round_id,commit,env,images):
        if root.name!='six-owners' or not root.is_absolute()or not re.fullmatch('round-(0[1-9]|10)',round_id):raise ValueError('SIX_SESSION_ROOT')
        for path in (root,*root.parents):
            info=path.lstat()
            if path.is_symlink()or not stat.S_ISDIR(info.st_mode)or info.st_uid!=0 or info.st_mode&0o022:raise RuntimeError('SIX_SESSION_ROOT_UNTRUSTED')
        self.root=root;self.output=root/round_id;self.output.mkdir(mode=0o700)
        self.env=dict(env);self.run_id=run_id;self.round_id=round_id;self.commit=commit;self.images=images
        self.lease_domain=None;self.lease_process=None;self.owner=None;self.started=time.monotonic();self.buffer=b'';self.prepared=False
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
        self.environment={**self.env,**isolated,**self.owner.environment,'GITHUB_RUN_ID':self.run_id,'CN_RELEASE_FULLSTACK_FIXTURE':'1','CN_SIX_SOURCE_COMMIT':self.commit,'CN_SIX_REPORT_PATH':str(self.output/'playwright-report.json'),'CN_SIX_OUTPUT_DIR':str(self.output/'playwright-output'),'PGUSER':'postgres','PGPASSWORD':'postgres_dev'}
        self.environment.pop('WORKSPACEX_REUSE_INFRA',None)
        infra.durable(self.output,'session-ready.json',dict(prepared=True,prepareSeconds=time.monotonic()-self.started,report=self.environment['CN_SIX_REPORT_PATH'],productionAccepted=False,egressIsolated=False))
        return self.environment
    def finish(self,application_cleanup):
        began=time.monotonic();daemon=None;lease=None;error=None
        # Do not delete DB resources while app descendants could still write.
        app_ok=isinstance(application_cleanup,dict)and application_cleanup.get('verified')is True and application_cleanup.get('populated')==0
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


def build_command(env):
    return [env['CN_API_STARTUP_NODE'],'--import',str(ROOT/'node_modules/tsx/dist/loader.mjs'),str(ROOT/'tests/fixtures/cn-six-business/next-production-build.ts')]


def run_phase(domain,command,env,log_path,deadline,phase):
    process=None
    try:
        with log_path.open('xb')as log:
            process=domain.spawn(command,cwd=ROOT,env=env,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
            selector=selectors.DefaultSelector();selector.register(process.stdout,selectors.EVENT_READ);total=0
            try:
                while True:
                    if time.monotonic()>=deadline:raise TimeoutError('SIX_'+phase+'_TIMEOUT')
                    if not selector.select(.1):continue
                    raw=os.read(process.stdout.fileno(),65536)
                    if not raw:break
                    total+=len(raw)
                    if total>16*1024*1024:raise RuntimeError('SIX_'+phase+'_LOG_LIMIT')
                    log.write(raw)
                if process.wait(timeout=max(.01,deadline-time.monotonic()))!=0:raise RuntimeError('SIX_'+phase+'_FAILED')
            finally:selector.close()
    finally:
        if process is not None and process.stdout is not None:process.stdout.close()



def cleanup_build(output,commit,application_cleanup):
    if not isinstance(application_cleanup,dict)or application_cleanup.get('verified')is not True or application_cleanup.get('populated')!=0:raise RuntimeError('SIX_BUILD_CLEANUP_UNPROVEN')
    dist=ROOT/'apps/web/.next-chat-read-e2e';intent=output/'next-build-intent.json'
    if not intent.exists():
        if dist.exists()or dist.is_symlink():raise RuntimeError('SIX_BUILD_OWNER_MISSING')
        return dict(verified=True,created=False)
    info=intent.lstat()
    if not stat.S_ISREG(info.st_mode)or intent.is_symlink()or info.st_nlink!=1 or info.st_size>16384:raise RuntimeError('SIX_BUILD_OWNER_INVALID')
    owner=json.loads(intent.read_bytes())
    if owner.get('sourceCommit')!=commit:raise RuntimeError('SIX_BUILD_SOURCE_CHANGED')
    info=dist.lstat()
    if not stat.S_ISDIR(info.st_mode)or dist.is_symlink()or (info.st_dev,info.st_ino)!=(owner.get('distDevice'),owner.get('distInode')):raise RuntimeError('SIX_BUILD_OWNER_CHANGED')
    shutil.rmtree(dist)
    return dict(verified=True,created=True,removed=True)


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
    session=None;application=None;process=None;app_cleanup=None;session_cleanup=None;report=None;failure=None
    begin=time.monotonic();stage='prepare';diagnostic=None;build_cleanup=None;build_started=False
    try:
        application=domains.Domain()
        session=Session(root,run_id,round_id,commit,env,images)
        prepared=session.prepare()
        # Build and six journeys share the original application budget and unit.
        end=time.monotonic()+APPLICATION_BUDGET
        stage='build'
        build_started=True
        try:run_phase(application,build_command(prepared),prepared,session.output/'next-build.log',end,'BUILD')
        finally:
            # Confirm compiler descendants are gone before starting services.
            build_cleanup=application.close();app_cleanup=build_cleanup;application=None
            infra.durable(session.output,'next-build-process-cleanup.json',build_cleanup)
            if not isinstance(build_cleanup,dict)or build_cleanup.get('verified')is not True or build_cleanup.get('populated')!=0:raise RuntimeError('SIX_BUILD_CLEANUP_UNPROVEN')
        stage='application'
        if time.monotonic()>=end:raise TimeoutError('SIX_APPLICATION_TIMEOUT')
        application=domains.Domain();app_cleanup=None
        with (session.output/'application.log').open('xb')as log:
            if time.monotonic()>=end:raise TimeoutError('SIX_APPLICATION_TIMEOUT')
            process=application.spawn(playwright_command(prepared),cwd=ROOT,env=prepared,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
            selector=selectors.DefaultSelector();selector.register(process.stdout,selectors.EVENT_READ);total=0
            try:
                while True:
                    if time.monotonic()>=end:raise TimeoutError('SIX_APPLICATION_TIMEOUT')
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
        diagnostic=dict(stage=stage,reason=reason if reason in ('SIX_BUILD_TIMEOUT','SIX_BUILD_FAILED','SIX_BUILD_LOG_LIMIT','SIX_BUILD_CLEANUP_UNPROVEN','SIX_APPLICATION_TIMEOUT','SIX_APPLICATION_FAILED','SIX_APPLICATION_LOG_LIMIT','SIX_REPORT_REQUIRED','SIX_REPORT_NOT_ALL_PASSED','SIX_REPORT_CASE_INVENTORY','SIX_REPORT_SPEC_FAILED','SIX_REPORT_ATTEMPT_FAILED')else'UNCLASSIFIED',exitCode=process.returncode if process is not None else None)
        if session is not None:
            try:diagnostic['report']=report_diagnostic(session.output/'playwright-report.json')
            except Exception:diagnostic['report']={'reportAvailable':False,'projectionFailed':True}
    finally:
        if application is not None:
            try:app_cleanup=application.close(process)
            except Exception as exc:failure='application-cleanup-'+type(exc).__name__
        if process is not None and process.stdout is not None:process.stdout.close()
        if session is not None:
            if build_started:
                try:infra.durable(session.output,'next-build-cleanup.json',cleanup_build(session.output,commit,app_cleanup))
                except Exception as exc:failure='build-cleanup-'+type(exc).__name__
            try:session_cleanup=session.finish(app_cleanup)
            except Exception as exc:failure='session-cleanup-'+type(exc).__name__
    result=dict(kind='cn-six-business-isolated-result-v1',verified=failure is None and report is not None and session_cleanup is not None and session_cleanup.get('verified')is True,failure=failure,diagnostic=diagnostic,report=report,applicationCleanup=app_cleanup,sessionCleanup=session_cleanup,elapsedSeconds=time.monotonic()-begin,productionAccepted=False,egressIsolated=False)
    if session is not None:infra.durable(session.output,'result.json',result)
    return result
