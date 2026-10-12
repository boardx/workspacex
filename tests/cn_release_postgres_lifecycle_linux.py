#!/usr/bin/env python3
"""Real PostgreSQL lifecycle using one epoch backup and actual app migrator.

Uses installed Linux PostgreSQL binaries, a fresh non-root initdb and private
Unix socket (TCP disabled). pg_dump/pg_restore are tool-layer tests, not claims
of RDS backup or full release-driver acceptance. Missing capabilities fail.
"""
import hashlib,json,os,pwd,shutil,signal,subprocess,sys,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
TOOLS=('initdb','pg_ctl','psql','pg_dump','pg_restore')
def require(ok,code):
    if not ok:raise RuntimeError(code)
def main():
    if sys.platform!='linux':
        print(json.dumps({'status':'CAPABILITY_UNAVAILABLE','reason':'LINUX_REQUIRED','verified':False}));return 2
    temp=None;started=False;initialized=False;pgctl=None;identity={};env={};checks=[]
    def run(args,*,input=None,timeout=40,check=True,as_root=False):
        command=[str(x)for x in args]
        process=subprocess.Popen(command,stdin=subprocess.PIPE if input is not None else subprocess.DEVNULL,
                                 stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True,
                                 env=env,cwd=str(temp) if temp is not None else '/',**({} if as_root else identity))
        try:
            stdout,stderr=process.communicate(input=input,timeout=timeout)
        except subprocess.TimeoutExpired:
            # Bound inherited output pipes too. The suite's enclosing Linux
            # cgroup additionally contains descendants that create sessions.
            try:os.killpg(process.pid,signal.SIGKILL)
            except ProcessLookupError:pass
            process.wait(timeout=5)
            raise
        finally:
            for stream in (process.stdin,process.stdout,process.stderr):
                if stream is not None:stream.close()
        result=subprocess.CompletedProcess(command,process.returncode,stdout,stderr)
        if check:result.check_returncode()
        return result
    try:
        seed=int(os.environ.get('CN_RELEASE_SIMULATION_SEED','0'))
        require(0<=seed<=2147483647,'SIMULATION_SEED_BOUND')
        candidates=[]
        configured=os.environ.get('CN_TEST_PG_BIN')
        if configured:candidates.append(Path(configured))
        candidates+=sorted(Path('/usr/lib/postgresql').glob('*/bin'),reverse=True)
        found=shutil.which('initdb')
        if found:candidates.append(Path(found).parent)
        bindir=next((p.resolve()for p in candidates if all((p/n).is_file() and os.access(p/n,os.X_OK)for n in TOOLS)),None)
        require(bindir is not None,'POSTGRES_BINARIES_REQUIRED')
        runtime=Path(os.environ.get('CN_ARCHIVE_TEST_RUNTIME','/missing')).resolve()
        require((runtime/'node_modules/tsx/dist/loader.mjs').is_file()and(runtime/'node_modules/pg/package.json').is_file(),'TSX_PG_RUNTIME_REQUIRED')
        node=Path(os.environ.get('CN_ARCHIVE_TEST_NODE',shutil.which('node')or'/missing')).resolve()
        require(node.is_file(),'NODE_REQUIRED')
        account=pwd.getpwnam('postgres') if os.geteuid()==0 else pwd.getpwuid(os.geteuid())
        if os.geteuid()==0:identity={'user':account.pw_uid,'group':account.pw_gid,'extra_groups':[]}
        require(account.pw_uid!=0,'NONROOT_POSTGRES_REQUIRED')
        temp=Path(tempfile.mkdtemp(prefix='wsx-pg-fixture-',dir='/tmp')).resolve()
        if os.geteuid()==0:os.chown(temp,account.pw_uid,account.pw_gid)
        env={'PATH':str(bindir)+':/usr/bin:/bin','HOME':str(temp),'LANG':'C.UTF-8','PGCONNECT_TIMEOUT':'5'}
        def put(name,raw):
            p=temp/name;p.write_bytes(raw);p.chmod(0o600)
            if os.geteuid()==0:os.chown(p,account.pw_uid,account.pw_gid)
            return p
        # Never change runner-owned dependency permissions. A postgres child
        # cannot rely on traversing RUNNER_TEMP or the root-only checkout.
        original_modules=runtime/'node_modules';module_bytes=0
        for item in original_modules.rglob('*'):
            if item.is_symlink():
                require(not item.is_dir() and item.resolve().is_relative_to(original_modules.resolve()),'RUNTIME_LINK_SCOPE')
            if item.is_file():
                module_bytes+=item.stat().st_size
                require(module_bytes<=512*1024*1024,'RUNTIME_COPY_BOUND')
        copied_modules=temp/'node_modules';shutil.copytree(original_modules,copied_modules,symlinks=False)
        for item in (copied_modules,*copied_modules.rglob('*')):
            if os.geteuid()==0:os.chown(item,account.pw_uid,account.pw_gid)
            if item.is_dir():item.chmod(0o700)
        source=ROOT/'apps/api/src/infrastructure/db/migrator.ts'
        raw=source.read_bytes();put('migrator.ts',raw)
        put('package.json',b'{"type":"module"}\n')
        fixture=ROOT/'tests/fixtures/cn-postgres-lifecycle/lifecycle.mjs';put('lifecycle.mjs',fixture.read_bytes())
        loader=copied_modules/'tsx/dist/loader.mjs'
        # Executes under the exact non-root account, before any initdb/server.
        run([node,'--import',loader,'--input-type=module','-e',
             "const m=await import('./migrator.ts');if(typeof m.migrate!=='function')process.exit(3)"],timeout=30)
        socket=temp/'socket';socket.mkdir(mode=0o700)
        if os.geteuid()==0:os.chown(socket,account.pw_uid,account.pw_gid)
        data=temp/'data';pgctl=bindir/'pg_ctl'
        run([bindir/'initdb','-D',data,'-A','trust','-U','fixture_owner','--no-locale'],timeout=60);initialized=True
        options=f"-c listen_addresses='' -c unix_socket_directories='{socket}' -c unix_socket_permissions=0700 -c fsync=on"
        start_args=[pgctl,'-D',data,'-l',temp/'server.log','-o',options,'-w','start']
        run(start_args,timeout=60);started=True
        cfg=put('config.json',json.dumps({'host':str(socket),'user':'fixture_owner','database':'postgres','port':5432,'binDir':str(bindir),'seed':seed}).encode())
        require(os.geteuid()==0,'DURABLE_ENTRY_ROOT_CGROUP_REQUIRED')
        bridge=ROOT/'tests/fixtures/cn-postgres-lifecycle/driver_bridge.py'
        result=run([sys.executable,'-I','-B',bridge,'--config',cfg,'--node',node,
                    '--loader',loader,'--fixture',temp/'lifecycle.mjs',
                    '--entry-source',ROOT/'.harness/scripts/vm/cn-release-advance.py',
                    '--driver-source',ROOT/'scripts/cn-release-fixed-driver.py'],timeout=300,as_root=True)
        receipt=json.loads(result.stdout)
        require(receipt['verified'] is True and receipt['actualApplicationMigrator'] is True,'LIFECYCLE_UNPROVEN')
        require(receipt['driverBridge']['actualDurableCore'] is True and receipt['driverBridge']['status']=='CHAIN_COMPLETED','DURABLE_DRIVER_UNPROVEN')
        require(receipt['seed']==seed,'SEED_CHANGED')
        checks=receipt['tests']
        receipt.update(status='PASSED',migrationSourceSha256=hashlib.sha256(raw).hexdigest(),
                       fixtureSourceSha256=hashlib.sha256(fixture.read_bytes()).hexdigest(),
                       postgresVersion=run([bindir/'postgres','--version']).stdout.decode().strip(),
                       isolatedDependencyBytes=module_bytes,testCount=len(checks),tcpEnabled=False)
        require(run([bindir/'psql','-XAt','-h',socket,'-U','fixture_owner','-d','postgres','-c','SHOW listen_addresses']).stdout.strip()==b'','TCP_ENABLED')
    except Exception as error:
        receipt={'status':'FAILED_OR_CAPABILITY_UNAVAILABLE','verified':False,'error':type(error).__name__,'tests':checks,'productionAccepted':False}
    finally:
        try:
            if initialized:
                status=run([pgctl,'-D',temp/'data','status'],check=False).returncode
                require(status in (0,3),'POSTGRES_STATUS_UNKNOWN')
                if status==0:run([pgctl,'-D',temp/'data','-m','immediate','-w','stop'],timeout=30)
                require(run([pgctl,'-D',temp/'data','status'],check=False).returncode==3,'POSTGRES_STILL_RUNNING')
                started=False
            if temp is not None:
                require(not started,'POSTGRES_CLEANUP_UNPROVEN');shutil.rmtree(temp)
        except Exception as error:
            receipt={'status':'CLEANUP_UNPROVEN','verified':False,'error':type(error).__name__,'tests':checks,'productionAccepted':False}
    print(json.dumps(receipt,sort_keys=True));return 0 if receipt['verified']else 1
if __name__=='__main__':sys.exit(main())
