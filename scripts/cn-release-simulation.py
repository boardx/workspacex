#!/usr/bin/env python3
"""Credential-free isolated regressions of production release code, not a deployment."""
import argparse,concurrent.futures,csv,datetime,hashlib,importlib.util,json,os,platform,re,selectors,stat,statistics,subprocess,sys,time,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
SUITES={'release':['test_cn_release_*.py'],'hongkong':['test_cn_hk*.py'],'candidate':['test_cn_candidate_*.py'],'image-archive':['test_cn_image*.py','test_cn_archive*.py'],'legacy-faults':['test_release_failure_matrix.py'],'linux-process':['cn_hk_performance_linux.py'],'linux-domain':['cn_release_simulation_domain_linux.py']}
LOG_LIMIT=4*1024*1024
GAPS=['External GitHub/OSS/ACR/ECS/RDS operations use fixtures; no live provider acceptance.',
      'No production image build, paid resource, production database, traffic switch or live business acceptance.',
      'Fixture timings do not demonstrate production throughput or the 30-minute release target.',
      'Linux process fixtures exercise local process groups; they do not prove remote writes have stopped.']
def write_json(path,value):
    raw=(json.dumps(value,sort_keys=True,indent=2)+'\n').encode()
    with path.open('x')as f:f.write(raw.decode());f.flush();os.fsync(f.fileno())
def child(suite,result):
    if suite.startswith('linux-') and platform.system()!='Linux':raise RuntimeError('LINUX_REQUIRED')
    loader=unittest.TestLoader();tests=unittest.TestSuite()
    if suite=='linux-domain':
        spec=importlib.util.spec_from_file_location('cn_simulation_domain_integration',ROOT/'tests/cn_release_simulation_domain_linux.py')
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        def real_domain_contract():
            if module.main()!=0:raise AssertionError('REAL_DOMAIN_CONTRACT_FAILED')
        tests.addTest(unittest.FunctionTestCase(real_domain_contract))
    else:
        for pattern in SUITES[suite]:tests.addTests(loader.discover(str(ROOT/'tests'),pattern=pattern))
    def flatten(items):
        for item in items:
            if isinstance(item,unittest.TestSuite):yield from flatten(item)
            else:yield item
    cases={test.id():dict(caseId=test.id(),status='notrun',durationSeconds=None,layer='isolated-fixture') for test in flatten(tests)}
    write_json(result.with_suffix('.inventory.json'),list(cases.values()))
    class Result(unittest.TextTestResult):
        def startTest(self,test):
            super().startTest(test);self.started=time.monotonic()
        def mark(self,test,status):
            key=test.id() if test.id()in cases or not hasattr(test,'test_case') else test.test_case.id()
            if key not in cases:cases[key]=dict(caseId=key,status='notrun',durationSeconds=None,layer='isolated-fixture')
            cases[key]['status']=status
        def addSuccess(self,test):super().addSuccess(test);self.mark(test,'pass')
        def addFailure(self,test,err):super().addFailure(test,err);self.mark(test,'fail')
        def addError(self,test,err):super().addError(test,err);self.mark(test,'fail')
        def addSkip(self,test,reason):super().addSkip(test,reason);self.mark(test,'skip')
        def addExpectedFailure(self,test,err):super().addExpectedFailure(test,err);self.mark(test,'fail')
        def addUnexpectedSuccess(self,test):super().addUnexpectedSuccess(test);self.mark(test,'fail')
        def addSubTest(self,test,subtest,err):
            super().addSubTest(test,subtest,err)
            if err is not None:self.mark(test,'fail')
        def stopTest(self,test):
            cases[test.id()]['durationSeconds']=round(time.monotonic()-self.started,6);super().stopTest(test)
    outcome=unittest.TextTestRunner(verbosity=2,resultclass=Result).run(tests)
    value=dict(tests=outcome.testsRun,failures=len(outcome.failures),errors=len(outcome.errors),skipped=len(outcome.skipped),expectedFailures=len(outcome.expectedFailures),unexpectedSuccesses=len(outcome.unexpectedSuccesses))
    write_json(result,value);write_json(result.with_suffix('.cases.json'),list(cases.values()))
    return 0 if outcome.wasSuccessful() and outcome.testsRun>0 and not outcome.skipped and not outcome.expectedFailures else 1

