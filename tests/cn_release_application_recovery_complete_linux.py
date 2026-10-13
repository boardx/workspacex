#!/usr/bin/env python3
"""Linux-only complete control-schema recovery fixture through original durable driver.
No cloud/production target; no image pulls. Requires outer exact-owned Docker cleanup.
"""
import hashlib,json,os,re,secrets,selectors,shutil,signal,stat,subprocess,sys,tempfile,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
env={'PATH':os.environ.get('PATH','/usr/bin:/bin'),'LANG':'C.UTF-8'}
DEADLINE=None
MEMORY_BYTES=2*1024**3
TMPFS_BYTES=1024**3
PGDATA='/var/lib/postgresql/data'
def need(value,code):
    if not value:raise RuntimeError(code)
def postgres_command():
    # Overriding the image CMD must retain its non-superuser AGE prerequisite.
    return ['postgres','-c','shared_preload_libraries=age','-c','listen_addresses=','-c','statement_timeout=85000']
def validate_preload(raw):
    need(raw.strip()==b'age','AGE_PRELOAD_REQUIRED')
def check_preload(docker,container):
    validate_preload(run([docker,'exec',container,'psql','-XAt','-U','fixture_owner','-d','postgres','-c',"SELECT current_setting('shared_preload_libraries')"]).stdout)
def bridge_command(bridge,*arguments):
    # The child environment is deliberately minimal; parent Python flags and
    # PYTHONDONTWRITEBYTECODE do not propagate across exec. Pin both explicitly.
    return [sys.executable,'-I','-B',bridge,*arguments]
def failure_projection(stderr,root):
    text=stderr[:8192].decode('utf8',errors='replace')
    reasons={'FIXTURE_CHAIN_INCOMPLETE','EXECUTION_UNCERTAIN_RECONCILE_NO_RETRY','OBSERVATION_FAILED','EVIDENCE_NOT_VERIFIED','PHASE_EVIDENCE_LIMIT','ENTRY_SOURCE_CHANGED','PHASE_CHAIN_CHANGED','FIXTURE_REPLAY_CHANGED'}
    found=re.findall(r'^(?:RuntimeError|[A-Za-z_][A-Za-z0-9_]*\.Rejected|Rejected): ([A-Z][A-Z0-9_]{0,79})$',text,re.M)
    frames=[dict(file=name,line=int(line))for name,line in re.findall(r'File "[^"\n]*/([^/"\n]+)", line ([0-9]+)',text)if name in ('driver_bridge.py','cn-release-fixed-driver.py','cn-release-advance.py')][:6]
    phases=('init','backup','restore','compatibility','migration-fault','startup-fault','postclear-fault','finalize')
    records=[dict(phase=p,intentPresent=(root/'application-journal'/(p+'.intent.json')).is_file(),receiptPresent=(root/'application-journal'/(p+'.result.json')).is_file())for p in phases]
    terminal=None
    for line in text.splitlines():
        if not line.startswith('CN_PG_RESTORE_DIAGNOSTIC '):continue
        try:
            value=json.loads(line[len('CN_PG_RESTORE_DIAGNOSTIC '):])
            if set(value)!={'kind','terminal','process'}or value['kind']!='pg-restore-terminal-diagnostic-v1':continue
            t=value['terminal'];p=value['process']
            if t is not None and not (isinstance(t,dict)and set(t)=={'reason','exitCode','stdoutSha256','processGroupStillPresent'}and t['reason']in ('EXITED','TIMEOUT','OUTPUT_LIMIT','ISOLATION_UNPROVEN')and (t['exitCode']is None or type(t['exitCode'])is int)and type(t['processGroupStillPresent'])is bool and isinstance(t['stdoutSha256'],str)and re.fullmatch('[a-f0-9]{64}',t['stdoutSha256'])):continue
            if p is not None and not(isinstance(p,dict)and set(p)=={'pid','requestSha256'}and type(p['pid'])is int and p['pid']>0 and isinstance(p['requestSha256'],str)and re.fullmatch('[a-f0-9]{64}',p['requestSha256'])):continue
            terminal=value
        except (ValueError,TypeError,KeyError):continue
    return dict(reason=found[-1]if found and found[-1]in reasons else 'UNCLASSIFIED',frames=frames,phaseRecords=records,phaseRecordsVerified=False,restoreTerminalDiagnostic=terminal)
