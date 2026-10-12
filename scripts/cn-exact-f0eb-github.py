#!/usr/bin/env python3
"""GitHub-only fixed historical ZIP download, byte preflight and idle-daemon load."""
import argparse,datetime,hashlib,importlib.util,json,os,re,shutil,stat,subprocess,sys,tempfile,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
REPO='boardx/workspacex'
BRANCH='worker/codex-cn-autonomous-release'
LABEL='cn-exact-f0eb-preflight-38251278777'
TOTAL=2100
WORK=1800
STAGES=frozenset(('initial','event','checkout','resources','daemon-resources','domain-create','resource-limits','worker-spawn','worker-wait','worker-validation','worker-clone','worker-selection','worker-metadata','worker-download','worker-preflight','worker-image-snapshot','worker-load'))
REASONS=frozenset(('RESOURCE_CONTROLLER_UNAVAILABLE','RESOURCE_LIMIT_READBACK','TOTAL_DEADLINE','SIZE_LIMIT','DEADLINE','COMMAND_FAILED','GITHUB_ROOT_WORKER_ONLY','WORKER_EXACT_HEAD','OWNED_ROOT_PATH','OWNED_ROOT_PRIVATE','CLONE_HEAD','GH_REQUIRED','DOCKER_REQUIRED','BEFORE_IMAGE_IDS','WRAPPER_RAW_BYTES','WRAPPER_CHANGED','WRAPPER_EXPIRED','WRAPPER_METADATA_CHANGED','WRAPPER_TIME_EXPIRED','FIXED_SEVEN_WRAPPERS','STANDARD_RUNNER_DISK_INSUFFICIENT','MEMTOTAL','ROOT_CGROUP_REQUIRED','ACTUAL_EVENT_CHECKOUT','DOCKER_ROOT_REQUIRED','EVENT_LIMIT','GITHUB_LINUX_ONLY','FIXED_LABEL_ATTEMPT_ONLY','FIXED_SAME_REPO_PR','EXACT_EVENT_HEAD','RUN_ID'))
CONTROLS=(('memory.max',str(3*1024**3)),('memory.swap.max','0'),('pids.max','128'),('cpu.max','200000 100000'))
def diagnostic(stage,error):
    reason=str(error)
    if reason not in REASONS:
        reason=('OS_PERMISSION_DENIED' if isinstance(error,PermissionError) else
                'SUBPROCESS_TIMEOUT' if isinstance(error,subprocess.TimeoutExpired) else
                'OS_ERROR' if isinstance(error,OSError) else 'UNCLASSIFIED_FAILURE')
    return {'stage':stage if stage in STAGES else 'initial','reason':reason,'productionReady':False}
def controller_snapshot(path):
    rows=[]
    for name,expected in CONTROLS:
        row={'controller':name,'expected':expected,'exists':False,'actual':None,'readStatus':'absent'}
        try:
            control=path/name;row['exists']=control.is_file()
            if row['exists']:
                with control.open() as stream:raw=stream.read(129).strip()
                if len(raw)<=128 and re.fullmatch(r'(?:max|[0-9]+)(?: [0-9]+)?',raw):row.update(actual=raw,readStatus='read')
                else:row['readStatus']='invalid-value'
        except OSError:row['readStatus']='os-error'
        rows.append(row)
    return rows
def resource_limits(path):
    for name,value in CONTROLS:
        control=path/name;need(control.is_file(),'RESOURCE_CONTROLLER_UNAVAILABLE');control.write_text(value)
        need(control.read_text().strip()==value,'RESOURCE_LIMIT_READBACK')
def persist_worker_diagnostic(owned,value):
    # Failure diagnostics must not authorize a new arbitrary output path.
    try:
        st=owned.lstat()
        if owned.parent!=Path('/var/lib') or not owned.name.startswith('wsx-exact-f0eb-') or owned.resolve(strict=True)!=owned or not stat.S_ISDIR(st.st_mode) or st.st_uid!=0 or st.st_gid!=0 or stat.S_IMODE(st.st_mode)!=0o700:return
        write(owned/'worker-diagnostic.json',value)
    except (OSError,AttributeError,TypeError):pass