def environment(output):
    home=output/'home';home.mkdir(mode=0o700,exist_ok=True)
    allowed=('PATH','TMPDIR','TEMP','TMP','CN_ARCHIVE_TEST_NODE','CN_ARCHIVE_TEST_RUNTIME','NODE_PATH','CN_TEST_PLAYWRIGHT','CN_TEST_CHROMIUM')
    return {**{k:os.environ[k]for k in allowed if k in os.environ},'HOME':str(home),'LANG':'C.UTF-8','PYTHONHASHSEED':'0','GIT_TERMINAL_PROMPT':'0','GIT_CONFIG_NOSYSTEM':'1'}
def domain_factory():
    spec=importlib.util.spec_from_file_location('cn_simulation_domain',ROOT/'scripts/cn_release_simulation_domain.py')
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    return module.Domain()
def execute(name,command,output,env,seconds,limit=LOG_LIMIT):
    start=time.monotonic();log=output/(name+'.log');result=output/(name+'.tests.json');reason=None;size=0;p=None;domain=None;cleanup=None
    try:
        with log.open('xb')as stream:
            domain=domain_factory()
            p=domain.spawn(command,cwd=ROOT,env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,start_new_session=True)
            selector=selectors.DefaultSelector();selector.register(p.stdout,selectors.EVENT_READ)
            try:
                while True:
                    if time.monotonic()-start>=seconds:reason='timeout';break
                    if not selector.select(min(.1,max(0,seconds-(time.monotonic()-start)))):continue
                    block=os.read(p.stdout.fileno(),min(65536,limit-size+1))
                    if not block:break
                    if size+len(block)>limit:reason='log-limit';break
                    stream.write(block);size+=len(block)
                if reason is None:
                    try:p.wait(timeout=max(.01,seconds-(time.monotonic()-start)))
                    except subprocess.TimeoutExpired:reason='timeout'
            finally:
                selector.close()
                try:cleanup=domain.close(p)
                except Exception as error:reason='cleanup-'+type(error).__name__
                p.stdout.close()
    except Exception as error:
        reason='runner-'+type(error).__name__
        if domain is not None and cleanup is None:
            try:cleanup=domain.close(p)
            except Exception:reason='cleanup-unproven'
    stats=None
    if result.exists():
        try:
            raw=result.read_bytes()
            if len(raw)<=16384:
                parsed=json.loads(raw);keys={'tests','failures','errors','skipped','expectedFailures','unexpectedSuccesses'}
                if set(parsed)==keys and all(type(v)is int and v>=0 for v in parsed.values()):stats=parsed
        except (ValueError,OSError):pass
    rc=p.returncode if p else None
    passed=reason is None and cleanup is not None and cleanup.get('verified')is True and rc==0 and stats is not None and stats['tests']>0 and stats['failures']==stats['errors']==stats['unexpectedSuccesses']==stats['skipped']==stats['expectedFailures']==0
    return dict(suite=name,command=command,cleanup=cleanup,exitCode=rc,status='passed'if passed else 'failed',reason=reason or (None if passed else 'test-failure-or-missing-stats'),durationSeconds=round(time.monotonic()-start,3),statistics=stats,casesEvidence=result.with_suffix('.cases.json').name if result.with_suffix('.cases.json').exists()else None,inventoryEvidence=result.with_suffix('.inventory.json').name if result.with_suffix('.inventory.json').exists()else None,log=log.name,logSha256=hashlib.sha256(log.read_bytes()).hexdigest()if log.exists()else None)