def development_failure(failure, exit_code):
    # A missing receipt can make the driver uncertain even after an observed
    # assertion exit. Only its actual terminal record proves that distinction.
    if not isinstance(failure,dict) or failure.get('stage')!='original-durable-driver' or failure.get('reason')!='DURABLE_CHAIN_FAILED' or type(exit_code)is not int or exit_code!=1:return False
    diagnostic=failure.get('bridgeDiagnostic')or{}
    if diagnostic.get('reason') not in ('FIXTURE_CHAIN_INCOMPLETE','EXECUTION_UNCERTAIN_RECONCILE_NO_RETRY'):return False
    record=diagnostic.get('restoreTerminalDiagnostic')or{}
    terminal=record.get('terminal')or{}
    return (record.get('kind')=='pg-restore-terminal-diagnostic-v1' and terminal.get('reason')=='EXITED'
            and type(terminal.get('exitCode'))is int and terminal['exitCode']>0
            and terminal.get('processGroupStillPresent')is False)
def validate_image_storage(image):
    config=image.get('Config',{})
    need(set((config.get('Volumes')or{}))<= {PGDATA},'UNEXPECTED_IMAGE_VOLUME')
    need([v.split('=',1)[1]for v in config.get('Env',[])if v.startswith('PGDATA=')]==[PGDATA],'IMAGE_PGDATA_MISMATCH')
def validate_container_storage(info,socket):
    host=info.get('HostConfig',{})
    need(host.get('Memory')==MEMORY_BYTES and host.get('MemorySwap')==MEMORY_BYTES,'MEMORY_LIMIT_MISMATCH')
    need(host.get('Tmpfs')=={PGDATA:'rw,size='+str(TMPFS_BYTES)} and not host.get('Binds'),'TMPFS_LIMIT_MISMATCH')
    mounts=info.get('Mounts',[])
    bind=[x for x in mounts if x.get('Type')=='bind']
    need(len(bind)==1 and bind[0].get('Source')==str(socket) and bind[0].get('Destination')=='/var/run/postgresql' and bind[0].get('RW') is True,'SOCKET_BIND_MISMATCH')
    need(all(x in bind or x.get('Type')=='tmpfs' and x.get('Destination')==PGDATA for x in mounts),'IMPLICIT_PERSISTENT_VOLUME')
def run(args,*,timeout=60,check=True,childenv=None,cwd=None):
    if DEADLINE is not None:timeout=min(timeout,DEADLINE-time.monotonic())
    need(timeout>0,'TOTAL_FIXTURE_DEADLINE')
    p=subprocess.Popen([str(x)for x in args],stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,
                       env=childenv or env,cwd=cwd or '/',start_new_session=True)
    streams={p.stdout:bytearray(),p.stderr:bytearray()};selector=selectors.DefaultSelector()
    for pipe in streams:selector.register(pipe,selectors.EVENT_READ)
    end=time.monotonic()+timeout;reaped=False
    try:
        while selector.get_map():
            need(time.monotonic()<end,'CHILD_TIMEOUT')
            for key,_ in selector.select(min(.1,max(0,end-time.monotonic()))):
                block=os.read(key.fileobj.fileno(),65536)
                if not block:selector.unregister(key.fileobj);continue
                streams[key.fileobj].extend(block)
                need(sum(map(len,streams.values()))<=4*1024*1024,'CHILD_OUTPUT_BOUND')
        p.wait(timeout=max(.01,end-time.monotonic()));reaped=True
        out,err=bytes(streams[p.stdout]),bytes(streams[p.stderr])
    except BaseException:
        # Child has not been reaped: only this still-owned group can be signalled.
        # Escaped sessions remain owned by the enclosing simulation cgroup.
        if not reaped:
            try:os.killpg(p.pid,signal.SIGKILL)
            except ProcessLookupError:pass
            p.wait(timeout=5)
        raise
    finally:
        selector.close()
        for stream in streams:stream.close()
    result=subprocess.CompletedProcess(args,p.returncode,out,err)
    if check and result.returncode!=0:raise RuntimeError('CHILD_FAILED_'+str(result.returncode))
    return result

