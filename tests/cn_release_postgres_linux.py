#!/usr/bin/env python3
"""Real isolated PostgreSQL + actual app migrator; no cloud/production fixture.

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
    def run(args,*,input=None,timeout=40,check=True):
        command=[str(x)for x in args]
        process=subprocess.Popen(command,stdin=subprocess.PIPE if input is not None else subprocess.DEVNULL,
                                 stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True,
                                 env=env,cwd=str(temp) if temp is not None else '/',**identity)
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
        fixture=ROOT/'tests/fixtures/cn-postgres-isolation/migration.mjs';put('migration.mjs',fixture.read_bytes())
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
        base=[bindir/'psql','-X','-A','-t','-v','ON_ERROR_STOP=1','-h',socket,'-U','fixture_owner']
        def sql(database,text):return run(base+['-d',database,'-c',text]).stdout
        for database in ('cn_fixture','restore_fixture','us_canary'):
            sql('postgres','CREATE DATABASE '+database)
        sql('cn_fixture',"CREATE TABLE a_before_conflict(value text);INSERT INTO a_before_conflict VALUES('synthetic-first');CREATE TABLE old_data(id integer PRIMARY KEY,value text NOT NULL);INSERT INTO old_data VALUES(1,'synthetic-cn');")
        sql('us_canary',"CREATE TABLE keep_data(value text);INSERT INTO keep_data VALUES('synthetic-us-unchanged');")
        old=sql('cn_fixture','TABLE old_data');us_before=sql('us_canary','TABLE keep_data')
        require(sql('postgres','SHOW listen_addresses').strip()==b'','TCP_MUST_BE_DISABLED')
        dump=run([bindir/'pg_dump','-h',socket,'-U','fixture_owner','-Fc','--no-owner','--no-acl','cn_fixture']).stdout
        archive=put('baseline.dump',dump)
        restore=[bindir/'pg_restore','-h',socket,'-U','fixture_owner','--exit-on-error','--single-transaction','--no-owner','--no-acl','--dbname=restore_fixture']
        run(restore+[archive]);require(sql('restore_fixture','TABLE old_data')==old,'RESTORED_ROWS_CHANGED')
        checks.append('real_pg_dump_custom_archive_restores_exact_old_rows')
        # Prove actual DDL occurs BEFORE the conflict: replay just the leading
        # table TOC entry successfully, remove it, then replay the original full
        # archive under --single-transaction. Its later old_data conflict must
        # roll that leading CREATE TABLE back, not merely fail at the first DDL.
        catalog=run([bindir/'pg_restore','--list',archive]).stdout.decode()
        table_entries=[line for line in catalog.splitlines() if ' TABLE public ' in line]
        first=next(i for i,line in enumerate(table_entries) if ' TABLE public a_before_conflict ' in line)
        conflict=next(i for i,line in enumerate(table_entries) if ' TABLE public old_data ' in line)
        require(first<conflict,'RESTORE_CONFLICT_ORDER_UNPROVEN')
        sql('restore_fixture','DROP TABLE a_before_conflict')
        only_first=put('first-table.list',(table_entries[first]+'\n').encode())
        run(restore+['--use-list',only_first,archive])
        require(sql('restore_fixture',"SELECT to_regclass('public.a_before_conflict')").strip()==b'a_before_conflict','RESTORE_FIRST_DDL_NOT_EXECUTED')
        sql('restore_fixture','DROP TABLE a_before_conflict')
        failed=run(restore+[archive],check=False)
        require(failed.returncode!=0 and sql('restore_fixture','TABLE old_data')==old,'RESTORE_CONFLICT_NOT_ATOMIC')
        require(sql('restore_fixture',"SELECT to_regclass('public.a_before_conflict') IS NULL").strip()==b't','RESTORE_PARTIAL_DDL_NOT_ROLLED_BACK')
        checks.append('restore_conflict_rolls_back_without_overwrite')
        truncated=put('truncated.dump',dump[:max(1,len(dump)//2)])
        sql('postgres','CREATE DATABASE corrupt_fixture')
        bad=[str(x).replace('--dbname=restore_fixture','--dbname=corrupt_fixture')for x in restore]
        failed=run(bad+[truncated],check=False)
        require(failed.returncode!=0,'TRUNCATED_ARCHIVE_ACCEPTED')
        require(sql('corrupt_fixture',"SELECT count(*) FROM pg_tables WHERE schemaname='public'").strip()==b'0','TRUNCATED_RESTORE_LEFT_SCHEMA')
        checks.append('truncated_archive_leaves_empty_destination')
        cfg=put('config.json',json.dumps({'host':str(socket),'user':'fixture_owner','database':'cn_fixture','port':5432}).encode())
        result=run([node,'--import',loader,temp/'migration.mjs',cfg],timeout=60)
        migration=json.loads(result.stdout);require(migration['actualApplicationMigrator'] is True,'MIGRATOR_PROOF')
        checks+=migration['tests']
        require(sql('us_canary','TABLE keep_data')==us_before,'US_CANARY_CHANGED')
        require(sql('cn_fixture','TABLE old_data')==old,'OLD_ROWS_CHANGED')
        checks.append('separate_us_database_canary_unchanged')
        run([pgctl,'-D',data,'-m','immediate','-w','stop'],timeout=30);started=False
        # Real crash/restart durability check using the same isolated cluster only.
        bad_start=run([pgctl,'-D',data,'-l',temp/'server.log','-o',options+' -c port=invalid','-w','start'],timeout=30,check=False)
        require(bad_start.returncode!=0,'INVALID_START_ACCEPTED')
        require(run([pgctl,'-D',data,'status'],check=False).returncode==3,'FAILED_START_LEFT_SERVER')
        checks.append('invalid_postgres_start_refused_before_recovery')
        run(start_args,timeout=60);started=True
        require(sql('postgres','SHOW listen_addresses').strip()==b'','RESTART_TCP_ENABLED')
        require(sql('cn_fixture','SELECT count(*) FROM once_probe').strip()==b'1','RESTART_DUPLICATED_DATA')
        require(sql('cn_fixture','TABLE old_data')==old,'RESTART_LOST_OLD_ROWS')
        checks.append('real_postgres_crash_restart_preserves_committed_old_and_new_rows')
        receipt={'status':'PASSED','verified':True,'tests':checks,'testCount':len(checks),
                 'migrationSourceSha256':hashlib.sha256(raw).hexdigest(),'isolatedDependencyBytes':module_bytes,'archiveSha256':hashlib.sha256(dump).hexdigest(),
                 'postgresVersion':run([bindir/'postgres','--version']).stdout.decode().strip(),
                 'realPostgres':True,'databaseScope':'fresh-local-synthetic-cluster','tcpEnabled':False,
                 'productionAccepted':False,'fullReleaseDriverTested':False,'rdsBackupPipelineTested':False,'cloudCalls':0}
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