def quantify(summary,output):
    metrics=[]
    def metric(name,value,unit,denominator,evidence,round_id=None):
        metrics.append(dict(name=name,value=value,unit=unit,denominator=denominator,evidence=evidence,roundId=round_id,commit=summary['commit'],runId=summary['githubRunId'],observedAt=summary['finishedAt'],layer='isolated-fixture'))
    durations=[];complete_cases=True;all_cases=[]
    for row in summary['rounds']:
        rid=row['roundId'];evidence='round-'+rid+'/round.json';durations.append(row['durationSeconds'])
        metric('roundDuration',row['durationSeconds'],'seconds',1,evidence,rid)
        for suite in row['suites']:
            metric(suite['suite']+'.duration',suite.get('durationSeconds'),'seconds',1 if suite.get('durationSeconds')is not None else None,evidence,rid)
            for key in ('tests','failures','errors','skipped','expectedFailures','unexpectedSuccesses'):
                stats=suite.get('statistics');metric(suite['suite']+'.'+key,stats[key]if stats else None,'cases',stats['tests']if stats else None,evidence,rid)
            casepath=suite.get('casesEvidence')
            if casepath:
                cases=json.loads((output/('round-'+rid)/casepath).read_text())
                for case in cases:all_cases.append({**case,'roundId':rid,'suite':suite['suite'],'commit':summary['commit'],'runId':summary['githubRunId'],'observedAt':row['finishedAt'],'evidence':'round-'+rid+'/'+casepath})
            else:complete_cases=False
        for name,unit in [('artifactBytes','bytes'),('throughput','bytes/second'),('retryCount','attempts'),('peakDisk','bytes'),('recoveryDuration','seconds'),('safetyViolationCount','violations')]:metric(name,None,unit,None,None,rid)
    summary['caseResults']=all_cases
    summary['caseCounts']={status:sum(c['status']==status for c in all_cases)for status in ('pass','fail','skip','notrun')}
    summary['metrics']=metrics
    summary['durationDistribution']={'sampleCount':len(durations),'minSeconds':min(durations)if durations else None,'medianSeconds':statistics.median(durations)if durations else None,'maxSeconds':max(durations)if durations else None,'evidence':[f"round-{r['roundId']}/round.json" for r in summary['rounds']]}
    no_bad=complete_cases and bool(all_cases)and all(c['status']=='pass'for c in all_cases)
    summary['completeRegressionAccepted']=False
    summary['acceptanceGates']={'tenOfTen':summary['requestedRounds']==summary['completedRounds']==10 and summary['status']=='passed','requiredCasesNoFailureOrSkip':no_bad,'fullMatrixCoverage':None,'seriousIssuesClosed':None,'safetyInvariantsZeroViolations':None,'realCloudThirtyMinutes':None,'accepted':False}
    summary['coverageLayers']={'isolatedFixtures':{'executed':True,'evidence':'summary.json'},'realLocalProcesses':{'executed':None,'reason':'Suite includes real subprocess tests; no per-case audited layer mapping yet.'},'realCloud':{'executed':False},'production':{'executed':False}}
    summary['integrationGaps']+=['Full required matrix (including browser, cgroup and legacy coverage) and serious issue closure are not independently attested; simulation acceptance remains blocked.','Unmeasured bytes, throughput, retries, peak disk, recovery time and safety violations are null, not zero.']
def render_reports(output):
    # JSON is the single source for CSV and human-readable evidence.
    value=json.loads((output/'summary.json').read_text())
    with (output/'metrics.csv').open('x',newline='')as f:
        fields=['name','value','unit','denominator','evidence','roundId','commit','runId','observedAt','layer'];writer=csv.DictWriter(f,fieldnames=fields);writer.writeheader();writer.writerows(value['metrics'])
    with (output/'cases.csv').open('x',newline='')as f:
        fields=['caseId','status','durationSeconds','layer','roundId','suite','commit','runId','observedAt','evidence'];writer=csv.DictWriter(f,fieldnames=fields);writer.writeheader();writer.writerows(value['caseResults'])
    with (output/'report.txt').open('x')as f:
        f.write('Isolated release regression: '+value['status']+'\nCommit: '+value['commit']+'\nCompleted rounds: '+str(value['completedRounds'])+'/'+str(value['requestedRounds'])+'\nCase counts: '+json.dumps(value['caseCounts'],sort_keys=True)+'\nProduction accepted: false\nFull acceptance gates: '+json.dumps(value['acceptanceGates'],sort_keys=True)+'\nDuration sample summary (fixture time only): '+json.dumps(value['durationDistribution'],sort_keys=True)+'\nNull metrics are unmeasured. CSV is derived from summary.json.\n'+'\n'.join(value['integrationGaps'])+'\n')