def need(ok,code):
    if not ok:raise RuntimeError(code)
def module(name,path):
    spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
preserve=module('exact_download_stream',ROOT/'scripts/preserve-cn-f0eb-originals.py')
def sha(raw):return hashlib.sha256(raw).hexdigest()
def write(path,value):preserve.private_file(path,preserve.canonical(value))
def source_git():
    return ['git','-c','safe.directory='+str(ROOT),'-c','safe.directory='+str(ROOT/'.git'),'-c','core.hooksPath=/dev/null','-c','protocol.file.allow=always']
def event_head(env,event):
    need(sys.platform=='linux' and env.get('GITHUB_ACTIONS')=='true' and env.get('GITHUB_REPOSITORY')==REPO,'GITHUB_LINUX_ONLY')
    need(env.get('GITHUB_EVENT_NAME')=='pull_request' and event.get('action')=='labeled' and event.get('label',{}).get('name')==LABEL and env.get('GITHUB_RUN_ATTEMPT')=='1','FIXED_LABEL_ATTEMPT_ONLY')
    pr=event.get('pull_request',{});h=pr.get('head',{});b=pr.get('base',{})
    need(pr.get('state')=='open' and h.get('repo',{}).get('full_name')==REPO and b.get('repo',{}).get('full_name')==REPO and h.get('ref')==BRANCH and b.get('ref')=='main','FIXED_SAME_REPO_PR')
    head=h.get('sha','');need(re.fullmatch('[a-f0-9]{40}',head) and env.get('EXACT_CHECKOUT_SHA')==head,'EXACT_EVENT_HEAD')
    need(re.fullmatch('[1-9][0-9]*',env.get('GITHUB_RUN_ID','')),'RUN_ID')
    return head
def metadata_pin(value,pin):
    need(type(value)is dict and value.get('expired')is False,'WRAPPER_EXPIRED')
    for key in ('id','name','size_in_bytes','digest','created_at','expires_at','workflow_run'):need(value.get(key)==pin[key],'WRAPPER_METADATA_CHANGED')
    need(datetime.datetime.fromisoformat(value['expires_at'].replace('Z','+00:00'))>datetime.datetime.now(datetime.timezone.utc),'WRAPPER_TIME_EXPIRED')
    return {k:value[k] for k in pin}
def selection(pinned,head):
    need(set(pinned['artifacts'])==set(preserve.SPECS) and pinned['runId']==38251278777 and pinned['originalSourceSha']==preserve.SOURCE,'FIXED_SEVEN_WRAPPERS')
    return {'kind':'isolated-f0eb-preserved-selection-v1','sourceRevision':preserve.SOURCE,'controlRevision':head,'preservationRunId':pinned['runId'],'artifacts':{s:{'artifactId':p['id'],'wrapperBytes':p['size_in_bytes'],'wrapperSha256':p['digest'].removeprefix('sha256:'),'file':s+'.zip'}for s,p in pinned['artifacts'].items()}}
def run(argv,end,limit=1048576,sink=None,*,token=False):
    remaining=end-time.monotonic();need(remaining>0,'TOTAL_DEADLINE')
    # Original bounded selector runner also kills/reaps its own child group.
    # Serial helper: only the three explicit gh calls may inherit its read token.
    removed={}
    if not token:
        for name in ('GH_TOKEN','GITHUB_TOKEN'):
            if name in os.environ:removed[name]=os.environ.pop(name)
    try:return preserve.stream([str(x)for x in argv],limit,remaining,sink)
    finally:os.environ.update(removed)
def copy_reports(owned,report):
    for source,name in ((owned/'worker-diagnostic.json','worker-diagnostic.json'),(owned/'controllers.json','controllers.json'),(owned/'resources.json','resources.json'),(owned/'daemon-resources.json','daemon-resources.json'),(owned/'selection.json','selection.json'),(owned/'preflight/preflight.json','preflight.json'),(owned/'preflight/loaded.json','loaded.json'),(owned/'preflight/load-claim.json','load-claim.json'),(owned/'before-image-ids.json','before-image-ids.json'),(owned/'cleanup.json','cleanup.json')):
        if not source.exists():continue
        st=source.lstat();need(stat.S_ISREG(st.st_mode)and st.st_nlink==1 and st.st_size<=1048576,'REPORT_BOUND')
        preserve.private_file(report/name,source.read_bytes())