def main():
    global DEADLINE
    if sys.platform!='linux' or os.geteuid()!=0:
        print(json.dumps({'verified':False,'reason':'ROOT_LINUX_REQUIRED','productionAccepted':False}));return 2
    started=time.monotonic();DEADLINE=started+720;temporary=None;container=None;registry_fd=None;cleanup=False;failure=None;result=None;stage='capability'
    token=os.environ.get('CN_API_STARTUP_OWNER_TOKEN','');name='wsx-cn-api-'+secrets.token_hex(8);docker=shutil.which('docker')
    try:
        need(re.fullmatch('[a-f0-9]{32}',token),'OUTER_OWNER_REQUIRED')
        registry=Path(os.environ.get('CN_API_STARTUP_OWNER_DIR','/missing-owner'))
        registry_fd=os.open(registry,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW);info=os.fstat(registry_fd)
        need(info.st_uid==0 and stat.S_IMODE(info.st_mode)==0o700,'OWNER_DIRECTORY_REQUIRED')
        def durable(filename,value):
            fd=os.open(filename,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=registry_fd)
            with os.fdopen(fd,'w')as f:json.dump(value,f);f.write('\n');f.flush();os.fsync(f.fileno())
            os.fsync(registry_fd)
        image=os.environ.get('CN_API_STARTUP_PG_IMAGE','');need(docker and re.fullmatch('sha256:[a-f0-9]{64}',image),'IMMUTABLE_LOCAL_IMAGE_REQUIRED')
        facts=json.loads(run([docker,'image','inspect',image]).stdout)
        revision=run(['git','-C',ROOT,'rev-parse','HEAD']).stdout.decode().strip()
        need(len(facts)==1 and facts[0]['Id']==image and facts[0]['Os']=='linux' and facts[0]['Architecture']=='amd64','IMAGE_IDENTITY')
        validate_image_storage(facts[0])
        need(facts[0].get('Config',{}).get('Labels',{}).get('org.opencontainers.image.revision')==revision,'IMAGE_REVISION')
        node=Path(os.environ.get('CN_API_STARTUP_NODE',shutil.which('node')or'/missing')).resolve();loader=ROOT/'apps/api/node_modules/tsx/dist/loader.mjs'
        need(node.is_file() and loader.is_file(),'NODE_DEPENDENCIES_REQUIRED')
        need(run([node,'-p','process.versions.node']).stdout.decode().startswith('22.'),'NODE22_REQUIRED')
        seed=int(os.environ.get('CN_RELEASE_SIMULATION_SEED','0'));need(0<=seed<=2**32-1,'SEED_REQUIRED')
        temporary=Path(tempfile.mkdtemp(prefix='wsx-pg-fixture-'));temporary.chmod(0o700);socket=temporary/'socket';socket.mkdir(mode=0o700)
        pg_env=temporary/'postgres.env';pg_env.write_text('POSTGRES_USER=fixture_owner\nPOSTGRES_DB=postgres\nPOSTGRES_PASSWORD='+secrets.token_hex(24)+'\n');pg_env.chmod(0o600)
        stage='create-owned-database';durable('api-create-intent.json',dict(token=token,containerName=name,imageId=image))
        container=run([docker,'run','--pull=never','--detach','--name',name,'--label','cn-startup-fixture='+token,
                       '--memory',str(MEMORY_BYTES),'--memory-swap',str(MEMORY_BYTES),'--tmpfs',PGDATA+':rw,size='+str(TMPFS_BYTES),'--env-file',pg_env,'--mount','type=bind,src='+str(socket)+',dst=/var/run/postgresql',image,
                       *postgres_command()]).stdout.decode().strip()
        need(re.fullmatch('[a-f0-9]{64}',container),'CONTAINER_ID')
        info=json.loads(run([docker,'inspect',container]).stdout)[0]
        need(info['Id']==container and info['Config']['Labels']['cn-startup-fixture']==token and info['Image']==image,'CONTAINER_IDENTITY')
        durable('api-create-receipt.json',dict(token=token,containerName=name,imageId=image,containerId=container))
        validate_container_storage(info,socket)
        stage='readiness';end=time.monotonic()+60
        # Entrypoint temporary init server is not PID 1 postgres. Never migrate against it.
        while True:
            ready=run([docker,'exec',container,'sh','-c','test "$(cat /proc/1/comm)" = postgres && pg_isready -U fixture_owner'],check=False)
            if ready.returncode==0:break
            need(time.monotonic()<end,'PG_START_TIMEOUT');time.sleep(.2)
        check_preload(docker,container)
        need(run([docker,'exec',container,'psql','-XAt','-U','fixture_owner','-d','postgres','-c',"SELECT name FROM pg_available_extensions WHERE name IN ('vector','age') ORDER BY name"]).stdout.split()==[b'age',b'vector'],'EXTENSIONS_REQUIRED')
        run([docker,'exec',container,'timeout','--version'])
        config=temporary/'config.json';config.write_text(json.dumps(dict(host=str(socket),port=5432,user='fixture_owner',database='postgres',seed=seed,containerId=container,ownerToken=token,imageId=image,checkoutRevision=revision,python=sys.executable)));config.chmod(0o600)
        stage='original-durable-driver'
        bridge=ROOT/'tests/fixtures/cn-postgres-lifecycle/driver_bridge.py'
        observed=run(bridge_command(bridge,'--config',config,'--node',node,'--loader',loader,
                      '--fixture',ROOT/'tests/fixtures/cn-application-recovery-complete/diagnostic-launcher.ts',
                      '--entry-source',ROOT/'.harness/scripts/vm/cn-release-advance.py','--driver-source',ROOT/'scripts/cn-release-fixed-driver.py'),
                     timeout=650,check=False,cwd=ROOT)
        need(observed.returncode==0,'DURABLE_CHAIN_FAILED')
        result=json.loads(observed.stdout);need(result['verified']is True and result['actualApplicationMigrator']is True and result['driverBridge']['actualDurableCore']is True and result['fullControlSchemaFixture']is True and result['aRoute']['originalARouteFactory']is True and result['holdDrift']['holdDriftRejected']is True,'ACTUAL_CHAIN_REQUIRED')
        stage='complete'
    except Exception as error:
        # No error body, credentials, SQL text or raw process output.
        failure={'type':type(error).__name__,'stage':stage,'reason':'DURABLE_CHAIN_FAILED' if str(error)=='DURABLE_CHAIN_FAILED' else 'UNCLASSIFIED'}
        if temporary is not None:
            diagnostic=temporary/'failure-diagnostic.json'
            if diagnostic.is_file() and not diagnostic.is_symlink() and diagnostic.stat().st_size<=16384:failure['diagnostic']=json.loads(diagnostic.read_bytes())
        if 'observed'in locals():failure.update(exitCode=observed.returncode,stderrBytes=len(observed.stderr),stderrSha256=hashlib.sha256(observed.stderr).hexdigest(),bridgeDiagnostic=failure_projection(observed.stderr,temporary))
    finally:
        DEADLINE=time.monotonic()+60  # Separate bounded cleanup, never a new action budget.
        if registry_fd is not None:os.close(registry_fd)
        if temporary is not None and docker:
            try:
                # Exact name+label+image reconcile also covers a lost create ACK; never run again.
                xs=json.loads(run([docker,'ps','--all','--no-trunc','--format','{{json .}}','--filter','name=^/'+name+'$']).stdout.decode().strip()or'null')
                if xs:
                    current=json.loads(run([docker,'inspect',xs['ID']]).stdout)[0]
                    need(current['Name']=='/'+name and current['Config']['Labels'].get('cn-startup-fixture')==token and current['Image']==image,'CLEANUP_IDENTITY')
                    run([docker,'rm','--force',current['Id']])
                need(run([docker,'ps','--all','--quiet','--no-trunc','--filter','label=cn-startup-fixture='+token]).stdout.strip()==b'','CLEANUP_NOT_EMPTY')
                cleanup=True
            except Exception:failure={'type':'CleanupUnproven','stage':'cleanup'}
        if temporary is not None and cleanup:shutil.rmtree(temporary)
    passed=failure is None and cleanup and result is not None
    import importlib.util
    spec=importlib.util.spec_from_file_location('complete_development_outcome',ROOT/'scripts/cn-release-development-outcome.py');outcome=importlib.util.module_from_spec(spec);spec.loader.exec_module(outcome)
    known=development_failure(failure,observed.returncode if 'observed'in locals()else None)
    outcome.write('linux-application-recovery-complete',business_failure=bool(known),inner_cleanup=cleanup is True,reason='known-business-failure' if known else 'not-continuable')
    print(json.dumps(dict(kind='cn-real-app-migration-recovery-linux-v1',verified=passed,failure=failure,result=result,
                         memoryLimitBytes=MEMORY_BYTES,pgdataTmpfsBytes=TMPFS_BYTES,cleanupVerified=cleanup,durationSeconds=round(time.monotonic()-started,3),productionAccepted=False,candidateValidation=False,imagePulledByTest=False)))
    return 0 if passed else 1
if __name__=='__main__':raise SystemExit(main())
