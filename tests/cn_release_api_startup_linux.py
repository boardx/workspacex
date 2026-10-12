#!/usr/bin/env python3
"""GitHub-only real startApi fixture; no pulls, cloud calls or production inputs.

Setup must provide an already-built immutable PG16+vector+AGE image and complete
repository Node dependencies. Each invocation owns a fresh container and each
scenario a fresh fully migrated DB. Missing dependencies fail, never skip.
"""
import hashlib,json,os,re,secrets,selectors,shutil,signal,stat,subprocess,sys,tempfile,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
SCENARIOS=('baseline','normal','cleanup-denied','seed-denied')
def need(value,code):
    if not value:raise RuntimeError(code)
def main():
    if sys.platform!='linux':
        print(json.dumps({'verified':False,'status':'CAPABILITY_UNAVAILABLE','reason':'LINUX_REQUIRED','productionAccepted':False}));return 2
    started=time.monotonic();records=[];container=None;name='wsx-cn-api-'+secrets.token_hex(8);token=os.environ.get('CN_API_STARTUP_OWNER_TOKEN','')
    env={'PATH':os.environ.get('PATH','/usr/bin:/bin'),'LANG':'C.UTF-8'}
    docker=shutil.which('docker');temporary=None;stage='capability';cleanup=False;registry_fd=None
    def run(args,*,timeout=60,check=True,childenv=None,cwd=None):
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
    try:
        need(re.fullmatch('[a-f0-9]{32}',token),'OUTER_CLEANUP_OWNER_TOKEN_REQUIRED')
        registry=Path(os.environ.get('CN_API_STARTUP_OWNER_DIR','/missing-owner-registry'))
        registry_fd=os.open(registry,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
        registry_stat=os.fstat(registry_fd)
        need(registry_stat.st_uid==os.geteuid()==0 and stat.S_IMODE(registry_stat.st_mode)==0o700,'OWNER_REGISTRY')
        def durable(name,value):
            fd=os.open(name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=registry_fd)
            with os.fdopen(fd,'w')as file:
                json.dump(value,file);file.write('\n');file.flush();os.fsync(file.fileno())
            os.fsync(registry_fd)
        need(docker is not None,'DOCKER_REQUIRED')
        image=os.environ.get('CN_API_STARTUP_PG_IMAGE','')
        need(re.fullmatch(r'sha256:[a-f0-9]{64}',image),'IMMUTABLE_LOCAL_IMAGE_REQUIRED')
        facts=json.loads(run([docker,'image','inspect',image]).stdout)
        need(len(facts)==1 and facts[0]['Id']==image and facts[0]['Os']=='linux' and facts[0]['Architecture']=='amd64','LOCAL_IMAGE_IDENTITY')
        node=Path(os.environ.get('CN_API_STARTUP_NODE',shutil.which('node')or'/missing')).resolve()
        loader=ROOT/'apps/api/node_modules/tsx/dist/loader.mjs'
        need(node.is_file() and loader.is_file(),'FULL_NODE_DEPENDENCIES_REQUIRED')
        need(run([node,'-p','process.versions.node']).stdout.decode().startswith('22.'),'NODE22_REQUIRED')
        temporary=Path(tempfile.mkdtemp(prefix='cn-api-startup-'));temporary.chmod(0o700)
        password=secrets.token_hex(24);envfile=temporary/'postgres.env'
        envfile.write_text('POSTGRES_USER=postgres\nPOSTGRES_PASSWORD='+password+'\nPOSTGRES_DB=postgres\n');envfile.chmod(0o600)
        stage='create-owned-postgres'
        # Name/label are durable local identity before a potentially lost Docker response.
        durable('api-create-intent.json',{'token':token,'containerName':name,'imageId':image})
        result=run([docker,'run','--pull=never','--detach','--name',name,'--label','cn-startup-fixture='+token,
                    '--env-file',envfile,'--publish','127.0.0.1::5432',image])
        container=result.stdout.decode().strip();need(re.fullmatch('[a-f0-9]{64}',container),'CONTAINER_ID')
        info=json.loads(run([docker,'inspect',container]).stdout)[0]
        need(info['Config']['Labels']['cn-startup-fixture']==token and info['Image']==image,'CONTAINER_BINDING')
        durable('api-create-receipt.json',{'token':token,'containerName':name,'imageId':image,'containerId':container})
        binding=info['NetworkSettings']['Ports']['5432/tcp'];need(len(binding)==1 and binding[0]['HostIp']=='127.0.0.1','LOOPBACK_ONLY')
        port=binding[0]['HostPort'];need(port.isdigit(),'PG_PORT')
        stage='postgres-readiness';end=time.monotonic()+60
        while run([docker,'exec',container,'pg_isready','-h','127.0.0.1','-U','postgres'],check=False).returncode:
            need(time.monotonic()<end,'PG_START_TIMEOUT');time.sleep(.2)
        extensions=run([docker,'exec',container,'psql','-XAt','-U','postgres','-c',"SELECT name FROM pg_available_extensions WHERE name IN ('vector','age') ORDER BY name"]).stdout
        need(extensions.split()==[b'age',b'vector'],'VECTOR_AGE_REQUIRED')
        baseline=None
        for scenario in SCENARIOS:
            stage=scenario;database='cn_startup_'+secrets.token_hex(8)
            create=[docker,'exec',container,'createdb','-U','postgres']
            if baseline:create.extend(['--template',baseline])
            run([*create,database])
            folder=temporary/scenario;folder.mkdir(mode=0o700);output=folder/'receipt.json'
            appenv={**env,'HOME':str(folder),'TMPDIR':str(folder),'NODE_ENV':'test','CN_API_STARTUP_FIXTURE':'1',
                'PGHOST':'127.0.0.1','PGPORT':port,'PGDATABASE':database,'WORKSPACEX_DB':database,
                'APP_DB_USER':'app_rw','APP_DB_PASSWORD':'app_rw_dev','MIGRATION_DB_USER':'postgres',
                'MIGRATION_DB_PASSWORD':password,'DIAG_DB_USER':'app_diag_ro','DIAG_DB_PASSWORD':'app_diag_ro_dev',
                'TSX_TSCONFIG_PATH':str(ROOT/'apps/api/tsconfig.json'),'SKILL_STARTER_PACK_ROOT':str(ROOT/'skills/starter-packs')}
            result=run([node,'--import',loader,ROOT/'tests/fixtures/cn-api-startup/startup.ts',scenario,output],
                       timeout=420,check=False,childenv=appenv,cwd=folder)
            record={'scenario':scenario,'exitCode':result.returncode,
                    'stdoutBytes':len(result.stdout),'stdoutSha256':hashlib.sha256(result.stdout).hexdigest(),
                    'stderrBytes':len(result.stderr),'stderrSha256':hashlib.sha256(result.stderr).hexdigest()}
            if output.is_file():
                need(not output.is_symlink() and output.stat().st_size<=16384,'RECEIPT_BOUND')
                record['receipt']=json.loads(output.read_bytes())
            records.append(record)
            need(result.returncode==0 and record.get('receipt',{}).get('verified')is True,'STARTUP_SCENARIO_FAILED')
            if scenario=='baseline':
                baseline=database
                run([docker,'exec',container,'psql','-XAt','-U','postgres','-c',f'ALTER DATABASE {baseline} WITH ALLOW_CONNECTIONS false'])
                locked=run([docker,'exec',container,'psql','-XAt','-U','postgres','-c',f"SELECT datallowconn FROM pg_database WHERE datname='{baseline}'"]).stdout.strip()
                need(locked==b'f','BASELINE_NOT_LOCKED')
        stage='complete'
    except Exception as error:
        failure={'type':type(error).__name__,'stage':stage}
    else:failure=None
    finally:
        if registry_fd is not None:os.close(registry_fd)
        if docker and temporary is not None:
            # Also reconcile a lost run ACK by our unique name, without issuing run again.
            try:
                found=run([docker,'inspect',name],check=False)
                if found.returncode==0:
                    xs=json.loads(found.stdout);need(len(xs)==1 and xs[0]['Config']['Labels'].get('cn-startup-fixture')==token,'CLEANUP_OWNERSHIP')
                    owned=xs[0]['Id'];need(re.fullmatch('[a-f0-9]{64}',owned),'CLEANUP_ID')
                    run([docker,'rm','--force',owned]);need(run([docker,'inspect',owned],check=False).returncode!=0,'CLEANUP_STILL_EXISTS')
                else:
                    # Successful daemon query is needed; CLI transport failure is not absence.
                    run([docker,'info','--format','{{.ServerVersion}}'])
                    need(run([docker,'ps','--all','--quiet','--filter','name=^/'+name+'$']).stdout.strip()==b'','CLEANUP_UNRESOLVED')
                cleanup=True
            except Exception:failure={'type':'CleanupUnproven','stage':'cleanup'}
        if temporary is not None and cleanup:shutil.rmtree(temporary)
    passed=failure is None and cleanup and len(records)==len(SCENARIOS)
    print(json.dumps({'kind':'cn-real-api-startup-linux-v1','verified':passed,'status':'PASSED'if passed else'FAILED_OR_CAPABILITY_UNAVAILABLE',
                      'failure':failure,'scenarios':records,'cleanupVerified':cleanup,'durationSeconds':round(time.monotonic()-started,3),
                      'realStartApi':passed,'freshScenarioClones':sum(r.get('receipt',{}).get('verifiedMigrationClone')is True for r in records),'realFullMigrationDatabases':sum(r.get('receipt',{}).get('fullMigrations') is True for r in records),'productionAccepted':False,
                      'queuedModelWorkerExecutionTested':False,'cloudCalls':0,'imagePulledByTest':False,'startupSourceSha256':hashlib.sha256((ROOT/'apps/api/src/main.ts').read_bytes()).hexdigest()}))
    return 0 if passed else 1
if __name__=='__main__':raise SystemExit(main())