def cleanup_loaded(root,before,end):
    loaded=root/'loaded.json'
    if not loaded.exists():return {'verified':not (root/'load-claim.json').exists(),'reason':'unknown-load-retained' if (root/'load-claim.json').exists()else'load-not-started'}
    data=json.loads(loaded.read_bytes());need(data.get('exactImagesLoaded')is True and data.get('servicesStarted')is False and data.get('productionReady')is False,'LOADED_RECEIPT')
    need(set(data['images'])=={'agent','api','postgres','sandbox','web'} and data.get('applicationRevision')==preserve.SOURCE and data.get('githubRunId')==os.environ['GITHUB_RUN_ID'],'LOADED_FIVE')
    original=(root/'set/candidate-set.json').read_bytes();need(sha(original)=='17dfdcc38f3d665b631cbeba001928856af6b9c9e4bda14e07abf72470bee193','CLEANUP_ORIGINAL_SET')
    entries=json.loads(original)['images']
    docker=shutil.which('docker');need(docker,'DOCKER_REQUIRED');removed=[]
    for service,image in data['images'].items():
        ident=image['daemonImageId'];tag=image['tag']
        need(re.fullmatch('sha256:[a-f0-9]{64}',ident) and ident not in before,'PREEXISTING_IMAGE_RETAINED')
        need(tag==entries[service]['stagingTag'] and image['originalConfigId']==entries[service]['imageId'] and image['originalTarSha256']==entries[service]['sha256'],'FIXED_CANDIDATE_TAG')
        _,_,raw=run([docker,'--host','unix:///var/run/docker.sock','image','inspect','--format','{{.Id}}',tag],end)
        need(raw.decode().strip()==ident,'CLEANUP_IMAGE_DRIFT')
        # No --force, no image ID deletion and no global prune.
        run([docker,'--host','unix:///var/run/docker.sock','image','rm','--no-prune',tag],end)
        _,_,gone=run([docker,'--host','unix:///var/run/docker.sock','image','ls','-q','--no-trunc',tag],end);need(not gone.strip(),'CLEANUP_TAG_STILL_PRESENT');removed.append(tag)
    return {'verified':True,'removedTags':removed,'containersStarted':False}