def export_reports(parent):
    """Copy only bounded named reports; never expose HOME or chmod source data.
    Destination must be created by the unprivileged CI artifact uploader first.
    """
    parent=parent.resolve(strict=True);source=parent/'cn-simulation';target=parent/'cn-simulation-artifacts'
    flags=os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW
    target_fd=os.open(target,flags);source_fd=None;total=0;count=0
    try:
        owner=os.fstat(target_fd)
        if stat.S_IMODE(owner.st_mode)!=0o700:raise ValueError('EXPORT_DESTINATION_PRIVATE_REQUIRED')
        if not source.exists():return {'files':0,'bytes':0,'sourceMissing':True}
        source_fd=os.open(source,flags)
        def copy_file(src_fd,dst_fd,name):
            nonlocal total,count
            try:fd=os.open(name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=src_fd)
            except FileNotFoundError:return
            with os.fdopen(fd,'rb')as stream:
                before=os.fstat(stream.fileno())
                if not stat.S_ISREG(before.st_mode)or before.st_nlink!=1 or before.st_size>16*1024*1024:raise ValueError('EXPORT_FILE_REJECTED')
                if count>=500 or total+before.st_size>512*1024*1024:raise ValueError('EXPORT_TOTAL_LIMIT')
                out=os.open(name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=dst_fd)
                with os.fdopen(out,'wb')as sink:
                    os.fchown(sink.fileno(),owner.st_uid,owner.st_gid)
                    remaining=before.st_size
                    while remaining:
                        block=stream.read(min(65536,remaining))
                        if not block:raise ValueError('EXPORT_TRUNCATED')
                        sink.write(block);remaining-=len(block)
                    after=os.fstat(stream.fileno())
                    if stream.read(1)or (before.st_size,before.st_mtime_ns,before.st_ctime_ns)!=(after.st_size,after.st_mtime_ns,after.st_ctime_ns):raise ValueError('EXPORT_CHANGED')
                total+=before.st_size;count+=1
        for name in ('summary.json','metrics.csv','cases.csv','report.txt'):copy_file(source_fd,target_fd,name)
        for index in range(1,11):
            name='round-%02d'%index
            try:round_fd=os.open(name,flags,dir_fd=source_fd)
            except FileNotFoundError:continue
            try:
                os.mkdir(name,0o700,dir_fd=target_fd);out_fd=os.open(name,flags,dir_fd=target_fd)
                try:
                    os.fchown(out_fd,owner.st_uid,owner.st_gid)
                    copy_file(round_fd,out_fd,'round.json')
                    for suite in SUITES:
                        for suffix in ('.log','.tests.json','.tests.inventory.json','.tests.cases.json'):copy_file(round_fd,out_fd,suite+suffix)
                finally:os.close(out_fd)
            finally:os.close(round_fd)
        return {'files':count,'bytes':total,'sourceMissing':False}
    finally:
        if source_fd is not None:os.close(source_fd)
        os.close(target_fd)

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--export-parent',type=Path);p.add_argument('--child',choices=SUITES);p.add_argument('--result',type=Path);p.add_argument('--output',type=Path);p.add_argument('--suite',choices=['all',*SUITES],default='all');p.add_argument('--workers',type=int,choices=range(1,4),default=3);p.add_argument('--timeout-seconds',type=int,default=480);p.add_argument('--rounds',type=int,choices=(1,10),default=1);p.add_argument('--seed',type=int,default=0);args=p.parse_args()
    if args.export_parent is not None:
        print(json.dumps(export_reports(args.export_parent),sort_keys=True));return 0
    if args.child:
        if not args.result:p.error('--result required for child')
        return child(args.child,args.result)
    if args.output is None or not 1<=args.timeout_seconds<=1200:p.error('new --output and timeout 1..1200 required')
    output=args.output.resolve()
    if output==ROOT or ROOT in output.parents:raise ValueError('OUTPUT_MUST_BE_OUTSIDE_CHECKOUT')
    output.mkdir(mode=0o700,parents=False,exist_ok=False)
    commit=subprocess.check_output(['git','-c','safe.directory='+str(ROOT),'-C',str(ROOT),'rev-parse','HEAD'],text=True).strip()
    if not re.fullmatch('[a-f0-9]{40}',commit):raise ValueError('COMMIT_INVALID')
    dirty=bool(subprocess.check_output(['git','-c','safe.directory='+str(ROOT),'-C',str(ROOT),'status','--porcelain','--untracked-files=all'],text=True))
    if args.rounds==10 and dirty:raise ValueError('TEN_ROUNDS_REQUIRE_CLEAN_FIXED_COMMIT')
    names=list(SUITES)if args.suite=='all'else[args.suite]
    if args.rounds==10 and args.suite!='all':raise ValueError('TEN_ROUNDS_REQUIRE_ALL_SUITES')
    started=datetime.datetime.now(datetime.timezone.utc).isoformat();rounds=[]
    for index in range(args.rounds):
        round_start=time.monotonic();round_started=datetime.datetime.now(datetime.timezone.utc).isoformat()
        round_id='%02d'%(index+1);folder=output/('round-'+round_id);folder.mkdir(mode=0o700)
        seed=args.seed+index;env=environment(folder);env['CN_RELEASE_SIMULATION_SEED']=str(seed)
        with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers)as pool:
            futures=[pool.submit(execute,name,[sys.executable,'-I','-B',str(Path(__file__).resolve()),'--child',name,'--result',str(folder/(name+'.tests.json'))],folder,env,args.timeout_seconds)for name in names]
            rows=[future.result()for future in futures]
        head=subprocess.check_output(['git','-c','safe.directory='+str(ROOT),'-C',str(ROOT),'rev-parse','HEAD'],text=True).strip()
        changed=bool(subprocess.check_output(['git','-c','safe.directory='+str(ROOT),'-C',str(ROOT),'status','--porcelain','--untracked-files=all'],text=True))
        fixed=head==commit and not dirty and not changed
        value=dict(roundId=round_id,startedAt=round_started,finishedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),durationSeconds=round(time.monotonic()-round_start,3),commit=commit,seed=seed,sourceUnchanged=fixed,suites=rows,status='passed'if fixed and all(x['status']=='passed'for x in rows)else'failed',externalServiceMode='fixtures',integrationGaps=GAPS)
        write_json(folder/'round.json',value);rounds.append(value)
        if value['status']!='passed':break
    summary=dict(kind='cn-release-isolated-simulation-v1',commit=commit,trackedChanges=dirty,githubRunId=os.environ.get('GITHUB_RUN_ID'),githubRunAttempt=os.environ.get('GITHUB_RUN_ATTEMPT'),startedAt=started,finishedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),requestedRounds=args.rounds,completedRounds=len(rounds),baseSeed=args.seed,rounds=rounds,status='passed'if len(rounds)==args.rounds and all(x['status']=='passed'for x in rounds)else'failed',productionAccepted=False,externalServiceMode='fixtures',integrationGaps=GAPS)
    quantify(summary,output)
    write_json(output/'summary.json',summary);render_reports(output);print(json.dumps({'summary':str(output/'summary.json'),'status':summary['status'],'commit':commit,'completedRounds':len(rounds),'completeRegressionAccepted':False},sort_keys=True));return 0 if summary['status']=='passed'else 1
if __name__=='__main__':sys.exit(main())