def worker(owned,head,progress=None):
    if progress is None:progress={}
    progress['stage']='worker-validation'
    need(sys.platform=='linux' and os.geteuid()==0 and os.environ.get('GITHUB_ACTIONS')=='true' and os.environ.get('GITHUB_REPOSITORY')==REPO and os.environ.get('GITHUB_RUN_ATTEMPT')=='1','GITHUB_ROOT_WORKER_ONLY')
    need(re.fullmatch('[a-f0-9]{40}',head or '') and os.environ.get('EXACT_CHECKOUT_SHA')==head,'WORKER_EXACT_HEAD')
    need(owned.parent==Path('/var/lib') and owned.name.startswith('wsx-exact-f0eb-') and owned.resolve(strict=True)==owned,'OWNED_ROOT_PATH')
    st=owned.lstat();need(stat.S_ISDIR(st.st_mode) and st.st_uid==0 and st.st_gid==0 and stat.S_IMODE(st.st_mode)==0o700,'OWNED_ROOT_PRIVATE')
    end=time.monotonic()+WORK;checkout=owned/'checkout';home=owned/'home';home.mkdir(mode=0o700)
    git=source_git()
    os.environ.update(HOME=str(home),GIT_CONFIG_GLOBAL='/dev/null',GIT_CONFIG_NOSYSTEM='1',GIT_ALLOW_PROTOCOL='file',GIT_TERMINAL_PROMPT='0')
    progress['stage']='worker-clone'
    run([*git,'clone','--no-hardlinks','--no-checkout','--',ROOT,checkout],end)
    run([*git,'-C',checkout,'checkout','--detach',head],end)
    _,_,actual=run([*git,'-C',checkout,'rev-parse','HEAD'],end);need(actual.decode().strip()==head,'CLONE_HEAD')
    progress['stage']='worker-selection'
    pins=json.loads((checkout/'tests/fixtures/cn-exact-candidate/preserved-wrappers.json').read_bytes());v=selection(pins,head)
    write(owned/'selection.json',v);inputs=owned/'inputs';inputs.mkdir(mode=0o700)
    gh=shutil.which('gh');need(gh,'GH_REQUIRED')
    for service in ('plan','set','agent','api','postgres','sandbox','web'):
        pin=pins['artifacts'][service];url='repos/'+REPO+'/actions/artifacts/'+str(pin['id'])
        progress['stage']='worker-metadata'
        _,_,raw=run([gh,'api',url],min(end,time.monotonic()+30),65536,token=True);before=metadata_pin(json.loads(raw),pin)
        progress['stage']='worker-download'
        fd=os.open(inputs/(service+'.zip'),os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
        with os.fdopen(fd,'wb')as sink:
            size,digest,_=run([gh,'api',url+'/zip'],min(end,time.monotonic()+900),pin['size_in_bytes'],sink,token=True);sink.flush();os.fsync(sink.fileno())
        need(size==pin['size_in_bytes'] and 'sha256:'+digest==pin['digest'],'WRAPPER_RAW_BYTES')
        progress['stage']='worker-metadata'
        _,_,raw=run([gh,'api',url],min(end,time.monotonic()+30),65536,token=True);need(metadata_pin(json.loads(raw),pin)==before,'WRAPPER_CHANGED')
    os.environ.pop('GH_TOKEN',None);os.environ.pop('GITHUB_TOKEN',None)
    digest=sha((owned/'selection.json').read_bytes());fixture=checkout/'tests/fixtures/cn-exact-candidate'
    progress['stage']='worker-preflight'
    run([sys.executable,'-I','-B',fixture/'preflight.py','--selection',owned/'selection.json','--selection-sha',digest,'--input-dir',inputs,'--output',owned/'preflight'],end)
    docker=shutil.which('docker');need(docker,'DOCKER_REQUIRED')
    progress['stage']='worker-image-snapshot'
    _,_,raw=run([docker,'--host','unix:///var/run/docker.sock','image','ls','-q','--no-trunc'],end)
    ids=raw.decode().splitlines();need(all(re.fullmatch('sha256:[a-f0-9]{64}',i)for i in ids),'BEFORE_IMAGE_IDS');write(owned/'before-image-ids.json',ids)
    preflight_sha=sha((owned/'preflight/preflight.json').read_bytes())
    progress['stage']='worker-load'
    run([sys.executable,'-I','-B',fixture/'load.py','--root',owned/'preflight','--preflight-sha',preflight_sha],end)
def main():
    a=argparse.ArgumentParser();a.add_argument('--worker',action='store_true');a.add_argument('--owned',type=Path);a.add_argument('--head');args=a.parse_args()
    if args.worker:
        progress={'stage':'worker-validation'}
        try:worker(args.owned,args.head,progress);return 0
        except Exception as error:
            failure=diagnostic(progress['stage'],error);persist_worker_diagnostic(args.owned,failure)
            print(json.dumps({'status':'FAILED_OR_UNKNOWN_NO_RETRY','diagnostic':failure,'productionReady':False}));return 1
    owned=None;domain=None;process=None;cleanup=None;daemon=None;status='failed';code=1;stage='initial';failure=None
    report=Path(os.environ['RUNNER_TEMP'])/'cn-exact-f0eb-report';report.mkdir(mode=0o700)
    try:
        stage='event'
        event=Path(os.environ['GITHUB_EVENT_PATH']);need(event.stat().st_size<=1048576,'EVENT_LIMIT');head=event_head(os.environ,json.loads(event.read_bytes()))
        need(os.geteuid()==0,'ROOT_CGROUP_REQUIRED')
        stage='checkout'
        _,_,actual=run([*source_git(),'rev-parse','HEAD'],time.monotonic()+5);need(actual.decode().strip()==head,'ACTUAL_EVENT_CHECKOUT')
        owned=Path(tempfile.mkdtemp(prefix='wsx-exact-f0eb-',dir='/var/lib'));owned.chmod(0o700)
        stage='resources'
        free=shutil.disk_usage(owned).free;mem=re.search(r'^MemTotal:\s+(\d+) kB$',Path('/proc/meminfo').read_text(),re.M);need(mem,'MEMTOTAL')
        memory=int(mem[1])*1024;resources={'diskFreeBytes':free,'requiredPreflightFreeBytes':30*1024**3,'cpuCount':os.cpu_count(),'memTotalBytes':memory,'originalServiceCapsWithHeadroomFit':memory>=16*1024**3,'productionReady':False};write(owned/'resources.json',resources)
        stage='daemon-resources'
        docker=shutil.which('docker');need(docker,'DOCKER_REQUIRED')
        _,_,raw=run([docker,'--host','unix:///var/run/docker.sock','info','--format','{{json .DockerRootDir}}'],time.monotonic()+30,65536)
        dockerroot=Path(json.loads(raw));need(dockerroot.is_absolute()and dockerroot.is_dir(),'DOCKER_ROOT_REQUIRED')
        write(owned/'daemon-resources.json',{'dockerRootDir':str(dockerroot),'diskFreeBytes':shutil.disk_usage(dockerroot).free,'requiredLoadFreeBytes':12*1024**3,'productionReady':False})
        need(free>=30*1024**3,'STANDARD_RUNNER_DISK_INSUFFICIENT')
        stage='domain-create'
        domain=module('exact_owned_domain',ROOT/'scripts/cn_release_simulation_domain.py').Domain()
        stage='resource-limits'
        # Only this newly-created process domain; no host/controller expansion.
        try:resource_limits(domain.path)
        finally:write(owned/'controllers.json',{'controllers':controller_snapshot(domain.path),'productionReady':False})
        env={k:v for k,v in os.environ.items()if k in ('PATH','GH_TOKEN','EXACT_CHECKOUT_SHA','GITHUB_ACTIONS','GITHUB_REPOSITORY','GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT','LANG')};env['PYTHONDONTWRITEBYTECODE']='1'
        stage='worker-spawn'
        process=domain.spawn([sys.executable,'-I','-B',__file__,'--worker','--owned',str(owned),'--head',head],cwd=ROOT,env=env,start_new_session=True)
        stage='worker-wait'
        code=process.wait(timeout=TOTAL);status='passed'if code==0 else'failed'
    except Exception as error:
        status='failed';failure=diagnostic(stage,error)
    finally:
        if domain is not None:
            try:cleanup=domain.close(process)
            except Exception:cleanup={'verified':False}
        elif process is None:cleanup={'verified':True,'populated':0,'notSpawned':True}
        if owned is not None:
            try:
                need(cleanup is not None and cleanup.get('verified')is True and cleanup.get('populated')==0,'DOMAIN_CLEANUP_UNKNOWN')
                before=json.loads((owned/'before-image-ids.json').read_bytes())if (owned/'before-image-ids.json').exists()else[]
                daemon=cleanup_loaded(owned/'preflight',set(before),time.monotonic()+120)
            except Exception as error:daemon={'verified':False,'errorType':type(error).__name__}
            write(owned/'cleanup.json',{'processDomain':cleanup,'daemon':daemon,'productionReady':False});copy_reports(owned,report)
            if cleanup and cleanup.get('verified')is True and daemon.get('verified')is True:shutil.rmtree(owned)
        write(report/'result.json',{'kind':'github-exact-f0eb-preflight-load-v1','status':status,'diagnostic':failure,'workerExitCode':code,'cleanup':cleanup,'daemonCleanup':daemon,'historicalSource':preserve.SOURCE,'processMemoryMaxBytes':3*1024**3,'processPidsMax':128,'workerSeconds':WORK,'outerSeconds':TOTAL,'ownedDirectory':str(owned) if owned else None,'servicesStarted':False,'sixBusinessesVerified':False,'proofRefreshed':False,'productionReady':False})
    return 0 if code==0 and cleanup and cleanup.get('verified')is True and daemon and daemon.get('verified')is True else 1
if __name__=='__main__':raise SystemExit(main())
